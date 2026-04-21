"""Merge duplicate DnaFamily rows created by the old member-set-based ID.

Why
---
The pre-fix ``_family_id_for(cand)`` hashed the exact sorted token-address
list, so every time DBSCAN re-clustered and the membership shifted by even
one token, a fresh family row was minted. Over many pipeline runs the DB
accumulated duplicates with identical ``event_title`` but disjoint-ish
member sets - e.g. 3x "Justice for Binance Meme Surge" holding 4,294
mutations in total.

This script collapses those duplicates into a canonical family (the one
with the largest ``mutations_count``) and re-parents every child row
(family_mutations, family_centers, family_references, family_timeline,
family_timepoints) to it. The duplicate families are then deleted.

Strategy
--------
Two kinds of merges:

1. Exact-title merges - every group of families sharing a case-insensitive
   event_title collapses to one canonical row.

2. Near-signature merges - families whose ``signature_vector`` cosine
   distance is below ``SIGNATURE_MERGE_THRESHOLD`` AND whose titles are
   *semantically similar* (share >=60%% of non-stopword tokens) also
   collapse.

Both passes are idempotent; re-running after a clean DB does nothing.

Usage
-----
    python scripts/merge_duplicate_families.py --dry-run
    python scripts/merge_duplicate_families.py        # apply
"""

from __future__ import annotations

import argparse
from collections import defaultdict

from loguru import logger
from sqlalchemy import func, text

from memedna.db import SessionLocal
from memedna.models import (
    DnaFamily,
    FamilyCenter,
    FamilyMutation,
    FamilyReference,
    FamilyTimeline,
    FamilyTimepoint,
)


STOPWORDS = {
    "a", "an", "and", "the", "of", "for", "to", "in", "on", "at",
    "meme", "tokens", "wave", "surge", "drop", "launch", "token",
}

SIGNATURE_MERGE_THRESHOLD = 0.12  # cosine distance cap for a "same-event" merge


def _title_key(title: str) -> str:
    return " ".join(
        w for w in title.lower().split() if w.isalnum() or any(c.isalnum() for c in w)
    ).strip()


def _title_tokens(title: str) -> set[str]:
    return {
        "".join(c for c in w.lower() if c.isalnum())
        for w in title.split()
    } - STOPWORDS - {""}


def _title_similar(a: str, b: str, ratio: float = 0.6) -> bool:
    ta, tb = _title_tokens(a), _title_tokens(b)
    if not ta or not tb:
        return False
    overlap = len(ta & tb) / max(len(ta), len(tb))
    return overlap >= ratio


def _find_title_duplicates(session) -> list[list[str]]:
    """Return groups of family IDs sharing an identical (normalised) title."""
    rows = session.execute(
        text(
            "SELECT id, event_title, mutations_count "
            "FROM dna_families ORDER BY mutations_count DESC"
        )
    ).all()
    groups: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for fid, title, muts in rows:
        groups[_title_key(title)].append((fid, int(muts or 0)))
    return [
        [fid for fid, _ in sorted(ids, key=lambda x: -x[1])]
        for ids in groups.values()
        if len(ids) > 1
    ]


def _find_signature_duplicates(session) -> list[list[str]]:
    """Return groups of family IDs whose signature vectors are near-duplicate.

    Uses pgvector's cosine-distance operator ``<=>`` and only merges when
    titles are semantically similar (prevents collapsing two unrelated
    events that happen to embed close).
    """
    sql = """
        SELECT a.id AS a_id, b.id AS b_id,
               a.event_title AS a_title, b.event_title AS b_title,
               a.mutations_count AS a_muts, b.mutations_count AS b_muts,
               (a.signature_vector <=> b.signature_vector) AS dist
        FROM dna_families a
        JOIN dna_families b
          ON a.id < b.id
         AND a.signature_vector IS NOT NULL
         AND b.signature_vector IS NOT NULL
        WHERE (a.signature_vector <=> b.signature_vector) < :thresh
        ORDER BY dist ASC
    """
    rows = session.execute(
        text(sql), {"thresh": SIGNATURE_MERGE_THRESHOLD}
    ).mappings().all()

    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent.get(x, x) != x:
            x = parent[x]
        return x

    def union(a: str, b: str, a_m: int, b_m: int) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        # Root the bigger-mutations family so the canonical pick is stable.
        if a_m >= b_m:
            parent[rb] = ra
        else:
            parent[ra] = rb

    for r in rows:
        if not _title_similar(r["a_title"], r["b_title"]):
            continue
        union(r["a_id"], r["b_id"], int(r["a_muts"] or 0), int(r["b_muts"] or 0))

    clusters: dict[str, list[str]] = defaultdict(list)
    for fid in parent:
        clusters[find(fid)].append(fid)
    for root, members in clusters.items():
        if root not in members:
            members.append(root)
    return [sorted(set(m)) for m in clusters.values() if len(m) > 1]


def _merge_group(session, group: list[str], dry_run: bool) -> tuple[str, list[str]]:
    """Merge ``group`` into its canonical member (largest mutations_count)."""
    rows = session.execute(
        text(
            "SELECT id, mutations_count, confidence_score, created_at "
            "FROM dna_families WHERE id = ANY(:ids)"
        ),
        {"ids": group},
    ).mappings().all()
    if not rows:
        return "", []
    rows_sorted = sorted(
        rows,
        key=lambda r: (
            -(int(r["mutations_count"] or 0)),
            -float(r["confidence_score"] or 0.0),
            r["created_at"],
        ),
    )
    canonical = rows_sorted[0]["id"]
    losers = [r["id"] for r in rows_sorted[1:]]
    if dry_run:
        return canonical, losers

    # Re-parent every child table. Each table has its own conflict shape
    # so we handle them individually.
    for loser in losers:
        # family_mutations: composite PK (family_id, token_address). Skip
        # rows the canonical already owns for that token.
        session.execute(
            text(
                "UPDATE family_mutations m SET family_id = :canonical "
                "WHERE m.family_id = :loser "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM family_mutations c "
                "  WHERE c.family_id = :canonical "
                "    AND c.token_address = m.token_address"
                ")"
            ),
            {"canonical": canonical, "loser": loser},
        )
        # Whatever the canonical already covers - just drop the dupe rows.
        session.execute(
            text("DELETE FROM family_mutations WHERE family_id = :loser"),
            {"loser": loser},
        )

        # family_centers: single-PK per family. Keep the canonical if it
        # already has a row.
        session.execute(
            text(
                "DELETE FROM family_centers "
                "WHERE family_id = :loser "
                "  AND EXISTS (SELECT 1 FROM family_centers WHERE family_id = :canonical)"
            ),
            {"canonical": canonical, "loser": loser},
        )
        session.execute(
            text(
                "UPDATE family_centers SET family_id = :canonical "
                "WHERE family_id = :loser"
            ),
            {"canonical": canonical, "loser": loser},
        )

        # family_references: (family_id, url) unique. Drop duplicates.
        session.execute(
            text(
                "DELETE FROM family_references r "
                "WHERE r.family_id = :loser "
                "  AND EXISTS ("
                "    SELECT 1 FROM family_references c "
                "    WHERE c.family_id = :canonical AND c.url = r.url"
                "  )"
            ),
            {"canonical": canonical, "loser": loser},
        )
        session.execute(
            text(
                "UPDATE family_references SET family_id = :canonical "
                "WHERE family_id = :loser"
            ),
            {"canonical": canonical, "loser": loser},
        )

        # family_timeline: just re-parent, ordering gets refreshed next run.
        session.execute(
            text(
                "UPDATE family_timeline SET family_id = :canonical "
                "WHERE family_id = :loser"
            ),
            {"canonical": canonical, "loser": loser},
        )

        # family_timepoints: (family_id, bucket) unique. Sum volumes/mut
        # counts into the canonical row where buckets collide.
        session.execute(
            text(
                "UPDATE family_timepoints c SET "
                "  mutations = c.mutations + l.mutations, "
                "  volume_usd = c.volume_usd + l.volume_usd "
                "FROM family_timepoints l "
                "WHERE c.family_id = :canonical AND l.family_id = :loser "
                "  AND c.bucket = l.bucket"
            ),
            {"canonical": canonical, "loser": loser},
        )
        session.execute(
            text(
                "DELETE FROM family_timepoints l "
                "WHERE l.family_id = :loser "
                "  AND EXISTS ("
                "    SELECT 1 FROM family_timepoints c "
                "    WHERE c.family_id = :canonical AND c.bucket = l.bucket"
                "  )"
            ),
            {"canonical": canonical, "loser": loser},
        )
        session.execute(
            text(
                "UPDATE family_timepoints SET family_id = :canonical "
                "WHERE family_id = :loser"
            ),
            {"canonical": canonical, "loser": loser},
        )

    # Drop the duplicate family rows themselves and recompute mutations_count
    # + dirty=True so the next analytics pass refreshes metrics.
    if losers:
        session.execute(
            text("DELETE FROM dna_families WHERE id = ANY(:ids)"),
            {"ids": losers},
        )
    session.execute(
        text(
            "UPDATE dna_families SET "
            "  mutations_count = ("
            "    SELECT count(*) FROM family_mutations "
            "    WHERE family_id = dna_families.id"
            "  ), "
            "  dirty = true "
            "WHERE id = :canonical"
        ),
        {"canonical": canonical},
    )
    return canonical, losers


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--skip-signature", action="store_true",
        help="Only collapse exact-title duplicates; skip the cosine-distance pass.",
    )
    args = parser.parse_args()

    with SessionLocal() as session:
        total_before = int(
            session.execute(text("SELECT count(*) FROM dna_families")).scalar_one()
        )
        logger.info("Before merge: {} dna_families", total_before)

        groups = _find_title_duplicates(session)
        logger.info("exact-title duplicate groups: {}", len(groups))

        sig_groups: list[list[str]] = []
        if not args.skip_signature:
            try:
                sig_groups = _find_signature_duplicates(session)
                logger.info("signature-distance duplicate groups: {}", len(sig_groups))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "signature-distance pass failed (pgvector missing?): {}", exc,
                )

        # Merge title groups first, then signature groups. We dedupe ids so
        # the same family never gets re-processed in the second pass.
        seen: set[str] = set()
        all_groups: list[list[str]] = []
        for g in groups + sig_groups:
            g = [x for x in g if x not in seen]
            if len(g) > 1:
                all_groups.append(g)
                seen.update(g)

        merged = 0
        dropped = 0
        for g in all_groups:
            canonical, losers = _merge_group(session, g, args.dry_run)
            if not canonical:
                continue
            logger.info(
                "{} canonical={} dropped={}",
                "DRY" if args.dry_run else "MERGE", canonical, losers,
            )
            merged += 1
            dropped += len(losers)

        if not args.dry_run:
            session.commit()

        total_after = int(
            session.execute(text("SELECT count(*) FROM dna_families")).scalar_one()
        )
        logger.info(
            "Done. groups_merged={} families_dropped={} total {} -> {}",
            merged, dropped, total_before, total_after,
        )


if __name__ == "__main__":
    main()

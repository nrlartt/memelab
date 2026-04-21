"""HDBSCAN clustering over token embeddings within the pipeline window."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np
from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm import Session

try:
    import hdbscan  # type: ignore
    _HDBSCAN_AVAILABLE = True
except Exception:  # noqa: BLE001
    _HDBSCAN_AVAILABLE = False

from sklearn.cluster import DBSCAN

from ..models import Token, TokenEmbedding


@dataclass
class CandidateCluster:
    label: int
    token_addresses: list[str]
    mean_vector: list[float]
    earliest_ts: datetime
    latest_ts: datetime
    # Optional archetype hint (dog / cat / doge / elon / cz / trump / shiba /
    # pepe / bonk / ...). Populated by the archetype sub-split pass; used
    # downstream so the LLM validator can bias its event title.
    archetype: str | None = None


def _normalize(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return x / norms


# ── Archetype sub-split ──────────────────────────────────────────────────
# Even with a tight cosine threshold DBSCAN will happily drop every animal-
# mascot meme into a single mega-cluster because OpenAI's text-embedding-3
# puts cats, dogs, dogs-in-hats, dogs-on-bikes, shibas, pepes, etc. in the
# same semantic hyper-sphere. Product-wise that's useless: users want to
# see "Dog memes", "Cat memes", "Shiba wave", "CZ tribute", etc. as their
# own families. So after DBSCAN we run a deterministic keyword sub-split:
# if a cluster has members in multiple archetype buckets, we emit one
# sub-cluster per bucket. Archetypes are ordered by specificity - the
# longer / more specific pattern wins when a token matches several
# (e.g. "doge" wins over the generic "dog").
#
# Patterns are word-boundary aware (so "catalyst" does NOT match "cat")
# and case-insensitive.
ARCHETYPE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("doge",     re.compile(r"\bdoge\w*", re.I)),
    ("shiba",    re.compile(r"\b(?:shiba|shib)\w*", re.I)),
    ("pepe",     re.compile(r"\bpepe\w*", re.I)),
    ("bonk",     re.compile(r"\bbonk\w*", re.I)),
    ("floki",    re.compile(r"\bfloki\w*", re.I)),
    ("trump",    re.compile(r"\btrump\w*", re.I)),
    ("elon",     re.compile(r"\belon\w*|\bmusk\b", re.I)),
    ("cz",       re.compile(r"\bcz\b|\bchangpeng\b", re.I)),
    ("binance",  re.compile(r"\bbinance\b|\bbnb\b", re.I)),
    ("wojak",    re.compile(r"\bwojak\b|\bchad\b", re.I)),
    ("frog",     re.compile(r"\bfrog\w*", re.I)),
    ("dog",      re.compile(r"\bdog\w*|\bpuppy\b|\bpup\b", re.I)),
    ("cat",      re.compile(r"\bcat\w*|\bkitt(?:y|en)\b|\bmeow\b", re.I)),
    ("ai",       re.compile(r"\bai\b|\bagi\b|\bgpt\b|\bllm\b", re.I)),
    ("moon",     re.compile(r"\bmoon\w*|\bluna\b", re.I)),
]


def _archetype_of(text: str) -> str | None:
    """Return the most specific archetype bucket a token belongs to, or None."""
    if not text:
        return None
    for name, pat in ARCHETYPE_PATTERNS:
        if pat.search(text):
            return name
    return None


def _split_by_archetype(
    cluster: CandidateCluster,
    token_texts: dict[str, str],
    min_subcluster_size: int = 2,
) -> list[CandidateCluster]:
    """Split a cluster into archetype-flavoured sub-clusters.

    Any member that does not match a known archetype (or whose bucket is
    too small to survive ``min_subcluster_size``) stays inside the
    residual "unlabeled" cluster so we don't drop them on the floor.
    """
    buckets: dict[str, list[int]] = {}
    unlabeled: list[int] = []
    for i, addr in enumerate(cluster.token_addresses):
        bucket = _archetype_of(token_texts.get(addr, ""))
        if bucket is None:
            unlabeled.append(i)
        else:
            buckets.setdefault(bucket, []).append(i)

    # Nothing to split.
    if not buckets:
        return [cluster]
    # Collapse tiny archetype buckets back into unlabeled so we don't
    # create singleton families.
    large_buckets = {k: v for k, v in buckets.items() if len(v) >= min_subcluster_size}
    small_bucket_idxs = [i for k, v in buckets.items() if k not in large_buckets for i in v]
    unlabeled.extend(small_bucket_idxs)

    # If every member landed in one bucket, just tag the existing cluster.
    if len(large_buckets) <= 1 and not unlabeled:
        if large_buckets:
            cluster.archetype = next(iter(large_buckets.keys()))
        return [cluster]

    # If one bucket absorbs >=85% of the cluster AND the residual is
    # smaller than a sub-family, just tag the parent rather than fragment.
    total = len(cluster.token_addresses)
    if len(large_buckets) == 1:
        only_bucket, only_idx = next(iter(large_buckets.items()))
        if len(only_idx) / total >= 0.85 and len(unlabeled) < min_subcluster_size:
            cluster.archetype = only_bucket
            return [cluster]

    out: list[CandidateCluster] = []
    for name, idxs in large_buckets.items():
        out.append(_subcluster_from(cluster, idxs, archetype=name, label_suffix=name))
    if len(unlabeled) >= min_subcluster_size:
        out.append(_subcluster_from(cluster, unlabeled, archetype=None, label_suffix="rest"))
    return out


def _subcluster_from(
    parent: CandidateCluster,
    idxs: list[int],
    archetype: str | None,
    label_suffix: str,
) -> CandidateCluster:
    addrs = [parent.token_addresses[i] for i in idxs]
    # Label namespacing: parent_label * 100 keeps originals stable while
    # making sub-labels easy to trace back in logs.
    return CandidateCluster(
        label=parent.label * 100 + abs(hash(label_suffix)) % 99,
        token_addresses=addrs,
        # Parent's mean vector is a reasonable approximation; the validator
        # re-computes titles from member tokens so this is only used for
        # family signature storage.
        mean_vector=parent.mean_vector,
        earliest_ts=parent.earliest_ts,
        latest_ts=parent.latest_ts,
        archetype=archetype,
    )


def run_clustering(
    session: Session,
    lookback_hours: int = 24,
    min_cluster_size: int = 2,
    eps: float = 0.55,
    archetype_split: bool = True,
) -> list[CandidateCluster]:
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=lookback_hours)

    # Pull the actual name/symbol text alongside the embedding so the
    # archetype sub-split pass has something to pattern-match against
    # without firing extra DB lookups.
    rows = session.execute(
        select(
            Token.token_address,
            Token.created_at,
            Token.name,
            Token.symbol,
            TokenEmbedding.embedding,
        )
        .join(TokenEmbedding, TokenEmbedding.token_address == Token.token_address)
        .where(Token.created_at >= cutoff)
    ).all()
    if len(rows) < max(min_cluster_size, 2):
        logger.info(
            "Not enough embedded tokens for clustering ({} < {})",
            len(rows), min_cluster_size,
        )
        return []

    addresses = [r[0] for r in rows]
    times = [r[1] for r in rows]
    token_texts = {r[0]: f"{r[2] or ''} {r[3] or ''}" for r in rows}
    vectors = np.asarray([list(r[4]) for r in rows], dtype=np.float32)
    vectors = _normalize(vectors)

    # We deliberately prefer DBSCAN with a tuneable cosine-eps over HDBSCAN
    # here because:
    #   1. The semantic-hash fallback embedding lives on a dense hypercube,
    #      so HDBSCAN's density heuristics don't find enough mass to carve
    #      out families; it tends to collapse ~80% of tokens into noise.
    #   2. Cosine distance with `eps≈0.55` matches how users actually judge
    #      "these tokens feel like the same meme" - shared stems, shared
    #      culture-pointers. Tweak via PIPELINE_CLUSTER_EPS.
    db = DBSCAN(eps=eps, min_samples=min_cluster_size, metric="cosine", n_jobs=-1)
    labels = db.fit_predict(vectors)
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = int((labels == -1).sum())
    logger.info(
        "DBSCAN(eps={}, min_samples={}) produced {} clusters, {} noise / {} points",
        eps, min_cluster_size, n_clusters, n_noise, len(labels),
    )

    clusters: dict[int, list[int]] = {}
    for idx, lab in enumerate(labels):
        if lab < 0:
            continue
        clusters.setdefault(int(lab), []).append(idx)

    out: list[CandidateCluster] = []
    for lab, members in clusters.items():
        mv = vectors[members].mean(axis=0)
        out.append(
            CandidateCluster(
                label=lab,
                token_addresses=[addresses[i] for i in members],
                mean_vector=mv.tolist(),
                earliest_ts=min(times[i] for i in members),
                latest_ts=max(times[i] for i in members),
            )
        )

    if archetype_split:
        split_out: list[CandidateCluster] = []
        for cand in out:
            split_out.extend(
                _split_by_archetype(cand, token_texts, min_subcluster_size=min_cluster_size)
            )
        extra = len(split_out) - len(out)
        if extra > 0:
            logger.info(
                "Archetype split: {} candidate clusters -> {} ({} new sub-families)",
                len(out), len(split_out), extra,
            )
        out = split_out

    out.sort(key=lambda c: len(c.token_addresses), reverse=True)
    return out

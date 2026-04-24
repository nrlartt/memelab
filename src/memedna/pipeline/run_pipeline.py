"""Full MemeDNA pipeline: ingest → embed → cluster → validate → enrich → analyse → anchor."""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..ai.centers import extract_centers
from ..ai.clustering import CandidateCluster, run_clustering
from ..ai.embeddings import embed_tokens_needing_update
from ..ai.enrichment import (
    ClusterValidation,
    explain_mutation,
    synthesise_research,
    validate_cluster,
)
from ..ai.research import WebResearcher
from ..analytics.engine import refresh_family_metrics
from ..blockchain.registry import RegistryClient
from ..config import get_settings
from ..db import (
    ADVISORY_LOCK_PIPELINE,
    ADVISORY_LOCK_PIPELINE_INGEST,
    SessionLocal,
    release_advisory_lock,
    session_scope,
    try_advisory_lock,
)
from ..models import (
    DnaFamily,
    FamilyCenter,
    FamilyMutation,
    FamilyReference,
    FamilyTimeline,
    PipelineRun,
    Token,
)


@dataclass
class PipelineResult:
    run_id: int
    tokens_ingested: int
    families_updated: int
    degraded: bool
    stages: dict[str, float]


async def run_pipeline(
    lookback_hours: int | None = None,
    force_recluster: bool = False,
    skip_ingest: bool = False,
) -> PipelineResult:
    settings = get_settings()
    lookback_hours = lookback_hours or settings.pipeline_lookback_hours

    stages: dict[str, float] = {}
    degraded = False
    tokens_ingested = 0
    families_updated = 0

    # 1) INGEST — separate advisory lock so every replica can still pull
    # Four.Meme events while one instance works through the slow LLM stages.
    if not skip_ingest:
        from ..ingestion.four_meme import ingest_four_meme_tokens

        ingest_lock_sess = SessionLocal()
        if try_advisory_lock(ingest_lock_sess, ADVISORY_LOCK_PIPELINE_INGEST):
            try:
                with session_scope() as session:
                    t0 = time.time()
                    stats = await ingest_four_meme_tokens(
                        session,
                        since_hours=lookback_hours,
                        max_tokens=settings.pipeline_max_tokens_per_run,
                    )
                    stages["ingest"] = round(time.time() - t0, 2)
                    tokens_ingested = stats.fetched
            finally:
                try:
                    release_advisory_lock(ingest_lock_sess, ADVISORY_LOCK_PIPELINE_INGEST)
                    ingest_lock_sess.commit()
                except Exception:  # noqa: BLE001
                    ingest_lock_sess.rollback()
                finally:
                    ingest_lock_sess.close()
        else:
            ingest_lock_sess.close()
            logger.info(
                "Ingest lock busy (another process indexing); this tick will not advance cursor"
            )

    if not settings.has_chat_llm:
        degraded = True

    # 2) EMBED / cluster / LLM — single leader; another replica may have ingested
    lock_session = SessionLocal()
    if not try_advisory_lock(lock_session, ADVISORY_LOCK_PIPELINE):
        lock_session.close()
        with session_scope() as session:
            now = datetime.now(tz=timezone.utc)
            run = PipelineRun(
                status="skipped",
                stages={**stages, "downstream": "deferred_to_leader"},
                tokens_ingested=tokens_ingested,
                families_updated=0,
                degraded=degraded,
                finished_at=now,
            )
            session.add(run)
            session.flush()
            skip_id = run.id
        logger.info(
            "Downstream pipeline skipped (leader lock held); run_id={} tokens_stage={}",
            skip_id, tokens_ingested,
        )
        return PipelineResult(
            run_id=skip_id,
            tokens_ingested=tokens_ingested,
            families_updated=0,
            degraded=degraded,
            stages=stages,
        )

    lock_session.commit()

    with session_scope() as session:
        run = PipelineRun(status="running", stages={})
        session.add(run)
        session.flush()
        run_id = run.id

    try:
        # 2. EMBED
        with session_scope() as session:
            t0 = time.time()
            n_embedded = await embed_tokens_needing_update(
                session, lookback_hours=lookback_hours
            )
            stages["embed"] = round(time.time() - t0, 2)

        # 3. CLUSTER
        with session_scope() as session:
            t0 = time.time()
            candidates = run_clustering(
                session,
                lookback_hours=lookback_hours,
                min_cluster_size=settings.pipeline_min_cluster_size,
                eps=settings.pipeline_cluster_eps,
            )
            stages["cluster"] = round(time.time() - t0, 2)
            logger.info("cluster stage: {} candidate families", len(candidates))

        # Budget-cap: only enrich the top-K largest candidate clusters so we
        # don't spam Groq with 200+ LLM calls per run.
        max_clusters = settings.pipeline_max_clusters_per_run
        if len(candidates) > max_clusters:
            logger.info(
                "Capping enrichment to top {} of {} candidate clusters",
                max_clusters, len(candidates),
            )
            candidates = candidates[:max_clusters]

        # 4+5+6. VALIDATE + ENRICH + PERSIST FAMILIES - run in bounded parallel
        research = WebResearcher()
        min_confidence = settings.pipeline_min_confidence
        t0 = time.time()
        # Keep in-flight enrichment chains serial: Groq free-tier caps
        # `openai/gpt-oss-120b` at 8k TPM, each cluster burns ~600–1,500
        # tokens across (validate + centers + per-mutation reasoning).
        # Serial is ~3× slower wall-clock but 0× throttled, which is a net win.
        sem = asyncio.Semaphore(1)

        total_c = len(candidates)
        processed = 0
        kept = 0

        async def _guarded(idx: int, c):
            nonlocal processed, kept
            async with sem:
                try:
                    ok = await _process_cluster(c, research, force_recluster, min_confidence)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("cluster[{}/{}] error: {}", idx, total_c, exc)
                    ok = False
                processed += 1
                if ok:
                    kept += 1
                logger.info(
                    "cluster progress: {}/{} (kept={})", processed, total_c, kept,
                )
                return ok

        results = await asyncio.gather(
            *[_guarded(i + 1, c) for i, c in enumerate(candidates)],
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, Exception):
                logger.warning("cluster processing error: {}", r)
            elif r:
                families_updated += 1
        stages["enrich"] = round(time.time() - t0, 2)
        logger.info("enrich stage: {} families persisted", families_updated)

        # 7. ANALYTICS + 8. ANCHOR
        registry = RegistryClient()
        t0 = time.time()
        with session_scope() as session:
            dirty_families: list[DnaFamily] = list(
                session.execute(select(DnaFamily).where(DnaFamily.dirty.is_(True))).scalars().all()
            )
            for fam in dirty_families:
                refresh_family_metrics(session, fam)
            session.flush()

            for fam in dirty_families:
                muts = list(
                    session.execute(
                        select(FamilyMutation).where(FamilyMutation.family_id == fam.id)
                    ).scalars().all()
                )
                try:
                    anchor = registry.anchor_family(fam, muts)
                    if anchor:
                        fam.onchain_tx_hash = anchor.tx_hash
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Anchoring failed for {}: {}", fam.id, exc)
        stages["analytics"] = round(time.time() - t0, 2)

    except Exception as exc:
        logger.exception("Pipeline failed")
        with session_scope() as session:
            run = session.get(PipelineRun, run_id)
            if run:
                run.status = "failed"
                run.error = str(exc)[:2000]
                run.finished_at = datetime.utcnow()
                run.stages = stages
        raise
    finally:
        try:
            release_advisory_lock(lock_session)
            lock_session.commit()
        except Exception:  # noqa: BLE001
            lock_session.rollback()
        finally:
            lock_session.close()

    with session_scope() as session:
        run = session.get(PipelineRun, run_id)
        if run:
            run.status = "ok"
            run.finished_at = datetime.utcnow()
            run.stages = stages
            run.tokens_ingested = tokens_ingested
            run.families_updated = families_updated
            run.degraded = degraded

    logger.info(
        "Pipeline finished. stages={}, tokens={}, families={}", stages, tokens_ingested, families_updated
    )
    return PipelineResult(
        run_id=run_id,
        tokens_ingested=tokens_ingested,
        families_updated=families_updated,
        degraded=degraded,
        stages=stages,
    )


async def _process_cluster(
    cand: CandidateCluster,
    research: WebResearcher,
    force: bool,
    min_confidence: float = 0.35,
) -> bool:
    """Process a single candidate cluster; return True if persisted."""
    with session_scope() as session:
        tokens: list[Token] = list(
            session.execute(
                select(Token).where(Token.token_address.in_(cand.token_addresses))
            ).scalars().all()
        )
        if len(tokens) < 2:
            return False

        # Guard against DBSCAN "catch-all" noise buckets: if a cluster is
        # enormous AND has no archetype hint it's almost certainly a bag of
        # low-signal Four.Meme tokens (short generic names, no shared theme).
        # Storing them as one family clogs the UI and blows the per-run time
        # budget (each token becomes a DB write). Cap the cluster size and
        # let the next pipeline pass re-cluster them with better data.
        NOISE_GUARD_SIZE = 500
        if cand.archetype is None and len(tokens) > NOISE_GUARD_SIZE:
            logger.info(
                "Skipping noise mega-cluster (n={}, no archetype)", len(tokens),
            )
            return False

        # Hard cap mutations per family so a runaway cluster can't stall the
        # pipeline. 300 is plenty for the UI (we only render a handful of
        # representative strains anyway).
        MAX_MUTATIONS_PER_FAMILY = 300
        if len(tokens) > MAX_MUTATIONS_PER_FAMILY:
            tokens = sorted(tokens, key=lambda t: t.created_at)[:MAX_MUTATIONS_PER_FAMILY]

        validation: ClusterValidation = await validate_cluster(
            session, tokens, archetype=cand.archetype
        )
        if not validation.is_same_event or validation.confidence < min_confidence:
            logger.info(
                "Cluster rejected (conf={:.2f} < {:.2f}, n={}): {}",
                validation.confidence, min_confidence, len(tokens),
                validation.event_title or "(no title)",
            )
            return False

        family_id = _family_id_for(cand)
        family = session.get(DnaFamily, family_id)
        model_name = get_settings().openai_chat_model
        if family is None:
            family = DnaFamily(
                id=family_id,
                event_title=validation.event_title or "Unknown event",
                event_summary=validation.event_summary or "",
                confidence_score=validation.confidence,
                first_seen_at=cand.earliest_ts,
                last_seen_at=cand.latest_ts,
                signature_vector=cand.mean_vector,
                llm_model=model_name,
                llm_version="v2",
                llm_reasoning=validation.reasoning,
                dirty=True,
            )
            session.add(family)
        else:
            family.event_title = validation.event_title or family.event_title
            family.event_summary = validation.event_summary or family.event_summary
            family.confidence_score = max(family.confidence_score, validation.confidence)
            family.first_seen_at = min(family.first_seen_at, cand.earliest_ts)
            family.last_seen_at = max(family.last_seen_at, cand.latest_ts)
            family.signature_vector = cand.mean_vector
            family.llm_model = model_name
            family.llm_version = "v2"
            family.llm_reasoning = validation.reasoning or family.llm_reasoning
            family.dirty = True

        session.flush()

        snippets: list[dict[str, Any]] = []
        if research.enabled and validation.event_title:
            try:
                snippets = await research.search(validation.event_title)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Web research failed: {}", exc)

        research_out = await synthesise_research(
            session, validation.event_title, snippets
        )
        _persist_references(session, family.id, research_out.get("references", []))
        _persist_timeline(session, family.id, research_out.get("timeline_of_event", []))

        centers_out = await extract_centers(
            session, validation.event_title, validation.event_summary, tokens, snippets
        )
        _persist_centers(session, family.id, centers_out)

        family.mutations_count = len(tokens)

        # Per-mutation reasoning is the most expensive step - one LLM call
        # per token. We cap to the 3 "anchor" tokens (earliest + 2 others)
        # and let heuristic reasons fill the rest. This is usually what the
        # UI surfaces anyway (origin/dominant/fastest strain rows).
        MAX_LLM_EXPLAIN = 3
        tokens_sorted = sorted(tokens, key=lambda t: t.created_at)
        llm_tokens = tokens_sorted[:MAX_LLM_EXPLAIN]
        heur_tokens = [t for t in tokens if t not in llm_tokens]

        reasons_llm: list[Any] = []
        for tok in llm_tokens:
            try:
                reasons_llm.append(
                    await explain_mutation(
                        session,
                        family.event_title,
                        family.event_summary,
                        family.first_seen_at,
                        tok,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                reasons_llm.append(exc)
        reasons_by_addr: dict[str, str] = {}
        for tok, rsn in zip(llm_tokens, reasons_llm):
            if isinstance(rsn, Exception):
                rsn = f"{tok.symbol or tok.name} launched in the same time-window as the family's other mutations."
            reasons_by_addr[tok.token_address] = rsn
        for tok in heur_tokens:
            reasons_by_addr[tok.token_address] = (
                f"{tok.symbol or tok.name}: joined family '{family.event_title}' "
                "via clustered embedding + shared time window."
            )

        existing = {
            m.token_address
            for m in session.execute(
                select(FamilyMutation).where(FamilyMutation.family_id == family.id)
            ).scalars().all()
        }
        for token in tokens:
            reason = reasons_by_addr.get(token.token_address, "")
            if token.token_address in existing:
                session.execute(
                    FamilyMutation.__table__.update()
                    .where(FamilyMutation.__table__.c.family_id == family.id)
                    .where(FamilyMutation.__table__.c.token_address == token.token_address)
                    .values(why_this_mutation_belongs=reason)
                )
            else:
                session.execute(
                    pg_insert(FamilyMutation.__table__)
                    .values(
                        family_id=family.id,
                        token_address=token.token_address,
                        why_this_mutation_belongs=reason,
                    )
                    .on_conflict_do_update(
                        index_elements=["family_id", "token_address"],
                        set_={"why_this_mutation_belongs": reason},
                    )
                )
    return True


def _family_id_for(cand: CandidateCluster) -> str:
    """Deterministic ID for the *event* a cluster represents, NOT its exact
    member set.

    Previously we hashed ``sorted(token_addresses)`` which made every new
    token addition mint a fresh family row and left the old one stranded.
    That is why the DB ended up with three copies of "Justice for Binance
    Meme Surge" (4,294 mutations scattered across duplicates).

    The new identity is derived from:
      * the cluster's archetype bucket (dog / cat / cz / ...), if any,
      * the earliest launch timestamp rounded to the *week*, which is
        stable even as new member tokens stream in during that week,
      * a short hash of the 5 oldest member addresses so distinct events
        that happen in the same week still get distinct IDs.

    The week-bucket is important: on-going meme waves keep receiving new
    mutations for days; locking the family to the week of its origin
    prevents duplicate families from being spawned on each pipeline pass.
    """
    import hashlib

    earliest_week = cand.earliest_ts.strftime("%G-W%V")  # ISO week
    seed_addrs = ",".join(sorted(cand.token_addresses)[:5])
    archetype = cand.archetype or "generic"
    key = f"{archetype}|{earliest_week}|{seed_addrs}".encode()
    return "fam_" + hashlib.sha256(key).hexdigest()[:20]


def _persist_references(session, family_id: str, refs: list[dict[str, Any]]) -> None:
    if not refs:
        return
    for r in refs[:20]:
        url = r.get("url")
        if not url:
            continue
        stmt = pg_insert(FamilyReference.__table__).values(
            family_id=family_id,
            url=url,
            ref_type=r.get("type") or "other",
            title=r.get("title"),
        )
        stmt = stmt.on_conflict_do_nothing(index_elements=["family_id", "url"])
        session.execute(stmt)


def _persist_timeline(session, family_id: str, points: list[dict[str, Any]]) -> None:
    session.execute(delete(FamilyTimeline).where(FamilyTimeline.family_id == family_id))
    for i, p in enumerate(points[:10]):
        event_text = p.get("event")
        if not event_text:
            continue
        at = p.get("at")
        try:
            at_parsed = datetime.fromisoformat(at.replace("Z", "+00:00")) if at else None
        except Exception:  # noqa: BLE001
            at_parsed = None
        session.add(FamilyTimeline(family_id=family_id, at=at_parsed, event=event_text, position=i))


def _persist_centers(session, family_id: str, data: dict[str, Any]) -> None:
    if not data:
        return

    def _v(key: str, sub: str = "value") -> str | None:
        block = data.get(key) or {}
        if isinstance(block, dict):
            val = block.get(sub)
            return str(val) if val is not None else None
        return None

    stmt = pg_insert(FamilyCenter.__table__).values(
        family_id=family_id,
        source_value=_v("source_center", "value"),
        source_url=_v("source_center", "url"),
        source_evidence=_v("source_center", "evidence"),
        entity_value=_v("entity_center", "value"),
        entity_evidence=_v("entity_center", "evidence"),
        geo_value=_v("geo_center", "value"),
        geo_evidence=_v("geo_center", "evidence"),
        community_value=_v("community_center", "value"),
        community_evidence=_v("community_center", "evidence"),
    )
    update_cols = [
        "source_value", "source_url", "source_evidence",
        "entity_value", "entity_evidence",
        "geo_value", "geo_evidence",
        "community_value", "community_evidence",
    ]
    stmt = stmt.on_conflict_do_update(
        index_elements=["family_id"],
        set_={**{c: getattr(stmt.excluded, c) for c in update_cols}, "extracted_at": datetime.utcnow()},
    )
    session.execute(stmt)


def main_cli() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback-hours", type=int, default=None)
    parser.add_argument("--force-recluster", action="store_true")
    parser.add_argument("--skip-ingest", action="store_true")
    args = parser.parse_args()
    asyncio.run(
        run_pipeline(
            lookback_hours=args.lookback_hours,
            force_recluster=args.force_recluster,
            skip_ingest=args.skip_ingest,
        )
    )


if __name__ == "__main__":
    main_cli()

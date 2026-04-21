from memedna.db import SessionLocal
from memedna.ai.clustering import run_clustering
from memedna.config import get_settings


def main() -> None:
    s = get_settings()
    with SessionLocal() as sess:
        cands = run_clustering(
            sess,
            lookback_hours=s.pipeline_lookback_hours,
            min_cluster_size=s.pipeline_min_cluster_size,
            eps=s.pipeline_cluster_eps,
        )
    print("candidate clusters:", len(cands))
    by_arch: dict[str, int] = {}
    for c in cands:
        key = c.archetype or "(none)"
        by_arch[key] = by_arch.get(key, 0) + 1
    print("by archetype:")
    for k, v in sorted(by_arch.items(), key=lambda x: -x[1]):
        print(f"  {k:<12} {v}")
    print()
    print("top 20 clusters by size:")
    for c in cands[:20]:
        arch = c.archetype or "-"
        print(f"  size={len(c.token_addresses):>4}  arch={arch:<10} label={c.label}")


if __name__ == "__main__":
    main()

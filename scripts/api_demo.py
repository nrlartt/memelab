"""Call the live MemeDNA API and print a condensed human-readable tour."""

from __future__ import annotations

import json

import httpx

BASE = "http://127.0.0.1:8000"


def hit(path: str) -> dict:
    r = httpx.get(f"{BASE}{path}", timeout=30)
    r.raise_for_status()
    return r.json()


def main() -> None:
    print("=" * 78)
    print(f"GET {BASE}/")
    print(json.dumps(hit("/"), indent=2, ensure_ascii=False))
    print()

    print("=" * 78)
    print(f"GET {BASE}/readyz")
    print(json.dumps(hit("/readyz"), indent=2, ensure_ascii=False))
    print()

    print("=" * 78)
    print(f"GET {BASE}/dna-families?limit=3")
    families = hit("/dna-families?limit=3")
    print(f"total={families['total']} limit={families['limit']}")
    for f in families["items"]:
        orig = f["origin_strain"]["symbol"] if f.get("origin_strain") else "-"
        dom = f["dominant_strain"]["symbol"] if f.get("dominant_strain") else "-"
        print(
            f"  - {f['id']}  conf={f['confidence_score']:.2f}  "
            f"mut={f['mutations_count']:>2}  evo={f['evolution_score']:.2f}  "
            f"origin={orig}  dominant={dom}  | {f['event_title']}"
        )
    print()

    fid = families["items"][0]["id"]
    print("=" * 78)
    print(f"GET {BASE}/dna-family/{fid}  (condensed)")
    detail = hit(f"/dna-family/{fid}")
    muts = detail.pop("mutations", [])
    timeline = detail.pop("timeline", [])
    curve = detail.pop("evolution_curve", [])
    detail["mutations"] = f"[{len(muts)} mutations]"
    detail["timeline"] = f"[{len(timeline)} entries]"
    detail["evolution_curve"] = f"[{len(curve)} points]"
    print(json.dumps(detail, indent=2, ensure_ascii=False))
    print()
    print("  first 3 mutations:")
    for m in muts[:3]:
        tags = []
        if m.get("is_origin_strain"): tags.append("ORIGIN")
        if m.get("is_dominant_strain"): tags.append("DOMINANT")
        if m.get("is_fastest_mutation"): tags.append("FASTEST")
        print(
            f"    - {m.get('symbol'):<14} {m.get('token_address'):<42}  "
            f"[{','.join(tags) or '-'}]"
        )
        why = (m.get("why_this_mutation_belongs") or "").strip()
        if why:
            print(f"       why: {why[:120]}")
    print()
    print("  evolution curve (first 5 pts):")
    for p in curve[:5]:
        print(f"    {p}")
    print()

    sample_addr = muts[0]["token_address"] if muts else None
    if sample_addr:
        print("=" * 78)
        print(f"GET {BASE}/mutation/{sample_addr}")
        mutdoc = hit(f"/mutation/{sample_addr}")
        print(json.dumps(mutdoc, indent=2, ensure_ascii=False)[:2000])
    print()

    print("=" * 78)
    print(f"GET {BASE}/trending-dna?limit=5")
    trending = hit("/trending-dna?limit=5")
    for t in trending["items"]:
        print(
            f"  - {t['id']}  evo={t['evolution_score']:.2f}  "
            f"mut={t['mutations_count']:>2}  | {t['event_title']}"
        )


if __name__ == "__main__":
    main()

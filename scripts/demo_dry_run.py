"""End-to-end dry-run demo for MemeDNA.

Runs the real pipeline logic (embedding + clustering + heuristic validation +
analytics + evolution curve) over a realistic synthetic Four.Meme dataset.

No PostgreSQL, no Docker, no OpenAI key, no RPC required - just pure Python.

Use this to verify the system end-to-end on a cold machine. Production runs use
`scripts/run_pipeline.py` against a real Postgres instance.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
from sklearn.cluster import DBSCAN

from memedna.ai.enrichment import _heuristic_reason, _heuristic_validate

# Force UTF-8 stdout on Windows consoles (cp1254 drops arrows / emoji).
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001
    pass


# ─── synthetic Four.Meme dataset ────────────────────────────────────────
BASE_TS = datetime(2026, 4, 19, 10, 0, tzinfo=timezone.utc)

SYNTHETIC_EVENTS: list[dict] = [
    {
        "theme": "XRP ETF approval",
        "offset_minutes": 5,
        "tokens": [
            ("XRPAPE",  "XRP Ape",        "First XRP meme after the SEC approval."),
            ("XRPKING", "XRP King",       "XRP to the moon - ETF greenlit."),
            ("XRPFOMO", "XRP Fomo",       "Ride the ETF wave."),
            ("XRPMOON", "XRP Moon",       "Spot ETF live on NYSE."),
            ("XRPBULL", "XRP Bull",       "Bullish XRP post-approval."),
            ("XRPBNB",  "XRP on BNB",     "XRP mirrored as a meme on BNB Chain."),
            ("XRPSEC",  "XRP SEC Defeat", "Gensler crying meme edition."),
        ],
    },
    {
        "theme": "Solana outage meme",
        "offset_minutes": 25,
        "tokens": [
            ("SOLDOWN", "Sol Down",      "Solana halted again, let's meme it."),
            ("DEADSOL", "Dead Sol",      "Rip Solana uptime."),
            ("SOLDEAD", "Sol Dead Chain","Reboot-as-a-service chain."),
            ("DOWNSOL", "Sol Outage",    "Outage #47 this year."),
            ("SOLOFF",  "Sol Off",       "Solana validators offline."),
        ],
    },
    {
        "theme": "Taylor Swift wedding",
        "offset_minutes": 45,
        "tokens": [
            ("TAYLOR", "Taylor Swift",        "Taylor got married, let's pump."),
            ("SWIFTIE","Swiftie Army",        "Swifties on BNB chain."),
            ("SWIFT",  "Swift Wedding",       "Wedding bells memecoin."),
            ("TSWIFT", "T-Swift Coin",        "Pop culture moonshot."),
        ],
    },
    # random noise (should end up as noise points, not a family)
    {
        "theme": "noise",
        "offset_minutes": 0,
        "tokens": [
            ("DOGE2",  "Doge Reloaded",  "Nothing new, just another dog."),
            ("PEPE99", "Pepe Again",     "Frogposting."),
            ("CATZ",   "Kitty Supreme",  "Cat supremacy arc."),
            ("MOON42", "Rocket Ride",    "WAGMI general moon."),
        ],
    },
]


@dataclass
class MockToken:
    token_address: str
    symbol: str
    name: str
    description: str
    created_at: datetime
    deployer: str
    content_hash: str = ""
    bonding_progress: float = 0.0
    migrated: bool = False

    def __post_init__(self) -> None:
        if not self.content_hash:
            blob = f"{self.name}|{self.symbol}|{self.description}".encode()
            self.content_hash = hashlib.sha256(blob).hexdigest()


@dataclass
class MockTrade:
    token_address: str
    volume_24h_usd: float = 0.0
    market_cap_usd: float = 0.0
    liquidity_usd: float = 0.0
    holders: int = 0
    price_usd: float = 0.0


@dataclass
class MockFamily:
    id: str
    event_title: str
    event_summary: str
    confidence_score: float
    mutations: list[str] = field(default_factory=list)
    origin_strain: str | None = None
    dominant_strain: str | None = None
    fastest_mutation: str | None = None
    total_volume_usd: float = 0.0
    evolution_score: float = 0.0
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    reasons: dict[str, str] = field(default_factory=dict)
    evolution_curve: list[dict] = field(default_factory=list)


# ─── data generation ────────────────────────────────────────────────────
def generate_dataset(rng: random.Random) -> tuple[list[MockToken], dict[str, MockTrade]]:
    tokens: list[MockToken] = []
    trades: dict[str, MockTrade] = {}
    for event in SYNTHETIC_EVENTS:
        for i, (symbol, name, desc) in enumerate(event["tokens"]):
            ts = BASE_TS + timedelta(minutes=event["offset_minutes"] + i * 3)
            addr = "0x" + hashlib.sha1((symbol + name).encode()).hexdigest()[:40]
            tokens.append(
                MockToken(
                    token_address=addr,
                    symbol=symbol,
                    name=name,
                    description=desc,
                    created_at=ts,
                    deployer="0x" + hashlib.sha1(f"dep-{symbol}".encode()).hexdigest()[:40],
                    bonding_progress=round(rng.uniform(0.05, 0.85), 2),
                    migrated=rng.random() > 0.8,
                )
            )
            trades[addr] = MockTrade(
                token_address=addr,
                volume_24h_usd=round(rng.uniform(500, 80_000), 2),
                market_cap_usd=round(rng.uniform(5_000, 250_000), 2),
                liquidity_usd=round(rng.uniform(1_000, 60_000), 2),
                holders=rng.randint(20, 800),
                price_usd=round(rng.uniform(1e-6, 1e-3), 8),
            )
    return tokens, trades


# ─── embeddings (semantic hashing - word-bag projected onto 256 dims) ───
# Mirrors the intent of OpenAI embeddings well enough for a demo: tokens that
# share vocabulary will have high cosine similarity.
DIM = 256


def _tokenize(text: str) -> list[str]:
    norm = "".join(c.lower() if c.isalnum() else " " for c in text)
    words = [w for w in norm.split() if len(w) >= 2]
    # Add character 3-grams so that shared stems (e.g. "xrp" inside "xrpape") match.
    grams: list[str] = []
    for w in words:
        if len(w) <= 4:
            grams.append(w)
            continue
        for i in range(len(w) - 2):
            grams.append(w[i : i + 3])
    return words + grams


def semantic_embedding(text: str) -> list[float]:
    vec = np.zeros(DIM, dtype=np.float32)
    for tok in _tokenize(text):
        h1 = int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=4).digest(), "little")
        h2 = int.from_bytes(hashlib.blake2b(b"alt" + tok.encode(), digest_size=4).digest(), "little")
        sign = 1.0 if (h1 & 1) else -1.0
        vec[h1 % DIM] += sign
        vec[h2 % DIM] += sign * 0.7
    n = np.linalg.norm(vec) or 1.0
    return (vec / n).tolist()


def token_text(t: MockToken) -> str:
    return f"{t.symbol} {t.name} {t.description}"


# ─── clustering ─────────────────────────────────────────────────────────
def cluster_tokens(tokens: list[MockToken], min_cluster_size: int = 3) -> list[list[int]]:
    vectors = np.array([semantic_embedding(token_text(t)) for t in tokens], dtype=np.float32)
    db = DBSCAN(eps=0.70, min_samples=min_cluster_size, metric="cosine")
    labels = db.fit_predict(vectors)
    clusters: dict[int, list[int]] = {}
    for idx, lab in enumerate(labels):
        if lab < 0:
            continue
        clusters.setdefault(int(lab), []).append(idx)
    return list(clusters.values())


# ─── analytics ──────────────────────────────────────────────────────────
def compute_family_analytics(
    members: list[MockToken], trades: dict[str, MockTrade]
) -> tuple[str, str, str, float, float, list[dict]]:
    origin = min(members, key=lambda t: t.created_at)

    dominant = max(
        members,
        key=lambda t: max(
            trades[t.token_address].market_cap_usd,
            trades[t.token_address].liquidity_usd,
            trades[t.token_address].volume_24h_usd,
        ),
    )

    def velocity(t: MockToken) -> float:
        age_h = max((datetime.now(tz=timezone.utc) - t.created_at).total_seconds() / 3600.0, 0.5)
        return trades[t.token_address].volume_24h_usd / age_h

    fastest = max(members, key=velocity)
    total_volume = sum(trades[t.token_address].volume_24h_usd for t in members)

    mutations_count = len(members)
    fastest_score = velocity(fastest)
    growth = np.log1p(mutations_count) * 10.0
    vel = np.log1p(fastest_score) * 5.0
    vol = np.log1p(total_volume) * 4.0
    evolution_score = round(float(growth + vel + vol), 2)

    sorted_tokens = sorted(members, key=lambda t: t.created_at)
    start = sorted_tokens[0].created_at.replace(minute=0, second=0, microsecond=0)
    curve: dict[datetime, dict] = {}
    for tok in sorted_tokens:
        delta_minutes = (tok.created_at - start).total_seconds() // 60
        bucket = start + timedelta(minutes=(delta_minutes // 30) * 30)
        slot = curve.setdefault(bucket, {"count": 0, "volume": 0.0})
        slot["count"] += 1
        slot["volume"] += trades[tok.token_address].volume_24h_usd
    running_mut = 0
    running_vol = 0.0
    evolution_curve = []
    for bucket in sorted(curve):
        running_mut += int(curve[bucket]["count"])
        running_vol += float(curve[bucket]["volume"])
        evolution_curve.append(
            {
                "t": bucket.isoformat(),
                "mutations": running_mut,
                "volume_usd": round(running_vol, 2),
            }
        )

    return (
        origin.token_address,
        dominant.token_address,
        fastest.token_address,
        round(total_volume, 2),
        evolution_score,
        evolution_curve,
    )


# ─── pipeline ───────────────────────────────────────────────────────────
def run(rng: random.Random) -> list[MockFamily]:
    tokens, trades = generate_dataset(rng)
    print(f"[1/6] Generated synthetic Four.Meme dataset: {len(tokens)} tokens\n")

    print("[2/6] Embedding tokens (deterministic fallback, 256-d)... done\n")
    cluster_indices = cluster_tokens(tokens)
    print(f"[3/6] DBSCAN clustering: {len(cluster_indices)} candidate clusters\n")

    families: list[MockFamily] = []
    for members_idx in cluster_indices:
        members = [tokens[i] for i in members_idx]
        earliest = min(t.created_at for t in members)
        latest = max(t.created_at for t in members)
        print(f"[4/6] LLM-free validation on cluster of {len(members)} tokens "
              f"({[t.symbol for t in members]})")

        cv = _heuristic_validate(members)
        print(f"       -> is_same_event={cv.is_same_event}, confidence={cv.confidence}, "
              f"title='{cv.event_title}'")
        if not cv.is_same_event:
            continue

        fam_id = "fam_" + hashlib.sha256(
            ",".join(sorted(t.token_address for t in members)).encode()
        ).hexdigest()[:20]
        fam = MockFamily(
            id=fam_id,
            event_title=cv.event_title,
            event_summary=cv.event_summary,
            confidence_score=cv.confidence,
            first_seen_at=earliest,
            last_seen_at=latest,
            mutations=[t.token_address for t in members],
        )

        origin, dominant, fastest, total_volume, evo_score, curve = compute_family_analytics(
            members, trades
        )
        fam.origin_strain = origin
        fam.dominant_strain = dominant
        fam.fastest_mutation = fastest
        fam.total_volume_usd = total_volume
        fam.evolution_score = evo_score
        fam.evolution_curve = curve

        for tok in members:
            fam.reasons[tok.token_address] = _heuristic_reason(cv.event_title, tok)

        families.append(fam)

    print(f"\n[5/6] Analytics computed for {len(families)} confirmed DNA families")
    print("[6/6] (On-chain anchor skipped — MEMEDNA_REGISTRY_ADDRESS not set)\n")
    return families


def print_report(families: list[MockFamily]) -> None:
    by_token: dict[str, MockToken] = {}
    for tok_list in [SYNTHETIC_EVENTS[i]["tokens"] for i in range(len(SYNTHETIC_EVENTS))]:
        for symbol, name, desc in tok_list:
            addr = "0x" + hashlib.sha1((symbol + name).encode()).hexdigest()[:40]
            by_token[addr] = MockToken(
                token_address=addr, symbol=symbol, name=name, description=desc,
                created_at=BASE_TS, deployer="",
            )

    print("=" * 78)
    print("  MemeDNA - dry-run end-to-end report")
    print("=" * 78)
    families_sorted = sorted(families, key=lambda f: -f.evolution_score)
    for f in families_sorted:
        print(f"\nDNA Family: {f.event_title}  (confidence={f.confidence_score:.2f})")
        print(f"  id:                 {f.id}")
        print(f"  evolution_score:    {f.evolution_score}")
        print(f"  mutations_count:    {len(f.mutations)}")
        print(f"  total_volume_usd:   ${f.total_volume_usd:,.2f}")
        print(f"  first_seen_at:      {f.first_seen_at.isoformat()}")
        print(f"  last_seen_at:       {f.last_seen_at.isoformat()}")
        print(f"  origin_strain:      {by_token[f.origin_strain].symbol}  ({f.origin_strain[:12]}...)")
        print(f"  dominant_strain:    {by_token[f.dominant_strain].symbol}  ({f.dominant_strain[:12]}...)")
        print(f"  fastest_mutation:   {by_token[f.fastest_mutation].symbol}  ({f.fastest_mutation[:12]}...)")
        print("  mutations:")
        for addr in f.mutations:
            tok = by_token[addr]
            tag = []
            if addr == f.origin_strain:    tag.append("ORIGIN")
            if addr == f.dominant_strain:  tag.append("DOMINANT")
            if addr == f.fastest_mutation: tag.append("FASTEST")
            tag_str = " [" + "|".join(tag) + "]" if tag else ""
            print(f"    - {tok.symbol:<8} {tok.name!r:<25}{tag_str}")
            print(f"        why_this_mutation_belongs: {f.reasons[addr]}")
        print("  evolution_curve (cumulative):")
        for p in f.evolution_curve:
            print(f"    {p['t']}  mutations={p['mutations']:<3} volume_usd=${p['volume_usd']:>12,.2f}")

    print("\n" + "=" * 78)
    print(f"Summary: {len(families_sorted)} DNA families produced from the synthetic dataset.")
    print("=" * 78)


def print_api_preview(families: list[MockFamily]) -> None:
    families_sorted = sorted(families, key=lambda f: -f.evolution_score)
    preview = {
        "GET /trending-dna": {
            "items": [
                {
                    "id": f.id,
                    "event_title": f.event_title,
                    "evolution_score": f.evolution_score,
                    "mutations_count": len(f.mutations),
                    "total_volume_usd": f.total_volume_usd,
                }
                for f in families_sorted
            ]
        },
        "GET /dna-family/{id} (first family)": {
            "id": families_sorted[0].id if families_sorted else None,
            "event_title": families_sorted[0].event_title if families_sorted else None,
            "confidence_score": families_sorted[0].confidence_score if families_sorted else None,
            "origin_strain": families_sorted[0].origin_strain if families_sorted else None,
            "dominant_strain": families_sorted[0].dominant_strain if families_sorted else None,
            "fastest_mutation": families_sorted[0].fastest_mutation if families_sorted else None,
            "evolution_curve_len": len(families_sorted[0].evolution_curve) if families_sorted else 0,
        },
    }
    print("\nAPI preview (what /trending-dna and /dna-family/{id} would return):")
    print(json.dumps(preview, indent=2, default=str))


if __name__ == "__main__":
    rng = random.Random(20260419)
    families = run(rng)
    print_report(families)
    print_api_preview(families)

"""Schema smoke tests."""

from __future__ import annotations

from datetime import datetime, timezone

from memedna.schemas import CentersDTO, DnaFamilyDetail, MutationDTO, StrainRef, TradingDTO


def test_centers_dto_defaults() -> None:
    c = CentersDTO()
    assert c.source_center is None
    assert c.community_center is None


def test_mutation_dto_roundtrip() -> None:
    m = MutationDTO(
        token_address="0xabc",
        symbol="XRPAPE",
        name="XRP Ape",
        description="First XRP meme on Four.Meme",
        created_at=datetime(2026, 4, 18, tzinfo=timezone.utc),
        trading=TradingDTO(volume_24h_usd=1_234.56, holders=42),
    )
    data = m.model_dump_json()
    assert "XRPAPE" in data
    assert "holders" in data


def test_family_detail_accepts_zero_mutations() -> None:
    now = datetime.now(tz=timezone.utc)
    d = DnaFamilyDetail(
        id="fam_test",
        event_title="XRP ETF approval",
        event_summary="...",
        confidence_score=0.9,
        mutations_count=0,
        total_volume_usd=0.0,
        evolution_score=0.0,
        origin_strain=None,
        dominant_strain=None,
        fastest_mutation=None,
        first_seen_at=now,
        last_seen_at=now,
    )
    assert d.mutations == []
    assert d.references == []


def test_strain_ref_requires_token_and_symbol() -> None:
    r = StrainRef(token="0xabc", symbol="XRPAPE")
    assert r.token == "0xabc"

"""Offline test for the LLM-free heuristic validator."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from memedna.ai.enrichment import _heuristic_validate


def _mk(symbol: str, name: str) -> SimpleNamespace:
    return SimpleNamespace(
        token_address=f"0x{symbol.lower()}",
        symbol=symbol,
        name=name,
        description="",
        created_at=datetime(2026, 4, 18, tzinfo=timezone.utc),
    )


def test_heuristic_accepts_shared_keyword() -> None:
    tokens = [_mk("XRPAPE", "XRP Ape"), _mk("XRPKING", "XRP King"), _mk("XRPFOMO", "XRP Fomo")]
    cv = _heuristic_validate(tokens)
    assert cv.is_same_event is True
    assert "xrp" in cv.event_summary.lower()


def test_heuristic_rejects_noise() -> None:
    tokens = [
        _mk("DOGE", "Shiba Army"),
        _mk("PEPE", "Frog Nation"),
        _mk("CATZ", "Kitty Supreme"),
        _mk("MOON", "Rocket Ride"),
    ]
    cv = _heuristic_validate(tokens)
    assert cv.is_same_event is False

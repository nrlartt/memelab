"""Quick check: top families by volume + top tokens by volume."""
from __future__ import annotations

from sqlalchemy import desc, select

from memedna.db import session_scope
from memedna.models import DnaFamily, Token, TokenTrade


with session_scope() as s:
    fams = list(
        s.execute(
            select(DnaFamily.id, DnaFamily.event_title, DnaFamily.total_volume_usd, DnaFamily.mutations_count)
            .order_by(desc(DnaFamily.total_volume_usd))
            .limit(12)
        ).all()
    )
    print("=== TOP 12 FAMILIES BY 24H VOLUME ===")
    for fid, title, vol, muts in fams:
        print(f"  ${vol:>15,.0f}  {muts:>4} muts  {title[:60]}")

    toks = list(
        s.execute(
            select(Token.symbol, Token.name, TokenTrade.volume_24h_usd, TokenTrade.liquidity_usd, TokenTrade.price_usd)
            .join(TokenTrade, TokenTrade.token_address == Token.token_address)
            .order_by(desc(TokenTrade.volume_24h_usd))
            .limit(10)
        ).all()
    )
    print("\n=== TOP 10 TOKENS BY 24H VOLUME ===")
    for sym, nm, vol, liq, px in toks:
        print(f"  ${vol:>14,.0f}  liq ${liq:>12,.0f}  ${px:>12.8f}  {sym:<12} {nm[:40]}")

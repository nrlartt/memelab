"""Derive token launch time from on-chain Four.Meme bonding metadata."""

from __future__ import annotations

from datetime import datetime, timezone

from ..models import Token


def effective_token_launch_utc(token: Token) -> datetime:
    """Prefer ``_tokenInfos.launchTime`` (unix seconds, UTC) over ``created_at``.

    ``created_at`` can reflect first DB ingest time when Bitquery/RPC rows lacked a
    parseable timestamp; Four.meme UI uses the on-chain launch time.
    """
    meta = token.raw_metadata or {}
    if isinstance(meta, dict):
        lt = meta.get("launchTime")
        try:
            if lt is not None:
                ts = int(lt)
                if ts > 1_000_000_000:
                    return datetime.fromtimestamp(ts, tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            pass
    ca = token.created_at
    if ca is None:
        return datetime.now(tz=timezone.utc)
    if ca.tzinfo is None:
        return ca.replace(tzinfo=timezone.utc)
    return ca

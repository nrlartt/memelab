"""LLM + embedding client.

- Chat goes through any OpenAI-compatible endpoint (OpenAI, Groq, Together,
  Fireworks, Azure, local vLLM…). JSON-mode is used for deterministic parsing.
- Embeddings go through a *separate* backend because some providers (Groq) do
  not expose an embeddings API. If none is configured we fall back to a local
  semantic hash embedding that still produces meaningful cosine similarities.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import struct
from typing import Any

import orjson
from loguru import logger
from openai import AsyncOpenAI
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import get_settings


EMBEDDING_DIM = 1536


_RETRY_AFTER_RE = re.compile(r"try again in ([0-9]*\.?[0-9]+)\s*s", re.I)


def _extract_retry_after(msg: str) -> float:
    """Pull the '…try again in 1.3s' hint out of a Groq rate-limit message."""
    m = _RETRY_AFTER_RE.search(msg)
    if not m:
        return 2.0
    try:
        return float(m.group(1))
    except ValueError:
        return 2.0


class LLMClient:
    def __init__(self) -> None:
        s = get_settings()
        self.settings = s
        self.chat_model = s.openai_chat_model
        self.embedding_model = s.resolved_embeddings_model

        self._chat: AsyncOpenAI | None = None
        if s.has_chat_llm:
            self._chat = AsyncOpenAI(
                api_key=s.openai_api_key, base_url=s.openai_base_url
            )

        self._embed: AsyncOpenAI | None = None
        if s.has_embedding_llm:
            self._embed = AsyncOpenAI(
                api_key=s.resolved_embeddings_api_key,
                base_url=s.resolved_embeddings_base_url,
            )

    # ── status flags ────────────────────────────────────────────────────────
    @property
    def enabled(self) -> bool:
        """Back-compat alias: True when chat LLM is usable."""
        return self._chat is not None

    @property
    def chat_enabled(self) -> bool:
        return self._chat is not None

    @property
    def embed_enabled(self) -> bool:
        return self._embed is not None

    # ── embeddings ──────────────────────────────────────────────────────────
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type(Exception),
        reraise=True,
    )
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if self._embed is None:
            return [_semantic_embedding(t) for t in texts]
        try:
            resp = await self._embed.embeddings.create(
                model=self.embedding_model, input=texts
            )
            return [d.embedding for d in resp.data]
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Embedding backend failed ({}); falling back to local semantic embedding",
                exc,
            )
            return [_semantic_embedding(t) for t in texts]

    # ── chat (JSON-mode) ────────────────────────────────────────────────────
    # Process-wide circuit breaker: when Groq / OpenAI return a *daily*
    # quota error (TPD / insufficient_quota) there's nothing we can do
    # until the quota window resets. Retrying 140 clusters x 5 LLM calls x
    # 4 attempts each burns minutes of wall time for no useful result.
    # Once tripped, every subsequent call skips straight to the caller's
    # heuristic fallback via a fast exception.
    _daily_quota_until: float = 0.0

    async def chat_json(
        self,
        system: str,
        user: str,
        temperature: float = 0.0,
        max_output_tokens: int = 800,
    ) -> dict[str, Any]:
        if self._chat is None:
            raise RuntimeError("Chat LLM not configured; cannot run LLM call")

        import time as _time
        if LLMClient._daily_quota_until > _time.time():
            raise RuntimeError(
                "LLM daily quota exhausted; using heuristic fallback "
                f"(resets in {int(LLMClient._daily_quota_until - _time.time())}s)"
            )

        kwargs: dict[str, Any] = {
            "model": self.chat_model,
            "temperature": temperature,
            "max_tokens": max_output_tokens,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        # Groq-hosted gpt-oss models accept an extra reasoning_effort knob;
        # pass it through only when explicitly set in config.
        effort = (self.settings.openai_reasoning_effort or "").strip().lower()
        if effort and self.settings.is_groq:
            kwargs["extra_body"] = {"reasoning_effort": effort}

        # Manual 429-aware retry loop - tenacity's exponential back-off was
        # retrying too fast and blew our TPM budget repeatedly.
        last_exc: Exception | None = None
        for attempt in range(4):
            try:
                resp = await self._chat.chat.completions.create(**kwargs)
                content = resp.choices[0].message.content or "{}"
                try:
                    return orjson.loads(content)
                except orjson.JSONDecodeError:
                    logger.warning("LLM returned non-JSON, attempting repair")
                    return await self._repair_json(system, user, content)
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                msg = str(exc).lower()
                # Daily-quota exhaustion: trip the circuit breaker so we
                # don't waste ~30s per remaining cluster retrying.
                if (
                    "tokens per day" in msg
                    or "(tpd)" in msg
                    or "insufficient_quota" in msg
                    or "daily" in msg and "quota" in msg
                ):
                    import time as _time
                    hint = _extract_retry_after(msg)
                    # Groq often returns a tiny TPM-style retry hint ("2s") even
                    # for daily caps. Clamp the breaker to at least 30 minutes
                    # so we stop hammering for the rest of the run.
                    wait = max(hint, 1800.0)
                    LLMClient._daily_quota_until = _time.time() + wait
                    logger.warning(
                        "LLM daily quota tripped; skipping further chat calls "
                        "for {}s (all callers fall back to heuristics).",
                        int(wait),
                    )
                    raise
                # Groq + OpenAI format both return 429 rate-limit errors that
                # embed a "Please try again in Xs" hint. Respect it.
                if "429" in msg or "rate_limit" in msg or "rate limit" in msg:
                    wait = _extract_retry_after(msg)
                    wait = min(max(wait, 1.5), 30.0)
                    logger.info(
                        "Groq TPM throttle (attempt {}/4); sleeping {:.1f}s",
                        attempt + 1, wait,
                    )
                    await asyncio.sleep(wait)
                    continue
                # Transient 5xx / network errors
                if any(k in msg for k in ("timeout", "503", "502", "504", "connection")):
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                raise
        assert last_exc is not None
        raise last_exc

    async def _repair_json(self, system: str, user: str, bad: str) -> dict[str, Any]:
        if self._chat is None:
            return {}
        repair = await self._chat.chat.completions.create(
            model=self.chat_model,
            temperature=0,
            max_tokens=800,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": "Return valid JSON only, matching the previous schema.",
                },
                {
                    "role": "user",
                    "content": f"Original prompt:\n{user}\n\nInvalid reply:\n{bad}",
                },
            ],
        )
        try:
            return orjson.loads(repair.choices[0].message.content or "{}")
        except orjson.JSONDecodeError:
            return {}


# ── local semantic embedding fallback ───────────────────────────────────────
_WORD_RE = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)


def _tokenize(text: str) -> list[str]:
    """Produce a bag of tokens + character n-grams so short, mixed-script
    meme symbols still cluster meaningfully.

    Strategy:
      * whole words (`w:`) catch direct matches (TRUMP ↔ TRUMP).
      * per-word 3-grams (`g:`) catch stems (PEPE ↔ PEPECOIN).
      * cross-word 3/4-grams (`n3:`, `n4:`) catch fusions that meme tokens
        love ("trump47" ↔ "trumppepe", "分你妈臭" ↔ "分你妈").
      * CJK bigrams (`g2:`) - a 2-char Chinese word IS a semantic unit.
    """
    raw = (text or "").lower()
    out: list[str] = []
    words = _WORD_RE.findall(raw)
    for w in words:
        out.append(f"w:{w}")
        if len(w) >= 3:
            for i in range(len(w) - 2):
                out.append(f"g:{w[i : i + 3]}")
        elif len(w) == 2:
            out.append(f"g2:{w}")

    joined = "".join(words)
    for n in (3, 4):
        if len(joined) >= n:
            for i in range(len(joined) - n + 1):
                out.append(f"n{n}:{joined[i : i + n]}")

    if not out:
        out.append(
            f"w:{hashlib.blake2b((raw or '∅').encode(), digest_size=8).hexdigest()}"
        )
    return out


def _semantic_embedding(text: str) -> list[float]:
    """Fully-local 1536-dim embedding based on hashed token bag.

    Much better than a raw content hash: two tokens sharing words or
    substrings land close in cosine space, which is enough for the MVP
    clustering when no real embedding provider is configured.

    IMPORTANT: we *must not* decode hash bytes as IEEE 754 floats - ~0.4%
    of 2-byte patterns yield NaN/Inf which poison pgvector + DBSCAN. We
    instead map each hash byte to an integer weight in [0, 255] and
    normalise at the end.
    """
    vec = [0.0] * EMBEDDING_DIM
    for tok in _tokenize(text):
        h = hashlib.blake2b(tok.encode("utf-8"), digest_size=16).digest()
        idx = int.from_bytes(h[:4], "little") % EMBEDDING_DIM
        sign = 1.0 if (h[4] & 1) else -1.0
        # Deterministic integer weight in [1.0, 8.0], no floating-point
        # surprises (NaN/Inf).
        weight = 1.0 + (h[5] / 255.0) * 7.0
        vec[idx] += sign * weight
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


_singleton: LLMClient | None = None


def get_llm() -> LLMClient:
    global _singleton
    if _singleton is None:
        _singleton = LLMClient()
    return _singleton


def reset_llm() -> None:
    """Force the singleton to be rebuilt after config changes (tests, re-runs)."""
    global _singleton
    _singleton = None


async def embed_texts(texts: list[str], batch_size: int = 64) -> list[list[float]]:
    llm = get_llm()
    out: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        chunk = texts[i : i + batch_size]
        vecs = await llm.embed_batch(chunk)
        out.extend(vecs)
        await asyncio.sleep(0)
    return out

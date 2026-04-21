"""Smoke-test the Groq + gpt-oss-120b integration.

Pings the configured chat LLM with a tiny JSON-mode prompt so we catch
config/API-key/base-url issues before we burn time on a full pipeline run.
"""
from __future__ import annotations

import asyncio
import sys

sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

from memedna.ai.llm import get_llm, reset_llm
from memedna.config import get_settings


async def main() -> int:
    reset_llm()
    s = get_settings()
    print(f"base_url : {s.openai_base_url}")
    print(f"model    : {s.openai_chat_model}")
    print(f"is_groq  : {s.is_groq}")
    print(f"chat_key : {'set' if s.has_chat_llm else 'MISSING'}")
    print(f"embed    : {'real' if s.has_embedding_llm else 'local-fallback'}")
    print()

    llm = get_llm()
    if not llm.chat_enabled:
        print("❌ chat LLM not configured — aborting")
        return 2

    try:
        out = await llm.chat_json(
            system="You are a concise classifier. Output JSON only.",
            user=(
                "Two meme tokens: A=TRUMP (Donald Trump 47th president coin), "
                "B=PEPE47 (Trump + Pepe crossover). Same event? "
                'Output schema: {"same_event": boolean, "event": string}'
            ),
            max_output_tokens=200,
        )
        print("✓ Groq reply:")
        print(out)
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"❌ Groq call failed: {exc.__class__.__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

"""Probe what a Four.Meme token page exposes so we know which fields we can
scrape for off-chain enrichment (description, socials, image, etc.)."""
from __future__ import annotations

import re
import sys

import httpx

sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

ADDRS = [
    "0x4444d46fbc6718684356141a689c9a7b13ece323",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}


def probe(addr: str) -> None:
    url = f"https://four.meme/token/{addr}"
    print(f"\n== {url} ==")
    with httpx.Client(
        follow_redirects=True,
        timeout=20,
        headers=HEADERS,
    ) as c:
        r = c.get(url)
        print(f"status={r.status_code} final={r.url} bytes={len(r.text)}")
        body = r.text

    meta = re.findall(
        r'<meta[^>]+(?:property|name)="([^"]+)"[^>]+content="([^"]{0,400})"',
        body,
        flags=re.I,
    )
    print("-- meta tags --")
    for k, v in meta[:20]:
        print(f"  {k}: {v[:200]}")

    # Next.js ships __NEXT_DATA__ — usually contains the full token record.
    m = re.search(
        r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, flags=re.S
    )
    if m:
        blob = m.group(1)
        print(f"-- __NEXT_DATA__ ({len(blob)} bytes) --")
        for key in (
            "description",
            "shortName",
            "symbol",
            "name",
            "tokenName",
            "tokenSymbol",
            "image",
            "imageUrl",
            "twitter",
            "telegram",
            "website",
            "twitterUrl",
            "telegramUrl",
            "websiteUrl",
            "marketCap",
            "holders",
            "raisedAmount",
            "address",
            "progress",
        ):
            for hit in re.findall(
                rf'"{key}"\s*:\s*("(?:[^"\\]|\\.){{0,400}}"|null|[0-9.]+|true|false)',
                blob,
            )[:2]:
                print(f"  {key}: {hit[:200]}")
    else:
        print("-- no __NEXT_DATA__ block found --")


if __name__ == "__main__":
    for a in ADDRS:
        probe(a)

import { NextRequest, NextResponse } from "next/server";

/**
 * Long-running POST proxy to FastAPI. Default Next rewrites to 127.0.0.1:8000
 * can ECONNRESET before the API finishes; this handler uses an explicit
 * 3-minute ceiling so lab-report generation can complete.
 */
function upstreamUrl(): string {
  const o = process.env.MEMEDNA_INTERNAL_API_ORIGIN?.replace(/\/$/, "");
  if (o) return `${o}/api/lab-report`;
  return "http://127.0.0.1:8000/api/lab-report";
}

const PROXY_TIMEOUT_MS = 180_000;

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
  try {
    const r = await fetch(upstreamUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
      signal: ac.signal,
    });
    const text = await r.text();
    const ct = r.headers.get("content-type") || "application/json";
    return new NextResponse(text, {
      status: r.status,
      headers: { "content-type": ct },
    });
  } catch {
    return NextResponse.json(
      {
        detail:
          "Lab Report proxy to the API failed (timeout or connection reset). " +
          "The generation step may still be running; wait and retry, or call the API directly on port 8000 in dev.",
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

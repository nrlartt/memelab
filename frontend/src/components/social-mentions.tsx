import {
  ExternalLink,
  FileText,
  Heart,
  MessageSquare,
  PlayCircle,
  Repeat2,
  Sparkles,
  Twitter,
} from "lucide-react";
import { api } from "@/lib/api";
import type { SocialMention } from "@/lib/types";

function iconFor(type: string) {
  if (type === "tweet") return Twitter;
  if (type === "video") return PlayCircle;
  if (type === "article") return FileText;
  return Sparkles;
}

function compact(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!v) return "-";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

/**
 * Server-side social feed for a mutation.
 *
 * Builds the query out of the token's symbol + truncated address so we get
 * both X tweets (via cookie auth when configured) and article-like results
 * from DuckDuckGo/Tavily/Serpapi. Rendered twice: once prominently as a
 * tweet wall for X hits, once compactly for everything else.
 */
export async function SocialMentions({
  symbol,
  name,
  address,
}: {
  symbol: string;
  name: string;
  address: string;
}) {
  const queryParts = [symbol, name, address.slice(0, 10)].filter(Boolean);
  const query = queryParts.join(" ").trim() || address;
  let items: SocialMention[] = [];
  let provider = "offline";
  try {
    const r = await api.social(query, 12);
    items = r.items || [];
    provider = r.provider_chain;
  } catch {
    items = [];
  }

  const tweets = items.filter((x) => x.type === "tweet");
  const articles = items.filter((x) => x.type !== "tweet");

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-5 text-xs italic text-[var(--color-ink-400)]">
        No social chatter surfaced yet. Providers tried: {provider}.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tweets.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {tweets.slice(0, 4).map((t, i) => (
            <TweetCard key={i} tweet={t} />
          ))}
        </div>
      )}
      {articles.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {articles.slice(0, 8).map((r, i) => {
            const Icon = iconFor(r.type);
            return (
              <li key={i}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-xs text-[var(--color-ink-200)] transition-colors hover:border-[var(--color-helix-a)]/30 hover:bg-white/[0.05]"
                >
                  <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-md bg-white/5 ring-1 ring-white/5">
                    <Icon className="h-3 w-3 text-[var(--color-helix-c)]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[12px] leading-snug text-white group-hover:text-[var(--color-helix-a)]">
                      {r.title || r.url}
                    </div>
                    {r.snippet && (
                      <div className="mt-1 line-clamp-2 text-[10px] text-[var(--color-ink-400)]">
                        {r.snippet}
                      </div>
                    )}
                  </div>
                  <ExternalLink className="mt-0.5 h-3 w-3 flex-none text-[var(--color-ink-400)] group-hover:text-white" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-500)]">
        providers · {provider}
      </div>
    </div>
  );
}

function TweetCard({ tweet }: { tweet: SocialMention }) {
  const handle = tweet.author_handle?.replace(/^@/, "") || null;
  return (
    <a
      href={tweet.url}
      target="_blank"
      rel="noreferrer"
      className="group block rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-4 transition-colors hover:border-[var(--color-helix-c)]/40"
    >
      <div className="flex items-center gap-2.5">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[var(--color-helix-b)]/30 to-[var(--color-helix-c)]/40 text-white">
          <Twitter className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">
            {tweet.author_name || handle || "@unknown"}
          </div>
          {handle && (
            <div className="truncate text-[11px] text-[var(--color-ink-400)]">
              @{handle}{" "}
              {tweet.followers != null && tweet.followers > 0 && (
                <span>· {compact(tweet.followers)} followers</span>
              )}
            </div>
          )}
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-[var(--color-ink-400)] group-hover:text-white" />
      </div>
      <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-[var(--color-ink-100)]">
        {tweet.snippet || tweet.title || "(empty tweet)"}
      </p>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-[var(--color-ink-400)]">
        <span className="inline-flex items-center gap-1">
          <Heart className="h-3 w-3" /> {compact(tweet.likes)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Repeat2 className="h-3 w-3" /> {compact(tweet.retweets)}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />{" "}
          {compact(tweet.views)}
        </span>
        {tweet.published_at && (
          <span className="ml-auto text-[10px] text-[var(--color-ink-500)]">
            {timeAgo(tweet.published_at)}
          </span>
        )}
      </div>
    </a>
  );
}

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)}s`;
    if (diff < 3600) return `${Math.round(diff / 60)}m`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h`;
    return `${Math.round(diff / 86400)}d`;
  } catch {
    return iso;
  }
}

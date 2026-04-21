export type StrainRef = {
  token: string;
  symbol: string;
};

export type FourCenters = {
  source_center: string | null;
  source_url: string | null;
  entity_center: string | null;
  geo_center: string | null;
  community_center: string | null;
};

export type DnaFamily = {
  id: string;
  event_title: string;
  event_summary: string;
  confidence_score: number;
  mutations_count: number;
  total_volume_usd: number;
  evolution_score: number;
  origin_strain: StrainRef | null;
  dominant_strain: StrainRef | null;
  fastest_mutation: StrainRef | null;
  centers: FourCenters;
  first_seen_at: string;
  last_seen_at: string;
  evolution_spark: number[];
};

export type DnaFamilyList = {
  items: DnaFamily[];
  total: number;
  limit: number;
  offset: number;
};

export type Mutation = {
  token_address: string;
  symbol: string;
  name: string;
  description: string;
  created_at: string;
  deployer: string | null;
  bonding_progress: number;
  migrated: boolean;
  is_origin_strain: boolean;
  is_dominant_strain: boolean;
  is_fastest_mutation: boolean;
  why_this_mutation_belongs: string;
  trading: {
    volume_24h_usd: number;
    market_cap_usd: number;
    holders: number;
    price_usd: number;
    liquidity_usd: number;
    trades_24h?: number;
  };
  image_url?: string | null;
  header_url?: string | null;
  website_url?: string | null;
  twitter_url?: string | null;
  telegram_url?: string | null;
};

export type MutationWithFamily = Mutation & {
  family: { id: string; event_title: string } | null;
};

export type TimelineEntry = {
  at: string | null;
  event: string;
};

export type FamilyReference = {
  url: string;
  type: "tweet" | "article" | "video" | "other";
  title: string | null;
};

export type EvolutionPoint = {
  t: string;
  mutations: number;
  volume_usd: number;
};

export type AIMetadata = {
  model: string | null;
  version: string | null;
  reasoning: string | null;
  research_provider: string | null;
  references_count: number;
};

export type DnaFamilyDetail = DnaFamily & {
  references: FamilyReference[];
  timeline_of_event: TimelineEntry[];
  onchain_tx_hash: string | null;
  mutations: Mutation[];
  timeline: TimelineEntry[];
  evolution_curve: EvolutionPoint[];
  ai: AIMetadata;
};

export type TrendingItem = {
  id: string;
  event_title: string;
  evolution_score: number;
  mutations_count: number;
  total_volume_usd: number;
};

export type TrendingResponse = {
  items: TrendingItem[];
};

export type ReadyResponse = {
  status: string;
  db: string;
  pipeline_fresh: boolean;
  last_run_status?: string | null;
  last_run_finished_at?: string | null;
  scheduler?: boolean;
};

export type OverviewStats = {
  families_total: number;
  tokens_total: number;
  mutations_total: number;
  volume_24h_usd: number;
  liquidity_usd: number;
  tokens_with_liquidity: number;
};

export type SocialMention = {
  title: string | null;
  url: string;
  snippet: string | null;
  type: string;
  provider: string;
  author_name?: string | null;
  author_handle?: string | null;
  likes?: number | null;
  retweets?: number | null;
  views?: number | null;
  followers?: number | null;
  published_at?: string | null;
};

export type SocialResponse = {
  query: string;
  provider_chain: string;
  items: SocialMention[];
  fetched_at: string;
};

export type WalletToken = {
  token_address: string;
  symbol: string;
  name: string;
  created_at: string;
  bonding_progress: number;
  migrated: boolean;
  price_usd: number;
  volume_24h_usd: number;
  liquidity_usd: number;
  holders: number;
  family_id: string | null;
  family_title: string | null;
  // Brand media sourced from DexScreener's ``info`` payload. ``null``
  // until the DexScreener refresher picks the token up (usually ≤ 2 min).
  image_url?: string | null;
  header_url?: string | null;
  website_url?: string | null;
  twitter_url?: string | null;
  telegram_url?: string | null;
};

export type WalletDna = {
  address: string;
  stats: {
    tokens_deployed: number;
    families_touched: number;
    total_volume_24h_usd: number;
    total_liquidity_usd: number;
    migrated_count: number;
  };
  deployed: WalletToken[];
  fetched_at: string;
};

export type ExplorerToken = WalletToken & { trades_24h: number };

export type ExplorerResponse = {
  items: ExplorerToken[];
  total: number;
  limit: number;
  offset: number;
};

export type PipelineRunSummary = {
  id: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_s: number | null;
  tokens_ingested: number;
  families_updated: number;
  degraded: boolean;
  error: string | null;
};

export type ScanningStats = {
  tokens_total: number;
  families_total: number;
  migrated_total: number;
  tokens_with_liquidity: number;
  new_tokens_1h: number;
  new_tokens_24h: number;
  cursor: {
    source: string | null;
    last_block: number;
    updated_at: string | null;
    age_seconds?: number | null;
  };
  chain_head?: number | null;
  lag_blocks?: number | null;
  stale?: boolean;
  runs: PipelineRunSummary[];
  scheduler: boolean;
};

export type QuickIngestResponse = {
  fetched: number;
  inserted: number;
  updated: number;
  enriched: number;
  new_1h: number;
  duration_s: number;
  cursor_block: number;
  chain_head: number | null;
  lag_blocks: number | null;
  head_events: number;
  head_inserted: number;
  gap_blocks: number;
};

export type StackInfo = {
  chat_llm: { enabled: boolean; model: string | null; provider: string | null };
  embeddings: { enabled: boolean; model: string; fallback: boolean };
  data_sources: {
    four_meme_onchain: boolean;
    bitquery: boolean;
    dexscreener: boolean;
  };
  research: { provider: string; enabled: boolean };
  blockchain: {
    chain_id: number;
    registry: boolean;
    anchor_address: string | null;
  };
  pipeline: {
    interval_minutes: number;
    lookback_hours: number;
    incremental: boolean;
    min_confidence: number;
    cluster_eps: number;
  };
};

export type LabReportNarrative = {
  headline: string;
  summary: string;
  archetype_section: string;
  families_section: string;
  timeline_section: string;
  research_section: string;
  behavior_section?: string;
  social_section: string;
  share_blurb: string;
  key_insights?: string[];
  risk_flags?: string[];
  opportunity_flags?: string[];
};

export type LabReportResponse = {
  mode: string;
  address: string;
  generated_at: string;
  facts: Record<string, unknown>;
  narrative: LabReportNarrative;
  llm_enhanced: boolean;
};

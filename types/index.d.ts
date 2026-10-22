export type CacheTtl = '5m' | '1h'

// Where the TTL came from: a default guess, deduced from cache reads,
// reported by the engine on a model switch, or pinned in the plugin's config.
export type CacheTtlSource = 'assumed' | 'observed' | 'reported' | 'pinned'

export type CacheSnapshot = {
  // When the last main-thread request started (ms since epoch); null before one.
  lastAt: number | null
  // Share of the last main-thread request's input read from cache, 0 to 1;
  // null before one.
  hitRate: number | null
  // Prompt tokens the next request re-sends, i.e. what a cold cache re-writes.
  contextTokens: number
  model: string | null
  ttl: CacheTtl
  ttlSource: CacheTtlSource
  // Set when something invalidated the cache before its TTL ran out.
  coldReason: string | null
}

export type LimitKind = 'five_hour' | 'seven_day'

// One usage-limit window as the last response reported it.
export type LimitReading = {
  kind: LimitKind
  // 0 to 100, at most one decimal.
  percentUsed: number
  // ISO 8601; null when the response gave no reset time.
  resetsAt: string | null
}

export type UsageSnapshot = {
  // Input tokens the last response was answered over (context.tokens); null
  // before the first response of the live window. Distinct from
  // CacheSnapshot.contextTokens, which counts what a cold cache re-writes.
  windowTokens: number | null
  // The model's full context window (context.window).
  modelWindow: number | null
  // The auto-compact window (breakdown.rawMaxTokens).
  compactionWindow: number | null
  // Where auto-compaction runs (breakdown.autoCompactThreshold); null when it
  // is off or unknown.
  compactionTrigger: number | null
  isAutoCompactEnabled: boolean | null
  // Empty off a subscription or before the first reading; 5-hour first.
  limits: LimitReading[]
  // What the session has cost so far in US dollars (the /cost figure); null
  // where the app keeps no cost ledger.
  costUsd: number | null
  // Context at the end of recent turns, oldest first, at most six readings;
  // emptied on /clear, resume and compaction. Feeds the compaction forecast.
  recentWindowTokens: number[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-info': { cache: CacheSnapshot; isHidden: boolean; usage: UsageSnapshot }
  }
}

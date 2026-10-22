import type { CacheTtl, CacheTtlSource, LimitKind } from '../types'

// How close a figure is to its limit: amber from 75%, red from 90%.
export type Level = 'normal' | 'warn' | 'alert'

export type CacheState = 'warm' | 'expiring' | 'busy' | 'cold'

export type CacheView = {
  state: CacheState
  // Time left on the TTL; 0 when cold.
  leftMs: number
  ttl: CacheTtl
  ttlSource: CacheTtlSource
  // What a cold cache re-writes on the next request.
  cachedTokens: number
  // Why it is cold ("compacted", "expired 12 min ago"); null unless cold.
  coldReason: string | null
  // Share of the last main-thread request's input read from cache, 0 to 1;
  // null before one.
  hitRate: number | null
}

export type ContextView = {
  // Tokens in the live window; null before its first response.
  used: number | null
  // The window the text names: the auto-compact window, or the model's
  // window when auto-compact is off.
  shownWindow: number | null
  // Used against the compaction trigger (or the best fallback), unclamped.
  percent: number | null
  level: Level
  // Where auto-compaction runs; null when it is off or unknown.
  trigger: number | null
  isAutoCompactOff: boolean
  // Average context growth per turn over recent turns; null until two
  // readings show growth.
  growthPerTurn: number | null
  // Turns left before auto-compaction at that rate; null when unknown or off.
  turnsToCompact: number | null
}

export type LimitView = {
  kind: LimitKind
  label: '5h' | 'wk'
  name: '5-hour' | 'Weekly'
  percent: number
  level: Level
  // Share of the window that has passed, 0 to 1; null without a reset time.
  elapsed: number | null
  resetsInMs: number | null
  forecast: LimitForecast | null
}

// Where a limit is heading at the current rate: its share at reset, or how
// soon it runs out when that comes before the reset.
export type LimitForecast = { kind: 'at-reset'; percent: number; level: Level } | { kind: 'runs-out'; inMs: number }

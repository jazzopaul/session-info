import type { SessionContextBreakdown, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { LimitKind, LimitReading, UsageSnapshot } from '../types'
import { level } from './format'
import type { ContextView, LimitForecast, LimitView } from './views'

export const EMPTY_USAGE: UsageSnapshot = {
  windowTokens: null,
  modelWindow: null,
  compactionWindow: null,
  compactionTrigger: null,
  isAutoCompactEnabled: null,
  limits: [],
  costUsd: null,
  recentWindowTokens: [],
}

// State outlives a reload, so a snapshot saved by an older version of the mod
// can lack fields added since; those take their defaults.
export const withUsageDefaults = (u: Partial<UsageSnapshot>): UsageSnapshot => ({ ...EMPTY_USAGE, ...u })

// The windows the bar shows, in the order it shows them. Others (a gateway's
// spend_limit) are ignored.
const KINDS: readonly LimitKind[] = ['five_hour', 'seven_day']

const WINDOW_MS: Record<LimitKind, number> = {
  five_hour: 5 * 3_600_000,
  seven_day: 7 * 86_400_000,
}

// Six readings give five turns of growth to average.
const HISTORY = 6
// Early in a window a forecast swings wildly, so none before 10% has passed.
const MIN_ELAPSED = 0.1

const NAMES = {
  five_hour: { label: '5h', name: '5-hour' },
  seven_day: { label: 'wk', name: 'Weekly' },
} as const

export const readLimits = (rateLimits: readonly SessionRateLimit[]): LimitReading[] =>
  KINDS.flatMap(kind => {
    const reading = rateLimits.find(r => r.kind === kind)

    return reading === undefined ? [] : [{ kind, percentUsed: reading.percentUsed, resetsAt: reading.resetsAt ?? null }]
  })

// A measurement always carries the window and the limits, so both are taken
// whole. A missing token figure means a fresh or just-compacted window, never
// "unchanged". Measurements also fire when only a limit moves, so context is
// recorded for the forecast only when it changed.
export const withMeasure = (
  u: UsageSnapshot,
  context: Pick<SessionContextUsage, 'tokens' | 'window'>,
  rateLimits: readonly SessionRateLimit[],
  cost?: SessionCost,
): UsageSnapshot => {
  const tokens = context.tokens ?? null
  const isNew = tokens !== null && tokens !== u.recentWindowTokens.at(-1)

  return {
    ...u,
    windowTokens: tokens,
    modelWindow: context.window,
    limits: readLimits(rateLimits),
    costUsd: cost?.usd ?? null,
    recentWindowTokens: isNew ? [...u.recentWindowTokens, tokens].slice(-HISTORY) : u.recentWindowTokens,
  }
}

// Compaction, /clear and resume start a new window: its figure and its growth
// no longer apply.
export const forgetWindow = (u: UsageSnapshot): UsageSnapshot => ({ ...u, windowTokens: null, recentWindowTokens: [] })

const growthPerTurn = (readings: readonly number[]): number | null => {
  const first = readings[0]
  const last = readings.at(-1)

  if (readings.length < 2 || first === undefined || last === undefined) {
    return null
  }

  const growth = (last - first) / (readings.length - 1)

  return growth > 0 ? growth : null
}

export const withBreakdown = (
  u: UsageSnapshot,
  breakdown: Pick<SessionContextBreakdown, 'rawMaxTokens' | 'autoCompactThreshold' | 'isAutoCompactEnabled'> | undefined,
): UsageSnapshot =>
  breakdown === undefined
    ? { ...u, compactionWindow: null, compactionTrigger: null, isAutoCompactEnabled: null }
    : {
        ...u,
        compactionWindow: breakdown.rawMaxTokens,
        compactionTrigger: breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null,
        isAutoCompactEnabled: breakdown.isAutoCompactEnabled,
      }

export const contextView = (u: UsageSnapshot): ContextView => {
  const isAutoCompactOff = u.isAutoCompactEnabled === false
  const shownWindow = isAutoCompactOff ? (u.modelWindow ?? u.compactionWindow) : (u.compactionWindow ?? u.modelWindow)
  const trigger = isAutoCompactOff ? null : u.compactionTrigger
  // Red should mean compaction is close, so measure against where it runs.
  const against = trigger ?? shownWindow
  const percent =
    u.windowTokens === null || against === null || against <= 0 ? null : Math.round((u.windowTokens / against) * 100)
  const growth = growthPerTurn(u.recentWindowTokens)
  const turnsToCompact =
    growth === null || trigger === null || u.windowTokens === null
      ? null
      : Math.max(0, Math.ceil((trigger - u.windowTokens) / growth))

  return {
    used: u.windowTokens,
    shownWindow,
    percent,
    level: percent === null ? 'normal' : level(percent),
    trigger,
    isAutoCompactOff,
    growthPerTurn: growth,
    turnsToCompact,
  }
}

// Where the limit lands at reset at the rate used so far; if that passes
// 100%, how long until it runs out at the same rate.
const forecast = (percent: number, elapsed: number | null, kind: LimitKind): LimitForecast | null => {
  // 1 - 0.9 is 0.09999999999999998, so a strict comparison would hide the
  // forecast at exactly 10%.
  if (elapsed === null || elapsed < MIN_ELAPSED - 1e-9) {
    return null
  }

  // Decide on the shown figure: 99.6 must not read "100% by reset".
  const rounded = Math.round(percent / elapsed)

  if (rounded < 100) {
    return { kind: 'at-reset', percent: rounded, level: level(rounded) }
  }

  const perMs = percent / (elapsed * WINDOW_MS[kind])

  return { kind: 'runs-out', inMs: Math.max(0, (100 - percent) / perMs) }
}

export const limitViews = (u: UsageSnapshot, now: number): LimitView[] =>
  u.limits.map(l => {
    const resetsAt = l.resetsAt === null ? Number.NaN : Date.parse(l.resetsAt)
    const resetsInMs = Number.isNaN(resetsAt) ? null : Math.max(0, resetsAt - now)
    const elapsed = resetsInMs === null ? null : Math.min(1, Math.max(0, 1 - resetsInMs / WINDOW_MS[l.kind]))

    // The bar shows the whole percentage, so the colour follows it (74.5 reads
    // "75%" and must be amber); the raw figure stays for a precise bar width.
    return {
      kind: l.kind,
      ...NAMES[l.kind],
      percent: l.percentUsed,
      level: level(Math.round(l.percentUsed)),
      elapsed,
      resetsInMs,
      forecast: forecast(l.percentUsed, elapsed, l.kind),
    }
  })

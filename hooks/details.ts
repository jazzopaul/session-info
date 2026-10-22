import { dialLabel } from './cache'
import { duration, tokens } from './format'
import type { CacheView, ContextView, LimitView } from './views'

export type BarModel = { cache: CacheView; context: ContextView; limits: LimitView[]; cost: number | null }

// The same minutes-or-seconds rule as the dial, so the two never disagree.
const left = (v: CacheView) => {
  const { value, unit } = dialLabel(v)

  return unit === 'MIN' ? `${value} min` : value
}

export const cacheDetail = (v: CacheView) => {
  const ttl = `${v.ttl} TTL${v.ttlSource === 'assumed' ? ' (assumed)' : ''}`

  switch (v.state) {
    case 'cold':
      return `cold · ${v.coldReason ?? 'expired'}`
    case 'busy':
      return `in use · ${ttl} · ${tokens(v.cachedTokens)} cached`
    default:
      return `${left(v)} left · ${ttl} · ${tokens(v.cachedTokens)} cached`
  }
}

export const contextDetail = (c: ContextView) => {
  if (c.used === null) {
    return 'no reading yet'
  }

  const of = c.shownWindow === null ? '' : ` of ${tokens(c.shownWindow)}`
  const percent = c.percent === null ? '' : ` · ${c.percent}%`

  if (c.isAutoCompactOff) {
    return `${tokens(c.used)}${of} · auto-compact off${percent}`
  }

  const at = c.trigger === null ? '' : ` · compacts at ${tokens(c.trigger)}`

  return `${tokens(c.used)}${of === '' ? '' : `${of} window`}${at}${percent}`
}

export const limitDetail = (l: LimitView) => {
  // Kept short: the desktop caps the hover card at a fixed width, and the
  // longer "of window passed" wording wrapped there.
  const passed = l.elapsed === null ? '' : ` · ${Math.round(l.elapsed * 100)}% elapsed`
  const reset = l.resetsInMs === null ? '' : ` · resets in ${duration(l.resetsInMs)}`

  return `${Math.round(l.percent)}% used${passed}${reset}`
}

const share = (rate: number) => `${Math.round(rate * 100)}%`

// The short figures printed on the bar beside what they explain.
export const hitText = (v: CacheView) => (v.hitRate === null ? null : `${share(v.hitRate)} hit`)

// "≈1 turn", not "≈1 turns"; at or past the trigger, compaction is next.
const turnsLeft = (turns: number) => (turns === 0 ? 'compacts next' : `≈${turns} ${turns === 1 ? 'turn' : 'turns'}`)

export const turnsText = (c: ContextView) => (c.turnsToCompact === null ? null : turnsLeft(c.turnsToCompact))

export const forecastText = (l: LimitView) => {
  if (l.forecast === null) {
    return null
  }

  if (l.forecast.kind === 'at-reset') {
    return `→ ${l.forecast.percent}%`
  }

  // Already used up: there is no time left to count down.
  return l.forecast.inMs <= 0 ? 'at limit' : `out in ${duration(l.forecast.inMs)}`
}

import type { CacheSnapshot, CacheTtl } from '../types'
import { ago } from './format'
import type { CacheView } from './views'

export const FIVE_MINUTES = 5 * 60_000
export const ONE_HOUR = 60 * 60_000
// Below this much time left the dial turns amber.
export const EXPIRING_SOON = 10 * 60_000

export const ttlMs = (ttl: CacheTtl) => (ttl === '1h' ? ONE_HOUR : FIVE_MINUTES)

export const cacheView = (s: CacheSnapshot & { lastAt: number }, now: number, isWorking: boolean): CacheView => {
  const expiresAt = s.lastAt + ttlMs(s.ttl)
  const leftMs = Math.max(0, expiresAt - now)
  const base = { ttl: s.ttl, ttlSource: s.ttlSource, cachedTokens: s.contextTokens, hitRate: s.hitRate }

  // A request in flight reads or re-writes the cache whatever state it was in.
  if (isWorking) {
    return { ...base, state: 'busy', leftMs, coldReason: null }
  }

  if (s.coldReason !== null || leftMs === 0) {
    return { ...base, state: 'cold', leftMs: 0, coldReason: s.coldReason ?? `expired ${ago(now - expiresAt)}` }
  }

  // Judge by the minutes the dial shows (rounded up, as dialLabel does), so
  // the colour never disagrees with the label: 9.5 min left reads "10 MIN"
  // and stays warm.
  const shownMinutes = Math.ceil(leftMs / 60_000)

  return { ...base, state: shownMinutes * 60_000 < EXPIRING_SOON ? 'expiring' : 'warm', leftMs, coldReason: null }
}

// What the dial's centre shows: whole minutes left rounded up, seconds in the
// last minute, dots while busy, nothing when cold.
export const dialLabel = (v: CacheView): { value: string; unit: string } => {
  if (v.state === 'busy') {
    return { value: '···', unit: '' }
  }

  if (v.state === 'cold') {
    return { value: '', unit: '' }
  }

  // Branch on the rounded seconds, so 59.5 s left reads "1 MIN", not "60s".
  const seconds = Math.ceil(v.leftMs / 1000)

  return seconds < 60
    ? { value: `${seconds}s`, unit: '' }
    : { value: `${Math.ceil(v.leftMs / 60_000)}`, unit: 'MIN' }
}

import { describe, expect, test } from 'claude-code/testing'

import { cacheDetail, contextDetail, forecastText, hitText, limitDetail, turnsText } from './details'
import type { CacheView, ContextView, LimitView } from './views'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const cache = (over: Partial<CacheView> = {}): CacheView => ({
  state: 'warm', leftMs: 42 * MINUTE, ttl: '1h', ttlSource: 'observed', cachedTokens: 182_000, coldReason: null, hitRate: null, ...over,
})
const context = (over: Partial<ContextView> = {}): ContextView => ({
  used: 152_000, shownWindow: 400_000, percent: 40, level: 'normal', trigger: 380_000, isAutoCompactOff: false, growthPerTurn: null, turnsToCompact: null, ...over,
})
const five: LimitView = { kind: 'five_hour', label: '5h', name: '5-hour', percent: 24, level: 'normal', elapsed: 0.36, resetsInMs: (3 * 60 + 12) * MINUTE, forecast: null }
const week: LimitView = { kind: 'seven_day', label: 'wk', name: 'Weekly', percent: 12, level: 'normal', elapsed: 0.4, resetsInMs: (4 * 24 + 4) * HOUR, forecast: null }

describe('cacheDetail', () => {
  const cases: [string, CacheView, string][] = [
    ['warm', cache(), '42 min left · 1h TTL · 182k cached'],
    ['assumed TTL', cache({ ttlSource: 'assumed' }), '42 min left · 1h TTL (assumed) · 182k cached'],
    ['last minute', cache({ state: 'expiring', leftMs: 42_000 }), '42s left · 1h TTL · 182k cached'],
    ['busy', cache({ state: 'busy' }), 'in use · 1h TTL · 182k cached'],
    ['cold', cache({ state: 'cold', leftMs: 0, coldReason: 'expired 12 min ago' }), 'cold · expired 12 min ago'],
  ]

  for (const [name, view, expected] of cases) {
    test(name, () => {
      expect(cacheDetail(view)).toBe(expected)
    })
  }
})

describe('contextDetail', () => {
  const cases: [string, ContextView, string][] = [
    ['with a trigger', context(), '152k of 400k window · compacts at 380k · 40%'],
    ['trigger unknown', context({ trigger: null, percent: 38 }), '152k of 400k window · 38%'],
    ['auto-compact off', context({ shownWindow: 1_000_000, percent: 15, trigger: null, isAutoCompactOff: true }), '152k of 1M · auto-compact off · 15%'],
    ['window unknown', context({ shownWindow: null, trigger: null, percent: null }), '152k'],
    ['no reading yet', context({ used: null, percent: null }), 'no reading yet'],
  ]

  for (const [name, view, expected] of cases) {
    test(name, () => {
      expect(contextDetail(view)).toBe(expected)
    })
  }
})

describe('limitDetail', () => {
  test('5-hour', () => {
    expect(limitDetail(five)).toBe('24% used · 36% elapsed · resets in 3h 12m')
  })

  test('weekly', () => {
    expect(limitDetail(week)).toBe('12% used · 40% elapsed · resets in 4d 4h')
  })

  test('without a reset time', () => {
    expect(limitDetail({ ...five, elapsed: null, resetsInMs: null })).toBe('24% used')
  })

  test('rounds a decimal percentage', () => {
    expect(limitDetail({ ...five, percent: 23.5, elapsed: null, resetsInMs: null })).toBe('24% used')
  })
})

describe('bar texts', () => {
  test('cache hit', () => {
    expect(hitText(cache({ hitRate: 0.987 }))).toBe('99% hit')
    expect(hitText(cache())).toBe(null)
  })

  test('turns to compact', () => {
    expect(turnsText(context({ turnsToCompact: 14 }))).toBe('≈14 turns')
    expect(turnsText(context())).toBe(null)
  })

  // "≈1 turn", not "≈1 turns"; at or past the trigger, compaction is next.
  test('turns to compact at its edges', () => {
    expect(turnsText(context({ turnsToCompact: 1 }))).toBe('≈1 turn')
    expect(turnsText(context({ turnsToCompact: 0 }))).toBe('compacts next')
  })

  test('limit forecasts', () => {
    expect(forecastText({ ...five, forecast: { kind: 'at-reset', percent: 67, level: 'normal' } })).toBe('→ 67%')
    expect(forecastText({ ...week, forecast: { kind: 'runs-out', inMs: 26 * 3_600_000 } })).toBe('out in 1d 2h')
    expect(forecastText(five)).toBe(null)
  })

  // A limit already used up has no time left to count down.
  test('a used-up limit reads at limit', () => {
    expect(forecastText({ ...five, forecast: { kind: 'runs-out', inMs: 0 } })).toBe('at limit')
    expect(forecastText({ ...five, forecast: { kind: 'runs-out', inMs: -60_000 } })).toBe('at limit')
  })
})

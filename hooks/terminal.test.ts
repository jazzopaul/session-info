import { describe, expect, test } from 'claude-code/testing'

import { terminalSegments, terminalText } from './terminal'
import type { CacheView, ContextView, LimitView } from './views'

const MINUTE = 60_000

const cache = (over: Partial<CacheView> = {}): CacheView => ({
  state: 'warm', leftMs: 42 * MINUTE, ttl: '1h', ttlSource: 'observed', cachedTokens: 182_000, coldReason: null, hitRate: null, ...over,
})
const context = (over: Partial<ContextView> = {}): ContextView => ({
  used: 152_000, shownWindow: 400_000, percent: 40, level: 'normal', trigger: 380_000, isAutoCompactOff: false, growthPerTurn: null, turnsToCompact: null, ...over,
})
const five: LimitView = { kind: 'five_hour', label: '5h', name: '5-hour', percent: 24, level: 'normal', elapsed: 0.36, resetsInMs: 1, forecast: null }
const week: LimitView = { kind: 'seven_day', label: 'wk', name: 'Weekly', percent: 12, level: 'normal', elapsed: 0.4, resetsInMs: 1, forecast: null }

describe('terminalText', () => {
  const cases: [string, CacheView, ContextView, LimitView[], string][] = [
    ['warm', cache(), context(), [five, week], '◔ 42m │ ctx 152k/400k │ 5h 24% · wk 12%'],
    ['last minute', cache({ state: 'expiring', leftMs: 42_000 }), context(), [five, week], '◔ 42s │ ctx 152k/400k │ 5h 24% · wk 12%'],
    ['busy', cache({ state: 'busy' }), context(), [five, week], '◔ in use │ ctx 152k/400k │ 5h 24% · wk 12%'],
    ['cold', cache({ state: 'cold', leftMs: 0, coldReason: 'compacted' }), context(), [five, week], '○ cold │ ctx 152k/400k │ 5h 24% · wk 12%'],
    ['no context reading', cache(), context({ used: null, percent: null }), [five, week], '◔ 42m │ ctx —/400k │ 5h 24% · wk 12%'],
    ['no limits', cache(), context(), [], '◔ 42m │ ctx 152k/400k'],
    ['one limit', cache(), context(), [five], '◔ 42m │ ctx 152k/400k │ 5h 24%'],
    ['auto-compact off', cache(), context({ shownWindow: 1_000_000, trigger: null, isAutoCompactOff: true }), [five, week], '◔ 42m │ ctx 152k/1M │ 5h 24% · wk 12%'],
  ]

  for (const [name, c, x, limits, expected] of cases) {
    test(name, () => {
      expect(terminalText(terminalSegments(c, x, limits))).toBe(expected)
    })
  }
})

describe('terminalSegments tones', () => {
  test('cache by state', () => {
    expect(terminalSegments(cache(), context(), [])[0]?.tone).toBe('success')
    expect(terminalSegments(cache({ state: 'expiring', leftMs: 7 * MINUTE }), context(), [])[0]?.tone).toBe('warning')
    expect(terminalSegments(cache({ state: 'cold', leftMs: 0 }), context(), [])[0]?.tone).toBe('error')
    expect(terminalSegments(cache({ state: 'busy' }), context(), [])[0]?.tone).toBe('plain')
  })

  test('figures by level, separators dim', () => {
    const segments = terminalSegments(cache(), context({ used: 344_000, level: 'alert' }), [{ ...week, percent: 81, level: 'warn' }])
    expect(segments.find(s => s.text === '344k')?.tone).toBe('error')
    expect(segments.find(s => s.text === '81%')?.tone).toBe('warning')
    expect(segments.find(s => s.text === ' │ ')?.tone).toBe('dim')
  })
})

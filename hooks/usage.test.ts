import { describe, expect, test } from 'claude-code/testing'

import type { UsageSnapshot } from '../types'
import { EMPTY_USAGE, contextView, forgetWindow, limitViews, readLimits, withBreakdown, withMeasure, withUsageDefaults } from './usage'

const NOW = Date.UTC(2026, 9, 18, 12)
const HOUR = 3_600_000
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString()

const usage = (over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  ...EMPTY_USAGE,
  windowTokens: 152_000,
  modelWindow: 1_000_000,
  compactionWindow: 400_000,
  compactionTrigger: 380_000,
  isAutoCompactEnabled: true,
  ...over,
})

describe('readLimits', () => {
  test('keeps the 5-hour and weekly windows, 5-hour first, and drops others', () => {
    const limits = readLimits([
      { kind: 'seven_day', percentUsed: 12, resetsAt: iso(100 * HOUR) },
      { kind: 'spend_limit', percentUsed: 50 },
      { kind: 'five_hour', percentUsed: 23.5 },
    ])

    expect(limits).toEqual([
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: null },
      { kind: 'seven_day', percentUsed: 12, resetsAt: iso(100 * HOUR) },
    ])
  })

  test('is empty off a subscription', () => {
    expect(readLimits([])).toEqual([])
  })
})

describe('withMeasure', () => {
  test('takes the tokens, the model window and the limits', () => {
    const u = withMeasure(EMPTY_USAGE, { tokens: 152_000, window: 1_000_000 }, [{ kind: 'five_hour', percentUsed: 24 }])
    expect(u.windowTokens).toBe(152_000)
    expect(u.modelWindow).toBe(1_000_000)
    expect(u.limits).toEqual([{ kind: 'five_hour', percentUsed: 24, resetsAt: null }])
  })

  test('clears the tokens when a measurement has none, never keeping the old figure', () => {
    expect(withMeasure(usage(), { window: 1_000_000 }, []).windowTokens).toBe(null)
  })

  test('keeps the breakdown figures', () => {
    expect(withMeasure(usage(), { tokens: 1, window: 1_000_000 }, []).compactionTrigger).toBe(380_000)
  })
})

describe('withBreakdown', () => {
  test('takes the window and the trigger when auto-compact is on', () => {
    const u = withBreakdown(EMPTY_USAGE, { rawMaxTokens: 400_000, autoCompactThreshold: 380_000, isAutoCompactEnabled: true })
    expect(u.compactionWindow).toBe(400_000)
    expect(u.compactionTrigger).toBe(380_000)
    expect(u.isAutoCompactEnabled).toBe(true)
  })

  test('has no trigger when auto-compact is off', () => {
    const u = withBreakdown(EMPTY_USAGE, { rawMaxTokens: 1_000_000, autoCompactThreshold: 900_000, isAutoCompactEnabled: false })
    expect(u.compactionTrigger).toBe(null)
    expect(u.isAutoCompactEnabled).toBe(false)
  })

  test('clears all three when the breakdown is missing', () => {
    const u = withBreakdown(usage(), undefined)
    expect([u.compactionWindow, u.compactionTrigger, u.isAutoCompactEnabled]).toEqual([null, null, null])
  })
})

describe('contextView', () => {
  test('names the window and measures against the trigger', () => {
    expect(contextView(usage())).toEqual({
      used: 152_000,
      shownWindow: 400_000,
      percent: 40,
      level: 'normal',
      trigger: 380_000,
      isAutoCompactOff: false,
      growthPerTurn: null,
      turnsToCompact: null,
    })
  })

  test('turns red near the trigger', () => {
    const v = contextView(usage({ windowTokens: 344_000 }))
    expect(v.percent).toBe(91)
    expect(v.level).toBe('alert')
  })

  test('measures against the model window when auto-compact is off', () => {
    const v = contextView(usage({ compactionWindow: 1_000_000, compactionTrigger: null, isAutoCompactEnabled: false }))
    expect([v.shownWindow, v.percent, v.trigger, v.isAutoCompactOff]).toEqual([1_000_000, 15, null, true])
  })

  test('falls back to the model window when the breakdown is unknown', () => {
    const v = contextView(usage({ compactionWindow: null, compactionTrigger: null, isAutoCompactEnabled: null }))
    expect([v.shownWindow, v.percent, v.isAutoCompactOff]).toEqual([1_000_000, 15, false])
  })

  test('measures against the window when only the trigger is unknown', () => {
    expect(contextView(usage({ compactionTrigger: null })).percent).toBe(38)
  })

  const boundaries = [
    [283_100, 75, 'warn'],
    [338_200, 89, 'warn'],
    [340_100, 90, 'alert'],
  ] as const

  for (const [windowTokens, percent, expected] of boundaries) {
    test(`${windowTokens} tokens against the trigger is ${percent}% (${expected})`, () => {
      const v = contextView(usage({ windowTokens }))
      expect([v.percent, v.level]).toEqual([percent, expected])
    })
  }

  test('falls back to the compaction window when auto-compact is off and the model window is unknown', () => {
    const v = contextView(usage({ modelWindow: null, compactionTrigger: null, isAutoCompactEnabled: false }))
    expect([v.shownWindow, v.percent]).toEqual([400_000, 38])
  })

  test('has no percentage before the first response', () => {
    const v = contextView(usage({ windowTokens: null }))
    expect([v.used, v.percent, v.level]).toEqual([null, null, 'normal'])
  })
})

describe('limitViews', () => {
  test('works out how much of each window has passed', () => {
    const views = limitViews(
      usage({
        limits: [
          { kind: 'five_hour', percentUsed: 24, resetsAt: iso(3.2 * HOUR) },
          { kind: 'seven_day', percentUsed: 93, resetsAt: iso(4.2 * 24 * HOUR) },
        ],
      }),
      NOW,
    )

    expect(views.map(v => [v.label, v.name, v.level])).toEqual([['5h', '5-hour', 'normal'], ['wk', 'Weekly', 'alert']])
    // The kit has no toBeCloseTo, so compare whole percentages.
    expect(views.map(v => Math.round((v.elapsed ?? -1) * 100))).toEqual([36, 40])
    expect(views[0]?.resetsInMs).toBe(3.2 * HOUR)
  })

  test('has no pace without a reset time', () => {
    const [v] = limitViews(usage({ limits: [{ kind: 'five_hour', percentUsed: 24, resetsAt: null }] }), NOW)
    expect([v?.elapsed, v?.resetsInMs]).toEqual([null, null])
  })

  // The level follows the whole percentage the bar shows, not the raw reading.
  const levels = [
    [74.4, 'normal'],
    [74.5, 'warn'],
    [89.4, 'warn'],
    [89.5, 'alert'],
  ] as const

  for (const [percentUsed, expected] of levels) {
    test(`${percentUsed}% used is ${expected}, keeping the raw percent`, () => {
      const [v] = limitViews(usage({ limits: [{ kind: 'five_hour', percentUsed, resetsAt: null }] }), NOW)
      expect([v?.percent, v?.level]).toEqual([percentUsed, expected])
    })
  }

  const resets = [
    ['an unparseable reset time has no pace', 'garbage', null, null],
    ['a reset further away than the window has no time passed', iso(6 * HOUR), 0, 6 * HOUR],
  ] as const

  for (const [name, resetsAt, elapsed, resetsInMs] of resets) {
    test(name, () => {
      const [v] = limitViews(usage({ limits: [{ kind: 'five_hour', percentUsed: 24, resetsAt }] }), NOW)
      expect([v?.elapsed, v?.resetsInMs]).toEqual([elapsed, resetsInMs])
    })
  }

  test('clamps a reset time already past to a full window', () => {
    const [v] = limitViews(usage({ limits: [{ kind: 'five_hour', percentUsed: 24, resetsAt: iso(-HOUR) }] }), NOW)
    expect([v?.elapsed, v?.resetsInMs]).toEqual([1, 0])
  })
})

describe('withMeasure, cost and history', () => {
  const ctx = (tokens?: number) => ({ window: 1_000_000, ...(tokens === undefined ? {} : { tokens }) })

  test('takes the cost, and clears it when a measurement has none', () => {
    expect(withMeasure(EMPTY_USAGE, ctx(1), [], { usd: 4.12 }).costUsd).toBe(4.12)
    expect(withMeasure(usage({ costUsd: 4.12 }), ctx(1), []).costUsd).toBe(null)
  })

  test('records context only when it changed, keeping the last six', () => {
    let u = EMPTY_USAGE
    for (const t of [100, 100, 110, 120, 130, 140, 150, 160]) {
      u = withMeasure(u, ctx(t * 1000), [])
    }
    expect(u.recentWindowTokens).toEqual([110_000, 120_000, 130_000, 140_000, 150_000, 160_000])
  })

  test('records a return to an earlier figure', () => {
    let u = EMPTY_USAGE
    for (const t of [100_000, 110_000, 100_000]) {
      u = withMeasure(u, ctx(t), [])
    }
    expect(u.recentWindowTokens).toEqual([100_000, 110_000, 100_000])
    expect(contextView(u).growthPerTurn).toBe(null)
  })

  test('records nothing without a token figure', () => {
    expect(withMeasure(usage({ recentWindowTokens: [1] }), ctx(), []).recentWindowTokens).toEqual([1])
  })

  test('forgetWindow clears the figure and its history', () => {
    const u = forgetWindow(usage({ recentWindowTokens: [1, 2] }))
    expect([u.windowTokens, u.recentWindowTokens]).toEqual([null, []])
  })
})

describe('contextView, growth and turns to compact', () => {
  test('averages growth over the readings and counts turns to the trigger', () => {
    const v = contextView(usage({ recentWindowTokens: [120_000, 136_000, 152_000] }))
    expect([v.growthPerTurn, v.turnsToCompact]).toEqual([16_000, 15])
  })

  const none = [
    ['one reading', usage({ recentWindowTokens: [152_000] })],
    ['shrinking context', usage({ recentWindowTokens: [160_000, 152_000] })],
    ['flat context', usage({ recentWindowTokens: [152_000, 152_000] })],
  ] as const

  for (const [name, u] of none) {
    test(`no forecast with ${name}`, () => {
      const v = contextView(u)
      expect([v.growthPerTurn, v.turnsToCompact]).toEqual([null, null])
    })
  }

  test('growth but no turns with auto-compact off', () => {
    const v = contextView(usage({ recentWindowTokens: [136_000, 152_000], compactionTrigger: null, isAutoCompactEnabled: false }))
    expect([v.growthPerTurn, v.turnsToCompact]).toEqual([16_000, null])
  })

  test('zero turns once past the trigger', () => {
    expect(contextView(usage({ windowTokens: 390_000, recentWindowTokens: [370_000, 390_000] })).turnsToCompact).toBe(0)
  })
})

describe('limitViews, forecasts', () => {
  const at = (kind: 'five_hour' | 'seven_day', percentUsed: number, resetsInMs: number | null) =>
    limitViews(usage({ limits: [{ kind, percentUsed, resetsAt: resetsInMs === null ? null : iso(resetsInMs) }] }), NOW)[0]?.forecast

  test('projects the share at reset while under 100', () => {
    expect(at('five_hour', 24, 3.2 * HOUR)).toEqual({ kind: 'at-reset', percent: 67, level: 'normal' })
  })

  test('colours the projection by its rounded level', () => {
    expect(at('seven_day', 29.8, 4.2 * 24 * HOUR)).toEqual({ kind: 'at-reset', percent: 75, level: 'warn' })
  })

  test('says when it runs out if that comes before the reset', () => {
    const f = at('seven_day', 93, 2.66 * 24 * HOUR)
    expect(f?.kind).toBe('runs-out')
    // 7% left at 93% per 62% of a week: about 7h 50m.
    expect(f?.kind === 'runs-out' ? Math.round(f.inMs / 60_000) : -1).toBe(470)
  })

  test('forecasts from exactly 10% of the window', () => {
    expect(at('five_hour', 5, 4.5 * HOUR)).toEqual({ kind: 'at-reset', percent: 50, level: 'normal' })
  })

  test('a projection that rounds to 100 runs out rather than reading 100% by reset', () => {
    // 39.84% at 40% of the week projects 99.6%.
    expect(at('seven_day', 39.84, 0.6 * 7 * 24 * HOUR)?.kind).toBe('runs-out')
  })

  test('no forecast before 10% of the window has passed, or without a reset time', () => {
    expect(at('five_hour', 5, 4.6 * HOUR)).toBe(null)
    expect(at('five_hour', 24, null)).toBe(null)
  })
})

// State outlives a reload, so a snapshot saved by an older version of the mod
// can lack fields added since. Reading one must not throw.
describe('withUsageDefaults', () => {
  test('fills fields an older version did not save', () => {
    const legacy = { windowTokens: 152_000, modelWindow: 1_000_000, limits: [] } as Partial<UsageSnapshot>
    const u = withUsageDefaults(legacy)
    expect([u.windowTokens, u.recentWindowTokens, u.costUsd]).toEqual([152_000, [], null])
    expect(contextView(u).growthPerTurn).toBe(null)
  })

  test('keeps every field that is present', () => {
    expect(withUsageDefaults(usage({ costUsd: 4.12 }))).toEqual(usage({ costUsd: 4.12 }))
  })
})

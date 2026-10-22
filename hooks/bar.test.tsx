import type { On, SessionRateLimit } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const NOW = Date.UTC(2026, 9, 18, 12)
const HOUR = 3_600_000
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const LIMITS: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 24, resetsAt: new Date(NOW + 3.2 * HOUR).toISOString() },
  { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(NOW + 4.2 * 24 * HOUR).toISOString() },
]
const BREAKDOWN = { rawMaxTokens: 400_000, autoCompactThreshold: 380_000, isAutoCompactEnabled: true }

// breakdown is read on every answer, so a test can change it mid-session.
// calls, when given, records each breakdown read, so a test can order it
// against other events.
type Options = { breakdownFails?: boolean; rateLimits?: SessionRateLimit[]; breakdown?: typeof BREAKDOWN; calls?: string[]; noCost?: boolean }

// Answers everything beneath the plugin a session would, and draws a marker
// when the plugin hands the band back to the engine.
const world = (on: On, options: Options = {}) => {
  const clock = mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', (_$, e) => {
    if (e.breakdown !== undefined) {
      options.calls?.push('breakdown')
    }
    if (e.breakdown !== undefined && options.breakdownFails) {
      throw new Error('breakdown unavailable')
    }

    // A call on $ (an op) is answered as { value }.
    return {
      value: {
        startedAt: NOW - HOUR,
        context: { window: 1_000_000, tokens: 152_000, percent: 15, ...(e.breakdown === undefined ? {} : { breakdown: options.breakdown ?? BREAKDOWN }) },
        rateLimits: options.rateLimits ?? LIMITS,
        ...(options.noCost ? {} : { cost: { usd: 4.12 } }),
      },
    } as never
  })
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { model: 'claude-opus-5-5', input_tokens: 10, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 2_000, output_tokens: 500 },
    } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine's own</Text>
  })

  return clock
}

// One main-thread model request, as the session makes it.
const request = async ($: Parameters<TestBody>[0]) => {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }
}

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text)

// What each drawing says for a reader that cannot see it: the dial, ruler and
// bars carry the full figures the bar abbreviates.
const alts = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`on ${surface}`, () => {
    test('draws nothing of its own before the first request', async ($, on) => {
      world(on)
      await $.session.start({ cwd: '/tmp', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'session-info', surface, component: 'AbovePrompt', props: PROPS })
      expect(await texts(ui)).toEqual(["engine's own"])
    })

    // The owner wants the bar to stay while the app asks a question, so the
    // engine's survey is drawn first and the bar stays beneath it.
    test('keeps the bar beneath a survey', async ($, on) => {
      world(on)
      await $.session.start({ cwd: '/tmp', surface, isInteractive: true })
      await request($)
      const ui = await $.ui.mount({ plugin: 'session-info', surface, component: 'AbovePrompt', props: { ...PROPS, hasSurvey: true } })
      const shown = await texts(ui)
      expect(shown[0]).toBe("engine's own")
      expect(shown.join('')).toContain('152k')
    })
  })
}

describe('on terminal', () => {
  test('draws one line of text and no Svg', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect((await texts(ui)).join('')).toBe('◔ 60m │ ctx 152k/400k │ 5h 24% · wk 12%')
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  })
})

describe('on desktop', () => {
  test('draws the dial, ruler and two limit bars with their figures', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const shown = await texts(ui)
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(4)
    expect(shown).toContain('152k')
    expect(shown).toContain(' / 400k')
    expect(shown).toContain('24%')
    expect(shown).toContain('12%')
    const labels = await alts(ui)
    expect(labels).toContain('Context: 152k of 400k window · compacts at 380k · 40%')
    expect(labels).toContain('Cache: 60 min left · 1h TTL (assumed) · 153k cached')
  })

  // The cache tracking is unchanged; these guard it through the rewrite.
  test('still infers the TTL: a cache read after six minutes means 1h', async ($, on) => {
    const clock = world(on)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    await clock.advance(6 * 60_000)
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await alts(ui)).toContain('Cache: 60 min left · 1h TTL · 153k cached')
  })

  test('compaction still makes the cache cold', async ($, on) => {
    world(on)
    on('session.compact', () => ({ skip: 'test' }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    // The engine refuses a compaction that leaves no messages.
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await alts(ui)).toContain('Cache: cold · compacted')
  })

  // The spec: just compacted shows "— / 400k" until the next measurement.
  test('compaction forgets the context figure until the next measurement', async ($, on) => {
    world(on)
    on('session.compact', () => ({ skip: 'test' }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const shown = await texts(ui)
    expect(shown).toContain('—')
    expect(shown).toContain(' / 400k')
    expect(shown).not.toContain('152k')
  })

  test('re-reads the compaction window after compaction', async ($, on) => {
    const breakdown = { ...BREAKDOWN }
    world(on, { breakdown })
    on('session.compact', () => ({ skip: 'test' }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    breakdown.rawMaxTokens = 200_000
    breakdown.autoCompactThreshold = 190_000
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await texts(ui)).toContain(' / 200k')
  })

  // The switch is the engine's; the breakdown read must not hold it up.
  test('lets a model switch through before reading the breakdown', async ($, on) => {
    const calls: string[] = []
    world(on, { calls })
    on('classic.PostModelSwitch', () => {
      calls.push('switched')

      return {} as never
    })
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    calls.length = 0
    await $.classic.PostModelSwitch({
      from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5', requested_model: 'sonnet', source: 'command',
      context_tokens: 152_500, prompt_cache_warm: true, cache_ttl: '1h', estimated_cache_write_usd: 0,
    } as never)
    expect(calls).toEqual(['switched', 'breakdown'])
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await alts(ui)).toContain('Cache: cold · model switched')
  })

  // The mod must never hold up, or stop, a session ending.
  test('lets the session end through before forgetting the conversation', async ($, on) => {
    const calls: string[] = []
    world(on)
    on('session.end', (_$, e) => {
      calls.push('ended')

      return { sessionId: e.sessionId } as never
    })
    on('state.set', (_$, e, next) => {
      calls.push(`set ${e.key}`)

      return next(e)
    })
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    calls.length = 0
    await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
    expect(calls).toEqual(['ended', 'set cache', 'set usage'])
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await texts(ui)).toEqual(["engine's own"])
  })

  test('/clear still forgets the cache', async ($, on) => {
    world(on)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await texts(ui)).toEqual(["engine's own"])
  })

  // No session.start fires for the conversation that follows, so the old
  // conversation's token figure must not carry over into it.
  test('/clear forgets the context figure', async ($, on) => {
    world(on)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const shown = await texts(ui)
    expect(shown).toContain('—')
    expect(shown).not.toContain('152k')
  })

  test('a resume forgets the cache', async ($, on) => {
    world(on)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    await $.session.end({ reason: 'resume', sessionId: 's1' } as never)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await texts(ui)).toEqual(["engine's own"])
  })

  test('a resume forgets the context figure', async ($, on) => {
    world(on)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    await $.session.end({ reason: 'resume', sessionId: 's1' } as never)
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const shown = await texts(ui)
    expect(shown).toContain('—')
    expect(shown).not.toContain('152k')
  })

  test('updates from a measurement and clears a missing token figure', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    await $.session.measure({ context: { window: 1_000_000, tokens: 344_000, percent: 34 }, rateLimits: LIMITS, changed: ['context'] })
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await texts(ui)).toContain('344k')

    // Mount again rather than rely on the first drawing having been redrawn.
    await $.session.measure({ context: { window: 1_000_000 }, rateLimits: LIMITS, changed: ['context'] })
    const again = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await texts(again)).toContain('—')
  })

  test('leaves the limits out without readings', async ($, on) => {
    world(on, { rateLimits: [] })
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
    expect(await texts(ui)).not.toContain('5h')
  })

  test('falls back to the model window when the breakdown fails', async ($, on) => {
    world(on, { breakdownFails: true })
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await texts(ui)).toContain(' / 1M')
  })

  test('keeps the last compaction window when a later breakdown fails', async ($, on) => {
    // The options object is read on every answer, so the failure can start mid-session.
    const options: Options = {}
    world(on, options)
    on('session.compact', () => ({ skip: 'test' }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    options.breakdownFails = true
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await texts(ui)).toContain(' / 400k')
  })

  // The owner removed the hover cards: nothing floats over the bar.
  const floating = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
    (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')

  test('spreads four keyed sections across the bar, with no hover cards', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const root = await ui.find({ key: 'usage-bar' })
    expect(root?.props.width).toBe('100%')
    // Each section takes an equal share of the free space and centres its
    // contents, so the cache and cost sit mid-section, not against the edges.
    for (const key of ['cache', 'context', 'limits', 'cost']) {
      const section = await ui.find({ key })
      expect([section?.props.flexGrow, section?.props.justifyContent]).toEqual([1, 'center'])
    }
    expect(await floating(ui)).toHaveLength(0)
    expect(root?.props.paddingRight).toBeUndefined()
    const labels = await alts(ui)
    expect(labels).toContain('Context: 152k of 400k window · compacts at 380k · 40%')
    expect(labels).toContain('5-hour: 24% used · 36% elapsed · resets in 3h 12m')
  })

  test('puts the hit rate, forecasts and cost beside their figures', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const shown = await texts(ui)
    // 150k of 152,010 input tokens read from cache.
    expect(shown).toContain('99% hit')
    expect(shown).toContain('→ 67%')
    expect(shown).toContain('→ 30%')
    expect(shown).toContain('$4.12')
    expect(shown).toContain('session')
  })

  // Context readings for the growth: two at 16k a turn.
  const measure = ($: Parameters<TestBody>[0], tokens: number) =>
    $.session.measure({ context: { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }, rateLimits: LIMITS, changed: ['context'] })
  const mount = ($: Parameters<TestBody>[0]) => $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // Growth from 40k to 56k alone: (380k − 56k) ÷ 16k, rounded up. Had the
  // 152k and 168k readings been kept, growth would be negative and no turns
  // would show.
  const FRESH_TURNS = `≈${Math.ceil((380_000 - 56_000) / 16_000)} turns`

  test('counts turns to compact from context growth, and starts again after compaction', async ($, on) => {
    world(on)
    on('session.compact', () => ({ skip: 'test' }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    await measure($, 168_000)
    // Seeded 152k, then 168k: 16k per turn, (380k − 168k) ÷ 16k → 14.
    expect(await texts(await mount($))).toContain('≈14 turns')

    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
    expect((await texts(await mount($))).some(t => /^≈\d+ turns?$/.test(t))).toBe(false)

    await measure($, 40_000)
    await measure($, 56_000)
    expect(await texts(await mount($))).toContain(FRESH_TURNS)
  })

  for (const reason of ['clear', 'resume'] as const) {
    test(`a ${reason} starts the growth again`, async ($, on) => {
      world(on)
      on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
      await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
      await request($)
      await measure($, 168_000)
      expect(await texts(await mount($))).toContain('≈14 turns')

      await $.session.end({ reason, sessionId: 's1' } as never)
      // The cache was forgotten too, so the bar waits for a request.
      await request($)
      await measure($, 40_000)
      await measure($, 56_000)
      expect(await texts(await mount($))).toContain(FRESH_TURNS)
    })
  }

  test('leaves cost out without a cost ledger', async ($, on) => {
    world(on, { noCost: true })
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ key: 'cost' })).toBeUndefined()
    expect((await texts(ui)).some(t => t.startsWith('$'))).toBe(false)
  })

  // Hiding is /session-info's job alone; the bar draws no button of its own.
  test('draws no hide button', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })

  // Nothing counts down while busy, so the band is not redrawn every second.
  test('stops the once-a-second redraw while Claude is working', async ($, on) => {
    const clock = world(on)
    let invalidations = 0
    on('ui.invalidate', () => {
      invalidations += 1

      // A call on $ (an op) is answered as { value }.
      return { value: undefined } as never
    })
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    const ui = await $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, isWorking: true } })
    invalidations = 0
    await clock.advance(3000)
    expect(invalidations).toBe(0)

    await ui.redraw({ ...PROPS, isWorking: false })
    invalidations = 0
    await clock.advance(3000)
    expect(invalidations).toBeGreaterThan(0)
  })

  test('/session-info hides the bar, and shows it again', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await request($)
    const run = () =>
      $.command.run({ command: 'session-info', args: '', origin: 'user', presentation: 'text' } as never)
    const mount = () => $.ui.mount({ plugin: 'session-info', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

    await run()
    expect(await texts(await mount())).toEqual(["engine's own"])

    await run()
    expect(await texts(await mount())).toContain('152k')
  })
})

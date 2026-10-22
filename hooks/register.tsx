import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheSnapshot, CacheTtl, UsageSnapshot } from '../types'
import { drawDesktopBar, drawTerminalBar } from './bar'
import { FIVE_MINUTES, ONE_HOUR, cacheView } from './cache'
import { EMPTY_USAGE, contextView, forgetWindow, limitViews, withBreakdown, withMeasure, withUsageDefaults } from './usage'

// A gap must clear the 5m TTL by this much before it counts as evidence.
const GAP_SLACK = 30_000
// The system prompt and tools can be served from a cache shared beyond this
// session, so a cache read only proves the *conversation* was cached when it
// covers most of what the previous request sent.
const SERVED_SHARE = 0.5

const EMPTY: CacheSnapshot = {
  lastAt: null,
  contextTokens: 0,
  model: null,
  ttl: '1h',
  ttlSource: 'assumed',
  coldReason: null,
  hitRate: null,
}

const cache = atom({ plugin: 'session-info', key: 'cache' } as const, EMPTY)
const isHidden = atom({ plugin: 'session-info', key: 'isHidden' } as const, false)
const usage = atom({ plugin: 'session-info', key: 'usage' } as const, EMPTY_USAGE)

// State outlives a reload, so a snapshot saved by an older version of the mod
// can lack fields added since. Every read and update goes through these, which
// fill those fields with their defaults, so the bar never meets an old shape.
const readCache = async ($: EngineInterface) => ({ ...EMPTY, ...(await read($, cache)) })
const updateCache = ($: EngineInterface, change: (s: CacheSnapshot) => CacheSnapshot) =>
  update($, cache, s => change({ ...EMPTY, ...s }))
const readUsage = async ($: EngineInterface) => withUsageDefaults(await read($, usage))
const updateUsage = ($: EngineInterface, change: (u: UsageSnapshot) => UsageSnapshot) =>
  update($, usage, u => change(withUsageDefaults(u)))

// The compaction window and trigger only move with the model, compaction or
// settings, so they are re-read at those points rather than on every
// measurement. The summary breakdown is a local estimate: no API call.
// Callers gate the engine's own events on this, so it never throws.
const refreshBreakdown = async ($: EngineInterface) => {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    await updateUsage($, u => withBreakdown(u, context.breakdown))
  } catch {
    // Nothing is written: the bar keeps its previous figures, or falls back to
    // the model's window when it has none, since contextView handles null
    // breakdown fields.
  }
}

export const register: Register = (on, options) => {
  const pinned: CacheTtl | undefined =
    options.cacheTtl === '1h' || options.cacheTtl === '5m' ? options.cacheTtl : undefined
  // The band's isWorking as last drawn. Kept here, not in an atom, because
  // only this process's redraw timer reads it, and the engine redraws the
  // band itself whenever its props change, so it never goes stale for long.
  let isWorkingShown = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-info',
      description: 'Show or hide the cache and usage bar above the prompt',
    })

    // State outlives a reload, so a pin set in /config applies straight away.
    if (pinned !== undefined) {
      await updateCache($, (s): CacheSnapshot => ({ ...s, ttl: pinned, ttlSource: 'pinned' }))
    }

    // Redraw the band once a second so the countdown moves. Redraws are only
    // asked for while there is something to count down: not while Claude is
    // working, when the dial shows a still ring with no countdown.
    $.clock.every(1000, async () => {
      if (isWorkingShown) {
        return
      }

      const s = await readCache($)

      if (s.lastAt !== null && !(await read($, isHidden))) {
        $.ui.invalidate('ui.render')
      }
    })

    const result = await next(e)

    // Seed from the session's current figures, so a resumed session shows
    // them before its first measurement. After next(e), so the session is
    // bound (the breakdown needs one) and start is not delayed.
    try {
      const current = await $.session.usage()
      await updateUsage($, u => withMeasure(u, current.context, current.rateLimits, current.cost))
    } catch {
      // Nothing is written: the figures stay as they were (empty in a new
      // session) until the first measurement fills them.
    }
    await refreshBreakdown($)

    return result
  })

  on('command.run', { command: 'session-info' }, async $ => {
    const hidden = await update($, isHidden, was => !was)

    return { text: hidden ? 'Session info hidden.' : 'Session info shown.' }
  })

  // Every main-thread model request reads (and so refreshes) the cache.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)

    // A subagent's requests keep its own prefix warm, not this conversation's.
    if (e.agentId !== undefined || result.usage === null) {
      return result
    }

    const stepUsage = result.usage
    const sent = stepUsage.input_tokens + stepUsage.cache_read_input_tokens + stepUsage.cache_creation_input_tokens

    await updateCache($, s => {
      let { ttl, ttlSource } = s
      const canInfer =
        pinned === undefined &&
        ttlSource !== 'reported' &&
        s.lastAt !== null &&
        s.coldReason === null &&
        s.model === stepUsage.model &&
        s.contextTokens > 0

      if (canInfer && s.lastAt !== null) {
        const gap = startedAt - s.lastAt
        const wasServed = stepUsage.cache_read_input_tokens >= s.contextTokens * SERVED_SHARE

        // Served after more than 5 minutes: only a 1h TTL explains that.
        // Missed after 5 to 60 minutes: a 1h TTL should have held, so it is 5m.
        if (gap > FIVE_MINUTES + GAP_SLACK && wasServed) {
          ttl = '1h'
          ttlSource = 'observed'
        } else if (gap > FIVE_MINUTES + GAP_SLACK && gap < ONE_HOUR && !wasServed) {
          ttl = '5m'
          ttlSource = 'observed'
        }
      }

      return {
        lastAt: startedAt,
        contextTokens: sent + stepUsage.output_tokens,
        model: stepUsage.model,
        ttl,
        ttlSource,
        coldReason: null,
        // Share of this request's input served from cache.
        hitRate: sent > 0 ? stepUsage.cache_read_input_tokens / sent : null,
      }
    })

    return result
  })

  // Context and limit figures, pushed by the engine whenever one moves. The
  // engine's measurement runs first, so it never waits on, or is lost to, this
  // state write.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)

    try {
      await updateUsage($, u => withMeasure(u, e.context, e.rateLimits, e.cost))
    } catch {
      // The bar keeps its previous figures until the next measurement.
    }

    return result
  })

  // The cache is per model: a switch forfeits it. The engine reports the
  // session's real TTL here, the one place a mod can read it. The switch runs
  // first, so it never waits on, or is stopped by, this state write or the
  // breakdown read.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)

    try {
      await updateCache($, (s): CacheSnapshot => ({
        ...s,
        coldReason: 'model switched',
        ttl: pinned ?? e.cache_ttl,
        ttlSource: pinned === undefined ? 'reported' : 'pinned',
      }))
    } catch {
      // The dial keeps its previous state until the next request.
    }
    await refreshBreakdown($)

    return result
  })

  // Compaction replaces the transcript, so the cached prefix no longer matches.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      try {
        await updateCache($, s => ({ ...s, coldReason: 'compacted' }))
        // The summary replaced the transcript, so the old figure overstates
        // it and its growth no longer applies; the bar shows "—" until the
        // next measurement.
        await updateUsage($, forgetWindow)
      } catch {
        // The compaction has happened; the bar catches up at the next
        // request and measurement.
      }
      await refreshBreakdown($)
    }

    return result
  })

  // A /clear or an in-process resume carries on under a new conversation
  // with no session.start, so the old conversation's cache, token figure and
  // growth must go here. The TTL, the windows and the limits belong to the
  // account and model, not the conversation, so they stay. The end runs first,
  // so the mod can never hold up or stop a session ending.
  on('session.end', async ($, e, next) => {
    const result = await next(e)

    if (e.reason === 'clear' || e.reason === 'resume') {
      try {
        await updateCache($, s => ({ ...EMPTY, ttl: s.ttl, ttlSource: s.ttlSource }))
        await updateUsage($, forgetWindow)
      } catch {
        // The bar may show the old conversation's figures until the next
        // request and measurement replace them.
      }
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Before the early returns, so the timer knows even when the bar is hidden.
    isWorkingShown = e.props.isWorking
    const s = await readCache($)

    if (s.lastAt === null || (await read($, isHidden))) {
      return next(e)
    }

    const now = await $.clock.now()
    const u = await readUsage($)
    const model = {
      cache: cacheView({ ...s, lastAt: s.lastAt }, now, e.props.isWorking),
      context: contextView(u),
      limits: limitViews(u, now),
      cost: u.costUsd,
    }

    const bar = e.surface === 'desktop' ? drawDesktopBar($.ui.resolve(e), model) : drawTerminalBar($.ui.resolve(e), model)

    // The owner wants the bar to stay while the app asks a question, so a
    // survey is drawn first and the bar stays beneath it, rather than yielding
    // the band. If a surface refuses the pair, the engine draws its own.
    if (e.props.hasSurvey) {
      const survey = await next(e)
      const { Box } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {survey}
          {bar}
        </Box>
      )
    }

    return bar
  })
}

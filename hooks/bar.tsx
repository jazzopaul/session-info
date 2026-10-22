import type { ElementTable } from 'claude-code'

import type { BarModel } from './details'
import { cacheDetail, contextDetail, forecastText, hitText, limitDetail, turnsText } from './details'
import { money, tokens } from './format'
import { DIAL_SIZE, LIMIT_BAR_WIDTH, RULER_WIDTH, SHAPE_HEIGHT, dialSvg, limitBarSvg, rulerSvg } from './svg'
import { terminalSegments } from './terminal'
import type { Tone } from './terminal'
import type { Level } from './views'

const LEVEL_COLOR: Record<Level, 'warning' | 'error' | undefined> = { normal: undefined, warn: 'warning', alert: 'error' }
const TONE_COLOR: Record<Tone, 'success' | 'warning' | 'error' | undefined> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  dim: undefined,
  plain: undefined,
}

// Every surface without Svg, and any surface besides the desktop, gets the
// bar as one line of text.
export const drawTerminalBar = (els: Pick<ElementTable<'terminal'>, 'Box' | 'Text'>, m: BarModel) => {
  const { Box, Text } = els

  return (
    <Box flexDirection="row">
      {terminalSegments(m.cache, m.context, m.limits).map(s => (
        <Text color={TONE_COLOR[s.tone]} dimColor={s.tone === 'dim'}>
          {s.text}
        </Text>
      ))}
    </Box>
  )
}

// A figure that only matters near a limit stays dim until it is coloured.
const dimUnlessColoured = (color: 'warning' | 'error' | undefined) => ({ color, dimColor: color === undefined })

// No hide button: /session-info toggles the bar.
export const drawDesktopBar = (els: ElementTable<'desktop'>, m: BarModel) => {
  const { Box, Svg, Text } = els
  const hit = hitText(m.cache)
  const turns = turnsText(m.context)

  const divider = <Text dimColor>│</Text>

  return (
    // Full width, split by the dividers into four sections. Each section takes
    // an equal share of the free space and centres its contents, so the cache
    // and cost sit mid-section rather than against the bar's edges.
    <Box key="usage-bar" width="100%" flexDirection="row" alignItems="center">
      <Box key="cache" flexGrow={1} flexDirection="row" justifyContent="center" alignItems="center" gap={1}>
        <Svg source={dialSvg(m.cache)} alt={`Cache: ${cacheDetail(m.cache)}`} width={DIAL_SIZE} height={DIAL_SIZE} />
        {hit === null ? null : <Text dimColor>{hit}</Text>}
      </Box>
      {divider}
      <Box key="context" flexGrow={1} flexDirection="row" justifyContent="center">
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            {/* The figure keeps its own spacing, so " / 400k" sits as before. */}
            <Box flexDirection="row">
              <Text weight="semibold" tabular color={LEVEL_COLOR[m.context.level]}>
                {m.context.used === null ? '—' : tokens(m.context.used)}
              </Text>
              <Text dimColor>{m.context.shownWindow === null ? '' : ` / ${tokens(m.context.shownWindow)}`}</Text>
            </Box>
            {turns === null ? null : <Text {...dimUnlessColoured(LEVEL_COLOR[m.context.level])}>{turns}</Text>}
          </Box>
          <Svg
            source={rulerSvg(m.context.percent, m.context.level)}
            alt={`Context: ${contextDetail(m.context)}`}
            width={RULER_WIDTH}
            height={SHAPE_HEIGHT}
          />
        </Box>
      </Box>
      {m.limits.length === 0 ? null : divider}
      {m.limits.length === 0 ? null : (
        <Box key="limits" flexGrow={1} flexDirection="row" justifyContent="center">
          <Box flexDirection="column">
            {m.limits.map(l => {
              const f = forecastText(l)
              // Running out is always red; a projection takes its own level.
              const color =
                l.forecast?.kind === 'runs-out' ? 'error' : l.forecast?.kind === 'at-reset' ? LEVEL_COLOR[l.forecast.level] : undefined

              return (
                <Box flexDirection="row" alignItems="center" gap={1}>
                  <Text dimColor size="caption">
                    {l.label}
                  </Text>
                  <Svg source={limitBarSvg(l)} alt={`${l.name}: ${limitDetail(l)}`} width={LIMIT_BAR_WIDTH} height={SHAPE_HEIGHT} />
                  <Text weight="semibold" tabular color={LEVEL_COLOR[l.level]}>
                    {`${Math.round(l.percent)}%`}
                  </Text>
                  {f === null ? null : <Text {...dimUnlessColoured(color)}>{f}</Text>}
                </Box>
              )
            })}
          </Box>
        </Box>
      )}
      {m.cost === null ? null : divider}
      {m.cost === null ? null : (
        <Box key="cost" flexGrow={1} flexDirection="row" justifyContent="center">
          <Box flexDirection="column" alignItems="center">
            <Text weight="semibold" tabular>
              {money(m.cost)}
            </Text>
            <Text dimColor size="caption">
              session
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

import { dialLabel } from './cache'
import { tokens } from './format'
import type { CacheView, ContextView, Level, LimitView } from './views'

// success, warning and error are theme colour keys; dim is drawn with dimColor, plain with no colour.
export type Tone = 'success' | 'warning' | 'error' | 'dim' | 'plain'

export type Segment = { text: string; tone: Tone }

const LEVEL_TONE: Record<Level, Tone> = { normal: 'plain', warn: 'warning', alert: 'error' }
const SEPARATOR: Segment = { text: ' │ ', tone: 'dim' }

const cacheSegment = (v: CacheView): Segment => {
  switch (v.state) {
    case 'cold':
      return { text: '○ cold', tone: 'error' }
    case 'busy':
      return { text: '◔ in use', tone: 'plain' }
    default: {
      // The dial's minutes-or-seconds rule, with minutes shortened to "m".
      const { value, unit } = dialLabel(v)

      return { text: `◔ ${value}${unit === 'MIN' ? 'm' : ''}`, tone: v.state === 'expiring' ? 'warning' : 'success' }
    }
  }
}

// The bar as one line: cache, context, then the limits, in the desktop's order.
export const terminalSegments = (cache: CacheView, context: ContextView, limits: readonly LimitView[]): Segment[] => {
  const segments: Segment[] = [
    cacheSegment(cache),
    SEPARATOR,
    { text: 'ctx ', tone: 'dim' },
    { text: context.used === null ? '—' : tokens(context.used), tone: LEVEL_TONE[context.level] },
  ]

  if (context.shownWindow !== null) {
    segments.push({ text: `/${tokens(context.shownWindow)}`, tone: 'dim' })
  }

  limits.forEach((l, i) => {
    segments.push(i === 0 ? SEPARATOR : { text: ' · ', tone: 'dim' })
    segments.push({ text: `${l.label} `, tone: 'dim' }, { text: `${Math.round(l.percent)}%`, tone: LEVEL_TONE[l.level] })
  })

  return segments
}

export const terminalText = (segments: readonly Segment[]) => segments.map(s => s.text).join('')

import { dialLabel, ttlMs } from './cache'
import type { CacheView, Level, LimitView } from './views'

// An Svg is drawn as an isolated image that cannot read the app's theme, so
// every shape carries both palettes and picks one with the colour-scheme
// media query.
const PALETTE = {
  light: {
    track: 'rgba(0,0,0,.09)',
    neutral: '#57534c',
    warn: '#b97a12',
    alert: '#c4473a',
    warm: '#2f9e63',
    expiring: '#b97a12',
    cold: '#c4473a',
    // Soft blue: active, and outside the green/amber/red warning scale.
    busy: '#3b78c9',
    text: '#1f1e1c',
    dim: '#6c6860',
    tick: '#a19d94',
    pace: '#1f1e1c',
  },
  dark: {
    track: 'rgba(255,255,255,.10)',
    neutral: '#c9c5bc',
    warn: '#e3a640',
    alert: '#e26d5c',
    warm: '#5fbf8a',
    expiring: '#e3a640',
    cold: '#e26d5c',
    busy: '#7aa7e6',
    text: '#ece9e3',
    dim: '#9c988f',
    tick: '#6f6c66',
    pace: '#ece9e3',
  },
} as const

type PaletteKey = keyof typeof PALETTE.light

const toVars = (p: Record<PaletteKey, string>) =>
  Object.entries(p)
    .map(([name, value]) => `--${name}:${value}`)
    .join(';')

const STYLE = `<style>svg{${toVars(PALETTE.light)}}@media (prefers-color-scheme: dark){svg{${toVars(PALETTE.dark)}}}</style>`

const FONT = 'font-family="-apple-system,system-ui,sans-serif"'

const LEVEL_TONE: Record<Level, PaletteKey> = { normal: 'neutral', warn: 'warn', alert: 'alert' }

const svg = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${STYLE}${body}</svg>`

export const DIAL_SIZE = 34
export const RULER_WIDTH = 64
export const LIMIT_BAR_WIDTH = 60
export const SHAPE_HEIGHT = 8

const centre = (value: string, unit: string, tone: PaletteKey) => {
  const c = DIAL_SIZE / 2

  if (unit === '') {
    return `<text x="${c}" y="${c + 4}" text-anchor="middle" font-size="11" font-weight="600" style="fill:var(--${tone})" ${FONT}>${value}</text>`
  }

  return (
    `<text x="${c}" y="${c + 2}" text-anchor="middle" font-size="12" font-weight="650" style="fill:var(--${tone})" ${FONT}>${value}</text>` +
    `<text x="${c}" y="${c + 10}" text-anchor="middle" font-size="6.5" letter-spacing=".04em" style="fill:var(--dim)" ${FONT}>${unit}</text>`
  )
}

export const dialSvg = (v: CacheView): string => {
  const c = DIAL_SIZE / 2
  const r = c - 2.5
  const circ = 2 * Math.PI * r
  const track = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:var(--track)" stroke-width="2"/>`

  if (v.state === 'cold') {
    return svg(DIAL_SIZE, DIAL_SIZE, `${track}<circle cx="${c}" cy="${c}" r="3" style="fill:var(--cold)"/>`)
  }

  // Busy is a still, full orange ring: a spin restarted (flashed) every time
  // the bar redrew mid-turn, so no shape here animates.
  if (v.state === 'busy') {
    const ring = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:var(--busy)" stroke-width="2"/>`

    return svg(DIAL_SIZE, DIAL_SIZE, `${ring}${centre('···', '', 'text')}`)
  }

  // The arc follows what the centre shows, not the exact time left, so the
  // source only changes when the label does and the image is redrawn once a
  // minute rather than every second.
  const label = dialLabel(v)
  const isLastMinute = label.unit === ''
  const shownMs = isLastMinute ? Math.ceil(v.leftMs / 1000) * 1000 : Math.ceil(v.leftMs / 60_000) * 60_000
  const fraction = Math.min(1, shownMs / ttlMs(v.ttl))
  const tone: PaletteKey = v.state === 'expiring' ? 'expiring' : 'warm'
  const arc =
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:var(--${tone})" stroke-width="2" stroke-linecap="round" ` +
    `stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${(circ * (1 - fraction)).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`

  return svg(DIAL_SIZE, DIAL_SIZE, `${track}${arc}${centre(label.value, label.unit, isLastMinute ? tone : 'text')}`)
}

export const rulerSvg = (percent: number | null, lvl: Level): string => {
  const fill = percent === null ? 0 : Math.min(1, Math.max(0, percent / 100)) * RULER_WIDTH
  let ticks = ''

  for (let i = 0; i <= 8; i++) {
    const isMajor = i % 4 === 0
    ticks += `<rect x="${Math.min(RULER_WIDTH - 1, i * 8)}" y="${isMajor ? 1 : 3}" width="1" height="${isMajor ? 5 : 3}" style="fill:var(--tick)"/>`
  }

  return svg(
    RULER_WIDTH,
    SHAPE_HEIGHT,
    `<rect x="0" y="6" width="${RULER_WIDTH}" height="2" rx="1" style="fill:var(--track)"/>` +
      `<rect x="0" y="6" width="${fill.toFixed(1)}" height="2" rx="1" style="fill:var(--${LEVEL_TONE[lvl]})"/>${ticks}`,
  )
}

export const limitBarSvg = (l: LimitView): string => {
  const w = LIMIT_BAR_WIDTH
  const fill = Math.max(1.5, Math.min(1, l.percent / 100) * w)
  // The pace tick: where an even rate of use would have got to by now.
  const tick =
    l.elapsed === null
      ? ''
      : `<rect x="${Math.min(w - 1.5, Math.max(0, w * l.elapsed - 0.75)).toFixed(1)}" y="0" width="1.5" height="${SHAPE_HEIGHT}" rx="0.75" style="fill:var(--pace)" opacity="0.75"/>`

  return svg(
    w,
    SHAPE_HEIGHT,
    `<rect x="0" y="2.5" width="${w}" height="3" rx="1.5" style="fill:var(--track)"/>` +
      `<rect x="0" y="2.5" width="${fill.toFixed(1)}" height="3" rx="1.5" style="fill:var(--${LEVEL_TONE[l.level]})"/>${tick}`,
  )
}

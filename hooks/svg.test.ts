import { describe, expect, test } from 'claude-code/testing'

import { dialSvg, limitBarSvg, rulerSvg } from './svg'
import type { CacheView, LimitView } from './views'

const MINUTE = 60_000

const cache = (over: Partial<CacheView> = {}): CacheView => ({
  state: 'warm',
  leftMs: 42 * MINUTE,
  ttl: '1h',
  ttlSource: 'observed',
  cachedTokens: 182_000,
  coldReason: null,
  hitRate: null,
  ...over,
})

const limit = (over: Partial<LimitView> = {}): LimitView => ({
  kind: 'five_hour',
  label: '5h',
  name: '5-hour',
  percent: 24,
  level: 'normal',
  elapsed: 0.36,
  resetsInMs: 3.2 * 3_600_000,
  forecast: null,
  ...over,
})

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe('every shape', () => {
  test('carries both palettes and switches on the colour scheme', () => {
    for (const s of [dialSvg(cache()), rulerSvg(40, 'normal'), limitBarSvg(limit())]) {
      expect(s).toContain('prefers-color-scheme: dark')
      expect(s).toContain('#2f9e63')
      expect(s).toContain('#5fbf8a')
      expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    }
  })
})

describe('dialSvg', () => {
  test('warm: a green arc, the minutes, no animation', () => {
    const s = dialSvg(cache())
    expect(s).toContain('var(--warm)')
    expect(s).toContain('>42<')
    expect(s).toContain('>MIN<')
    expect(s).not.toContain('<animate')
  })

  // The spike showed a pulse restarting whenever the source changed, which
  // read as a flash, so expiring is shown by colour alone.
  test('expiring: an amber arc with no animation', () => {
    const v = cache({ state: 'expiring', leftMs: 7 * MINUTE })
    expect(dialSvg(v)).toContain('var(--expiring)')
    expect(dialSvg(v)).not.toContain('<animate')
  })

  // A spin restarted (flashed) whenever the bar redrew mid-turn, so busy is a
  // still, full ring. It is soft blue: orange read as a warning, and busy is
  // healthy (the request refreshes the cache).
  test('busy: a full soft-blue ring and dots, no animation', () => {
    const s = dialSvg(cache({ state: 'busy' }))
    expect(s).toContain('var(--busy)')
    expect(s).toContain('--busy:#3b78c9')
    expect(s).toContain('--busy:#7aa7e6')
    expect(s).toContain('···')
    expect(s).not.toContain('<animate')
    expect(s).not.toContain('stroke-dasharray')
  })

  test('cold: a red dot and no text', () => {
    const s = dialSvg(cache({ state: 'cold', leftMs: 0, coldReason: 'compacted' }))
    expect(s).toContain('var(--cold)')
    expect(s).not.toContain('<text')
  })

  test('keeps the same source while the label is unchanged', () => {
    expect(dialSvg(cache({ leftMs: 42 * MINUTE }))).toBe(dialSvg(cache({ leftMs: 41.2 * MINUTE })))
    expect(dialSvg(cache({ leftMs: 42 * MINUTE }))).not.toBe(dialSvg(cache({ leftMs: 40.9 * MINUTE })))
  })

  test('shows seconds in the last minute', () => {
    expect(dialSvg(cache({ state: 'expiring', leftMs: 42_000 }))).toContain('>42s<')
  })

  test('a full TTL draws the whole arc', () => {
    expect(dialSvg(cache({ leftMs: 60 * MINUTE }))).toContain('stroke-dashoffset="0.00"')
  })

  test('half the TTL draws half the arc', () => {
    const half = ((2 * Math.PI * 14.5) / 2).toFixed(2)
    expect(dialSvg(cache({ leftMs: 30 * MINUTE }))).toContain(`stroke-dashoffset="${half}"`)
  })
})

describe('rulerSvg', () => {
  test('fills the share used, clamped to the ruler', () => {
    expect(rulerSvg(50, 'normal')).toContain('width="32.0"')
    expect(rulerSvg(150, 'alert')).toContain('width="64.0"')
    expect(rulerSvg(150, 'alert')).toContain('var(--alert)')
  })

  test('is empty with no reading', () => {
    expect(rulerSvg(null, 'normal')).toContain('width="0.0"')
  })

  test('draws nine ticks', () => {
    expect(count(rulerSvg(40, 'normal'), 'var(--tick)')).toBe(9)
  })
})

describe('limitBarSvg', () => {
  test('draws the pace tick where the window has got to', () => {
    const s = limitBarSvg(limit({ elapsed: 0.5 }))
    const x = Number(/<rect x="([\d.]+)" y="0"/.exec(s)?.[1])
    expect(s).toContain('var(--pace)')
    // Centred on half of the 60px bar: 30 less half the tick's 1.5px width.
    expect(x).toBe(29.3)
  })

  test('puts the tick at the edges at the start and end of the window', () => {
    const tickX = (elapsed: number) => /<rect x="([\d.]+)" y="0"/.exec(limitBarSvg(limit({ elapsed })))?.[1]
    expect(tickX(0)).toBe('0.0')
    // 60 less the tick's 1.5px width, so it stays inside the bar.
    expect(tickX(1)).toBe('58.5')
  })

  test('clamps the fill to the bar', () => {
    expect(limitBarSvg(limit({ percent: 150 }))).toContain('width="60.0"')
  })

  test('leaves the tick out without a reset time', () => {
    expect(limitBarSvg(limit({ elapsed: null }))).not.toContain('var(--pace)')
  })

  test('takes the level colour', () => {
    expect(limitBarSvg(limit({ percent: 93, level: 'alert' }))).toContain('var(--alert)')
  })

  test('always shows a sliver of fill', () => {
    // No pace tick, which is also 1.5 wide and would hide a broken fill.
    expect(limitBarSvg(limit({ percent: 0, elapsed: null }))).toContain('width="1.5"')
  })
})

import { describe, expect, test } from 'claude-code/testing'

import type { CacheSnapshot } from '../types'
import { cacheView, dialLabel, EXPIRING_SOON } from './cache'

const NOW = Date.UTC(2026, 9, 18, 12)
const MINUTE = 60_000

const snapshot = (over: Partial<CacheSnapshot> = {}) =>
  ({
    lastAt: NOW,
    contextTokens: 182_000,
    model: 'claude-opus-5-5',
    ttl: '1h',
    ttlSource: 'observed',
    coldReason: null,
    hitRate: null,
    ...over,
  }) as CacheSnapshot & { lastAt: number }

describe('cacheView', () => {
  test('warm with more than ten minutes left', () => {
    const v = cacheView(snapshot({ lastAt: NOW - 18 * MINUTE }), NOW, false)
    expect(v.state).toBe('warm')
    expect(v.leftMs).toBe(42 * MINUTE)
    expect(v.coldReason).toBe(null)
  })

  test('expiring under ten minutes', () => {
    expect(cacheView(snapshot({ lastAt: NOW - 53 * MINUTE }), NOW, false).state).toBe('expiring')
  })

  test('warm with exactly ten minutes left', () => {
    expect(cacheView(snapshot({ lastAt: NOW - 60 * MINUTE + EXPIRING_SOON }), NOW, false).state).toBe('warm')
  })

  // The dial rounds minutes up, so 9.5 min left reads "10 MIN"; amber there
  // would contradict the label.
  test('warm with 9.5 minutes left, which the dial shows as 10', () => {
    expect(cacheView(snapshot({ lastAt: NOW - 50.5 * MINUTE }), NOW, false).state).toBe('warm')
  })

  test('expiring with 9 minutes left', () => {
    expect(cacheView(snapshot({ lastAt: NOW - 51 * MINUTE }), NOW, false).state).toBe('expiring')
  })

  test('cold at the moment of expiry, expired just now', () => {
    const v = cacheView(snapshot({ lastAt: NOW - 60 * MINUTE }), NOW, false)
    expect(v.state).toBe('cold')
    expect(v.coldReason).toBe('expired just now')
  })

  test('cold once the TTL has run out, saying how long ago', () => {
    const v = cacheView(snapshot({ lastAt: NOW - 72 * MINUTE }), NOW, false)
    expect(v.state).toBe('cold')
    expect(v.leftMs).toBe(0)
    expect(v.coldReason).toBe('expired 12 min ago')
  })

  test('cold with the snapshot reason when something invalidated it', () => {
    const v = cacheView(snapshot({ coldReason: 'compacted' }), NOW, false)
    expect(v.state).toBe('cold')
    expect(v.coldReason).toBe('compacted')
  })

  test('busy while Claude works, even when cold', () => {
    expect(cacheView(snapshot({ coldReason: 'compacted' }), NOW, true).state).toBe('busy')
    expect(cacheView(snapshot(), NOW, true).state).toBe('busy')
  })

  test('the 5m TTL counts down from five minutes', () => {
    expect(cacheView(snapshot({ ttl: '5m', lastAt: NOW - MINUTE }), NOW, false).leftMs).toBe(4 * MINUTE)
  })
})

describe('dialLabel', () => {
  const at = (leftMs: number) => cacheView(snapshot({ lastAt: NOW - (60 * MINUTE - leftMs) }), NOW, false)

  test('whole minutes, rounded up, with a MIN unit', () => {
    expect(dialLabel(at(42 * MINUTE))).toEqual({ value: '42', unit: 'MIN' })
    expect(dialLabel(at(41.5 * MINUTE))).toEqual({ value: '42', unit: 'MIN' })
  })

  test('seconds in the last minute', () => {
    expect(dialLabel(at(42_000))).toEqual({ value: '42s', unit: '' })
  })

  test('just under a minute rounds up to 1 MIN, never 60s', () => {
    expect(dialLabel(at(59_500))).toEqual({ value: '1', unit: 'MIN' })
  })

  test('dots while busy and nothing when cold', () => {
    expect(dialLabel(cacheView(snapshot(), NOW, true))).toEqual({ value: '···', unit: '' })
    expect(dialLabel(cacheView(snapshot({ coldReason: 'compacted' }), NOW, false))).toEqual({ value: '', unit: '' })
  })
})

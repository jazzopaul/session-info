import { describe, expect, test } from 'claude-code/testing'

import { ago, duration, level, money, tokens } from './format'

describe('level', () => {
  const cases = [
    [0, 'normal'],
    [74.9, 'normal'],
    [75, 'warn'],
    [89.9, 'warn'],
    [90, 'alert'],
    [130, 'alert'],
  ] as const

  for (const [percent, expected] of cases) {
    test(`${percent}% is ${expected}`, () => {
      expect(level(percent)).toBe(expected)
    })
  }
})

describe('tokens', () => {
  const cases = [
    [999, '999'],
    [1000, '1k'],
    [999_499, '999k'],
    [152_400, '152k'],
    [400_000, '400k'],
    [999_600, '1M'],
    [1_000_000, '1M'],
    [1_500_000, '1.5M'],
  ] as const

  for (const [n, expected] of cases) {
    test(`${n} reads ${expected}`, () => {
      expect(tokens(n)).toBe(expected)
    })
  }
})

describe('duration', () => {
  const MINUTE = 60_000
  const cases = [
    [NaN, '<1m'],
    [0, '<1m'],
    [59_000, '<1m'],
    [47 * MINUTE, '47m'],
    [(3 * 60 + 12) * MINUTE, '3h 12m'],
    [(4 * 24 + 4) * 60 * MINUTE, '4d 4h'],
  ] as const

  for (const [ms, expected] of cases) {
    test(`${ms} ms reads ${expected}`, () => {
      expect(duration(ms)).toBe(expected)
    })
  }
})

describe('money', () => {
  const cases = [
    [0, '$0.00'],
    [4.123, '$4.12'],
    [99.994, '$99.99'],
    [123.4, '$123'],
  ] as const

  for (const [usd, expected] of cases) {
    test(`${usd} reads ${expected}`, () => {
      expect(money(usd)).toBe(expected)
    })
  }
})

describe('ago', () => {
  const cases = [
    [NaN, 'just now'],
    [20_000, 'just now'],
    [12 * 60_000, '12 min ago'],
    [3 * 3_600_000, '3 h ago'],
  ] as const

  for (const [ms, expected] of cases) {
    test(`${ms} ms reads ${expected}`, () => {
      expect(ago(ms)).toBe(expected)
    })
  }
})

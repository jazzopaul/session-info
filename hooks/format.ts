import type { Level } from './views'

// Context and limits turn amber at 75% and red at 90%.
const WARN_AT = 75
const ALERT_AT = 90

export const level = (percent: number): Level =>
  percent >= ALERT_AT ? 'alert' : percent >= WARN_AT ? 'warn' : 'normal'

// From 999,500 the thousands would round to "1000k", so millions start there.
export const tokens = (n: number) =>
  n >= 999_500
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : `${n}`

export const ago = (ms: number) => {
  if (!Number.isFinite(ms)) {
    return 'just now'
  }

  const minutes = Math.round(ms / 60_000)

  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`
}

// A span as "4d 4h", "3h 12m" or "47m"; under a minute reads "<1m".
export const duration = (ms: number) => {
  if (!Number.isFinite(ms)) {
    return '<1m'
  }

  const minutes = Math.max(0, Math.floor(ms / 60_000))

  if (minutes < 1) {
    return '<1m'
  }

  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

// Session cost: cents under $100, whole dollars from there.
export const money = (usd: number) => (usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`)

import { getErrorMessage, type ApiError } from '../../api/axios'

// Dates and times in the viewer's own time zone, without seconds

const valid = (value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatDate = (value?: string | null) =>
  valid(value)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '—'

export const formatDateTime = (value?: string | null) =>
  valid(value)?.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) ?? '—'

export const formatTime = (value?: string | null) =>
  valid(value)?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) ?? '—'

// A calendar day (YYYY-MM-DD) as written, never shifted by a time zone
export const formatDay = (day?: string | null) => {
  const match = day ? /^(\d{4})-(\d{2})-(\d{2})/.exec(day) : null
  if (!match) return '—'
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

// YYYY-MM-DD of a date in the viewer's time zone
export const dayKey = (date = new Date()) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export const daysAgo = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return dayKey(date)
}

export const formatHours = (hours?: number | null) =>
  typeof hours === 'number' && Number.isFinite(hours) ? `${hours.toFixed(1)} h` : '—'

export const initials = (name?: string | null) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'

// The server's message, with a word on rate limits and a plain one for a lost connection
export const errorText = (error: unknown, fallback: string) => {
  const status = (error as ApiError | undefined)?.status
  const message = getErrorMessage(error, fallback)
  if (status === undefined && /cannot connect to server/i.test(message)) {
    return "Can't reach Pandav right now. Check your connection and try again."
  }
  if (status === 429 && !/try again/i.test(message)) {
    return `${message} Too many requests in a short time: please wait a minute and try again.`
  }
  return message
}

// "Nov 10, 2026, 3:45 PM": the browser's local date and time, without seconds
export const formatDateTime = (value?: string | Date | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

// "Just now", "5 min ago", "3 h ago", "Yesterday", then the date
export const timeAgo = (value?: string | Date | null, now = new Date()) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000)
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString([], { dateStyle: 'medium' })
}

// A day as YYYY-MM-DD in the browser's own time zone (toISOString gives the UTC day)
export const localDayKey = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

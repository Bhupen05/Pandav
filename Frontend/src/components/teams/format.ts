import { getErrorMessage } from '../../api/axios'

// ── Dates ──────────────────────────────────────────────────────────────────
// Local date and time, never with seconds

export const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const formatDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

export const formatTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—'

// A calendar day (YYYY-MM-DD, such as a task's dueDay or an attendance
// record's day) shown as that same day, whatever the browser's time zone
export const formatDay = (day?: string | null) => {
  const match = day && /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
  if (!match) return '—'
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Today as YYYY-MM-DD in the given time zone (the server's is Asia/Kolkata)
export const dayIn = (timeZone?: string, date = new Date()) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  }
}

export const SERVER_TIME_ZONE = 'Asia/Kolkata'

export const formatHours = (hours?: number | null) => {
  if (hours === undefined || hours === null || Number.isNaN(hours)) return '—'
  const rounded = Math.round(hours * 100) / 100
  return `${rounded} h`
}

// ── Labels ─────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  user: 'User',
  team_member: 'Team member',
  team_leader: 'Team leader',
  admin: 'Admin',
}

export const roleLabel = (role?: string) => (role ? ROLE_LABELS[role] ?? role : '')

export const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  'in-progress': 'In progress',
  'completion-requested': 'Awaiting review',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const TASK_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  'in-progress': 'bg-blue-100 text-blue-800',
  'completion-requested': 'bg-purple-100 text-purple-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

export const PRIORITY_CLASSES: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-800',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-red-100 text-red-800',
}

// The kind of day: outlined, so it never looks like an approval state
export const DAY_TYPE_LABELS: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  'half-day': 'Half day',
  leave: 'Leave',
}

export const DAY_TYPE_CLASSES: Record<string, string> = {
  present: 'border-emerald-300 text-emerald-800',
  absent: 'border-red-300 text-red-700',
  late: 'border-orange-300 text-orange-800',
  'half-day': 'border-sky-300 text-sky-800',
  leave: 'border-violet-300 text-violet-800',
}

// The approval state: filled
export const APPROVAL_LABELS: Record<string, string> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
}

export const APPROVAL_CLASSES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
}

export const INVITE_STATE_LABELS: Record<string, string> = {
  pending: 'Waiting for an answer',
  expired: 'Expired',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
}

export const INVITE_STATE_CLASSES: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-800',
  expired: 'bg-gray-100 text-gray-600',
  accepted: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-red-100 text-red-700',
  withdrawn: 'bg-gray-100 text-gray-600',
}

export const labelFrom = (labels: Record<string, string>, value?: string | null) =>
  value ? labels[value] ?? value.replace(/[-_]/g, ' ') : '—'

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

// ── Errors ─────────────────────────────────────────────────────────────────

const waitText = (seconds: number) => {
  if (seconds < 90) return 'in about a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `in about ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return `in about ${hours} hour${hours === 1 ? '' : 's'}`
}

// The server's message; for a rate limit, also when to try again
export const teamErrorMessage = (error: unknown, fallback: string) => {
  const message = getErrorMessage(error, fallback)
  if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
    const retryAfter = 'retryAfter' in error && typeof error.retryAfter === 'number' ? error.retryAfter : undefined
    return retryAfter ? `${message.replace(/\s*Please try again later\.?$/i, '')} You can try again ${waitText(retryAfter)}.` : message
  }
  return message
}

export const errorStatus = (error: unknown) =>
  error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined

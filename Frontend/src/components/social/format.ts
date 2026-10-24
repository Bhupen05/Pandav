import { getErrorMessage } from '../../api/axios'
import type {
  ApprovalStatus,
  JobStatus,
  ModerationStatus,
  Person,
  PersonalTask,
  PersonalTaskStatus,
  Priority,
  Provider,
  PublishResult,
  Visibility,
} from './types'

// Readable labels for the values the API sends

export const roleLabel = (role?: string | null) =>
  ({ admin: 'Admin', team_leader: 'Team leader', team_member: 'Team member', user: 'User' } as Record<string, string>)[role ?? ''] ??
  ''

export const visibilityLabel: Record<Visibility, string> = {
  public: 'Public',
  team: 'Team only',
  connections: 'Connections only',
}

export const providerLabel: Record<Provider, string> = { linkedin: 'LinkedIn', github: 'GitHub' }

// `none` has no label: most posts never need approval
export const approvalLabel: Record<ApprovalStatus, string> = {
  none: '',
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
}

export const moderationLabel: Record<ModerationStatus, string> = {
  clean: 'No action',
  flagged: 'Flagged',
  hidden: 'Hidden',
  removed: 'Removed',
}

export const jobStatusLabel: Record<JobStatus, string> = {
  queued: 'Queued',
  processing: 'Publishing',
  completed: 'Published',
  failed: 'Failed',
}

export const taskStatusLabel: Record<PersonalTaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  completed: 'Done',
}

export const priorityLabel: Record<Priority, string> = {
  low: 'Low priority',
  medium: 'Medium priority',
  high: 'High priority',
}

export const autoPostLabel: Record<NonNullable<PersonalTask['autoPostStatus']>, string> = {
  none: '',
  pending_approval: 'Shared post awaiting approval',
  approved: 'Shared post approved',
  rejected: 'Shared post rejected',
  published: 'Shared',
  failed: 'Sharing failed',
  already_generated: 'Already shared',
}

export const publishResultLabel = (result?: PublishResult) =>
  result?.status === 'published' ? 'Published' : result?.status === 'failed' ? 'Failed' : 'Not published yet'

// Badge colours, one family per meaning
export const tone = {
  neutral: 'bg-slate-100 text-slate-600',
  info: 'bg-sky-100 text-sky-700',
  warning: 'bg-amber-100 text-amber-800',
  success: 'bg-emerald-100 text-emerald-700',
  danger: 'bg-rose-100 text-rose-700',
  dark: 'bg-slate-800 text-white',
} as const

export const approvalTone: Record<ApprovalStatus, string> = {
  none: tone.neutral,
  pending: tone.warning,
  approved: tone.success,
  rejected: tone.danger,
}

export const moderationTone: Record<ModerationStatus, string> = {
  clean: tone.neutral,
  flagged: tone.warning,
  hidden: tone.dark,
  removed: tone.danger,
}

export const jobTone: Record<JobStatus, string> = {
  queued: tone.info,
  processing: tone.warning,
  completed: tone.success,
  failed: tone.danger,
}

export const priorityTone: Record<Priority, string> = {
  low: tone.neutral,
  medium: tone.info,
  high: 'bg-orange-100 text-orange-700',
}

export const taskStatusTone: Record<PersonalTaskStatus, string> = {
  todo: tone.neutral,
  in_progress: tone.info,
  completed: tone.success,
}

// Dates: local time, no seconds
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export const formatDateTime = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date)
}

export const formatDate = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

// A to-do's due date is a day (stored as midnight UTC): show that day, in
// any timezone
export const dueDay = (value?: string | null) => (value ? value.slice(0, 10) : '')

export const formatDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  return dateFormat.format(new Date(year, month - 1, date))
}

export const todayKey = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export const initials = (name?: string | null) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

export const personOf = (value: Person | string | null | undefined): Person | null =>
  value && typeof value === 'object' ? value : null

export const idOf = (value: { _id: string } | string | null | undefined) =>
  typeof value === 'string' ? value : value?._id ?? ''

// The server's message, or the fallback. A 429 says when to try again.
export const errorText = (error: unknown, fallback: string) => {
  const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: number }).status : undefined
  const message = getErrorMessage(error, fallback)
  if (status === 429 && !/try again/i.test(message)) {
    return 'Too many requests. Wait a minute and try again.'
  }
  return message
}

export const errorStatus = (error: unknown) =>
  error && typeof error === 'object' && 'status' in error ? (error as { status?: number }).status : undefined

// Where a published copy lives, when the provider gave a link
export const externalLink = (provider: Provider, externalId?: string | null) => {
  if (!externalId) return null
  if (/^https:\/\//.test(externalId)) return externalId
  if (provider === 'linkedin' && externalId.startsWith('urn:li:')) {
    return `https://www.linkedin.com/feed/update/${externalId}/`
  }
  return null
}

export const excerpt = (text: string | null | undefined, length = 80) => {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

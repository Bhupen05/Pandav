import type { ProgressStatus } from '../../utils/taskProgress'
import type { HistoryEntry, PersonRef, Recurrence, TaskPriority, TaskStatus } from './types'

// One label and one colour per value (UI_REDESIGN.md 6.1)

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  'in-progress': 'In progress',
  'completion-requested': 'Awaiting review',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const STATUS_BADGE: Record<TaskStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  'in-progress': 'bg-blue-100 text-blue-800',
  'completion-requested': 'bg-purple-100 text-purple-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-neutral-200 text-neutral-700',
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

export const PRIORITY_BADGE: Record<TaskPriority, string> = {
  low: 'bg-neutral-100 text-neutral-700',
  medium: 'bg-blue-100 text-blue-800',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-red-100 text-red-800',
}

export const PROGRESS_LABEL: Record<ProgressStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'Working on it',
  'completion-requested': 'Done, waiting for review',
  completed: 'Completed',
}

export const PROGRESS_BADGE: Record<ProgressStatus, string> = {
  'not-started': 'bg-neutral-100 text-neutral-700',
  'in-progress': 'bg-blue-50 text-blue-700',
  'completion-requested': 'bg-purple-50 text-purple-700',
  completed: 'bg-emerald-50 text-emerald-700',
}

export const statusLabel = (status: string) => STATUS_LABEL[status as TaskStatus] ?? status
export const priorityLabel = (priority?: string) => PRIORITY_LABEL[(priority || 'medium') as TaskPriority] ?? priority ?? ''

export const personName = (ref: string | PersonRef | null | undefined, fallback = 'Someone') =>
  ref && typeof ref === 'object' && ref.name ? ref.name : fallback

export const personId = (ref: string | PersonRef | null | undefined) =>
  ref ? (typeof ref === 'string' ? ref : ref._id) : undefined

// A calendar day (YYYY-MM-DD) as the browser writes dates, without shifting
// it into a time zone: a task due on the 20th is due on the 20th everywhere
export const formatDay = (day?: string | null, style: 'medium' | 'short' = 'medium') => {
  if (!day) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString(undefined, style === 'short' ? { day: 'numeric', month: 'short' } : { dateStyle: 'medium' })
}

// A moment in local time, without seconds
export const formatDateTime = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// The due day of a task: the server's dueDay, or the date part of dueDate
// (stored as midnight UTC of the due day)
export const dueDayOf = (task: { dueDay?: string; dueDate?: string }) => task.dueDay || task.dueDate?.slice(0, 10) || ''

export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`
}

const UNIT: Record<Recurrence['frequency'], [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
}

// "Every 2 weeks, until 30 Nov 2026"
export const repeatLabel = (recurrence: Pick<Recurrence, 'frequency' | 'interval' | 'until'>) => {
  const [one, many] = UNIT[recurrence.frequency] ?? ['period', 'periods']
  const every = recurrence.interval > 1 ? `Every ${recurrence.interval} ${many}` : `Every ${one}`
  return recurrence.until ? `${every}, until ${formatDay(recurrence.until)}` : every
}

export const repeatUnit = (frequency: Recurrence['frequency'], interval: number) => {
  const [one, many] = UNIT[frequency] ?? ['period', 'periods']
  return interval === 1 ? one : many
}

const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  startDate: 'start date',
  dueDate: 'due date',
  estimatedDays: 'estimate',
  tags: 'tags',
  notes: 'notes',
  recurrence: 'repeat settings',
}

const listOf = (words: string[]) =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`

const names = (users?: PersonRef[]) => listOf((users || []).map((user) => user.name || 'someone'))

// One line of a task's activity history, without who did it
export const historyText = (entry: HistoryEntry): string => {
  const details = entry.details || {}
  switch (entry.action) {
    case 'created':
      return details.repeatOf ? 'created this task as the next one of a repeating series' : 'created the task'
    case 'edited':
      return details.fields?.length
        ? `changed the ${listOf(details.fields.map((field) => FIELD_LABEL[field] || field))}`
        : 'edited the task'
    case 'assigned':
      return `added ${names(details.users)}`
    case 'unassigned':
      return `took ${names(details.users)} off the task`
    case 'checklist_updated':
      if (typeof details.item === 'string') {
        return `${details.done ? 'ticked' : 'unticked'} "${details.item}"`
      }
      return typeof details.items === 'number'
        ? `set the checklist (${details.items} item${details.items === 1 ? '' : 's'})`
        : 'changed the checklist'
    case 'status_changed':
      return `changed the status from ${statusLabel(details.from || '')} to ${statusLabel(details.to || '')}`
    case 'started':
      return 'started their part'
    case 'part_done':
      return details.note ? `marked their part done: "${details.note}"` : 'marked their part done'
    case 'completion_requested':
      return 'sent the task for review'
    case 'approved':
      return 'approved the task'
    case 'rejected':
      return details.reason ? `sent the task back: "${details.reason}"` : 'sent the task back'
    case 'cancelled':
      return details.reason ? `cancelled the task: "${details.reason}"` : 'cancelled the task'
    case 'reopened':
      return `reopened the task as ${statusLabel(details.status || 'pending')}`
    case 'comment_added':
      return 'commented'
    case 'attachment_added':
      return `attached ${details.name ? `"${details.name}"` : 'a file'}`
    case 'attachment_removed':
      return `removed ${details.name ? `"${details.name}"` : 'a file'}`
    case 'recurrence_stopped':
      return details.reason ? `stopped repeating: ${details.reason}` : 'stopped repeating'
    default:
      return entry.action.replace(/_/g, ' ')
  }
}

// Who did it: a person, or Pandav itself for the background jobs
export const historyActor = (entry: HistoryEntry) => (entry.by ? personName(entry.by) : 'Pandav')

// Initials for an avatar, at most two letters
export const initials = (name?: string) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?'

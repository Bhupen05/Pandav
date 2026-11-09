// Readable words and badge colours for the values the API returns (UI_REDESIGN §6)

const sentence = (value: string) => {
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ''
}

const pick = (map: Record<string, string>, value: string | null | undefined, fallback = '') =>
  value ? map[value] ?? sentence(value) : fallback

export const ROLE_LABELS: Record<string, string> = {
  user: 'User',
  team_member: 'Team member',
  team_leader: 'Team leader',
  admin: 'Admin',
}
export const roleLabel = (role?: string | null) => pick(ROLE_LABELS, role, 'User')

export const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  'in-progress': 'In progress',
  'completion-requested': 'Awaiting review',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
export const taskStatusLabel = (status?: string | null) => pick(TASK_STATUS_LABELS, status)

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}
// A task without a priority has the default, medium
export const priorityLabel = (priority?: string | null) => pick(PRIORITY_LABELS, priority || 'medium')

export const DAY_TYPE_LABELS: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  'half-day': 'Half day',
  leave: 'Leave',
}
export const dayTypeLabel = (status?: string | null) => pick(DAY_TYPE_LABELS, status)

export const APPROVAL_LABELS: Record<string, string> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  mixed: 'Partly approved',
}
export const approvalLabel = (status?: string | null) => pick(APPROVAL_LABELS, status)

export const CONTACT_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  'in-progress': 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}
export const contactStatusLabel = (status?: string | null) => pick(CONTACT_STATUS_LABELS, status)

export const MODERATION_LABELS: Record<string, string> = {
  clean: 'Visible',
  flagged: 'Flagged',
  hidden: 'Hidden',
  removed: 'Removed',
}

// Audit actions are `<area>_<verb>`, for example `admin_user_deactivated`
const ACTION_WORDS: Record<string, string> = {
  '2fa': 'two-step sign-in',
  admin: 'Admin',
}
export const auditActionLabel = (action: string) => {
  const words = action.split('_').map((word) => ACTION_WORDS[word] ?? word)
  return sentence(words.join(' '))
}

export const JOB_LABELS: Record<string, { title: string; description: string }> = {
  'social-publish': {
    title: 'Social Hub publishing',
    description: 'Puts stuck publish jobs back in the queue and publishes queued posts that are due.',
  },
  'task-reminders': {
    title: 'Task reminders',
    description: 'Tells people about open tasks that are due soon or overdue.',
  },
  'task-recurrence': {
    title: 'Repeating tasks',
    description: 'Creates the next occurrence of repeating tasks.',
  },
  'attendance-missed-checkout': {
    title: 'Missed check-outs',
    description: 'Marks days left without a check-out and tells their owner.',
  },
  'attendance-auto-absent': {
    title: 'Automatic absences',
    description: 'When turned on in the attendance settings, records absences for the previous workday.',
  },
}
export const jobLabel = (name: string) => JOB_LABELS[name] ?? { title: sentence(name), description: '' }

// Badge colours. Day types and approvals use separate colour families.
export type Tone = 'neutral' | 'amber' | 'blue' | 'purple' | 'emerald' | 'red' | 'orange' | 'sky' | 'indigo' | 'rose' | 'violet'

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  purple: 'bg-purple-100 text-purple-800',
  emerald: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  orange: 'bg-orange-100 text-orange-800',
  sky: 'bg-sky-100 text-sky-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  rose: 'bg-rose-100 text-rose-800',
  violet: 'bg-violet-100 text-violet-800',
}

export const taskStatusTone = (status?: string): Tone =>
  ({ pending: 'amber', 'in-progress': 'blue', 'completion-requested': 'purple', completed: 'emerald', cancelled: 'neutral' } as Record<string, Tone>)[status ?? ''] ?? 'neutral'

export const priorityTone = (priority?: string): Tone =>
  ({ low: 'neutral', medium: 'blue', high: 'orange', urgent: 'red' } as Record<string, Tone>)[priority || 'medium'] ?? 'blue'

export const dayTypeTone = (status?: string): Tone =>
  ({ present: 'sky', late: 'orange', 'half-day': 'indigo', absent: 'rose', leave: 'violet' } as Record<string, Tone>)[status ?? ''] ?? 'neutral'

export const approvalTone = (status?: string): Tone =>
  ({ pending: 'amber', approved: 'emerald', rejected: 'red', mixed: 'neutral' } as Record<string, Tone>)[status ?? ''] ?? 'neutral'

export const contactStatusTone = (status?: string): Tone =>
  ({ new: 'purple', 'in-progress': 'blue', resolved: 'emerald', closed: 'neutral' } as Record<string, Tone>)[status ?? ''] ?? 'neutral'

export const roleTone = (role?: string): Tone =>
  ({ admin: 'purple', team_leader: 'indigo', team_member: 'sky', user: 'blue' } as Record<string, Tone>)[role ?? ''] ?? 'blue'

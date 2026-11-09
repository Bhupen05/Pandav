// Each assignee tracks their own part of a task (matches the backend Task model)
export type ProgressStatus = 'not-started' | 'in-progress' | 'completion-requested' | 'completed'

export type AssigneeProgress = {
  // { _id, name } from the API; a plain id in older responses
  user: string | { _id: string; name?: string }
  status: ProgressStatus
  completionRequestedAt?: string
  // The note the assignee left for the reviewer when marking their part done
  notes?: string
  _id?: string
}

type TaskWithProgress = {
  status: string
  assigneeProgress?: AssigneeProgress[]
  assignedTo?: Array<string | { _id: string }>
}

const refId = (ref: string | { _id: string }) => (typeof ref === 'string' ? ref : ref._id)

// Whether the user is one of the people the task is assigned to
export const isAssignee = (task: TaskWithProgress, userId?: string) => {
  if (!userId) return false
  if (task.assignedTo) return task.assignedTo.some((assignee) => refId(assignee) === userId)
  return Boolean(task.assigneeProgress?.some((entry) => refId(entry.user) === userId))
}

// The given user's progress on a task. Tasks from before progress was tracked
// per assignee fall back to the task's own status.
export const progressOf = (task: TaskWithProgress, userId?: string): ProgressStatus => {
  const entry = task.assigneeProgress?.find((p) => refId(p.user) === userId)
  if (entry) return entry.status

  switch (task.status) {
    case 'in-progress':
      return 'in-progress'
    case 'completion-requested':
      return 'completion-requested'
    case 'completed':
      return 'completed'
    default:
      return 'not-started'
  }
}

// What the user can do on their own part of the task right now. Only the
// people on a task have a part: a leader looking at a teammate's task doesn't.
export const canStart = (task: TaskWithProgress, userId?: string) =>
  isAssignee(task, userId) &&
  ['pending', 'in-progress'].includes(task.status) &&
  progressOf(task, userId) === 'not-started'

export const canRequestCompletion = (task: TaskWithProgress, userId?: string) =>
  isAssignee(task, userId) &&
  ['pending', 'in-progress'].includes(task.status) &&
  ['not-started', 'in-progress'].includes(progressOf(task, userId))

// Finished their part, but teammates haven't yet
export const isWaitingForTeammates = (task: TaskWithProgress, userId?: string) =>
  isAssignee(task, userId) && task.status === 'in-progress' && progressOf(task, userId) === 'completion-requested'

type EditedTask = {
  editedAt?: string
  editedBy?: string | { _id?: string; name?: string }
}

// "Edited by Pat · 18 Oct 2026, 15:42" for a task an admin or team leader
// changed after creating it, or null if nobody has
export const editedLabel = (task: EditedTask): string | null => {
  if (!task.editedAt) return null
  const who = typeof task.editedBy === 'object' && task.editedBy?.name ? task.editedBy.name : 'someone'
  const when = new Date(task.editedAt)
  const time = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return `Edited by ${who}${time ? ` · ${time}` : ''}`
}

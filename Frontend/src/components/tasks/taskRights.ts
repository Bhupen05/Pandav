import { personId } from './taskFormat'
import { OPEN_STATUSES, type Task } from './types'

// What the signed-in person may do with a task. The server decides in the end
// (and its message is shown when it refuses); these rules only decide which
// buttons are worth showing, and follow Backend/Doc/Tasks.md "Who may do what".

export type TeamInfo = { _id: string; name: string; isActive: boolean; memberIds: string[] }

export type Viewer = {
  id: string
  isAdmin: boolean
  isLeader: boolean
  // The team a leader leads, with everyone in it
  ledTeam: TeamInfo | null
  // Team names by id, to name a task's team
  teamNames: Record<string, string>
}

const assigneeIds = (task: Task) => task.assignedTo.map((assignee) => personId(assignee) || '')

export const isOpenTask = (task: Pick<Task, 'status'>) => OPEN_STATUSES.includes(task.status)

// Someone on the task has asked for it to be reviewed (the last one to finish
// turns the task itself into "Awaiting review")
export const hasReviewRequest = (task: Task) =>
  task.status === 'completion-requested' ||
  (isOpenTask(task) &&
    ((task.doneCount ?? 0) > 0 || Boolean(task.assigneeProgress?.some((entry) => entry.status === 'completion-requested'))))

// Edit, delete, cancel and reopen: admins; a leader of the task's team while it
// isn't frozen, when they aren't on the task and everyone on it is in the team
export const canManageTask = (task: Task, viewer: Viewer) => {
  if (viewer.isAdmin) return true
  const team = viewer.ledTeam
  if (!viewer.isLeader || !team?.isActive) return false
  const ids = assigneeIds(task)
  if (ids.includes(viewer.id)) return false
  if (task.team) {
    if (String(task.team) !== team._id) return false
  } else if (personId(task.createdBy) !== viewer.id || ids.length === 0) {
    return false
  }
  return ids.every((id) => team.memberIds.includes(id))
}

// Approve and reject: admins; a leader who isn't on the task, when everyone on
// it is in their team and the team isn't frozen
export const canReviewTask = (task: Task, viewer: Viewer) => {
  if (!hasReviewRequest(task) || !isOpenTask(task)) return false
  if (viewer.isAdmin) return true
  const team = viewer.ledTeam
  if (!viewer.isLeader || !team?.isActive) return false
  const ids = assigneeIds(task)
  return ids.length > 0 && !ids.includes(viewer.id) && ids.every((id) => team.memberIds.includes(id))
}

// Tick checklist items: the people on the task, and its managers
export const canTickChecklist = (task: Task, viewer: Viewer) =>
  isOpenTask(task) && (assigneeIds(task).includes(viewer.id) || canManageTask(task, viewer))

// Attach files: the people on the task, its managers and admins; not to a cancelled task
export const canAttachFiles = (task: Task, viewer: Viewer) =>
  task.status !== 'cancelled' && (viewer.isAdmin || assigneeIds(task).includes(viewer.id) || canManageTask(task, viewer))

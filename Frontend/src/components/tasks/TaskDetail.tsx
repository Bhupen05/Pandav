import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { taskAPI } from '../../api/taskAPI'
import { getErrorMessage } from '../../api/axios'
import { canRequestCompletion, canStart, editedLabel, isAssignee, isWaitingForTeammates, type AssigneeProgress } from '../../utils/taskProgress'
import {
  PROGRESS_BADGE,
  PROGRESS_LABEL,
  dueDayOf,
  formatDate,
  formatDateTime,
  formatDay,
  personId,
  personName,
  repeatLabel,
} from './taskFormat'
import { canAttachFiles, canChangeDiscussion, canManageTask, canReviewTask, canTickChecklist, isFrozenFor, isOpenTask, type Viewer } from './taskRights'
import type { Task } from './types'
import { InlineError, PriorityBadge, Spinner, StatusBadge } from './ui'
import { useTaskActions } from './useTaskActions'
import TaskChecklist from './TaskChecklist'
import TaskComments from './TaskComments'
import TaskFiles from './TaskFiles'
import TaskHistory from './TaskHistory'

type Props = {
  taskId: string
  viewer: Viewer
  // Goes up when the list saved a change to this task (an edit), so it reloads
  refreshKey: number
  onClose: () => void
  onEdit: (task: Task) => void
  // After something changed: the list reloads its rows and counts
  onChanged: (task?: Task) => void
  onDeleted: (id: string) => void
}

type Notice = { tone: 'success' | 'error'; text: string }

const BUTTON = 'rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-0.5 wrap-break-word text-sm text-neutral-900">{children}</dd>
    </div>
  )
}

// The whole task in a panel over the list: every field, who has done what,
// the checklist, files, comments and history, and the actions this person may take
export default function TaskDetail({ taskId, viewer, refreshKey, onClose, onEdit, onChanged, onDeleted }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const requestId = useRef(0)
  const loaded = useRef(false)

  // showModal keeps focus inside the panel and closes it on Escape; closing it
  // on the way out hands focus back to whatever opened it
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  const load = useCallback(
    async (silent = false) => {
      const quiet = silent && loaded.current
      const id = ++requestId.current
      if (!quiet) {
        setLoading(true)
        setError('')
      }
      try {
        const response = await taskAPI.getTask(taskId)
        if (id !== requestId.current) return
        loaded.current = true
        setTask(response.data)
        setError('')
      } catch (failure) {
        if (id === requestId.current && !quiet) setError(getErrorMessage(failure, "Couldn't open this task."))
      } finally {
        if (id === requestId.current && !quiet) setLoading(false)
      }
    },
    [taskId],
  )

  useEffect(() => {
    load(refreshKey > 0)
  }, [load, refreshKey])

  const report = useCallback((text: string, tone: 'success' | 'error') => setNotice({ tone, text }), [])

  const actions = useTaskActions({
    report,
    onChanged: (updated) => {
      if (updated) setTask(updated)
      onChanged(updated)
    },
    onDeleted,
  })

  // Something happened in the comments or files: the history has a new line
  const refreshQuietly = useCallback(() => {
    load(true)
    onChanged()
  }, [load, onChanged])

  const manager = task ? canManageTask(task, viewer) : false
  const reviewer = task ? canReviewTask(task, viewer) : false
  const open = task ? isOpenTask(task) : false
  const busy = actions.busyId !== null
  const showStart = task ? canStart(task, viewer.id) : false
  const showRequest = task ? canRequestCompletion(task, viewer.id) : false
  const onIt = task ? isAssignee(task, viewer.id) : false
  // A frozen team's task is closed to everyone but admins, apart from the assignees' own work
  const frozen = task ? isFrozenFor(task, viewer) : false
  const discussionOpen = task ? canChangeDiscussion(task, viewer) : true
  const teamName = task?.team ? viewer.teamNames[String(task.team)] || 'A team task' : 'No team'

  const progress: AssigneeProgress[] | undefined = task?.assigneeProgress

  return (
    <>
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-2xl overflow-hidden rounded-none bg-white p-0 shadow-2xl backdrop:bg-black/40 open:flex open:flex-col sm:rounded-l-2xl"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-200 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={titleId} className="wrap-break-word text-lg font-semibold text-neutral-900">{task ? task.title : 'Task details'}</h2>
          {task && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
              {task.isOverdue && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                  <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                  Overdue
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close task details"
          className="shrink-0 rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
        {notice && (
          <div
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
              notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            <p className="min-w-0 flex-1 wrap-break-word">{notice.text}</p>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message" className="rounded px-1 text-lg leading-none opacity-60 hover:opacity-100">
              ×
            </button>
          </div>
        )}

        {loading && !task ? (
          <Spinner label="Loading task…" />
        ) : error && !task ? (
          <InlineError title="This task didn't open" message={error} onRetry={() => load()} />
        ) : task ? (
          <>
            {frozen && (
              <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                This team is frozen. Only an admin can change it.
              </div>
            )}
            {task.rejectionReason && (
              <div role="note" className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-900">Sent back for more work</p>
                <p className="mt-1 wrap-break-word text-sm text-red-800">Reason: {task.rejectionReason}</p>
                {(task.rejectedBy || task.rejectedAt) && (
                  <p className="mt-1 text-xs text-red-700">
                    {task.rejectedBy ? `By ${personName(task.rejectedBy)}` : ''}
                    {task.rejectedAt ? ` on ${formatDateTime(task.rejectedAt)}` : ''}
                  </p>
                )}
              </div>
            )}
            {task.status === 'cancelled' && (
              <div role="note" className="rounded-xl border border-neutral-300 bg-neutral-100 p-4">
                <p className="text-sm font-semibold text-neutral-800">This task was cancelled</p>
                {task.cancelReason && <p className="mt-1 wrap-break-word text-sm text-neutral-700">Reason: {task.cancelReason}</p>}
                {(task.cancelledBy || task.cancelledAt) && (
                  <p className="mt-1 text-xs text-neutral-600">
                    {task.cancelledBy ? `By ${personName(task.cancelledBy)}` : ''}
                    {task.cancelledAt ? ` on ${formatDateTime(task.cancelledAt)}` : ''}
                  </p>
                )}
              </div>
            )}
            {task.status === 'completed' && (
              <div role="note" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Completed
                  {task.approvedBy ? ` and approved by ${personName(task.approvedBy)}` : ''}
                  {task.approvedAt || task.completedDate ? ` on ${formatDateTime(task.approvedAt || task.completedDate)}` : ''}.
                </p>
              </div>
            )}

            {/* What this person can do */}
            <div className="flex flex-wrap items-center gap-2" aria-label="Actions">
              {showStart && (
                <button type="button" onClick={() => actions.start(task)} disabled={busy} className={`${BUTTON} bg-blue-600 text-white hover:bg-blue-700`}>
                  Start
                </button>
              )}
              {showRequest && (
                <button
                  type="button"
                  onClick={() => actions.requestCompletion(task)}
                  disabled={busy}
                  className={`${BUTTON} text-white ${task.rejectionReason ? 'bg-orange-600 hover:bg-orange-700' : 'bg-purple-600 hover:bg-purple-700'}`}
                >
                  {task.rejectionReason ? 'Request again' : 'Request completion'}
                </button>
              )}
              {reviewer && (
                <>
                  <button type="button" onClick={() => actions.approve(task)} disabled={busy} className={`${BUTTON} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    Approve
                  </button>
                  <button type="button" onClick={() => actions.reject(task)} disabled={busy} className={`${BUTTON} border border-red-500 text-red-600 hover:bg-red-50`}>
                    Reject
                  </button>
                </>
              )}
              {manager && (
                <>
                  <button type="button" onClick={() => onEdit(task)} disabled={busy} className={`${BUTTON} border border-neutral-300 text-neutral-700 hover:bg-neutral-50`}>
                    Edit
                  </button>
                  {open ? (
                    <button type="button" onClick={() => actions.cancel(task)} disabled={busy} className={`${BUTTON} border border-neutral-300 text-neutral-700 hover:bg-neutral-50`}>
                      Cancel task
                    </button>
                  ) : (
                    <button type="button" onClick={() => actions.reopen(task)} disabled={busy} className={`${BUTTON} border border-neutral-300 text-neutral-700 hover:bg-neutral-50`}>
                      Reopen
                    </button>
                  )}
                  <button type="button" onClick={() => actions.remove(task)} disabled={busy} className={`${BUTTON} border border-red-300 text-red-600 hover:bg-red-50`}>
                    Delete
                  </button>
                </>
              )}
              {isWaitingForTeammates(task, viewer.id) && (
                <span className="text-sm font-medium text-purple-700">Your part is done. Waiting for the others.</span>
              )}
              {task.status === 'completion-requested' && !reviewer && (
                <span className="text-sm font-medium text-purple-700">Waiting for review</span>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Detail label="Due">
                {formatDay(dueDayOf(task)) || 'Not set'}
              </Detail>
              <Detail label="Starts">{formatDay(task.startDate) || 'Not set'}</Detail>
              <Detail label="Estimated">
                {task.estimatedDays ? `${task.estimatedDays} day${task.estimatedDays === 1 ? '' : 's'}` : 'Not set'}
              </Detail>
              <Detail label="Team">{teamName}</Detail>
              <Detail label="Created by">
                {personName(task.createdBy, 'Unknown')}
                {task.createdAt ? <span className="block text-xs text-neutral-500">{formatDateTime(task.createdAt)}</span> : null}
              </Detail>
              {editedLabel(task) && <Detail label="Last edited">{editedLabel(task)?.replace(/^Edited by /, '')}</Detail>}
            </dl>

            <section aria-labelledby="task-description-heading">
              <h3 id="task-description-heading" className="mb-1.5 text-sm font-semibold text-neutral-900">Description</h3>
              <p className="whitespace-pre-wrap wrap-break-word text-sm text-neutral-800">{task.description || 'No description.'}</p>
            </section>

            {task.notes && (
              <section aria-labelledby="task-notes-heading">
                <h3 id="task-notes-heading" className="mb-1.5 text-sm font-semibold text-neutral-900">Notes</h3>
                <p className="whitespace-pre-wrap wrap-break-word text-sm text-neutral-800">{task.notes}</p>
              </section>
            )}

            {task.tags && task.tags.length > 0 && (
              <section aria-labelledby="task-tags-heading">
                <h3 id="task-tags-heading" className="mb-1.5 text-sm font-semibold text-neutral-900">Tags</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {task.tags.map((tag) => (
                    <li key={tag} className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">#{tag}</li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="task-people-heading">
              <h3 id="task-people-heading" className="mb-2 text-sm font-semibold text-neutral-900">
                People{' '}
                {task.assigneeCount !== undefined && (
                  <span className="font-normal text-neutral-500">
                    ({task.doneCount ?? 0} of {task.assigneeCount} done)
                  </span>
                )}
              </h3>
              <ul className="space-y-2">
                {(progress && progress.length > 0
                  ? progress.map((entry) => ({ key: personId(entry.user) || '', name: personName(entry.user), entry }))
                  : task.assignedTo.map((assignee) => ({ key: personId(assignee) || '', name: personName(assignee), entry: undefined }))
                ).map(({ key, name, entry }) => (
                  <li key={key} className="rounded-xl border border-neutral-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-neutral-900">
                        {name}
                        {key === viewer.id && <span className="ml-1.5 text-xs font-normal text-neutral-500">(you)</span>}
                      </p>
                      {entry && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PROGRESS_BADGE[entry.status]}`}>{PROGRESS_LABEL[entry.status]}</span>
                      )}
                    </div>
                    {entry?.notes && <p className="mt-1.5 whitespace-pre-wrap wrap-break-word text-sm text-neutral-700">“{entry.notes}”</p>}
                    {entry?.completionRequestedAt && (
                      <p className="mt-1 text-xs text-neutral-500">Marked done {formatDateTime(entry.completionRequestedAt)}</p>
                    )}
                  </li>
                ))}
              </ul>
              {!onIt && task.assignedTo.length === 0 && <p className="text-sm text-neutral-500">Nobody is on this task.</p>}
            </section>

            {task.checklist && task.checklist.length > 0 && (
              <TaskChecklist
                task={task}
                canTick={canTickChecklist(task, viewer)}
                onTask={(updated) => {
                  setTask(updated)
                  onChanged(updated)
                }}
                report={report}
              />
            )}

            {task.recurrence && (
              <section aria-labelledby="task-repeat-heading">
                <h3 id="task-repeat-heading" className="mb-1.5 text-sm font-semibold text-neutral-900">Repeats</h3>
                <p className="text-sm text-neutral-800">{repeatLabel(task.recurrence)}</p>
                {task.recurrence.nextOccurrenceAt && (
                  <p className="mt-0.5 text-xs text-neutral-500">Next one is created on {formatDate(task.recurrence.nextOccurrenceAt)}.</p>
                )}
              </section>
            )}

            <TaskFiles
              taskId={task._id}
              viewerId={viewer.id}
              canAttach={canAttachFiles(task, viewer)}
              canRemove={discussionOpen}
              canModerate={manager || viewer.isAdmin}
              report={report}
              onActivity={refreshQuietly}
            />

            <TaskComments
              taskId={task._id}
              viewerId={viewer.id}
              canWrite={discussionOpen}
              canModerate={manager || viewer.isAdmin}
              report={report}
              onActivity={refreshQuietly}
            />

            <TaskHistory history={task.history || []} />
          </>
        ) : null}
      </div>

    </dialog>
    {actions.dialogs}
    </>
  )
}

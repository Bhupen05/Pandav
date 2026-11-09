import { useCallback, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { teamAPI } from '../../api/teamAPI'
import { useFeedback } from '../../context/useFeedback'
import { PriorityBadge, TaskStatusBadge } from './badges'
import { formatDateTime, formatDay, TASK_STATUS_LABELS, teamErrorMessage } from './format'
import { useBusy, useDebounced, useLoader } from './hooks'
import type { TeamReviews } from './reviews'
import TaskFormDialog from './TaskFormDialog'
import { assigneeNames, isAssignedTo, teamPeople, type ListResponse, type Team, type TeamTask } from './types'
import { EmptyBlock, ErrorBlock, inputClass, LoadingBlock, Pager, primaryButton } from './ui'

const PAGE_SIZE = 20

type Props = {
  team: Team
  meId?: string
  // A leader of a team that isn't frozen: tasks can be created, changed and reviewed
  canAct: boolean
  frozen: boolean
  // Bumped when something elsewhere changed, to load again
  version: number
  // Tasks the signed-in leader can review right now
  reviewableIds: Set<string>
  reviews: TeamReviews
  onChanged: () => void
}

export default function TeamTasksPanel({ team, meId, canAct, frozen, version, reviewableIds, reviews, onChanged }: Props) {
  const { notify, confirm } = useFeedback()
  const { run, isBusy } = useBusy()
  const searchId = useId()
  const statusId = useId()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [form, setForm] = useState<{ task?: TeamTask } | null>(null)
  const query = useDebounced(search).trim()

  const load = useCallback(
    () => teamAPI.getTeamTasks(team._id, { q: query, status, page, limit: PAGE_SIZE }) as Promise<ListResponse<TeamTask>>,
    [team._id, query, status, page],
  )
  const loader = useLoader(load, 'Could not load the team’s tasks.', version)
  const tasks = loader.data?.data ?? []
  const filtered = Boolean(query || status)

  const removeTask = async (task: TeamTask) => {
    const ok = await confirm({
      title: 'Delete this task?',
      message: `"${task.title}" is removed for everyone on it, with its comments and files.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    await run(`delete-${task._id}`, async () => {
      try {
        await teamAPI.deleteTask(task._id)
        notify('Task deleted.', 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not delete this task.'), 'error')
      }
      onChanged()
    })
  }

  return (
    <section aria-labelledby="team-tasks-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="team-tasks-heading" className="text-lg font-semibold text-gray-800">
          Team Tasks
        </h2>
        {canAct && (
          <button type="button" onClick={() => setForm({})} className={primaryButton}>
            + Create Task
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div>
          <label htmlFor={searchId} className="text-sm font-medium text-gray-700">
            Search tasks
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Title, description or tag"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={statusId} className="text-sm font-medium text-gray-700">
            Status
          </label>
          <select
            id={statusId}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
            }}
            className={inputClass}
          >
            <option value="">All statuses</option>
            {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {frozen && (
        <p className="mb-4 text-sm text-gray-600">
          Tasks can’t be created, changed or reviewed while the team is frozen. Reviews wait for an admin.
        </p>
      )}

      {loader.error ? (
        <ErrorBlock message={loader.error} onRetry={loader.reload} retrying={loader.loading} />
      ) : loader.loading && !loader.data ? (
        <LoadingBlock label="Loading tasks…" />
      ) : tasks.length === 0 ? (
        <EmptyBlock>
          {filtered
            ? 'No tasks match this search.'
            : canAct
              ? 'No team tasks yet. Create the first one!'
              : 'No team tasks yet.'}
        </EmptyBlock>
      ) : (
        <>
          <div
            className={`overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm ${loader.loading ? 'opacity-60' : ''}`}
            aria-busy={loader.loading}
          >
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Assigned To</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Priority</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Due</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tasks.map((task) => {
                  const mine = isAssignedTo(task, meId)
                  const canManage = canAct && !mine
                  const canReview = canAct && !mine && reviewableIds.has(task._id)
                  const busy = reviews.isTaskBusy(task) || isBusy(`delete-${task._id}`)
                  return (
                    <tr key={task._id} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link to={`/tasks?task=${task._id}`} className="font-medium text-blue-700 hover:underline">
                          {task.title}
                        </Link>
                        {task.editedAt && (
                          <p className="mt-0.5 text-xs text-gray-500">
                            Edited by {task.editedBy?.name ?? 'someone'} · {formatDateTime(task.editedAt)}
                          </p>
                        )}
                        {task.rejectionReason && task.status !== 'completed' && (
                          <p className="mt-0.5 text-xs text-red-700">
                            Sent back{task.rejectedBy ? ` by ${task.rejectedBy.name}` : ''}: “{task.rejectionReason}”
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {assigneeNames(task).join(', ') || '—'}
                        {(task.assigneeCount ?? 0) > 1 && (
                          <p className="mt-0.5 text-xs text-gray-500">
                            {task.doneCount ?? 0} of {task.assigneeCount} done
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3"><PriorityBadge priority={task.priority} /></td>
                      <td className="px-4 py-3"><TaskStatusBadge status={task.status} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                        {formatDay(task.dueDay ?? task.dueDate)}
                        {task.isOverdue && <p className="mt-0.5 text-xs font-medium text-red-700">Overdue</p>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => setForm({ task })}
                                disabled={busy}
                                aria-label={`Edit ${task.title}`}
                                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeTask(task)}
                                disabled={busy}
                                aria-label={`Delete ${task.title}`}
                                className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {canReview && (
                            <>
                              <button
                                type="button"
                                onClick={() => void reviews.approveTask(task)}
                                disabled={busy}
                                aria-label={`Approve ${task.title}`}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void reviews.rejectTask(task)}
                                disabled={busy}
                                aria-label={`Reject ${task.title}`}
                                className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {!canManage && !canReview && <span className="text-xs text-gray-400">—</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager
            page={loader.data?.pagination?.page ?? page}
            pages={loader.data?.pagination?.pages ?? 1}
            total={loader.data?.pagination?.total ?? tasks.length}
            onPage={setPage}
            label="tasks"
            disabled={loader.loading}
          />
        </>
      )}

      {form && (
        <TaskFormDialog
          teamId={team._id}
          people={teamPeople(team)}
          meId={meId}
          task={form.task}
          onClose={() => setForm(null)}
          onSaved={() => {
            notify(form.task ? 'Task saved.' : 'Task created.', 'success')
            setForm(null)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

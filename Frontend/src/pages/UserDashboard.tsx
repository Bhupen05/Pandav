import { useCallback, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ClipboardList, Globe, ListTodo, MessageCircle, ThumbsUp, Trophy } from 'lucide-react'
import { taskAPI, type FeedPost, type PersonalTodo } from '../api/taskAPI'
import { getErrorMessage } from '../api/axios'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'
import { canRequestCompletion, canStart, isWaitingForTeammates } from '../utils/taskProgress'
import ShareTaskDialog, { type ShareOffer } from '../components/ShareTaskDialog'
import { InlineError, PriorityBadge, StatusBadge } from '../components/tasks/ui'
import { STATUS_LABEL, dueDayOf, formatDay, initials } from '../components/tasks/taskFormat'
import { useSection } from '../components/tasks/useSection'
import { useTaskActions } from '../components/tasks/useTaskActions'
import { OPEN_STATUSES, TASK_STATUSES, type LeaderboardRow, type Task, type TaskStatus } from '../components/tasks/types'

type Period = 'month' | 'all'

// The stat cards, one per status, so they add up to the total
const STAT_STYLE: Record<TaskStatus, { box: string; number: string }> = {
  pending: { box: 'bg-amber-500', number: 'text-amber-700' },
  'in-progress': { box: 'bg-blue-500', number: 'text-blue-700' },
  'completion-requested': { box: 'bg-purple-500', number: 'text-purple-700' },
  completed: { box: 'bg-emerald-500', number: 'text-emerald-700' },
  cancelled: { box: 'bg-neutral-400', number: 'text-neutral-700' },
}

// Today and `offset` days on, as the browser's calendar day (YYYY-MM-DD)
const calendarDay = (offset = 0) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const greeting = () => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// A picture, or the initials when there is none or it doesn't load
function Avatar({ name, image, className = 'h-8 w-8 text-xs' }: { name?: string; image?: string | null; className?: string }) {
  // The address that failed, so a new picture is tried again
  const [failed, setFailed] = useState<string | null>(null)
  return image && image !== failed ? (
    <img src={image} alt="" onError={() => setFailed(image)} className={`${className} shrink-0 rounded-full object-cover`} />
  ) : (
    <div aria-hidden="true" className={`${className} flex shrink-0 items-center justify-center rounded-full bg-purple-100 font-bold text-purple-700`}>
      {initials(name)}
    </div>
  )
}

export default function UserDashboard() {
  const { notify } = useFeedback()
  const { user } = useAuth()
  const navigate = useNavigate()
  // Admins have their own dashboard
  const isAdminUser = user?.role === 'admin'
  const enabled = !isAdminUser && !!user?._id

  // A completed to-do's share draft, waiting for the owner to confirm it
  const [shareOffer, setShareOffer] = useState<ShareOffer | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('month')

  const loadSummary = useCallback(async () => (await taskAPI.getSummary()).data, [])
  const loadRecent = useCallback(async () => (await taskAPI.listTasks({ page: 1, limit: 5, sort: '-createdAt' })).data ?? [], [])
  const loadOverdue = useCallback(async () => (await taskAPI.listTasks({ page: 1, limit: 3, sort: 'dueDate', overdue: true })).data ?? [], [])
  const loadDueSoon = useCallback(async () => {
    const response = await taskAPI.listTasks({ page: 1, limit: 25, sort: 'dueDate', dueFrom: calendarDay(0), dueTo: calendarDay(3) })
    return (response.data ?? []).filter((task) => OPEN_STATUSES.includes(task.status) && !task.isOverdue)
  }, [])
  const loadBoard = useCallback(async () => ({ period, rows: (await taskAPI.getLeaderboard(period)).data ?? [] }), [period])
  const loadFeed = useCallback(async () => (await taskAPI.getFeed()).slice(0, 5), [])
  const loadTodos = useCallback(async () => taskAPI.getPersonalTodos(), [])

  const summary = useSection(loadSummary, enabled)
  const recent = useSection(loadRecent, enabled)
  const overdue = useSection(loadOverdue, enabled)
  const dueSoon = useSection(loadDueSoon, enabled)
  const board = useSection(loadBoard, enabled)
  const feed = useSection(loadFeed, enabled)
  const todos = useSection(loadTodos, enabled)

  // After an action on a task, everything that counts or lists tasks catches up
  const reloadTasks = useCallback(() => {
    summary.reload(true)
    recent.reload(true)
    overdue.reload(true)
    dueSoon.reload(true)
  }, [summary, recent, overdue, dueSoon])

  const actions = useTaskActions({ report: notify, onChanged: reloadTasks, onDeleted: reloadTasks })

  const toggleTodo = async (todo: PersonalTodo) => {
    if (togglingId) return
    setTogglingId(todo._id)
    try {
      const response = await taskAPI.togglePersonalTodo(todo._id)
      todos.reload(true)
      // With auto-share on, nothing is posted until the owner confirms the draft
      if (response.autoShare?.suggested && response.autoShare.draft) {
        setShareOffer({ taskId: todo._id, draft: response.autoShare.draft })
      }
    } catch (error) {
      notify(getErrorMessage(error, "Couldn't update the to-do."), 'error')
    } finally {
      setTogglingId(null)
    }
  }

  if (isAdminUser) return <Navigate to="/admin" replace />

  const counts = summary.data
  const open = counts ? (counts.byStatus.pending ?? 0) + (counts.byStatus['in-progress'] ?? 0) + (counts.byStatus['completion-requested'] ?? 0) : null
  const myTodos = todos.data ?? []
  const boardRows: LeaderboardRow[] = board.data?.period === period ? board.data.rows : []
  const boardLoading = board.loading || (board.data !== null && board.data.period !== period && !board.error)

  const dueText = (task: Task) => {
    const day = formatDay(dueDayOf(task))
    return day ? `Due ${day}` : ''
  }

  // The list of tasks behind an alert, each opening its details
  const alertList = (tasks: Task[] | null, total: number, tone: 'red' | 'amber') => {
    const text = tone === 'red' ? 'text-red-700' : 'text-amber-700'
    return (
      <ul className="mt-2 space-y-1">
        {(tasks ?? []).slice(0, 3).map((task) => (
          <li key={task._id} className={`text-sm ${text}`}>
            <Link to={`/tasks?task=${task._id}`} className="font-medium underline-offset-2 hover:underline">
              {task.title}
            </Link>{' '}
            <span className="whitespace-nowrap">({dueText(task)})</span>
          </li>
        ))}
        {total > 3 && (
          <li className={`text-sm ${text}`}>
            <Link to={tone === 'red' ? '/tasks?overdue=true' : '/tasks'} className="underline-offset-2 hover:underline">
              +{total - 3} more
            </Link>
          </li>
        )}
      </ul>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="space-y-6">
          {/* Welcome Header */}
          <div className="rounded-xl bg-linear-to-r from-emerald-600 to-teal-600 p-6 text-white">
            <h1 className="text-2xl font-bold">{greeting()}, {user?.name?.split(' ')[0] || 'User'}!</h1>
            <p className="mt-1 text-emerald-50">Here's what's happening with your tasks today.</p>

            <div className="mt-4 flex flex-wrap gap-4">
              <div className="rounded-lg bg-white/20 px-4 py-2">
                <span className="text-sm">Active Tasks</span>
                <span className="ml-2 text-lg font-bold">{open ?? '–'}</span>
              </div>
              <div className="rounded-lg bg-white/20 px-4 py-2">
                <span className="text-sm">Completion Rate</span>
                <span className="ml-2 text-lg font-bold">{counts ? `${counts.completionRate}%` : '–'}</span>
              </div>
              <Link to="/tasks" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
                View all tasks
              </Link>
            </div>
          </div>

          {/* Anyone outside a team can start one, or join one by invite */}
          {user?.role === 'user' && (
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-neutral-900">You're not in a team yet</p>
                <p className="text-sm text-neutral-600">Start your own team and invite people to it, or accept an invite you've received.</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/teams')}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Start or join a team
              </button>
            </div>
          )}

          {/* Stats: one card per status, so they add up to the total */}
          {summary.error && !counts ? (
            <InlineError title="Your task counts didn't load" message={summary.error} onRetry={() => summary.reload()} />
          ) : (
            <section aria-label="Task counts" className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <Link to="/tasks" className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                <p className="text-2xl font-bold text-neutral-900">{counts?.total ?? '–'}</p>
                <p className="text-xs text-neutral-600">Total tasks</p>
              </Link>
              {TASK_STATUSES.map((status) => (
                <Link
                  key={status}
                  to={`/tasks?status=${status}`}
                  className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${STAT_STYLE[status].box}`} />
                    <p className={`text-2xl font-bold ${STAT_STYLE[status].number}`}>{counts?.byStatus[status] ?? '–'}</p>
                  </div>
                  <p className="text-xs text-neutral-600">{STATUS_LABEL[status]}</p>
                </Link>
              ))}
            </section>
          )}

          {/* Alerts */}
          {counts && (counts.overdue > 0 || counts.dueSoon > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              {counts.overdue > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertTriangle aria-hidden="true" className="h-5 w-5" />
                    <h2 className="font-semibold">Overdue tasks ({counts.overdue})</h2>
                  </div>
                  {overdue.error && !overdue.data ? (
                    <p className="mt-2 text-sm text-red-700">
                      The list didn't load.{' '}
                      <button type="button" onClick={() => overdue.reload()} className="font-medium underline">Retry</button>
                    </p>
                  ) : (
                    alertList(overdue.data, counts.overdue, 'red')
                  )}
                </div>
              )}
              {counts.dueSoon > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-amber-700">
                    <CalendarClock aria-hidden="true" className="h-5 w-5" />
                    <h2 className="font-semibold">Due soon ({counts.dueSoon})</h2>
                  </div>
                  {dueSoon.error && !dueSoon.data ? (
                    <p className="mt-2 text-sm text-amber-800">
                      The list didn't load.{' '}
                      <button type="button" onClick={() => dueSoon.reload()} className="font-medium underline">Retry</button>
                    </p>
                  ) : (
                    alertList(dueSoon.data, counts.dueSoon, 'amber')
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Social Feed */}
            <section aria-labelledby="dash-feed" className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              <div className="border-b border-neutral-200 bg-linear-to-r from-purple-600 to-pink-600 px-5 py-4 text-white">
                <div className="flex items-center gap-2">
                  <Globe aria-hidden="true" className="h-6 w-6" />
                  <h2 id="dash-feed" className="text-lg font-bold">Social Feed</h2>
                </div>
                <p className="mt-1 text-sm text-white/90">Updates from your network</p>
              </div>
              {feed.loading && !feed.data ? (
                <p role="status" className="p-6 text-center text-sm text-neutral-600">Loading the feed…</p>
              ) : feed.error && !feed.data ? (
                <div className="p-4"><InlineError title="The feed didn't load" message={feed.error} onRetry={() => feed.reload()} /></div>
              ) : (feed.data ?? []).length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-neutral-600">No posts yet. Visit the Social Hub to get started.</p>
                  <Link to="/social" className="mt-3 inline-block text-sm font-medium text-purple-700 hover:underline">Go to Social Hub →</Link>
                </div>
              ) : (
                <ul className="max-h-96 divide-y divide-neutral-200 overflow-y-auto">
                  {(feed.data ?? []).map((post: FeedPost) => (
                    <li key={post._id} className="p-4 transition-colors hover:bg-neutral-50">
                      <div className="flex items-start gap-3">
                        <Avatar name={post.author?.name} image={post.author?.profileImage} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-neutral-900">{post.author?.name || 'Unknown'}</p>
                          <Link to={`/social?post=${post._id}`} className="mt-1 line-clamp-2 block text-sm text-neutral-700 hover:underline">
                            {post.title ? `${post.title}: ${post.content}` : post.content}
                          </Link>
                          <div className="mt-2 flex gap-4 text-xs text-neutral-600">
                            <span className="inline-flex items-center gap-1">
                              <ThumbsUp aria-hidden="true" className="h-3.5 w-3.5" />
                              {post.likes?.length ?? 0}
                              <span className="sr-only"> likes</span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
                              {post.comments?.length ?? 0}
                              <span className="sr-only"> comments</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Personal Todos */}
            <section aria-labelledby="dash-todos" className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              <div className="border-b border-neutral-200 bg-linear-to-r from-teal-600 to-cyan-600 px-5 py-4 text-white">
                <div className="flex items-center gap-2">
                  <ListTodo aria-hidden="true" className="h-6 w-6" />
                  <h2 id="dash-todos" className="text-lg font-bold">Personal Todos</h2>
                </div>
                <p className="mt-1 text-sm text-white/90">
                  {todos.data ? `${myTodos.filter((todo) => todo.status !== 'completed').length} of ${myTodos.length} remaining` : 'Your own to-do list'}
                </p>
              </div>
              {todos.loading && !todos.data ? (
                <p role="status" className="p-6 text-center text-sm text-neutral-600">Loading your to-dos…</p>
              ) : todos.error && !todos.data ? (
                <div className="p-4"><InlineError title="Your to-dos didn't load" message={todos.error} onRetry={() => todos.reload()} /></div>
              ) : myTodos.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-neutral-600">No to-dos yet. Create one in the Social Hub.</p>
                  <Link to="/social" className="mt-3 inline-block text-sm font-medium text-teal-700 hover:underline">Go to Social Hub →</Link>
                </div>
              ) : (
                <ul className="max-h-96 divide-y divide-neutral-200 overflow-y-auto">
                  {myTodos.map((todo) => {
                    const done = todo.status === 'completed'
                    return (
                      <li key={todo._id} className={`flex items-start gap-3 p-4 transition-colors hover:bg-neutral-50 ${done ? 'bg-neutral-50' : ''}`}>
                        <input
                          type="checkbox"
                          checked={done}
                          disabled={togglingId === todo._id}
                          onChange={() => toggleTodo(todo)}
                          aria-label={done ? `Mark "${todo.title}" as not done` : `Mark "${todo.title}" as done`}
                          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-neutral-300 accent-teal-600 disabled:cursor-wait"
                        />
                        <div className="min-w-0 flex-1">
                          <p className={`wrap-break-word text-sm font-medium ${done ? 'text-neutral-500 line-through' : 'text-neutral-900'}`}>{todo.title}</p>
                          {todo.description && <p className="mt-1 wrap-break-word text-xs text-neutral-600">{todo.description}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Leaderboard */}
            <section aria-labelledby="dash-board" className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              <div className="border-b border-neutral-200 bg-linear-to-r from-amber-600 to-orange-600 px-5 py-4 text-white">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Trophy aria-hidden="true" className="h-6 w-6" />
                    <h2 id="dash-board" className="text-lg font-bold">Leaderboard</h2>
                  </div>
                  <div role="group" aria-label="Leaderboard period" className="flex rounded-lg bg-white/20 p-0.5 text-xs font-semibold">
                    {(['month', 'all'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPeriod(value)}
                        aria-pressed={period === value}
                        className={`rounded-md px-3 py-1.5 transition-colors ${period === value ? 'bg-white text-orange-700' : 'text-white hover:bg-white/10'}`}
                      >
                        {value === 'month' ? 'This month' : 'All time'}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-sm text-white/90">Top performers in your team</p>
              </div>
              {boardLoading && boardRows.length === 0 ? (
                <p role="status" className="p-6 text-center text-sm text-neutral-600">Loading the leaderboard…</p>
              ) : board.error ? (
                <div className="p-4"><InlineError title="The leaderboard didn't load" message={board.error} onRetry={() => board.reload()} /></div>
              ) : boardRows.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-neutral-600">
                    {period === 'month' ? 'No finished or open tasks this month yet.' : 'Nobody has any tasks yet.'}
                  </p>
                </div>
              ) : (
                <ol aria-busy={boardLoading} className={`divide-y divide-neutral-200 ${boardLoading ? 'opacity-60' : ''}`}>
                  {boardRows.slice(0, 5).map((member, index) => {
                    const isCurrentUser = member._id === user?._id
                    return (
                      <li key={member._id} className={`flex items-center gap-3 px-5 py-3 transition-colors ${isCurrentUser ? 'bg-emerald-50' : 'hover:bg-neutral-50'}`}>
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                            index === 0 ? 'bg-amber-100 text-amber-800' : index === 1 ? 'bg-neutral-200 text-neutral-700' : index === 2 ? 'bg-orange-100 text-orange-800' : 'bg-neutral-100 text-neutral-600'
                          }`}
                        >
                          <span className="sr-only">Rank </span>
                          {index + 1}
                        </div>
                        <Avatar name={member.name} image={member.photoUrl} className="h-10 w-10 text-sm" />
                        <div className="min-w-0 flex-1">
                          {/* A long name is cut short; "(You)" always stays */}
                          <p className={`flex items-baseline gap-2 font-medium ${isCurrentUser ? 'text-emerald-800' : 'text-neutral-900'}`}>
                            <span className="truncate">{member.name}</span>
                            {isCurrentUser && <span className="shrink-0 text-xs text-emerald-700">(You)</span>}
                          </p>
                          <p className="text-xs text-neutral-600">{member.completedTasks} of {member.totalTasks} completed</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100 sm:block" aria-hidden="true">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${member.completionRate}%` }} />
                          </div>
                          <span className="w-10 text-right text-xs font-medium text-neutral-700">{member.completionRate}%</span>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
              {boardRows.length > 5 && (
                <div className="border-t border-neutral-200 px-5 py-3 text-center text-xs text-neutral-600">+{boardRows.length - 5} more team members</div>
              )}
            </section>

            {/* Recent Tasks */}
            <section aria-labelledby="dash-recent" className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id="dash-recent" className="flex items-center gap-2 font-semibold text-neutral-900">
                  <ClipboardList aria-hidden="true" className="h-5 w-5 text-neutral-500" />
                  Recent Tasks
                </h2>
                <Link to="/tasks" className="text-sm font-medium text-emerald-700 hover:underline">View all tasks</Link>
              </div>
              {recent.loading && !recent.data ? (
                <p role="status" className="py-8 text-center text-sm text-neutral-600">Loading your tasks…</p>
              ) : recent.error && !recent.data ? (
                <InlineError title="Your tasks didn't load" message={recent.error} onRetry={() => recent.reload()} />
              ) : (recent.data ?? []).length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-600">No tasks assigned yet.</p>
              ) : (
                <ul className="space-y-3">
                  {(recent.data ?? []).map((task) => {
                    const busy = actions.busyId === task._id
                    const due = dueText(task)
                    return (
                      <li key={task._id} className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 transition-colors hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <Link to={`/tasks?task=${task._id}`} className="block wrap-break-word font-medium text-neutral-900 hover:underline">
                            {task.title}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <PriorityBadge priority={task.priority} />
                            <StatusBadge status={task.status} />
                            {due && <span className={`text-xs ${task.isOverdue ? 'font-semibold text-red-700' : 'text-neutral-600'}`}>{due}{task.isOverdue ? ' (overdue)' : ''}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {canStart(task, user?._id) && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => actions.start(task)}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Start
                            </button>
                          )}
                          {canRequestCompletion(task, user?._id) && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => actions.requestCompletion(task)}
                              className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                            >
                              Request completion
                            </button>
                          )}
                          {isWaitingForTeammates(task, user?._id) && <span className="text-xs text-purple-700">Waiting for teammates</span>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>

      {shareOffer && (
        <ShareTaskDialog
          offer={shareOffer}
          onClose={() => setShareOffer(null)}
          onShared={(text) => {
            setShareOffer(null)
            notify(text, 'success')
          }}
        />
      )}

      {actions.dialogs}
    </div>
  )
}

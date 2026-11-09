import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { LogOut, MessageSquare } from 'lucide-react'
import { teamAPI } from '../api/teamAPI'
import { useAuth } from '../context/useAuth'
import { PriorityBadge, TaskStatusBadge } from '../components/teams/badges'
import { errorStatus, formatDay, formatHours, plural, roleLabel } from '../components/teams/format'
import { useLoader, useSyncSession } from '../components/teams/hooks'
import { useLeaveTeam } from '../components/teams/useLeaveTeam'
import type { AttendanceSummary, ListResponse, Team, TeamTask } from '../components/teams/types'
import { Avatar, EmptyBlock, ErrorBlock, LoadingBlock, Pager } from '../components/teams/ui'

const TASK_PAGE_SIZE = 10

const card = 'rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6'
const eyebrow = 'text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600'

// "2026-10" as "October 2026"
const monthName = (month?: string) => {
  const match = month && /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return 'this month'
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// Admins have their own pages. Leaders are sent on by what the server says
// about their team, not by the role in the session, which can be out of date.
export default function TeamMemberDashboard() {
  const { user } = useAuth()
  if (user?.role === 'admin') return <Navigate to="/admin" replace />
  return <MemberHome />
}

function MemberHome() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const syncSession = useSyncSession()

  const loadTeam = useCallback(async (): Promise<Team | null> => {
    try {
      const response = await teamAPI.getMyTeam()
      return response.data as Team
    } catch (error) {
      // Not in a team: the team page is where to start or join one
      if (errorStatus(error) === 404) return null
      throw error
    }
  }, [])
  const loader = useLoader(loadTeam, 'Could not load your team.')
  const team = loader.data

  useEffect(() => {
    if (team !== null) return
    // No team (any more): copy the role the server has into the session, and
    // go to the one screen for people without a team
    void syncSession().then(() => navigate('/teams', { replace: true }))
    // Once, when the answer arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team])

  // Someone who joined from elsewhere still has a stale role in this session
  const roleChecked = useRef(false)
  useEffect(() => {
    if (!team || roleChecked.current || user?.role === 'team_member') return
    roleChecked.current = true
    void syncSession()
  }, [team, user, syncSession])

  if (team === undefined || team === null) {
    return (
      <div className="min-h-screen px-4 py-12">
        <div className="mx-auto max-w-xl">
          {team === undefined && loader.error ? (
            <ErrorBlock message={loader.error} onRetry={loader.reload} retrying={loader.loading} />
          ) : (
            <LoadingBlock label="Loading your team…" />
          )}
        </div>
      </div>
    )
  }

  // Someone who leads this team belongs on the leader page
  if (team.leaders.some((leader) => leader._id === user?._id)) return <Navigate to="/teams" replace />

  return <MemberView team={team} onLeft={() => navigate('/teams', { replace: true })} />
}

function MemberView({ team, onLeft }: { team: Team; onLeft: () => void }) {
  const { user } = useAuth()
  const frozen = team.isActive === false
  const [taskPage, setTaskPage] = useState(1)
  const { leave, leaving } = useLeaveTeam(team, onLeft)

  const loadTasks = useCallback(
    () =>
      teamAPI.getMyTeamTasks(team._id, { page: taskPage, limit: TASK_PAGE_SIZE, sort: 'dueDate' }) as Promise<ListResponse<TeamTask>>,
    [team._id, taskPage],
  )
  const tasks = useLoader(loadTasks, 'Could not load your tasks in this team.')

  const loadSummary = useCallback(
    async () => (await teamAPI.getMyAttendanceSummary()).data as AttendanceSummary,
    [],
  )
  const summary = useLoader(loadSummary, 'Could not load your attendance.')

  const people = [...team.leaders, ...team.members.filter((member) => !team.leaders.some((leader) => leader._id === member._id))]
  const days = summary.data?.days
  const taskList = tasks.data?.data ?? []

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_24%),linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-white/70 bg-white/85 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="bg-[linear-gradient(135deg,rgba(5,150,105,0.98),rgba(13,148,136,0.92))] px-5 py-6 text-white sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-100">Team member workspace</p>
            <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h1 className="break-words text-3xl font-black tracking-tight">{team.name}</h1>
                <p className="mt-2 max-w-2xl text-sm text-emerald-50">
                  {team.description || 'Your team’s tasks, people and chat are here.'}
                </p>
                <p className="mt-1 text-sm text-emerald-100">
                  Led by {team.leaders.map((leader) => leader.name).join(', ') || 'no one yet'}
                </p>
              </div>
              <dl className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="rounded-2xl bg-white/10 px-3 py-3 sm:px-4">
                  <dt className="text-[10px] uppercase tracking-[0.12em] text-emerald-100 sm:text-[11px] sm:tracking-[0.18em]">People</dt>
                  <dd className="mt-1 text-xl font-bold">{people.length}</dd>
                </div>
                <div className="rounded-2xl bg-white/10 px-3 py-3 sm:px-4">
                  <dt className="text-[10px] uppercase tracking-[0.12em] text-emerald-100 sm:text-[11px] sm:tracking-[0.18em]">Your tasks</dt>
                  <dd className="mt-1 text-xl font-bold">{tasks.data?.pagination?.total ?? '—'}</dd>
                </div>
                <div className="rounded-2xl bg-white/10 px-3 py-3 sm:px-4">
                  <dt className="text-[10px] uppercase tracking-[0.12em] text-emerald-100 sm:text-[11px] sm:tracking-[0.18em]">Hours</dt>
                  <dd className="mt-1 text-xl font-bold">{summary.data ? formatHours(summary.data.approvedHours) : '—'}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 px-5 py-4 sm:px-6">
            <Link
              to={`/chat?team=${team._id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Open team chat
            </Link>
            <Link
              to="/social"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Social Hub
            </Link>
            <Link
              to="/attendance"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Attendance
            </Link>
            <button
              type="button"
              onClick={() => void leave()}
              disabled={leaving}
              className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {leaving ? 'Leaving…' : 'Leave team'}
            </button>
          </div>
        </section>

        {frozen && (
          <p role="status" className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <span className="font-semibold">An admin has frozen this team.</span> You can still see its tasks, work on your own
            tasks and check in, but nothing new can be added and the chat is read-only. Your requests wait for an admin until
            the team is unfrozen. You can still leave.
          </p>
        )}

        <section aria-labelledby="my-team-tasks" className={card}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className={eyebrow}>Tasks</p>
              <h2 id="my-team-tasks" className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                Your tasks in this team
              </h2>
            </div>
            <Link to="/tasks" className="text-sm font-semibold text-emerald-700 hover:underline">
              Open all my tasks
            </Link>
          </div>

          <div className="mt-4">
            {tasks.error ? (
              <ErrorBlock message={tasks.error} onRetry={tasks.reload} retrying={tasks.loading} />
            ) : tasks.loading && !tasks.data ? (
              <LoadingBlock label="Loading your tasks…" />
            ) : taskList.length === 0 ? (
              <EmptyBlock>No tasks are assigned to you in this team yet.</EmptyBlock>
            ) : (
              <>
                <ul className={`divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white ${tasks.loading ? 'opacity-60' : ''}`}>
                  {taskList.map((task) => (
                    <li key={task._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 basis-56">
                        <Link to={`/tasks?task=${task._id}`} className="font-medium text-slate-900 hover:underline">
                          {task.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Due {formatDay(task.dueDay ?? task.dueDate)}
                          {task.isOverdue && <span className="ml-1 font-medium text-red-700">· Overdue</span>}
                        </p>
                        {task.rejectionReason && task.status !== 'completed' && (
                          <p className="mt-0.5 text-xs text-red-700">Sent back: “{task.rejectionReason}”</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <PriorityBadge priority={task.priority} />
                        <TaskStatusBadge status={task.status} />
                      </div>
                    </li>
                  ))}
                </ul>
                <Pager
                  page={tasks.data?.pagination?.page ?? taskPage}
                  pages={tasks.data?.pagination?.pages ?? 1}
                  total={tasks.data?.pagination?.total ?? taskList.length}
                  onPage={setTaskPage}
                  label="tasks"
                  disabled={tasks.loading}
                />
              </>
            )}
          </div>
        </section>

        <section aria-labelledby="my-team-attendance" className={card}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className={eyebrow}>Attendance</p>
              <h2 id="my-team-attendance" className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                Your attendance in {monthName(summary.data?.month)}
              </h2>
            </div>
            <Link to="/attendance" className="text-sm font-semibold text-emerald-700 hover:underline">
              Open attendance
            </Link>
          </div>

          <div className="mt-4">
            {summary.error ? (
              <ErrorBlock message={summary.error} onRetry={summary.reload} retrying={summary.loading} />
            ) : summary.loading && !summary.data ? (
              <LoadingBlock label="Loading your attendance…" />
            ) : days && summary.data ? (
              <>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ['Present', days.present],
                    ['Late', days.late],
                    ['Half days', days.halfDay],
                    ['Absent', days.absent],
                    ['Leave', days.leave],
                    ['Approved hours', formatHours(summary.data.approvedHours)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className="mt-1 text-xl font-bold text-slate-900">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-sm text-slate-600">
                  Only approved days are counted.
                  {summary.data.pendingCount > 0 && ` ${plural(summary.data.pendingCount, 'day')} still awaiting approval.`}
                  {summary.data.rejectedCount > 0 && ` ${plural(summary.data.rejectedCount, 'day')} rejected.`}
                </p>
              </>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="my-team-people" className={card}>
          <p className={eyebrow}>People</p>
          <h2 id="my-team-people" className="mt-1 text-2xl font-black tracking-tight text-slate-900">
            People in this team ({people.length})
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((person) => {
              const isLeader = team.leaders.some((leader) => leader._id === person._id)
              const isMe = person._id === user?._id
              return (
                <li key={person._id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <Avatar
                    name={person.name}
                    src={person.profileImage}
                    size="lg"
                    rounded="rounded-2xl"
                    tone={isLeader ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {person.name}
                      {isMe && <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {[roleLabel(isLeader ? 'team_leader' : 'team_member'), person.department].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {!isMe && (
                    <Link
                      to={`/chat?user=${person._id}`}
                      aria-label={`Message ${person.name}`}
                      className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Message
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}

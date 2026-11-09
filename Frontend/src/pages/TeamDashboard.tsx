import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { MessageSquare, Pencil } from 'lucide-react'
import { teamAPI } from '../api/teamAPI'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'
import InviteDialog from '../components/teams/InviteDialog'
import MembersPanel from '../components/teams/MembersPanel'
import NoTeam from '../components/teams/NoTeam'
import OverviewPanel, { type Queue } from '../components/teams/OverviewPanel'
import SentInvites from '../components/teams/SentInvites'
import TeamAttendancePanel from '../components/teams/TeamAttendancePanel'
import { EditTeamDialog } from '../components/teams/TeamDialogs'
import TeamTasksPanel from '../components/teams/TeamTasksPanel'
import { errorStatus, plural } from '../components/teams/format'
import { useLoader, useSyncSession } from '../components/teams/hooks'
import type { PickerPerson } from '../components/teams/PersonPicker'
import { useTeamReviews } from '../components/teams/reviews'
import type { InviteCandidate, ListResponse, AttendanceRecord, Team, TeamTask } from '../components/teams/types'
import { ErrorBlock, FrozenBanner, LoadingBlock, secondaryButton } from '../components/teams/ui'

type TabId = 'overview' | 'tasks' | 'attendance' | 'members' | 'invites'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'overview' },
  { id: 'tasks', label: 'tasks' },
  { id: 'attendance', label: 'attendance' },
  { id: 'members', label: 'members' },
  { id: 'invites', label: 'invites sent' },
]

const isTab = (value: string | null): value is TabId => TABS.some((tab) => tab.id === value)

// Admins manage teams from their own page. Everyone else is sent by what the
// server says about their team, not by the role in the session, which can be
// out of date (an admin may have just made a member a leader).
export default function TeamDashboard() {
  const { user } = useAuth()
  if (user?.role === 'admin') return <Navigate to="/admin/teams" replace />
  return <TeamHome />
}

// A member whose session still says they are not one: copy the new role in
// and move them to their own page
function MemberRedirect() {
  const syncSession = useSyncSession()
  useEffect(() => {
    void syncSession()
    // Once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <Navigate to="/team-member" replace />
}

function TeamHome() {
  const { user } = useAuth()
  const syncSession = useSyncSession()

  const loadTeam = useCallback(async (): Promise<Team | null> => {
    try {
      const response = await teamAPI.getMyTeam()
      return response.data as Team
    } catch (error) {
      // Not being in a team is not a failure
      if (errorStatus(error) === 404) return null
      throw error
    }
  }, [])
  const loader = useLoader(loadTeam, 'Could not load your team.')
  const team = loader.data

  if (team === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-12">
        <div className="mx-auto max-w-xl">
          {loader.error ? (
            <ErrorBlock message={loader.error} onRetry={loader.reload} retrying={loader.loading} />
          ) : (
            <LoadingBlock label="Loading your team…" />
          )}
        </div>
      </div>
    )
  }

  if (team === null) {
    return (
      <NoTeam
        onCreated={() => {
          // Creating a team makes the user its leader on the server
          void syncSession().then(() => loader.reload())
        }}
      />
    )
  }

  if (!team.leaders.some((leader) => leader._id === user?._id)) return <MemberRedirect />

  return <LeaderView team={team} refreshError={loader.error} onReload={loader.reload} onLeft={loader.reload} />
}

type LeaderViewProps = {
  team: Team
  // A failed refresh of a team that is already on screen
  refreshError: string
  onReload: () => void
  onLeft: () => void
}

function LeaderView({ team, refreshError, onReload, onLeft }: LeaderViewProps) {
  const { user } = useAuth()
  const { notify } = useFeedback()
  const syncSession = useSyncSession()
  const [params, setParams] = useSearchParams()
  const [version, setVersion] = useState(0)
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState(false)

  const frozen = team.isActive === false
  // Leaders act on their team only while it isn't frozen
  const canAct = !frozen
  const requested = params.get('tab')
  const tab: TabId = isTab(requested) ? requested : 'overview'

  // A leader added from elsewhere still has a stale role in this session
  const roleChecked = useRef(false)
  useEffect(() => {
    if (!user || roleChecked.current || user.role === 'team_leader') return
    roleChecked.current = true
    void syncSession()
  }, [user, syncSession])

  const changed = useCallback(() => {
    setVersion((current) => current + 1)
    onReload()
  }, [onReload])

  const chooseTab = (id: TabId) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (id === 'overview') next.delete('tab')
        else next.set('tab', id)
        return next
      },
      { replace: true },
    )

  const onTabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((item) => item.id === tab)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    chooseTab(TABS[next].id)
    document.getElementById(`team-tab-${TABS[next].id}`)?.focus()
  }

  // ── What is waiting for review ──────────────────────────────────────────
  // A frozen team has no review queue: its waiting work goes to an admin, so
  // only how much of it there is gets counted.
  const loadWaitingTasks = useCallback(
    () =>
      (frozen
        ? teamAPI.getTeamTasks(team._id, { status: 'completion-requested', page: 1, limit: 1 })
        : teamAPI.getTeamPendingApprovalTasks(team._id)) as Promise<ListResponse<TeamTask>>,
    [team._id, frozen],
  )
  const waitingTasks = useLoader(loadWaitingTasks, 'Could not load the tasks waiting for approval.', version)

  const loadWaitingAttendance = useCallback(
    () =>
      (frozen
        ? teamAPI.getTeamAttendance(team._id, { status: 'pending', page: 1, limit: 1 })
        : teamAPI.getTeamPendingAttendance(team._id)) as Promise<ListResponse<AttendanceRecord>>,
    [team._id, frozen],
  )
  const waitingAttendance = useLoader(loadWaitingAttendance, 'Could not load the attendance waiting for approval.', version)

  const loadTaskTotal = useCallback(
    () => teamAPI.getTeamTasks(team._id, { page: 1, limit: 1 }) as Promise<ListResponse<TeamTask>>,
    [team._id],
  )
  const taskTotal = useLoader(loadTaskTotal, 'Could not count the team’s tasks.', version)

  const taskQueue: Queue<TeamTask> = {
    items: frozen ? [] : (waitingTasks.data?.data ?? []),
    count: waitingTasks.data ? (frozen ? waitingTasks.data.pagination?.total : waitingTasks.data.data.length) : undefined,
    error: waitingTasks.error,
    loading: waitingTasks.loading,
    reload: waitingTasks.reload,
  }
  const attendanceQueue: Queue<AttendanceRecord> = {
    items: frozen ? [] : (waitingAttendance.data?.data ?? []),
    count: waitingAttendance.data
      ? frozen
        ? waitingAttendance.data.pagination?.total
        : waitingAttendance.data.data.length
      : undefined,
    error: waitingAttendance.error,
    loading: waitingAttendance.loading,
    reload: waitingAttendance.reload,
  }

  const reviewableTaskIds = useMemo(() => new Set(taskQueue.items.map((task) => task._id)), [taskQueue.items])
  const reviewableAttendanceIds = useMemo(
    () => new Set(attendanceQueue.items.map((record) => record._id)),
    [attendanceQueue.items],
  )
  const reviews = useTeamReviews(team._id, changed)

  // ── Inviting ────────────────────────────────────────────────────────────
  const searchPeople = useCallback(
    async (query: string): Promise<PickerPerson[]> => {
      const response = await teamAPI.getInviteCandidates(team._id, query)
      return ((response.data ?? []) as InviteCandidate[]).map((person) => ({
        _id: person._id,
        name: person.name,
        email: person.email,
        department: person.department,
        profileImage: person.profileImage,
        note: person.invitePending ? 'Invite already waiting' : undefined,
        unavailable: person.invitePending,
      }))
    },
    [team._id],
  )

  const openInvites = team.counts?.openInvites ?? 0
  const tabBadge = (id: TabId) => {
    if (id === 'tasks') return taskQueue.count
    if (id === 'attendance') return attendanceQueue.count
    if (id === 'invites') return openInvites
    return 0
  }
  const waitingFor = frozen ? 'waiting for an admin' : 'awaiting approval'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-bold text-gray-900">{team.name}</h1>
              {team.description && <p className="mt-0.5 break-words text-sm text-gray-600">{team.description}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to={`/chat?team=${team._id}`} className={secondaryButton}>
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Open team chat
                </Link>
                {canAct && (
                  <button type="button" onClick={() => setEditing(true)} className={secondaryButton}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit team
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(taskQueue.count ?? 0) > 0 && (
                <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
                  {plural(taskQueue.count ?? 0, 'task')} {waitingFor}
                </span>
              )}
              {(attendanceQueue.count ?? 0) > 0 && (
                <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                  {attendanceQueue.count} attendance {frozen ? 'waiting for an admin' : 'pending'}
                </span>
              )}
              {openInvites > 0 && (
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                  {plural(openInvites, 'open invite')}
                </span>
              )}
            </div>
          </div>

          {frozen && (
            <div className="mt-4">
              <FrozenBanner>
                <span className="font-semibold">This team is frozen.</span> An admin has paused it: you can look at its tasks,
                attendance and chat, but nothing can be added, changed or approved until an admin unfreezes it. Work waiting
                for approval goes to an admin.
              </FrozenBanner>
            </div>
          )}

          <div
            role="tablist"
            aria-label="Team sections"
            onKeyDown={onTabKeys}
            className="-mb-px mt-4 flex gap-1 overflow-x-auto"
          >
            {TABS.map((item) => {
              const badge = tabBadge(item.id)
              const selected = tab === item.id
              return (
                <button
                  key={item.id}
                  id={`team-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="team-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => chooseTab(item.id)}
                  className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${
                    selected ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {item.label}
                  {typeof badge === 'number' && badge > 0 && (
                    <span className="ml-1.5 rounded-full bg-blue-500 px-1.5 py-0.5 text-xs text-white">{badge}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div
        id="team-panel"
        role="tabpanel"
        aria-labelledby={`team-tab-${tab}`}
        className="mx-auto max-w-7xl px-4 py-6"
      >
        {refreshError && (
          <div className="mb-4">
            <ErrorBlock message={refreshError} onRetry={onReload} />
          </div>
        )}

        {tab === 'overview' && (
          <OverviewPanel
            peopleCount={team.counts ? team.counts.leaders + team.counts.members : team.leaders.length + team.members.length}
            taskTotal={taskTotal.data?.pagination?.total}
            tasks={taskQueue}
            attendance={attendanceQueue}
            canAct={canAct}
            frozen={frozen}
            reviews={reviews}
          />
        )}

        {tab === 'tasks' && (
          <TeamTasksPanel
            team={team}
            meId={user?._id}
            canAct={canAct}
            frozen={frozen}
            version={version}
            reviewableIds={reviewableTaskIds}
            reviews={reviews}
            onChanged={changed}
          />
        )}

        {tab === 'attendance' && (
          <TeamAttendancePanel
            team={team}
            meId={user?._id}
            canAct={canAct}
            frozen={frozen}
            version={version}
            reviewableIds={reviewableAttendanceIds}
            reviews={reviews}
          />
        )}

        {tab === 'members' && (
          <MembersPanel
            team={team}
            meId={user?._id}
            canAct={canAct}
            onInvite={() => setInviting(true)}
            onChanged={changed}
            onLeft={onLeft}
          />
        )}

        {tab === 'invites' && (
          <SentInvites
            team={team}
            canAct={canAct}
            frozen={frozen}
            version={version}
            onChanged={changed}
            onInvite={() => setInviting(true)}
          />
        )}
      </div>

      {inviting && (
        <InviteDialog
          teamId={team._id}
          teamName={team.name}
          search={searchPeople}
          minChars={2}
          onClose={() => setInviting(false)}
          onInvited={(who) => {
            setInviting(false)
            notify(`Invite sent to ${who}.`, 'success')
            changed()
          }}
        />
      )}

      {editing && (
        <EditTeamDialog
          team={team}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            notify('Team updated.', 'success')
            changed()
          }}
        />
      )}
    </div>
  )
}

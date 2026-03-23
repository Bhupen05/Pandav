import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { teamAPI } from '../api/teamAPI'
import { useAuth } from '../context/AuthContext'

type Invite = {
  _id: string
  team: { _id: string; name: string; description?: string }
  invitedBy: { _id: string; name: string; email: string }
  createdAt: string
}

type TeamUser = {
  _id: string
  name: string
  email: string
  role: string
  department?: string
  profileImage?: string
}

type Team = {
  _id: string
  name: string
  description?: string
  leaders: TeamUser[]
  members: TeamUser[]
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

export default function TeamMemberDashboard() {
  const navigate = useNavigate()
  const { isAuthenticated, user, updateUser } = useAuth()
  const [team, setTeam] = useState<Team | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login')
      return
    }

    if (user?.role === 'admin') {
      navigate('/admin')
      return
    }

    if (user?.role === 'team_leader') {
      navigate('/teams')
      return
    }

    void fetchData()
  }, [isAuthenticated, user, navigate])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [invitesRes, teamRes] = await Promise.allSettled([
        teamAPI.getMyInvites(),
        teamAPI.getMyTeam(),
      ])

      if (invitesRes.status === 'fulfilled') {
        setInvites(invitesRes.value.data || [])
      }

      if (teamRes.status === 'fulfilled') {
        setTeam(teamRes.value.data || null)
      } else {
        setTeam(null)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptInvite = async (inviteId: string) => {
    if (!user) return
    setActionLoading((prev) => ({ ...prev, [inviteId]: true }))
    try {
      await teamAPI.acceptInvite(inviteId)
      updateUser({ ...user, role: 'team_member' })
      await fetchData()
    } catch (error: unknown) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { data?: { message?: string } } }).response?.data?.message === 'string'
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : 'Failed to accept invite'
      alert(message)
    } finally {
      setActionLoading((prev) => ({ ...prev, [inviteId]: false }))
    }
  }

  const handleDeclineInvite = async (inviteId: string) => {
    setActionLoading((prev) => ({ ...prev, [inviteId]: true }))
    try {
      await teamAPI.declineInvite(inviteId)
      setInvites((prev) => prev.filter((invite) => invite._id !== inviteId))
    } catch (error: unknown) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { data?: { message?: string } } }).response?.data?.message === 'string'
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : 'Failed to decline invite'
      alert(message)
    } finally {
      setActionLoading((prev) => ({ ...prev, [inviteId]: false }))
    }
  }

  const teamSize = useMemo(() => {
    if (!team) return 0
    return team.leaders.length + team.members.length
  }, [team])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_24%),linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-white/70 bg-white/85 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="bg-[linear-gradient(135deg,rgba(5,150,105,0.98),rgba(13,148,136,0.92))] px-6 py-6 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-100">Team Member Workspace</p>
            <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-black tracking-tight">{user?.name}</h1>
                <p className="mt-2 max-w-2xl text-sm text-emerald-50">
                  Review your invites, confirm your current team, and move into the right workspace without seeing data outside your own scope.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100">Invites</p>
                  <p className="mt-1 text-xl font-bold">{invites.length}</p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100">Team</p>
                  <p className="mt-1 text-xl font-bold">{team ? 1 : 0}</p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100">Members</p>
                  <p className="mt-1 text-xl font-bold">{teamSize}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 px-6 py-4">
            <button
              onClick={() => navigate('/chat')}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open Chat
            </button>
            <button
              onClick={() => navigate('/social')}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Social Hub
            </button>
            <button
              onClick={() => navigate(team ? '/tasks' : '/attendance')}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {team ? 'Open My Tasks' : 'Open Attendance'}
            </button>
          </div>
        </section>

        {invites.length > 0 && (
          <section className="rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Pending Invites</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Your invite queue</h2>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {invites.length} pending
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {invites.map((invite) => (
                <div
                  key={invite._id}
                  className="flex flex-col gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-slate-900">{invite.team.name}</p>
                    {invite.team.description ? (
                      <p className="mt-1 text-sm text-slate-600">{invite.team.description}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500">
                      Invited by {invite.invitedBy.name} on {new Date(invite.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAcceptInvite(invite._id)}
                      disabled={actionLoading[invite._id]}
                      className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleDeclineInvite(invite._id)}
                      disabled={actionLoading[invite._id]}
                      className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Current Team</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                {team ? team.name : 'No active team'}
              </h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {team ? `${teamSize} people` : 'Waiting'}
            </span>
          </div>

          {!team ? (
            <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
              You are not assigned to a team yet. Accept an invite above to join your workspace.
            </div>
          ) : (
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Team Leaders</p>
                <div className="mt-3 space-y-3">
                  {team.leaders.map((leader) => (
                    <div key={leader._id} className="flex items-center gap-3 rounded-2xl border bg-neutral-50 px-4 py-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-sm font-bold text-emerald-700">
                        {initials(leader.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-neutral-900">{leader.name}</p>
                        <p className="text-sm text-neutral-600">{leader.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Team Members</p>
                <div className="mt-3 space-y-3">
                  {team.members.map((member) => (
                    <div key={member._id} className="flex items-center gap-3 rounded-2xl border bg-neutral-50 px-4 py-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-200 text-sm font-bold text-slate-700">
                        {initials(member.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-neutral-900">{member.name}</p>
                        <p className="text-sm text-neutral-600">{member.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

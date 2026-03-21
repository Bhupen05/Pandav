import { useEffect, useState } from 'react'
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
      navigate('/team')
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
    } catch (error: any) {
      alert(error?.response?.data?.message || 'Failed to accept invite')
    } finally {
      setActionLoading((prev) => ({ ...prev, [inviteId]: false }))
    }
  }

  const handleDeclineInvite = async (inviteId: string) => {
    setActionLoading((prev) => ({ ...prev, [inviteId]: true }))
    try {
      await teamAPI.declineInvite(inviteId)
      setInvites((prev) => prev.filter((invite) => invite._id !== inviteId))
    } catch (error: any) {
      alert(error?.response?.data?.message || 'Failed to decline invite')
    } finally {
      setActionLoading((prev) => ({ ...prev, [inviteId]: false }))
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-600">Team Member</p>
          <h1 className="mt-2 text-3xl font-semibold text-neutral-900">{user?.name}</h1>
          <p className="mt-2 text-sm text-neutral-600">
            View your team, manage pending invites, and move into your team workspace cleanly.
          </p>
        </div>

        {invites.length > 0 && (
          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-neutral-900">Pending Invites</h2>
            <div className="mt-4 space-y-3">
              {invites.map((invite) => (
                <div key={invite._id} className="flex flex-col gap-4 rounded-xl border border-emerald-100 bg-emerald-50 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-base font-semibold text-neutral-900">{invite.team.name}</p>
                    {invite.team.description && (
                      <p className="mt-1 text-sm text-neutral-600">{invite.team.description}</p>
                    )}
                    <p className="mt-2 text-xs text-neutral-500">
                      Invited by {invite.invitedBy.name} on {new Date(invite.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAcceptInvite(invite._id)}
                      disabled={actionLoading[invite._id]}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleDeclineInvite(invite._id)}
                      disabled={actionLoading[invite._id]}
                      className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-neutral-900">Current Team</h2>
          {!team ? (
            <div className="mt-4 rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
              You are not assigned to a team yet.
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-neutral-900">{team.name}</h3>
                {team.description && <p className="mt-1 text-sm text-neutral-600">{team.description}</p>}
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Team Leaders</p>
                  <div className="mt-3 space-y-2">
                    {team.leaders.map((leader) => (
                      <div key={leader._id} className="rounded-xl border bg-neutral-50 px-4 py-3">
                        <p className="font-medium text-neutral-900">{leader.name}</p>
                        <p className="text-sm text-neutral-600">{leader.email}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Team Members</p>
                  <div className="mt-3 space-y-2">
                    {team.members.map((member) => (
                      <div key={member._id} className="rounded-xl border bg-neutral-50 px-4 py-3">
                        <p className="font-medium text-neutral-900">{member.name}</p>
                        <p className="text-sm text-neutral-600">{member.email}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

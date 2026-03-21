import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { teamAPI } from '../api/teamAPI'
import { userAPI } from '../api/userAPI'

type User = {
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
  leaders: User[]
  members: User[]
  isActive: boolean
  createdAt: string
  createdBy?: { _id: string; name: string }
}

export default function TeamManagement() {
  const navigate = useNavigate()
  const { isAdmin, isAuthenticated } = useAuth()

  const [teams, setTeams] = useState<Team[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showLeaderModal, setShowLeaderModal] = useState(false)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  const [newTeam, setNewTeam] = useState({ name: '', description: '', leaderId: '' })
  const [inviteUserId, setInviteUserId] = useState('')
  const [newLeaderId, setNewLeaderId] = useState('')

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login'); return }
    if (!isAdmin) { navigate('/') ; return }
    fetchData()
  }, [isAuthenticated, isAdmin])

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const [teamsRes, usersRes] = await Promise.all([
        teamAPI.getTeams(),
        userAPI.getUsers(),
      ])
      setTeams(teamsRes.data)
      setUsers(usersRes.data || usersRes)
    } catch (err) {
      console.error('Failed to load data', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionLoading(p => ({ ...p, create: true }))
    try {
      await teamAPI.createTeam(newTeam)
      setShowCreateModal(false)
      setNewTeam({ name: '', description: '', leaderId: '' })
      await fetchData()
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to create team')
    } finally {
      setActionLoading(p => ({ ...p, create: false }))
    }
  }

  const handleDeleteTeam = async (teamId: string, teamName: string) => {
    if (!confirm(`Delete team "${teamName}"? This cannot be undone.`)) return
    setActionLoading(p => ({ ...p, [teamId]: true }))
    try {
      await teamAPI.deleteTeam(teamId)
      setTeams(p => p.filter(t => t._id !== teamId))
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to delete team')
    } finally {
      setActionLoading(p => ({ ...p, [teamId]: false }))
    }
  }

  const handleInviteMember = async () => {
    if (!selectedTeam || !inviteUserId.trim()) return
    setActionLoading(p => ({ ...p, invite: true }))
    try {
      await teamAPI.inviteMember(selectedTeam._id, inviteUserId)
      setShowInviteModal(false)
      setInviteUserId('')
      alert('Invite sent successfully!')
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to send invite')
    } finally {
      setActionLoading(p => ({ ...p, invite: false }))
    }
  }

  const handleAddLeader = async () => {
    if (!selectedTeam || !newLeaderId.trim()) return
    setActionLoading(p => ({ ...p, addLeader: true }))
    try {
      await teamAPI.addLeader(selectedTeam._id, newLeaderId)
      setShowLeaderModal(false)
      setNewLeaderId('')
      await fetchData()
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to add leader')
    } finally {
      setActionLoading(p => ({ ...p, addLeader: false }))
    }
  }

  const handleRemoveMember = async (teamId: string, userId: string, name: string) => {
    if (!confirm(`Remove ${name} from team?`)) return
    setActionLoading(p => ({ ...p, [`${teamId}-${userId}`]: true }))
    try {
      await teamAPI.removeMember(teamId, userId)
      await fetchData()
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to remove member')
    } finally {
      setActionLoading(p => ({ ...p, [`${teamId}-${userId}`]: false }))
    }
  }

  const nonTeamUsers = users.filter(u =>
    !teams.some(t =>
      t.leaders.some(l => l._id === u._id) || t.members.some(m => m._id === u._id)
    )
  )

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
            <p className="text-sm text-gray-500">Create and manage teams, assign leaders and members</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            + Create Team
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {teams.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border">
            <p className="text-gray-400 text-lg">No teams created yet.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              Create First Team
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {teams.map(team => (
              <div key={team._id} className="bg-white rounded-xl shadow-sm border">
                {/* Team header */}
                <div className="p-5 border-b flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-gray-900">{team.name}</h2>
                      {!team.isActive && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>
                      )}
                    </div>
                    {team.description && <p className="text-sm text-gray-500 mt-0.5">{team.description}</p>}
                    <p className="text-xs text-gray-400 mt-1">
                      {team.leaders.length} leader{team.leaders.length !== 1 ? 's' : ''} ·{' '}
                      {team.members.length} member{team.members.length !== 1 ? 's' : ''} ·{' '}
                      Created {new Date(team.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setSelectedTeam(team); setShowInviteModal(true) }}
                      className="px-3 py-1.5 border border-blue-600 text-blue-600 text-sm rounded-lg hover:bg-blue-50"
                    >
                      Invite
                    </button>
                    <button
                      onClick={() => { setSelectedTeam(team); setShowLeaderModal(true) }}
                      className="px-3 py-1.5 border border-purple-600 text-purple-600 text-sm rounded-lg hover:bg-purple-50"
                    >
                      Add Leader
                    </button>
                    <button
                      onClick={() => handleDeleteTeam(team._id, team.name)}
                      disabled={actionLoading[team._id]}
                      className="px-3 py-1.5 border border-red-500 text-red-500 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Leaders */}
                {team.leaders.length > 0 && (
                  <div className="p-5 border-b">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Leaders</h3>
                    <div className="flex flex-wrap gap-3">
                      {team.leaders.map(leader => (
                        <div key={leader._id} className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
                          <div className="w-8 h-8 rounded-full bg-blue-200 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                            {leader.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{leader.name}</p>
                            <p className="text-xs text-gray-500">{leader.email}</p>
                          </div>
                          <button
                            onClick={() => handleRemoveMember(team._id, leader._id, leader.name)}
                            disabled={actionLoading[`${team._id}-${leader._id}`]}
                            className="ml-2 text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Members */}
                <div className="p-5">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Members ({team.members.length})</h3>
                  {team.members.length === 0 ? (
                    <p className="text-sm text-gray-400">No members yet. Invite some!</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {team.members.map(member => (
                        <div key={member._id} className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-sm shrink-0">
                              {member.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{member.name}</p>
                              <p className="text-xs text-gray-500 truncate">{member.email}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveMember(team._id, member._id, member.name)}
                            disabled={actionLoading[`${team._id}-${member._id}`]}
                            className="text-xs text-red-400 hover:text-red-600 shrink-0 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create Team Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Create New Team</h3>
            <form onSubmit={handleCreateTeam} className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Team Name *</label>
                <input
                  required
                  value={newTeam.name}
                  onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Development Team"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Description</label>
                <textarea
                  rows={2}
                  value={newTeam.description}
                  onChange={e => setNewTeam(p => ({ ...p, description: e.target.value }))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional description"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Team Leader *</label>
                <select
                  required
                  value={newTeam.leaderId}
                  onChange={e => setNewTeam(p => ({ ...p, leaderId: e.target.value }))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a leader...</option>
                  {users.filter(u => u.role !== 'admin').map(u => (
                    <option key={u._id} value={u._id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading['create']}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading['create'] ? 'Creating...' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Invite Member Modal ── */}
      {showInviteModal && selectedTeam && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-1">Invite Member to "{selectedTeam.name}"</h3>
            <p className="text-sm text-gray-500 mb-4">Select a user to invite:</p>
            <select
              value={inviteUserId}
              onChange={e => setInviteUserId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select user...</option>
              {nonTeamUsers.map(u => (
                <option key={u._id} value={u._id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
            <div className="flex gap-3 mt-4 justify-end">
              <button
                onClick={() => { setShowInviteModal(false); setInviteUserId('') }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleInviteMember}
                disabled={actionLoading['invite'] || !inviteUserId}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading['invite'] ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Leader Modal ── */}
      {showLeaderModal && selectedTeam && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-1">Add Leader to "{selectedTeam.name}"</h3>
            <p className="text-sm text-gray-500 mb-4">Select a user to promote as team leader:</p>
            <select
              value={newLeaderId}
              onChange={e => setNewLeaderId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select user...</option>
              {users
                .filter(u =>
                  u.role !== 'admin' &&
                  !selectedTeam.leaders.some(l => l._id === u._id)
                )
                .map(u => (
                  <option key={u._id} value={u._id}>
                    {u.name} ({u.email})
                  </option>
                ))}
            </select>
            <div className="flex gap-3 mt-4 justify-end">
              <button
                onClick={() => { setShowLeaderModal(false); setNewLeaderId('') }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleAddLeader}
                disabled={actionLoading['addLeader'] || !newLeaderId}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50"
              >
                {actionLoading['addLeader'] ? 'Adding...' : 'Add Leader'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

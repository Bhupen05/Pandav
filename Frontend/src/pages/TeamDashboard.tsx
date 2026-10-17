import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { authAPI } from '../api/authAPI'
import { taskAPI } from '../api/taskAPI'
import { teamAPI } from '../api/teamAPI'
import { editedLabel } from '../utils/taskProgress'
import type { TaskInput } from '../components/Tasksadd'

type TeamMember = {
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
  leaders: TeamMember[]
  members: TeamMember[]
  // false: an admin froze the team; it can be looked at but not changed
  isActive?: boolean
}

type Task = {
  _id: string
  title: string
  description?: string
  status: string
  priority: string
  assignedTo: Array<{ _id: string; name: string; email: string }>
  startDate?: string
  dueDate?: string
  editedBy?: { _id: string; name: string }
  editedAt?: string
  completionRequestedBy?: { _id: string; name: string }
  completionRequestedAt?: string
  rejectionReason?: string
}

type Attendance = {
  _id: string
  user: { _id: string; name: string; email: string; profileImage?: string }
  date: string
  status: string
  checkInTime?: string
  checkOutTime?: string
  workHours?: number
  remarks?: string
}

type Invite = {
  _id: string
  team: { _id: string; name: string; description?: string }
  invitedBy: { _id: string; name: string; email: string; profileImage?: string }
  status: string
  createdAt: string
}

const overviewCardTone: Record<'blue' | 'indigo' | 'purple' | 'yellow', string> = {
  blue: 'text-blue-600',
  indigo: 'text-indigo-600',
  purple: 'text-purple-600',
  yellow: 'text-yellow-600',
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { data?: { message?: string } } }).response?.data?.message === 'string'
  ) {
    return (error as { response?: { data?: { message?: string } } }).response?.data?.message as string
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

export default function TeamDashboard() {
  const navigate = useNavigate()
  const { user, isAuthenticated, updateUser } = useAuth()

  const [team, setTeam] = useState<Team | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [pendingTasks, setPendingTasks] = useState<Task[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [pendingAttendance, setPendingAttendance] = useState<Attendance[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'attendance' | 'members' | 'invite'>('overview')
  const [showCreateTask, setShowCreateTask] = useState(false)
  // Set while the task modal edits an existing task instead of creating one
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteIdentifier, setInviteIdentifier] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectingTaskId, setRejectingTaskId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [newTask, setNewTask] = useState({
    title: '', description: '', assignedTo: [] as string[], priority: 'medium',
    startDate: '', dueDate: '',
  })
  const [newTeam, setNewTeam] = useState({
    name: '', description: '',
  })

  const isLeader = user?.role === 'team_leader' || user?.role === 'admin'
  // Anyone outside a team can create one here (and becomes its leader) or
  // accept an invite; team members have their own page
  const canUsePage = isLeader || user?.role === 'user'
  const frozen = team?.isActive === false
  // Leaders act on their team only while it isn't frozen
  const canAct = isLeader && !frozen

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      console.log('[TeamDashboard] Fetching team data for user:', user?.email, 'role:', user?.role)
      const teamRes = await teamAPI.getMyTeam()
      console.log('[TeamDashboard] Team data received:', teamRes.data)
      const t: Team = teamRes.data
      setTeam(t)

      // Secondary fetches are non-fatal — show the dashboard even if they fail.
      // A frozen team has no review queues: its waiting work goes to an admin.
      const isFrozen = t.isActive === false
      try {
        const [tasksRes, pendingTasksRes, pendingAttRes, invitesRes, attRes] = await Promise.all([
          teamAPI.getTeamTasks(t._id),
          isFrozen ? { data: [] } : teamAPI.getTeamPendingApprovalTasks(t._id),
          isFrozen ? { data: [] } : teamAPI.getTeamPendingAttendance(t._id),
          teamAPI.getMyInvites(),
          teamAPI.getTeamAttendance(t._id),
        ])
        setTasks(tasksRes.data)
        setPendingTasks(pendingTasksRes.data)
        setPendingAttendance(pendingAttRes.data)
        setInvites(invitesRes.data)
        setAttendance(attRes.data)
      } catch {
        // Partial failure — team is loaded, secondary data unavailable
      }
    } catch (err: unknown) {
      const status =
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: { status?: number } }).response?.status === 'number'
          ? (err as { response?: { status?: number } }).response?.status
          : undefined
      const message = getErrorMessage(err, 'Failed to load team data')
      
      console.error('[TeamDashboard] Error fetching team data:', { status, message, error: err })
      
      if (status === 404) {
        console.log('[TeamDashboard] 404 - No team found, showing create screen')
        setTeam(null)
        setTasks([])
        setPendingTasks([])
        setAttendance([])
        setPendingAttendance([])
        setError(null)
        // Someone without a team may have been invited to one
        teamAPI.getMyInvites().then((res) => setInvites(res.data || [])).catch(() => setInvites([]))
      } else {
        const errorMsg =
          message ||
          (message === 'Network Error'
            ? 'Could not connect to the server. Please check that the backend is running.'
            : 'Failed to load team data')
        console.error('[TeamDashboard] Setting error:', errorMsg)
        setError(errorMsg)
      }
    } finally {
      setIsLoading(false)
    }
  }, [user?.email, user?.role])

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login'); return }
    if (user?.role === 'team_member') { navigate('/team-member'); return }
    if (!canUsePage) { navigate('/dashboard'); return }
    void fetchData()
  }, [fetchData, isAuthenticated, canUsePage, user?.role, navigate])

  // Creating a team or joining one changes the user's role on the server
  const refreshUser = async () => {
    try {
      updateUser(await authAPI.getMe())
    } catch {
      // The next page load picks the new role up
    }
  }

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionLoading(p => ({ ...p, createTeam: true }))
    try {
      await teamAPI.createTeam({
        name: newTeam.name.trim(),
        description: newTeam.description.trim(),
      })
      setShowCreateTeam(false)
      setNewTeam({ name: '', description: '' })
      await refreshUser()
      await fetchData()
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to create team'))
    } finally {
      setActionLoading(p => ({ ...p, createTeam: false }))
    }
  }

  const handleApproveTask = async (taskId: string) => {
    if (!team) return
    setActionLoading(p => ({ ...p, [taskId]: true }))
    try {
      await teamAPI.approveTeamTask(team._id, taskId)
      await fetchData()
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to approve task'))
    } finally {
      setActionLoading(p => ({ ...p, [taskId]: false }))
    }
  }

  const openRejectModal = (taskId: string) => {
    setRejectingTaskId(taskId)
    setRejectionReason('')
    setShowRejectModal(true)
  }

  const handleRejectTask = async () => {
    if (!team || !rejectingTaskId) return
    setActionLoading(p => ({ ...p, [rejectingTaskId]: true }))
    try {
      await teamAPI.rejectTeamTask(team._id, rejectingTaskId, { rejectionReason })
      setShowRejectModal(false)
      await fetchData()
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to reject task'))
    } finally {
      setActionLoading(p => ({ ...p, [rejectingTaskId]: false }))
    }
  }

  const handleApproveAttendance = async (attendanceId: string) => {
    if (!team) return
    setActionLoading(p => ({ ...p, [attendanceId]: true }))
    try {
      await teamAPI.approveTeamAttendance(team._id, attendanceId)
      await fetchData()
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to approve attendance'))
    } finally {
      setActionLoading(p => ({ ...p, [attendanceId]: false }))
    }
  }

  const handleDisapproveAttendance = async (attendanceId: string) => {
    if (!team) return
    setActionLoading(p => ({ ...p, [attendanceId]: true }))
    try {
      await teamAPI.disapproveTeamAttendance(team._id, attendanceId)
      await fetchData()
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to disapprove attendance'))
    } finally {
      setActionLoading(p => ({ ...p, [attendanceId]: false }))
    }
  }

  const handleInviteMember = async () => {
    if (!team || !inviteIdentifier.trim()) return
    setActionLoading(p => ({ ...p, invite: true }))
    try {
      await teamAPI.inviteMember(team._id, inviteIdentifier.trim())
      setInviteIdentifier('')
      setShowInviteModal(false)
      alert('Invite sent successfully!')
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to send invite'))
    } finally {
      setActionLoading(p => ({ ...p, invite: false }))
    }
  }

  const handleRemoveMember = async (userId: string, memberName: string) => {
    if (!team) return
    if (!confirm(`Remove ${memberName} from the team?`)) return
    setActionLoading(p => ({ ...p, [userId]: true }))
    try {
      await teamAPI.removeMember(team._id, userId)
      await fetchData()
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to remove member'))
    } finally {
      setActionLoading(p => ({ ...p, [userId]: false }))
    }
  }

  const closeTaskModal = () => {
    setShowCreateTask(false)
    setEditingTaskId(null)
    setNewTask({ title: '', description: '', assignedTo: [], priority: 'medium', startDate: '', dueDate: '' })
  }

  const openEditTask = (task: Task) => {
    setEditingTaskId(task._id)
    setNewTask({
      title: task.title,
      description: task.description || '',
      assignedTo: task.assignedTo.map(u => u._id),
      priority: task.priority,
      startDate: task.startDate?.slice(0, 10) || '',
      dueDate: task.dueDate?.slice(0, 10) || '',
    })
    setShowCreateTask(true)
  }

  // A leader manages tasks of the people they lead, never one they are on
  const canManageTask = (task: Task) => canAct && !task.assignedTo.some(u => u._id === user?._id)

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!team) return
    setActionLoading(p => ({ ...p, createTask: true }))
    try {
      if (editingTaskId) {
        await taskAPI.updateTask(editingTaskId, { ...newTask, priority: newTask.priority as TaskInput['priority'] })
      } else {
        await teamAPI.createTeamTask(team._id, { ...newTask, assignedTo: newTask.assignedTo })
      }
      closeTaskModal()
      await fetchData()
    } catch (err: unknown) {
      alert(getErrorMessage(err, editingTaskId ? 'Failed to save task' : 'Failed to create task'))
    } finally {
      setActionLoading(p => ({ ...p, createTask: false }))
    }
  }

  const handleDeleteTask = async (task: Task) => {
    if (!confirm(`Delete "${task.title}"? It will be removed for everyone.`)) return
    setActionLoading(p => ({ ...p, [`delete-${task._id}`]: true }))
    try {
      await taskAPI.deleteTask(task._id)
      await fetchData()
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to delete task'))
    } finally {
      setActionLoading(p => ({ ...p, [`delete-${task._id}`]: false }))
    }
  }

  const handleAcceptInvite = async (inviteId: string) => {
    setActionLoading(p => ({ ...p, [inviteId]: true }))
    try {
      await teamAPI.acceptInvite(inviteId)
      // Joining makes them a team member, whose page is /team-member
      await refreshUser()
      navigate('/team-member')
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to accept invite'))
    } finally {
      setActionLoading(p => ({ ...p, [inviteId]: false }))
    }
  }

  const handleDeclineInvite = async (inviteId: string) => {
    setActionLoading(p => ({ ...p, [inviteId]: true }))
    try {
      await teamAPI.declineInvite(inviteId)
      setInvites(prev => prev.filter(i => i._id !== inviteId))
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to decline invite'))
    } finally {
      setActionLoading(p => ({ ...p, [inviteId]: false }))
    }
  }

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      'in-progress': 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-gray-100 text-gray-600',
      'completion-requested': 'bg-purple-100 text-purple-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      requested: 'bg-yellow-100 text-yellow-800',
    }
    return map[status] || 'bg-gray-100 text-gray-600'
  }

  const priorityColor = (priority: string) => {
    const map: Record<string, string> = {
      low: 'bg-gray-100 text-gray-600',
      medium: 'bg-blue-100 text-blue-800',
      high: 'bg-orange-100 text-orange-800',
      urgent: 'bg-red-100 text-red-800',
    }
    return map[priority] || 'bg-gray-100 text-gray-600'
  }

  const allMembers = team ? [...team.leaders, ...team.members.filter(m => !team.leaders.some(l => l._id === m._id))] : []

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error && !team) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-4">
          <p className="text-red-500 text-lg font-medium mb-2">Failed to load team data</p>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <button
            onClick={() => fetchData()}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!team) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white border rounded-2xl shadow-sm p-8 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Your team</p>
            <h1 className="text-3xl font-bold text-gray-900 mt-3">Create your team</h1>
            <p className="text-gray-500 mt-3 max-w-xl mx-auto">
              You are not in a team yet. Create one and you will lead it: invite people, give them tasks,
              and approve their work and attendance from this page.
            </p>
            <button
              onClick={() => setShowCreateTeam(true)}
              className="mt-6 px-5 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700"
            >
              Create Team
            </button>
          </div>

          {invites.length > 0 && (
            <div className="mt-6 bg-white border rounded-2xl shadow-sm p-6">
              <h2 className="font-semibold text-gray-900">Or join a team you were invited to</h2>
              <div className="mt-4 space-y-3">
                {invites.map(invite => (
                  <div key={invite._id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{invite.team.name}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Invited by {invite.invitedBy.name} · {new Date(invite.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAcceptInvite(invite._id)}
                        disabled={actionLoading[invite._id]}
                        className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleDeclineInvite(invite._id)}
                        disabled={actionLoading[invite._id]}
                        className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {showCreateTeam && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">Create Team</h3>
              <form onSubmit={handleCreateTeam} className="space-y-4">
                <div>
                  <label htmlFor="team-name" className="text-sm font-medium text-gray-700">Team Name *</label>
                  <input id="team-name"
                    required
                    value={newTeam.name}
                    onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter team name"
                  />
                </div>
                <div>
                  <label htmlFor="team-description" className="text-sm font-medium text-gray-700">Description</label>
                  <textarea id="team-description"
                    rows={3}
                    value={newTeam.description}
                    onChange={e => setNewTeam(p => ({ ...p, description: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="What does this team handle?"
                  />
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowCreateTeam(false)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading.createTeam}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {actionLoading.createTeam ? 'Creating...' : 'Create Team'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {team?.name || 'Team Dashboard'}
              </h1>
              {team?.description && (
                <p className="text-sm text-gray-500 mt-0.5">{team.description}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {pendingTasks.length > 0 && (
                <span className="bg-purple-100 text-purple-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                  {pendingTasks.length} task{pendingTasks.length > 1 ? 's' : ''} awaiting approval
                </span>
              )}
              {pendingAttendance.length > 0 && (
                <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                  {pendingAttendance.length} attendance pending
                </span>
              )}
              {invites.length > 0 && (
                <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                  {invites.length} invite{invites.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {frozen && (
            <div role="status" className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <span className="font-semibold">This team is frozen.</span> An admin has paused it: you can look at its
              tasks, attendance and chat, but nothing can be added, changed or approved until an admin unfreezes it.
              Work waiting for approval goes to an admin.
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mt-4 border-b -mb-px">
            {(['overview', 'tasks', 'attendance', 'members', 'invite'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
                {tab === 'tasks' && pendingTasks.length > 0 && (
                  <span className="ml-1.5 bg-purple-500 text-white text-xs rounded-full px-1.5 py-0.5">
                    {pendingTasks.length}
                  </span>
                )}
                {tab === 'attendance' && pendingAttendance.length > 0 && (
                  <span className="ml-1.5 bg-yellow-500 text-white text-xs rounded-full px-1.5 py-0.5">
                    {pendingAttendance.length}
                  </span>
                )}
                {tab === 'invite' && invites.length > 0 && (
                  <span className="ml-1.5 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5">
                    {invites.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ── OVERVIEW ── */}
        {activeTab === 'overview' && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Team Members', value: allMembers.length, color: 'blue' },
                { label: 'Total Tasks', value: tasks.length, color: 'indigo' },
                { label: 'Pending Approvals', value: pendingTasks.length, color: 'purple' },
                { label: 'Pending Attendance', value: pendingAttendance.length, color: 'yellow' },
              ].map(card => (
                <div key={card.label} className="bg-white rounded-xl shadow-sm p-4 border">
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className={`mt-1 text-3xl font-bold ${overviewCardTone[card.color as keyof typeof overviewCardTone]}`}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* Pending task approvals */}
            {canAct && pendingTasks.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
                <h2 className="font-semibold text-gray-800 mb-3">Tasks Awaiting Your Approval</h2>
                <div className="space-y-3">
                  {pendingTasks.map(task => (
                    <div key={task._id} className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{task.title}</p>
                        <p className="text-xs text-gray-500">
                          Requested by {task.completionRequestedBy?.name || 'unknown'} ·{' '}
                          {task.completionRequestedAt ? new Date(task.completionRequestedAt).toLocaleDateString() : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproveTask(task._id)}
                          disabled={actionLoading[task._id]}
                          className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                          {actionLoading[task._id] ? '...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => openRejectModal(task._id)}
                          className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending attendance */}
            {canAct && pendingAttendance.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <h2 className="font-semibold text-gray-800 mb-3">Attendance Requests</h2>
                <div className="space-y-3">
                  {pendingAttendance.map(a => (
                    <div key={a._id} className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{a.user.name}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(a.date).toLocaleDateString()} ·{' '}
                          {a.checkInTime ? `In: ${new Date(a.checkInTime).toLocaleTimeString()}` : ''}{' '}
                          {a.checkOutTime ? `Out: ${new Date(a.checkOutTime).toLocaleTimeString()}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproveAttendance(a._id)}
                          disabled={actionLoading[a._id]}
                          className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                          {actionLoading[a._id] ? '...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => handleDisapproveAttendance(a._id)}
                          disabled={actionLoading[a._id]}
                          className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TASKS ── */}
        {activeTab === 'tasks' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Team Tasks</h2>
              {canAct && (
                <button
                  onClick={() => setShowCreateTask(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                >
                  + Create Task
                </button>
              )}
            </div>

            {tasks.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border">
                <p className="text-gray-500">{canAct ? 'No team tasks yet. Create the first one!' : 'No team tasks yet.'}</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 text-gray-600 font-medium">Title</th>
                      <th className="text-left px-4 py-3 text-gray-600 font-medium">Assigned To</th>
                      <th className="text-left px-4 py-3 text-gray-600 font-medium">Priority</th>
                      <th className="text-left px-4 py-3 text-gray-600 font-medium">Status</th>
                      <th className="text-left px-4 py-3 text-gray-600 font-medium">Due</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {tasks.map(task => (
                      <tr key={task._id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{task.title}</p>
                          {editedLabel(task) && <p className="text-xs text-gray-400 mt-0.5">{editedLabel(task)}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {task.assignedTo?.map(u => (typeof u === 'string' ? u : u.name)).join(', ')}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityColor(task.priority)}`}>
                            {task.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(task.status)}`}>
                            {task.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                          {canManageTask(task) && (
                            <>
                              <button
                                onClick={() => openEditTask(task)}
                                className="px-2 py-1 border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteTask(task)}
                                disabled={actionLoading[`delete-${task._id}`]}
                                className="px-2 py-1 border border-red-300 text-red-600 text-xs rounded hover:bg-red-50 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {canAct && task.status === 'completion-requested' && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleApproveTask(task._id)}
                                disabled={actionLoading[task._id]}
                                className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => openRejectModal(task._id)}
                                className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── ATTENDANCE ── */}
        {activeTab === 'attendance' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Team Attendance</h2>

            {canAct && pendingAttendance.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-yellow-800 mb-2">Pending Requests</h3>
                <div className="space-y-2">
                  {pendingAttendance.map(a => (
                    <div key={a._id} className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{a.user.name}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(a.date).toLocaleDateString()} ·{' '}
                          {a.checkInTime ? `In: ${new Date(a.checkInTime).toLocaleTimeString()}` : ''}{' '}
                          {a.checkOutTime ? `Out: ${new Date(a.checkOutTime).toLocaleTimeString()}` : ''}
                          {a.remarks ? ` · "${a.remarks}"` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproveAttendance(a._id)}
                          disabled={actionLoading[a._id]}
                          className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleDisapproveAttendance(a._id)}
                          disabled={actionLoading[a._id]}
                          className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Member</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Check In</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Check Out</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Hours</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {attendance.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-gray-500">No attendance records found</td>
                    </tr>
                  ) : (
                    attendance.map(a => (
                      <tr key={a._id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{a.user.name}</td>
                        <td className="px-4 py-3 text-gray-600">{new Date(a.date).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {a.checkInTime ? new Date(a.checkInTime).toLocaleTimeString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {a.checkOutTime ? new Date(a.checkOutTime).toLocaleTimeString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{a.workHours ?? '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(a.status)}`}>
                            {a.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── MEMBERS ── */}
        {activeTab === 'members' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Team Members ({allMembers.length})</h2>
              {canAct && (
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                >
                  + Invite Member
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allMembers.map(member => {
                const isLeaderMember = team?.leaders.some(l => l._id === member._id)
                return (
                  <div key={member._id} className="bg-white rounded-xl border shadow-sm p-4 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-lg shrink-0">
                      {member.profileImage
                        ? <img src={member.profileImage} className="w-10 h-10 rounded-full object-cover" alt="" />
                        : member.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{member.name}</p>
                        {isLeaderMember && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                            Leader
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{member.email}</p>
                      {member.department && (
                        <p className="text-xs text-gray-400">{member.department}</p>
                      )}
                    </div>
                    {canAct && !isLeaderMember && member._id !== user?._id && (
                      <button
                        onClick={() => handleRemoveMember(member._id, member.name)}
                        disabled={actionLoading[member._id]}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 shrink-0"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── INVITE ── */}
        {activeTab === 'invite' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Your Pending Invites</h2>
            {invites.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border">
                <p className="text-gray-500">No pending invites.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {invites.map(invite => (
                  <div key={invite._id} className="bg-white border rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{invite.team.name}</p>
                      {invite.team.description && (
                        <p className="text-sm text-gray-500">{invite.team.description}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        Invited by {invite.invitedBy.name} · {new Date(invite.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAcceptInvite(invite._id)}
                        disabled={actionLoading[invite._id]}
                        className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleDeclineInvite(invite._id)}
                        disabled={actionLoading[invite._id]}
                        className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Reject Task Modal ── */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-3">Reject Task Completion</h3>
            <textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="Reason for rejection..."
              rows={3}
              className="w-full border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-3 mt-4 justify-end">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectTask}
                disabled={actionLoading[rejectingTaskId!]}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading[rejectingTaskId!] ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Member Modal ── */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-3">Invite Member</h3>
            <p className="text-sm text-gray-500 mb-3">Enter the username or user id to invite. This avoids showing a global user list to team leaders.</p>
            <input
              type="text"
              value={inviteIdentifier}
              onChange={e => setInviteIdentifier(e.target.value)}
              placeholder="Username or user id"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowInviteModal(false)
                  setInviteIdentifier('')
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleInviteMember}
                disabled={actionLoading['invite'] || !inviteIdentifier.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading['invite'] ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Task Modal ── */}
      {showCreateTask && team && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg my-4">
            <h3 className="text-lg font-semibold mb-4">{editingTaskId ? 'Edit Task' : 'Create Team Task'}</h3>
            {editingTaskId && (
              <p className="text-xs text-gray-500 -mt-2 mb-4">Saving a change marks the task as edited by you, with the time.</p>
            )}
            <form onSubmit={handleCreateTask} className="space-y-3">
              <div>
                <label htmlFor="task-title" className="text-sm font-medium text-gray-700">Title *</label>
                <input id="task-title"
                  required
                  value={newTask.title}
                  onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="task-description" className="text-sm font-medium text-gray-700">Description *</label>
                <textarea id="task-description"
                  required
                  rows={3}
                  value={newTask.description}
                  onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="task-assignees" className="text-sm font-medium text-gray-700">Assign To (select members) *</label>
                <select id="task-assignees"
                  multiple
                  value={newTask.assignedTo}
                  onChange={e => {
                    const selected = Array.from(e.target.selectedOptions, o => o.value)
                    setNewTask(p => ({ ...p, assignedTo: selected }))
                  }}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {allMembers.map(m => (
                    <option key={m._id} value={m._id}>{m.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Hold Ctrl/Cmd to select multiple</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="task-priority" className="text-sm font-medium text-gray-700">Priority</label>
                  <select id="task-priority"
                    value={newTask.priority}
                    onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {['low', 'medium', 'high', 'urgent'].map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="task-start" className="text-sm font-medium text-gray-700">Start Date *</label>
                  <input id="task-start"
                    required
                    type="date"
                    value={newTask.startDate}
                    onChange={e => setNewTask(p => ({ ...p, startDate: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="task-due" className="text-sm font-medium text-gray-700">Due Date *</label>
                  <input id="task-due"
                    required
                    type="date"
                    value={newTask.dueDate}
                    onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={closeTaskModal}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading['createTask']}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading['createTask']
                    ? (editingTaskId ? 'Saving...' : 'Creating...')
                    : (editingTaskId ? 'Save Changes' : 'Create Task')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

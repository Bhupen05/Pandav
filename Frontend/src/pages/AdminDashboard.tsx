import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { taskAPI } from '../api/taskAPI'
import { attendanceAPI } from '../api/attendanceAPI'
import { userAPI } from '../api/userAPI'
import { useAuth } from '../context/AuthContext'
import Tasksadd from '../components/Tasksadd'

type DashboardTask = {
  _id: string
  title: string
  description?: string
  assignedTo?: Array<string | { _id: string; name: string; email?: string }>
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled' | 'completion-requested' | 'rejected'
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  startDate?: string
  dueDate?: string
  completedAt?: string
  updatedAt?: string
  completionRequestedBy?: { _id: string; name: string }
  completionRequestedAt?: string
}

type AttendanceRecord = {
  _id: string
  user: { _id: string; name: string }
  date: string
  checkIn?: string
  checkOut?: string
  totalHours?: number
  status: 'requested' | 'approved' | 'rejected'
}

type DashboardUser = {
  _id: string
  name: string
  email: string
  role: string
  isActive: boolean
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const { isAdmin, isAuthenticated, user } = useAuth()

  const [tasks, setTasks] = useState<DashboardTask[]>([])
  const [pendingApprovalTasks, setPendingApprovalTasks] = useState<DashboardTask[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [attendanceRequests, setAttendanceRequests] = useState<AttendanceRecord[]>([])
  const [users, setUsers] = useState<DashboardUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [processedAttendance, setProcessedAttendance] = useState<Record<string, boolean>>({})
  const [processedTasks, setProcessedTasks] = useState<Record<string, boolean>>({})
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'attendance' | 'users'>('overview')
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [rejectingTaskId, setRejectingTaskId] = useState<string | null>(null)
  const [isRejectSubmitting, setIsRejectSubmitting] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login')
    } else if (!isAdmin) {
      navigate('/')
    }
  }, [isAuthenticated, isAdmin, navigate])

  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      fetchAllData()
    }
  }, [isAuthenticated, isAdmin])

  const fetchAllData = async () => {
    setIsLoading(true)
    try {
      const [taskRes, pendingTaskRes, attendanceRes, userRes] = await Promise.all([
        taskAPI.getTasks(),
        taskAPI.getPendingApprovalTasks(),
        attendanceAPI.getAttendance(),
        userAPI.getUsers(),
      ])
      setTasks(Array.isArray(taskRes?.data) ? taskRes.data : [])
      setPendingApprovalTasks(Array.isArray(pendingTaskRes?.data) ? pendingTaskRes.data : [])
      const allAttendance = Array.isArray(attendanceRes?.data) ? attendanceRes.data : []
      setAttendanceRecords(allAttendance)
      const requested = allAttendance.filter((item: AttendanceRecord) => item.status === 'requested')
      setAttendanceRequests(requested)
      setUsers(Array.isArray(userRes?.data) ? userRes.data : [])
    } catch (error) {
      console.error('Failed to load dashboard data', error)
    } finally {
      setIsLoading(false)
    }
  }

  const resolveAssigneeName = (task: DashboardTask) => {
    if (!task.assignedTo || !Array.isArray(task.assignedTo) || task.assignedTo.length === 0) return 'Unassigned'
    return task.assignedTo.map(assignee => {
      if (typeof assignee === 'string') {
        return users.find((u) => u._id === assignee)?.name || 'Unknown'
      }
      return assignee.name
    }).join(', ')
  }

  const handleApproveTaskCompletion = async (taskId: string) => {
    try {
      await taskAPI.approveCompletion(taskId)
      setProcessedTasks((prev) => ({ ...prev, [taskId]: true }))
      setPendingApprovalTasks((prev) => prev.filter((task) => task._id !== taskId))
      await fetchAllData()
    } catch (error) {
      console.error('Failed to approve task completion', error)
    }
  }

  const handleRejectTaskCompletion = async (taskId: string) => {
    // Open modal instead of directly rejecting
    setRejectingTaskId(taskId)
    setRejectionReason('')
    setShowRejectModal(true)
  }

  // NEW: Add this function to handle rejection with reason
  const handleRejectTaskWithReason = async () => {
    if (!rejectingTaskId) return

    setIsRejectSubmitting(true)
    try {
      await taskAPI.rejectCompletion(rejectingTaskId, {
        rejectionReason: rejectionReason.trim() || 'Task completion rejected by admin'
      })
      setProcessedTasks((prev) => ({ ...prev, [rejectingTaskId]: true }))
      setPendingApprovalTasks((prev) => prev.filter((task) => task._id !== rejectingTaskId))
      setShowRejectModal(false)
      setRejectionReason('')
      setRejectingTaskId(null)
      await fetchAllData()
    } catch (error) {
      console.error('Failed to reject task completion', error)
      alert('Failed to reject task')
    } finally {
      setIsRejectSubmitting(false)
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return
    try {
      await taskAPI.deleteTask(taskId)
      setTasks((prev) => prev.filter((task) => task._id !== taskId))
    } catch (error) {
      console.error('Failed to delete task', error)
    }
  }

  const handleAttendanceDecision = async (requestId: string, decision: 'approved' | 'rejected') => {
    try {
      await attendanceAPI.updateAttendance(requestId, { status: decision })
      setProcessedAttendance((prev) => ({ ...prev, [requestId]: true }))
      setAttendanceRequests((prev) => prev.filter((item) => item._id !== requestId))
    } catch (error) {
      console.error('Failed to update attendance request', error)
    }
  }

  const handleToggleUser = async (targetUser: DashboardUser) => {
    try {
      await userAPI.updateUser(targetUser._id, { isActive: !targetUser.isActive } as Partial<DashboardUser>)
      setUsers((prev) =>
        prev.map((item) => (item._id === targetUser._id ? { ...item, isActive: !item.isActive } : item)),
      )
    } catch (error) {
      console.error('Failed to toggle user status', error)
    }
  }

  // Calculate enhanced stats
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const totalTasks = tasks.length
  const pendingTasks = tasks.filter((task) => task.status === 'pending').length
  const inProgressTasks = tasks.filter((task) => task.status === 'in-progress').length
  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  // Tasks completed this week/month
  const tasksCompletedThisWeek = tasks.filter((task) => {
    if (task.status !== 'completed') return false
    const completedDate = new Date(task.completedAt || task.updatedAt || '')
    return completedDate >= startOfWeek
  }).length

  const tasksCompletedThisMonth = tasks.filter((task) => {
    if (task.status !== 'completed') return false
    const completedDate = new Date(task.completedAt || task.updatedAt || '')
    return completedDate >= startOfMonth
  }).length

  // Overdue tasks
  const overdueTasks = tasks.filter((task) => {
    if (task.status === 'completed' || task.status === 'cancelled') return false
    if (!task.dueDate) return false
    const dueDate = new Date(task.dueDate)
    dueDate.setHours(23, 59, 59, 999)
    return dueDate < today
  })

  // Today's check-ins
  const todayStr = today.toISOString().split('T')[0]
  const todaysCheckIns = attendanceRecords.filter((record) => {
    const recordDate = new Date(record.date).toISOString().split('T')[0]
    return recordDate === todayStr && record.checkIn
  })

  // Average work hours
  const approvedThisMonth = attendanceRecords.filter((record) => {
    const recordDate = new Date(record.date)
    return record.status === 'approved' && recordDate >= startOfMonth && record.totalHours
  })
  const avgWorkHours = approvedThisMonth.length > 0
    ? (approvedThisMonth.reduce((sum, r) => sum + (r.totalHours || 0), 0) / approvedThisMonth.length).toFixed(1)
    : '—'

  // Active vs inactive users
  const activeUsers = users.filter((u) => u.isActive).length
  const inactiveUsers = users.filter((u) => !u.isActive).length
  const teamMembers = users.filter((u) => u.role !== 'admin')

  const completionRequests = pendingApprovalTasks.length
  const pendingAttendance = attendanceRequests.length

  // Greeting based on time
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening'

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-600">
        Checking access...
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-600">
        Loading dashboard...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      {/* Header */}
      <header className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-neutral-900">
              {greeting}, {user?.name?.split(' ')[0] || 'Admin'} 👋
            </h1>
            <p className="text-neutral-500 mt-1">Here's what's happening with your team today</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchAllData()}
              className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition-all"
            >
              <span>🔄</span> Refresh
            </button>
            <button
              onClick={() => setShowTaskModal(true)}
              className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all"
            >
              <span>➕</span> New Task
            </button>
          </div>
        </div>
      </header>

      {/* Quick Stats Grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Total Tasks</p>
          <p className="mt-2 text-2xl font-semibold text-neutral-900">{totalTasks}</p>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Active Tasks</p>
          <p className="mt-2 text-2xl font-semibold text-amber-600">{pendingTasks + inProgressTasks}</p>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Completion Rate</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{completionRate}%</p>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Pending Approvals</p>
          <p className="mt-2 text-2xl font-semibold text-purple-600">{completionRequests}</p>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Active Users</p>
          <p className="mt-2 text-2xl font-semibold text-blue-600">{activeUsers}<span className="text-sm text-neutral-400">/{users.length}</span></p>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Avg Work Hours</p>
          <p className="mt-2 text-2xl font-semibold text-cyan-600">{avgWorkHours}h</p>
        </div>
      </section>

      {/* Quick Actions Panel */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <button
            onClick={() => setShowTaskModal(true)}
            className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4 hover:bg-neutral-50 transition-all"
          >
            <span className="text-2xl">➕</span>
            <span className="text-sm text-neutral-700">Create Task</span>
          </button>

          <Link
            to="/admin/attendance"
            className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4 hover:bg-neutral-50 transition-all"
          >
            <span className="text-2xl">📅</span>
            <span className="text-sm text-neutral-700">Team Attendance</span>
          </Link>

          <Link
            to="/admin/userview"
            className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4 hover:bg-neutral-50 transition-all"
          >
            <span className="text-2xl">👤</span>
            <span className="text-sm text-neutral-700">View User</span>
          </Link>

          <Link
            to="/tasks"
            className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4 hover:bg-neutral-50 transition-all"
          >
            <span className="text-2xl">📋</span>
            <span className="text-sm text-neutral-700">All Tasks</span>
          </Link>

          <button
            onClick={() => setActiveTab('attendance')}
            className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4 hover:bg-neutral-50 transition-all relative"
          >
            <span className="text-2xl">✓</span>
            <span className="text-sm text-neutral-700">Approvals</span>
            {pendingAttendance > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                {pendingAttendance}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4 hover:bg-neutral-50 transition-all"
          >
            <span className="text-2xl">👥</span>
            <span className="text-sm text-neutral-700">Manage Users</span>
          </button>
        </div>
      </section>

      {/* Navigation Tabs */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
        {['overview', 'tasks', 'attendance', 'users'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as typeof activeTab)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === tab
                ? 'bg-neutral-900 text-white'
                : 'bg-white border text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {tab === 'overview' && '📊 Overview'}
            {tab === 'tasks' && `📋 Tasks (${totalTasks})`}
            {tab === 'attendance' && `📅 Attendance ${pendingAttendance > 0 ? `(${pendingAttendance})` : ''}`}
            {tab === 'users' && `👥 Users (${users.length})`}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Overdue Tasks Alert */}
            {overdueTasks.length > 0 && (
              <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4">
                <h3 className="text-lg font-semibold text-red-800 mb-3">
                  ⚠️ Overdue Tasks ({overdueTasks.length})
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {overdueTasks.slice(0, 5).map((task) => (
                    <div key={task._id} className="flex items-center justify-between rounded-lg bg-white p-3 border">
                      <div>
                        <p className="font-medium text-neutral-900">{task.title}</p>
                        <p className="text-xs text-red-600">
                          Due: {new Date(task.dueDate!).toLocaleDateString()} • {resolveAssigneeName(task)}
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                        task.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                        task.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {task.priority || 'medium'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Task Completion Requests */}
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-lg font-semibold text-neutral-900 mb-3">
                🔔 Completion Requests
                {completionRequests > 0 && (
                  <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">{completionRequests}</span>
                )}
              </h3>
              {pendingApprovalTasks.length === 0 ? (
                <p className="text-neutral-500 text-sm py-4 text-center">No pending completion requests</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {pendingApprovalTasks.map((task) => {
                    const disabled = processedTasks[task._id]
                    return (
                      <div key={task._id} className="flex items-center justify-between rounded-lg bg-purple-50 p-3 border border-purple-100">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-neutral-900 truncate">{task.title}</p>
                          <p className="text-xs text-neutral-500">
                            By: {task.completionRequestedBy?.name || '—'} • {task.completionRequestedAt ? new Date(task.completionRequestedAt).toLocaleDateString() : ''}
                          </p>
                        </div>
                        <div className="flex gap-2 ml-3">
                          <button
                            disabled={disabled}
                            onClick={() => handleApproveTaskCompletion(task._id)}
                            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50 transition-all"
                          >
                            ✓
                          </button>
                          <button
                            disabled={disabled}
                            onClick={() => handleRejectTaskCompletion(task._id)}
                            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-all"
                          >
                            ✗
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Weekly Summary */}
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-lg font-semibold text-neutral-900 mb-4">
                📈 This Week's Summary
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-emerald-50 p-4 text-center border border-emerald-100">
                  <p className="text-3xl font-bold text-emerald-600">{tasksCompletedThisWeek}</p>
                  <p className="text-xs text-neutral-600 mt-1">Tasks Completed</p>
                </div>
                <div className="rounded-lg bg-blue-50 p-4 text-center border border-blue-100">
                  <p className="text-3xl font-bold text-blue-600">{todaysCheckIns.length}</p>
                  <p className="text-xs text-neutral-600 mt-1">Today's Check-ins</p>
                </div>
                <div className="rounded-lg bg-purple-50 p-4 text-center border border-purple-100">
                  <p className="text-3xl font-bold text-purple-600">{tasksCompletedThisMonth}</p>
                  <p className="text-xs text-neutral-600 mt-1">Monthly Completed</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Today's Check-ins */}
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-lg font-semibold text-neutral-900 mb-3">
                🕐 Today's Check-ins
                <span className="text-sm font-normal text-neutral-500 ml-2">({todaysCheckIns.length}/{teamMembers.length})</span>
              </h3>
              {todaysCheckIns.length === 0 ? (
                <p className="text-neutral-500 text-sm py-4 text-center">No check-ins yet today</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {todaysCheckIns.map((record) => (
                    <div key={record._id} className="flex items-center gap-3 rounded-lg bg-neutral-50 p-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                        <span className="text-emerald-600">✓</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-neutral-900 truncate">{record.user.name}</p>
                        <p className="text-xs text-neutral-500">
                          {record.checkIn ? new Date(record.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                          {record.checkOut && ` - ${new Date(record.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Team Members */}
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-lg font-semibold text-neutral-900 mb-3">
                👥 Team Members
              </h3>
              <div className="space-y-2 max-h-48 [&::-webkit-scrollbar]:hidden overflow-y-auto">
                {teamMembers.length === 0 ? (
                  <p className="text-neutral-500 text-sm py-4 text-center">No team members</p>
                ) : (
                  teamMembers.map((member) => (
                    <div key={member._id} className="flex items-center gap-3 rounded-lg bg-neutral-50 p-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${member.isActive ? 'bg-emerald-100' : 'bg-red-100'}`}>
                        <span className={`text-sm font-medium ${member.isActive ? 'text-emerald-700' : 'text-red-700'}`}>{member.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-neutral-900 truncate">{member.name}</p>
                        <p className="text-xs text-neutral-500 truncate">{member.email}</p>
                      </div>
                      <span className={`h-2 w-2 rounded-full ${member.isActive ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Pending Attendance */}
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-lg font-semibold text-neutral-900 mb-3">
                📝 Attendance Requests
                {pendingAttendance > 0 && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{pendingAttendance}</span>
                )}
              </h3>
              {attendanceRequests.length === 0 ? (
                <p className="text-neutral-500 text-sm py-4 text-center">No pending requests</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {attendanceRequests.slice(0, 5).map((request) => {
                    const disabled = processedAttendance[request._id]
                    return (
                      <div key={request._id} className="flex items-center justify-between rounded-lg bg-amber-50 p-3 border border-amber-100">
                        <div>
                          <p className="font-medium text-neutral-900">{request.user.name}</p>
                          <p className="text-xs text-neutral-500">{new Date(request.date).toLocaleDateString()}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            disabled={disabled}
                            onClick={() => handleAttendanceDecision(request._id, 'approved')}
                            className="rounded-lg bg-emerald-500 px-2 py-1 text-xs text-white disabled:opacity-50 hover:bg-emerald-600"
                          >
                            ✓
                          </button>
                          <button
                            disabled={disabled}
                            onClick={() => handleAttendanceDecision(request._id, 'rejected')}
                            className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-600 disabled:opacity-50 hover:bg-red-50"
                          >
                            ✗
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div className="rounded-lg border bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-neutral-900">All Tasks</h3>
            <button
              onClick={() => setShowTaskModal(true)}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all"
            >
              + New Task
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
                <tr>
                  <th className="px-3 py-2">Task</th>
                  <th className="px-3 py-2">Assigned To</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Due Date</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-neutral-800">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-neutral-500">No tasks yet</td>
                  </tr>
                ) : (
                  tasks.map((task) => {
                    const isOverdue = task.dueDate && new Date(task.dueDate) < today && task.status !== 'completed' && task.status !== 'cancelled'
                    return (
                      <tr key={task._id} className={`${isOverdue ? 'bg-red-50' : 'hover:bg-neutral-50'}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-neutral-900">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-neutral-500 truncate max-w-xs">{task.description}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-neutral-700">{resolveAssigneeName(task)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            task.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                            task.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                            task.priority === 'medium' ? 'bg-blue-100 text-blue-800' :
                            'bg-neutral-100 text-neutral-700'
                          }`}>
                            {task.priority || 'medium'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            task.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                            task.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                            task.status === 'completion-requested' ? 'bg-purple-100 text-purple-800' :
                            task.status === 'cancelled' ? 'bg-neutral-200 text-neutral-700' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {task.status.replace('-', ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-neutral-700">
                          {task.dueDate ? (
                            <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                              {new Date(task.dueDate).toLocaleDateString()}
                              {isOverdue && ' ⚠️'}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right space-x-1">
                          {task.status === 'completion-requested' && (
                            <>
                              <button
                                onClick={() => handleApproveTaskCompletion(task._id)}
                                className="rounded border border-emerald-500 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleRejectTaskCompletion(task._id)}
                                className="rounded border border-red-500 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleDeleteTask(task._id)}
                            className="rounded border border-red-500 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Attendance Tab */}
      {activeTab === 'attendance' && (
        <div className="rounded-lg border bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-neutral-900">Attendance Requests</h3>
            <Link
              to="/admin/attendance"
              className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100 transition-all"
            >
              View Full Attendance →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-neutral-800">
                {attendanceRequests.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-neutral-500">No pending requests</td>
                  </tr>
                ) : (
                  attendanceRequests.map((request) => {
                    const disabled = processedAttendance[request._id]
                    return (
                      <tr key={request._id} className="hover:bg-neutral-50">
                        <td className="px-3 py-2">
                          <p className="font-medium text-neutral-900">{request.user.name}</p>
                        </td>
                        <td className="px-3 py-2 text-neutral-700">{new Date(request.date).toLocaleDateString()}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            {request.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right space-x-2">
                          <button
                            disabled={disabled}
                            onClick={() => handleAttendanceDecision(request._id, 'approved')}
                            className="rounded border border-emerald-500 bg-emerald-500 px-3 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            disabled={disabled}
                            onClick={() => handleAttendanceDecision(request._id, 'rejected')}
                            className="rounded border border-red-500 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="rounded-lg border bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-neutral-900">User Management</h3>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-emerald-600">● {activeUsers} Active</span>
              <span className="text-red-600">● {inactiveUsers} Inactive</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y text-neutral-800">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-neutral-500">No users found</td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u._id} className="hover:bg-neutral-50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-full ${u.isActive ? 'bg-emerald-100' : 'bg-red-100'}`}>
                            <span className={`text-sm font-medium ${u.isActive ? 'text-emerald-700' : 'text-red-700'}`}>{u.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <span className="font-medium text-neutral-900">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-neutral-700">{u.email}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {u.role || 'employee'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${u.isActive ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleToggleUser(u)}
                          className={`rounded border px-3 py-1 text-xs font-medium ${
                            u.isActive
                              ? 'border-red-300 text-red-600 hover:bg-red-50'
                              : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                          }`}
                        >
                          {u.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reject Task Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-neutral-900">Reject Task Completion</h3>
              <p className="mt-1 text-sm text-neutral-600">Provide a reason for rejecting this task completion request.</p>
            </div>

            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-neutral-700">Rejection Reason</label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g., Work quality needs improvement, Missing requirements, etc."
                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 resize-none"
                rows={4}
              />
              <p className="mt-1 text-xs text-neutral-500">
                {rejectionReason.length}/500 characters
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowRejectModal(false)}
                disabled={isRejectSubmitting}
                className="flex-1 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectTaskWithReason}
                disabled={isRejectSubmitting}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
              >
                {isRejectSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    Rejecting...
                  </>
                ) : (
                  'Reject Task'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Creation Modal */}
      <Tasksadd
        isOpen={showTaskModal}
        onClose={() => {
          setShowTaskModal(false)
          fetchAllData()
        }}
      />
    </div>
  )
}

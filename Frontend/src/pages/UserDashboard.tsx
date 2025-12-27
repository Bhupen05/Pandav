import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { taskAPI } from '../api/taskAPI'
import { attendanceAPI } from '../api/attendanceAPI'
import { useAuth } from '../context/AuthContext'

type Task = {
  _id: string
  title: string
  description?: string
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled' | 'completion-requested'
  startDate?: string
  dueDate?: string
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  assignedTo?: Array<string | { _id: string; name?: string; email?: string }>
  tags?: string[]
}

type AttendanceRecord = {
  _id: string
  date: string
  status: 'requested' | 'approved' | 'rejected'
  user?: { _id: string }
}

const priorityConfig = {
  urgent: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' },
  high: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  medium: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  low: { bg: 'bg-neutral-100', text: 'text-neutral-600', border: 'border-neutral-200' },
}

const statusConfig = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-700', icon: '⏳' },
  'in-progress': { bg: 'bg-blue-100', text: 'text-blue-700', icon: '🔄' },
  'completion-requested': { bg: 'bg-purple-100', text: 'text-purple-700', icon: '📤' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: '✅' },
  cancelled: { bg: 'bg-neutral-200', text: 'text-neutral-600', icon: '❌' },
}

export default function UserDashboard() {
  const navigate = useNavigate()
  const { isAuthenticated, user } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRequestingAttendance, setIsRequestingAttendance] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login')
      return
    }
    if (user?.role === 'admin') {
      navigate('/admin')
      return
    }
    setCheckingSession(false)
  }, [isAuthenticated, user?.role, navigate])

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [taskRes, attendanceRes] = await Promise.all([
        taskAPI.getTasks(),
        attendanceAPI.getAttendance(),
      ])

      // Backend already filters tasks for the current user if not admin
      const myTasks = Array.isArray(taskRes?.data) ? taskRes.data : []

      const myAttendance = Array.isArray(attendanceRes?.data)
        ? attendanceRes.data.filter(
            (record: AttendanceRecord) => record.user?._id === user?._id,
          )
        : []

      setTasks(myTasks)
      setAttendanceHistory(
        myAttendance.sort(
          (a: AttendanceRecord, b: AttendanceRecord) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
      )
    } catch (error) {
      console.error('Failed to load user dashboard', error)
    } finally {
      setIsLoading(false)
    }
  }, [user?._id])

  useEffect(() => {
    if (!checkingSession && isAuthenticated && user?._id) {
      loadData()
    }
  }, [checkingSession, isAuthenticated, user?._id, loadData])

  const pendingTasks = tasks.filter((task) => task.status === 'pending')
  const inProgressTasks = tasks.filter((task) => task.status === 'in-progress')
  const completedTasks = tasks.filter((task) => task.status === 'completed')
  const completionRequestedTasks = tasks.filter((task) => task.status === 'completion-requested')
  const todayKey = new Date().toISOString().split('T')[0]
  const todaysAttendance = attendanceHistory.find((entry) =>
    entry.date.startsWith(todayKey),
  )
  const todayStatus = todaysAttendance?.status ?? 'Not Requested'
  const hasRequestedToday = todayStatus !== 'Not Requested'
  
  // Calculate completion rate
  const completionRate = tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0
  
  // Get urgent/overdue tasks
  const overdueTasks = tasks.filter((task) => {
    if (!task.dueDate || task.status === 'completed' || task.status === 'cancelled') return false
    return new Date(task.dueDate) < new Date()
  })
  
  // Get upcoming tasks (due in next 3 days)
  const upcomingTasks = tasks.filter((task) => {
    if (!task.dueDate || task.status === 'completed' || task.status === 'cancelled') return false
    const dueDate = new Date(task.dueDate)
    const threeDaysFromNow = new Date()
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)
    return dueDate >= new Date() && dueDate <= threeDaysFromNow
  })

  // Get greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const handleCompleteTask = async (taskId: string) => {
    try {
      await taskAPI.requestCompletion(taskId)
      setTasks((prev) =>
        prev.map((task) =>
          task._id === taskId ? { ...task, status: 'completion-requested' } : task,
        ),
      )
    } catch (error) {
      console.error('Unable to request task completion', error)
    }
  }

  const handleStartTask = async (taskId: string) => {
    try {
      await taskAPI.updateTask(taskId, { status: 'in-progress' })
      setTasks((prev) =>
        prev.map((task) =>
          task._id === taskId ? { ...task, status: 'in-progress' } : task,
        ),
      )
    } catch (error) {
      console.error('Unable to start task', error)
    }
  }

  const handleRequestAttendance = async () => {
    if (hasRequestedToday) return
    setIsRequestingAttendance(true)
    try {
      await attendanceAPI.createAttendance({
        date: new Date().toISOString(),
        status: 'requested',
      })
      await loadData()
    } catch (error) {
      console.error('Unable to request attendance', error)
    } finally {
      setIsRequestingAttendance(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-600">
        Redirecting...
      </div>
    )
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-600">
        Checking session...
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

  const renderDashboard = (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="rounded-xl bg-linear-to-r from-emerald-600 to-teal-600 p-6 text-white">
        <h1 className="text-2xl font-bold">{getGreeting()}, {user?.name?.split(' ')[0] || 'User'}! 👋</h1>
        <p className="mt-1 text-emerald-100">Here's what's happening with your tasks today.</p>
        
        {/* Quick Stats in Header */}
        <div className="mt-4 flex flex-wrap gap-4">
          <div className="rounded-lg bg-white/20 px-4 py-2">
            <span className="text-sm opacity-90">Active Tasks</span>
            <span className="ml-2 text-lg font-bold">{pendingTasks.length + inProgressTasks.length}</span>
          </div>
          <div className="rounded-lg bg-white/20 px-4 py-2">
            <span className="text-sm opacity-90">Completion Rate</span>
            <span className="ml-2 text-lg font-bold">{completionRate}%</span>
          </div>
          <div className="rounded-lg bg-white/20 px-4 py-2">
            <span className="text-sm opacity-90">Today's Attendance</span>
            <span className="ml-2 text-lg font-bold capitalize">{todayStatus}</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Attendance Card */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-neutral-900">Today's Attendance</h3>
              <p className="mt-1 text-sm text-neutral-500">
                {hasRequestedToday 
                  ? `Status: ${todayStatus.charAt(0).toUpperCase() + todayStatus.slice(1)}`
                  : "Don't forget to mark your attendance"
                }
              </p>
            </div>
            <div className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl ${
              todayStatus === 'approved' ? 'bg-emerald-100' : 
              todayStatus === 'requested' ? 'bg-amber-100' : 
              todayStatus === 'rejected' ? 'bg-red-100' : 'bg-neutral-100'
            }`}>
              {todayStatus === 'approved' ? '✅' : 
               todayStatus === 'requested' ? '⏳' : 
               todayStatus === 'rejected' ? '❌' : '📅'}
            </div>
          </div>
          <button
            onClick={handleRequestAttendance}
            disabled={hasRequestedToday || isRequestingAttendance}
            className={`mt-4 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              hasRequestedToday 
                ? 'bg-neutral-100 text-neutral-500 cursor-not-allowed'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {hasRequestedToday ? 'Already Requested' : isRequestingAttendance ? 'Requesting...' : 'Request Attendance'}
          </button>
        </div>

        {/* Progress Card */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-neutral-900">Task Progress</h3>
          <div className="mt-4">
            <div className="mb-2 flex justify-between text-sm">
              <span className="text-neutral-600">Overall Progress</span>
              <span className="font-medium text-neutral-900">{completionRate}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-neutral-100">
              <div className="flex h-full">
                <div className="bg-emerald-500 transition-all" style={{ width: `${tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0}%` }}></div>
                <div className="bg-purple-500 transition-all" style={{ width: `${tasks.length > 0 ? (completionRequestedTasks.length / tasks.length) * 100 : 0}%` }}></div>
                <div className="bg-blue-500 transition-all" style={{ width: `${tasks.length > 0 ? (inProgressTasks.length / tasks.length) * 100 : 0}%` }}></div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500"></span> Completed ({completedTasks.length})</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500"></span> Awaiting ({completionRequestedTasks.length})</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500"></span> In Progress ({inProgressTasks.length})</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-xl">📋</div>
            <div>
              <p className="text-2xl font-bold text-neutral-900">{tasks.length}</p>
              <p className="text-xs text-neutral-500">Total Tasks</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-xl">⏳</div>
            <div>
              <p className="text-2xl font-bold text-amber-600">{pendingTasks.length}</p>
              <p className="text-xs text-neutral-500">Pending</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-xl">🔄</div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{inProgressTasks.length}</p>
              <p className="text-xs text-neutral-500">In Progress</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-xl">✅</div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{completedTasks.length}</p>
              <p className="text-xs text-neutral-500">Completed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts Section */}
      {(overdueTasks.length > 0 || upcomingTasks.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {overdueTasks.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-red-700">
                <span className="text-lg">⚠️</span>
                <h3 className="font-semibold">Overdue Tasks ({overdueTasks.length})</h3>
              </div>
              <ul className="mt-2 space-y-1">
                {overdueTasks.slice(0, 3).map(task => (
                  <li key={task._id} className="text-sm text-red-600">
                    • {task.title} (Due: {new Date(task.dueDate!).toLocaleDateString()})
                  </li>
                ))}
                {overdueTasks.length > 3 && (
                  <li className="text-sm text-red-500">+{overdueTasks.length - 3} more...</li>
                )}
              </ul>
            </div>
          )}
          {upcomingTasks.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-amber-700">
                <span className="text-lg">📌</span>
                <h3 className="font-semibold">Due Soon ({upcomingTasks.length})</h3>
              </div>
              <ul className="mt-2 space-y-1">
                {upcomingTasks.slice(0, 3).map(task => (
                  <li key={task._id} className="text-sm text-amber-600">
                    • {task.title} (Due: {new Date(task.dueDate!).toLocaleDateString()})
                  </li>
                ))}
                {upcomingTasks.length > 3 && (
                  <li className="text-sm text-amber-500">+{upcomingTasks.length - 3} more...</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Recent Tasks */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-neutral-900">Recent Tasks</h3>
          <button 
            onClick={() => setActiveTab('tasks')}
            className="text-sm text-emerald-600 hover:text-emerald-700"
          >
            View All →
          </button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-center text-sm text-neutral-500 py-8">No tasks assigned yet.</p>
        ) : (
          <div className="space-y-3">
            {tasks.slice(0, 5).map((task) => {
              const config = statusConfig[task.status] || statusConfig.pending
              const pConfig = priorityConfig[task.priority || 'medium']
              return (
                <div key={task._id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-neutral-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{config.icon}</span>
                    <div>
                      <p className="font-medium text-neutral-900">{task.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pConfig.bg} ${pConfig.text}`}>
                          {task.priority || 'medium'}
                        </span>
                        {task.dueDate && (
                          <span className="text-xs text-neutral-500">
                            Due: {new Date(task.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}>
                      {task.status.replace('-', ' ')}
                    </span>
                    {task.status === 'pending' && (
                      <button
                        onClick={() => handleStartTask(task._id)}
                        className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Start
                      </button>
                    )}
                    {task.status === 'in-progress' && (
                      <button
                        onClick={() => handleCompleteTask(task._id)}
                        className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        Complete
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Content */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        {renderDashboard}
      </div>
    </div>
  )
}
function setActiveTab(_arg0: string): void {
  throw new Error('Function not implemented.')
}


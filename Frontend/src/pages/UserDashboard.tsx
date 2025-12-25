import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { taskAPI } from '../api/taskAPI'
import { attendanceAPI } from '../api/attendanceAPI'
import { useAuth } from '../context/AuthContext'

type Task = {
  _id: string
  title: string
  description?: string
  status: 'pending' | 'completed'
  dueDate?: string
  assignedTo?: string | { _id: string }
}

type AttendanceRecord = {
  _id: string
  date: string
  status: 'requested' | 'approved' | 'rejected'
  user?: { _id: string }
}

type Tab = 'dashboard' | 'tasks' | 'attendance'

const navItems: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'tasks', label: 'My Tasks' },
  { key: 'attendance', label: 'Attendance' },
]

export default function UserDashboard() {
  const navigate = useNavigate()
  const { isAuthenticated, user } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
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

  useEffect(() => {
    if (!checkingSession && isAuthenticated && user?._id) {
      loadData()
    }
  }, [checkingSession, isAuthenticated, user?._id])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [taskRes, attendanceRes] = await Promise.all([
        taskAPI.getTasks(),
        attendanceAPI.getAttendance(),
      ])

      const myTasks = Array.isArray(taskRes?.data)
        ? taskRes.data.filter((task: Task) => {
            if (!task.assignedTo) return false
            return typeof task.assignedTo === 'string'
              ? task.assignedTo === user?._id
              : task.assignedTo._id === user?._id
          })
        : []

      const myAttendance = Array.isArray(attendanceRes?.data)
        ? attendanceRes.data.filter(
            (record: AttendanceRecord) => record.user?._id === user?._id,
          )
        : []

      setTasks(myTasks)
      setAttendanceHistory(
        myAttendance.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
      )
    } catch (error) {
      console.error('Failed to load user dashboard', error)
    } finally {
      setIsLoading(false)
    }
  }

  const pendingTasks = tasks.filter((task) => task.status !== 'completed')
  const todayKey = new Date().toISOString().split('T')[0]
  const todaysAttendance = attendanceHistory.find((entry) =>
    entry.date.startsWith(todayKey),
  )
  const todayStatus = todaysAttendance?.status ?? 'Not Requested'
  const hasRequestedToday = todayStatus !== 'Not Requested'

  const handleCompleteTask = async (taskId: string) => {
    try {
      await taskAPI.updateTask(taskId, { status: 'completed' })
      setTasks((prev) =>
        prev.map((task) =>
          task._id === taskId ? { ...task, status: 'completed' } : task,
        ),
      )
    } catch (error) {
      console.error('Unable to mark task complete', error)
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
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Pending Tasks</p>
          <p className="mt-2 text-2xl font-semibold text-neutral-900">
            {pendingTasks.length}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Today&apos;s Attendance</p>
          <p className="mt-2 text-xl font-semibold text-neutral-900">
            {todayStatus}
          </p>
        </div>
      </div>
      <p className="text-sm text-neutral-600">
        Welcome back, {user?.name?.split(' ')[0] || 'User'}.
      </p>
    </div>
  )

  const renderTasks = (
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
          <tr>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Due Date</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y text-neutral-800">
          {tasks.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-neutral-500">
                No tasks assigned yet.
              </td>
            </tr>
          ) : (
            tasks.map((task) => (
              <tr key={task._id}>
                <td className="px-3 py-2 font-medium">{task.title}</td>
                <td className="px-3 py-2 text-neutral-600">
                  {task.description || '—'}
                </td>
                <td className="px-3 py-2">
                  {task.dueDate
                    ? new Date(task.dueDate).toLocaleDateString()
                    : '—'}
                </td>
                <td className="px-3 py-2 capitalize">{task.status}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => handleCompleteTask(task._id)}
                    disabled={task.status === 'completed'}
                    className="rounded border px-3 py-1 text-xs text-neutral-700 disabled:opacity-50"
                  >
                    Mark Complete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )

  const renderAttendance = (
    <div className="space-y-4">
      <button
        onClick={handleRequestAttendance}
        disabled={hasRequestedToday || isRequestingAttendance}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {hasRequestedToday ? 'Already Requested Today' : isRequestingAttendance ? 'Requesting...' : 'Request Attendance'}
      </button>
      <div className="rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y text-neutral-800">
            {attendanceHistory.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-neutral-500">
                  No attendance records yet.
                </td>
              </tr>
            ) : (
              attendanceHistory.slice(0, 10).map((entry) => (
                <tr key={entry._id}>
                  <td className="px-3 py-2">
                    {new Date(entry.date).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 capitalize">{entry.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <nav className="mb-6 flex flex-wrap gap-2">
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setActiveTab(item.key)}
            className={`rounded border px-3 py-2 text-sm ${
              activeTab === item.key ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {activeTab === 'dashboard' && renderDashboard}
      {activeTab === 'tasks' && renderTasks}
      {activeTab === 'attendance' && renderAttendance}
    </div>
  )
}

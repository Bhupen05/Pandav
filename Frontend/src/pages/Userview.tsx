import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { taskAPI } from '../api/taskAPI'
import { attendanceAPI } from '../api/attendanceAPI'
import { userAPI } from '../api/userAPI'
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
  user: {
    _id: string
    name: string
    email: string
  }
  date: string
  status: 'present' | 'absent' | 'late' | 'half-day' | 'leave' | 'requested' | 'approved' | 'rejected'
  checkInTime?: string
  checkOutTime?: string
  workHours?: number
}

type User = {
  profileImage: string | undefined
  _id: string
  name: string
  email: string
  role: string
}

export default function Userview() {
  const navigate = useNavigate()
  const { isAdmin, isAuthenticated } = useAuth()
  
  const [users, setUsers] = useState<User[]>([])
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'attendance'>('overview')

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login')
    } else if (!isAdmin) {
      navigate('/')
    }
  }, [isAuthenticated, isAdmin, navigate])

  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      loadUsers()
    }
  }, [isAuthenticated, isAdmin])

  useEffect(() => {
    if (selectedUser) {
      loadUserData(selectedUser)
    }
  }, [selectedUser])

  const loadUsers = async () => {
    try {
      const response = await userAPI.getUsers()
      const nonAdminUsers = (response.data || []).filter((u: User) => u.role !== 'admin')
      setUsers(nonAdminUsers)
      if (nonAdminUsers.length > 0) {
        setSelectedUser(nonAdminUsers[0]._id)
      }
    } catch (error) {
      console.error('Failed to load users:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadUserData = async (userId: string) => {
    try {
      const [taskRes, attendanceRes] = await Promise.all([
        taskAPI.getTasks({ assignedTo: userId }),
        attendanceAPI.getAttendance({ user: userId })
      ])
      setTasks(Array.isArray(taskRes?.data) ? taskRes.data : [])
      setAttendance(Array.isArray(attendanceRes?.data) ? attendanceRes.data : [])
    } catch (error) {
      console.error('Failed to load user data:', error)
    }
  }

  const selectedUserData = users.find(u => u._id === selectedUser)
  
  // Task stats
  const taskStats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    requested: tasks.filter(t => t.status === 'completion-requested').length,
  }

  // Attendance stats
  const attendanceStats = {
    total: attendance.length,
    present: attendance.filter(a => a.status === 'present' || a.status === 'approved').length,
    late: attendance.filter(a => a.status === 'late').length,
    absent: attendance.filter(a => a.status === 'absent').length,
    totalHours: attendance.reduce((sum, a) => sum + (a.workHours || 0), 0),
  }

  const formatDate = (date?: string) => {
    if (!date) return '—'
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatTime = (time?: string) => {
    if (!time) return '—'
    return new Date(time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800'
      case 'high': return 'bg-orange-100 text-orange-800'
      case 'medium': return 'bg-blue-100 text-blue-800'
      default: return 'bg-neutral-100 text-neutral-700'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
      case 'approved':
      case 'present':
        return 'bg-emerald-100 text-emerald-800'
      case 'in-progress':
        return 'bg-blue-100 text-blue-800'
      case 'completion-requested':
      case 'requested':
        return 'bg-purple-100 text-purple-800'
      case 'pending':
        return 'bg-amber-100 text-amber-800'
      case 'late':
        return 'bg-orange-100 text-orange-800'
      case 'absent':
      case 'rejected':
      case 'cancelled':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-neutral-100 text-neutral-700'
    }
  }

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900"></div>
          <p className="text-sm text-neutral-600">Checking access...</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900"></div>
          <p className="text-sm text-neutral-600">Loading user data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      {/* Header */}
      <div className="bg-linear-to-r from-blue-500 to-emerald-500 text-white">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold md:text-3xl">User View</h1>
                <p className="text-sm text-neutral-300">View any team member's dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm outline-none hover:bg-white/20 transition-colors"
              >
                {users.map(user => (
                  <option key={user._id} value={user._id} className="text-neutral-900">
                    {user.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => navigate('/admin')}
                className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm hover:bg-white/20 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* User Profile Card */}
        {selectedUserData && (
          <div className="mb-6 rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-xl font-bold text-neutral-700">
                {selectedUserData.profileImage ? (
                    <img 
                        src={selectedUserData.profileImage} 
                        alt={selectedUserData.name} 
                        className="h-16 w-16 rounded-full object-cover"
                    />
                ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-xl font-bold text-neutral-700">
                        {selectedUserData.name?.split(' ').map(n => n[0]).join('') || '?'}
                    </div>
                )}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-neutral-900">{selectedUserData.name}</h2>
                  <p className="text-sm text-neutral-500">{selectedUserData.email}</p>
                  <span className="mt-1 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium capitalize text-blue-800">
                    {selectedUserData.role}
                  </span>
                </div>
              </div>
              <div className="flex gap-6 text-center">
                <div>
                  <p className="text-2xl font-bold text-neutral-900">{taskStats.total}</p>
                  <p className="text-xs text-neutral-500">Total Tasks</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-600">{taskStats.completed}</p>
                  <p className="text-xs text-neutral-500">Completed</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-600">{attendanceStats.totalHours.toFixed(1)}</p>
                  <p className="text-xs text-neutral-500">Work Hours</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex gap-2 overflow-x-auto">
          {[
            { key: 'overview', label: '📊 Overview', icon: '' },
            { key: 'tasks', label: '📋 Tasks', icon: '' },
            { key: 'attendance', label: '🕐 Attendance', icon: '' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-neutral-900 text-white shadow-lg'
                  : 'bg-white text-neutral-600 border hover:bg-neutral-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Task Summary */}
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-neutral-900">
                <span>📋</span> Task Summary
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-amber-50 p-4 text-center">
                  <p className="text-2xl font-bold text-amber-600">{taskStats.pending}</p>
                  <p className="text-xs text-amber-700">Pending</p>
                </div>
                <div className="rounded-xl bg-blue-50 p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">{taskStats.inProgress}</p>
                  <p className="text-xs text-blue-700">In Progress</p>
                </div>
                <div className="rounded-xl bg-purple-50 p-4 text-center">
                  <p className="text-2xl font-bold text-purple-600">{taskStats.requested}</p>
                  <p className="text-xs text-purple-700">Awaiting Approval</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-4 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{taskStats.completed}</p>
                  <p className="text-xs text-emerald-700">Completed</p>
                </div>
              </div>
              {taskStats.total > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-neutral-600 mb-1">
                    <span>Progress</span>
                    <span>{Math.round((taskStats.completed / taskStats.total) * 100)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                    <div 
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${(taskStats.completed / taskStats.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Attendance Summary */}
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-neutral-900">
                <span>🕐</span> Attendance Summary
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-emerald-50 p-4 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{attendanceStats.present}</p>
                  <p className="text-xs text-emerald-700">Days Present</p>
                </div>
                <div className="rounded-xl bg-orange-50 p-4 text-center">
                  <p className="text-2xl font-bold text-orange-600">{attendanceStats.late}</p>
                  <p className="text-xs text-orange-700">Days Late</p>
                </div>
                <div className="rounded-xl bg-red-50 p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{attendanceStats.absent}</p>
                  <p className="text-xs text-red-700">Days Absent</p>
                </div>
                <div className="rounded-xl bg-blue-50 p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">{attendanceStats.totalHours.toFixed(1)}</p>
                  <p className="text-xs text-blue-700">Total Hours</p>
                </div>
              </div>
              {attendanceStats.total > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-neutral-600 mb-1">
                    <span>Attendance Rate</span>
                    <span>{Math.round((attendanceStats.present / attendanceStats.total) * 100)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                    <div 
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${(attendanceStats.present / attendanceStats.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Recent Tasks */}
            <div className="rounded-2xl border bg-white p-6 shadow-sm lg:col-span-2">
              <h3 className="mb-4 text-lg font-semibold text-neutral-900">Recent Tasks</h3>
              {tasks.length === 0 ? (
                <p className="text-center text-sm text-neutral-500 py-8">No tasks assigned</p>
              ) : (
                <div className="space-y-3">
                  {tasks.slice(0, 5).map(task => (
                    <div key={task._id} className="flex items-center justify-between rounded-xl border p-4 hover:bg-neutral-50 transition-colors">
                      <div>
                        <p className="font-medium text-neutral-900">{task.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${getStatusColor(task.status)}`}>
                            {task.status.replace('-', ' ')}
                          </span>
                          {task.priority && (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${getPriorityColor(task.priority)}`}>
                              {task.priority}
                            </span>
                          )}
                          {task.dueDate && (
                            <span className="text-xs text-neutral-500">Due: {formatDate(task.dueDate)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tasks Tab */}
        {activeTab === 'tasks' && (
          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div className="border-b bg-neutral-50 px-4 py-3">
              <h3 className="font-semibold text-neutral-900">All Tasks ({tasks.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase text-neutral-600">
                  <tr>
                    <th className="px-4 py-3">Task</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Start Date</th>
                    <th className="px-4 py-3">Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tasks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                        No tasks found for this user
                      </td>
                    </tr>
                  ) : (
                    tasks.map(task => (
                      <tr key={task._id} className="hover:bg-neutral-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-neutral-900">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-neutral-500 truncate max-w-75">{task.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${getStatusColor(task.status)}`}>
                            {task.status.replace('-', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${getPriorityColor(task.priority)}`}>
                            {task.priority || 'low'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-neutral-700">{formatDate(task.startDate)}</td>
                        <td className="px-4 py-3 text-neutral-700">{formatDate(task.dueDate)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Attendance Tab */}
        {activeTab === 'attendance' && (
          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div className="border-b bg-neutral-50 px-4 py-3">
              <h3 className="font-semibold text-neutral-900">Attendance History ({attendance.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase text-neutral-600">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Check In</th>
                    <th className="px-4 py-3">Check Out</th>
                    <th className="px-4 py-3">Work Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {attendance.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                        No attendance records found
                      </td>
                    </tr>
                  ) : (
                    attendance.map(record => (
                      <tr key={record._id} className="hover:bg-neutral-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-neutral-900">{formatDate(record.date)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${getStatusColor(record.status)}`}>
                            {record.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-neutral-700">{formatTime(record.checkInTime)}</td>
                        <td className="px-4 py-3 text-neutral-700">{formatTime(record.checkOutTime)}</td>
                        <td className="px-4 py-3">
                          {record.workHours ? (
                            <span className="font-medium text-neutral-900">{record.workHours.toFixed(2)} hrs</span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

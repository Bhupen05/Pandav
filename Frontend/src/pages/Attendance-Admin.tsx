import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { attendanceAPI } from '../api/attendanceAPI'
import { userAPI } from '../api/userAPI'
import { useAuth } from '../context/AuthContext'

type AttendanceRecord = {
  _id: string
  user: {
    _id: string
    name: string
    email: string
    profileImage?: string
  }
  date: string
  status: 'present' | 'absent' | 'late' | 'half-day' | 'leave' | 'requested' | 'approved' | 'rejected'
  checkInTime?: string
  checkOutTime?: string
  workHours?: number
  remarks?: string
}

type User = {
  _id: string
  name: string
  email: string
  role: string
  isActive: boolean
}

export default function AttendanceAdmin() {
  const navigate = useNavigate()
  const { isAdmin, isAuthenticated } = useAuth()
  
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [filterUser, setFilterUser] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' })

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login')
    } else if (!isAdmin) {
      navigate('/')
    }
  }, [isAuthenticated, isAdmin, navigate])

  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      loadData()
    }
  }, [isAuthenticated, isAdmin])

  const loadData = async () => {
    setLoading(true)
    try {
      const [attendanceRes, userRes] = await Promise.all([
        attendanceAPI.getAttendance(),
        userAPI.getUsers()
      ])
      setRecords(Array.isArray(attendanceRes?.data) ? attendanceRes.data : [])
      setUsers(Array.isArray(userRes?.data) ? userRes.data : [])
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (id: string) => {
    try {
      await attendanceAPI.updateAttendance(id, { status: 'approved' })
      setRecords(prev => prev.map(r => r._id === id ? { ...r, status: 'approved' as const } : r))
    } catch (error) {
      console.error('Failed to approve:', error)
    }
  }

  const handleReject = async (id: string) => {
    try {
      await attendanceAPI.updateAttendance(id, { status: 'rejected' })
      setRecords(prev => prev.map(r => r._id === id ? { ...r, status: 'rejected' as const } : r))
    } catch (error) {
      console.error('Failed to reject:', error)
    }
  }

  // Filter records
  const filteredRecords = records.filter(record => {
    if (filterUser !== 'all' && record.user?._id !== filterUser) return false
    if (filterStatus !== 'all' && record.status !== filterStatus) return false
    if (dateRange.start && new Date(record.date) < new Date(dateRange.start)) return false
    if (dateRange.end && new Date(record.date) > new Date(dateRange.end)) return false
    return true
  })

  // Group by user for summary
  const userSummary = users.filter(u => u.role !== 'admin').map(user => {
    const userRecords = records.filter(r => r.user?._id === user._id)
    const present = userRecords.filter(r => r.status === 'present' || r.status === 'approved').length
    const late = userRecords.filter(r => r.status === 'late').length
    const absent = userRecords.filter(r => r.status === 'absent').length
    const totalHours = userRecords.reduce((sum, r) => sum + (r.workHours || 0), 0)
    return { user, present, late, absent, totalHours, totalDays: userRecords.length }
  })

  // Stats
  const pendingRequests = records.filter(r => r.status === 'requested').length
  const todayRecords = records.filter(r => {
    const today = new Date().toISOString().split('T')[0]
    return r.date.split('T')[0] === today
  })
  const checkedInToday = todayRecords.filter(r => r.checkInTime).length

  const formatTime = (time?: string) => {
    if (!time) return '—'
    return new Date(time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'present':
      case 'approved':
        return 'bg-emerald-100 text-emerald-800'
      case 'absent':
      case 'rejected':
        return 'bg-red-100 text-red-800'
      case 'late':
        return 'bg-orange-100 text-orange-800'
      case 'half-day':
        return 'bg-amber-100 text-amber-800'
      case 'leave':
        return 'bg-blue-100 text-blue-800'
      case 'requested':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-neutral-100 text-neutral-800'
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
          <p className="text-sm text-neutral-600">Loading attendance data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      {/* Header */}
      <div className="bg-linear-to-r from-neutral-900 via-neutral-800 to-neutral-900 text-white">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold md:text-3xl">Attendance Management</h1>
                <p className="text-sm text-neutral-300">View and manage all team attendance</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/admin')}
              className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm hover:bg-white/20 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Stats Cards */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Checked In Today</p>
                <p className="text-xl font-bold text-neutral-900">{checkedInToday}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Pending Requests</p>
                <p className="text-xl font-bold text-purple-600">{pendingRequests}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Team Members</p>
                <p className="text-xl font-bold text-neutral-900">{users.filter(u => u.role !== 'admin').length}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Total Records</p>
                <p className="text-xl font-bold text-neutral-900">{records.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Pending Requests Section */}
        {pendingRequests > 0 && (
          <div className="mb-6 rounded-2xl border-2 border-purple-200 bg-purple-50 p-4">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-purple-900">
              <span>🔔</span> Pending Approval Requests
            </h2>
            <div className="space-y-2">
              {records.filter(r => r.status === 'requested').map(record => (
                <div key={record._id} className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 text-sm font-semibold text-purple-700">
                      {record.user?.name?.split(' ').map(n => n[0]).join('') || '?'}
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900">{record.user?.name || 'Unknown'}</p>
                      <p className="text-xs text-neutral-500">{formatDate(record.date)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(record._id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(record._id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User Summary Cards */}
        <div className="mb-6">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900">Team Overview</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {userSummary.map(({ user, present, late, absent, totalHours }) => (
              <div key={user._id} className="rounded-2xl border bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-700">
                    {user.name?.split(' ').map(n => n[0]).join('') || '?'}
                  </div>
                  <div>
                    <p className="font-semibold text-neutral-900">{user.name}</p>
                    <p className="text-xs text-neutral-500">{user.email}</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-50 p-2">
                    <p className="text-lg font-bold text-emerald-600">{present}</p>
                    <p className="text-xs text-emerald-700">Present</p>
                  </div>
                  <div className="rounded-lg bg-orange-50 p-2">
                    <p className="text-lg font-bold text-orange-600">{late}</p>
                    <p className="text-xs text-orange-700">Late</p>
                  </div>
                  <div className="rounded-lg bg-red-50 p-2">
                    <p className="text-lg font-bold text-red-600">{absent}</p>
                    <p className="text-xs text-red-700">Absent</p>
                  </div>
                  <div className="rounded-lg bg-blue-50 p-2">
                    <p className="text-lg font-bold text-blue-600">{totalHours.toFixed(1)}</p>
                    <p className="text-xs text-blue-700">Hours</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-600">Filter by User</label>
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
            >
              <option value="all">All Users</option>
              {users.filter(u => u.role !== 'admin').map(user => (
                <option key={user._id} value={user._id}>{user.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-600">Filter by Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
            >
              <option value="all">All Status</option>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
              <option value="half-day">Half Day</option>
              <option value="leave">Leave</option>
              <option value="requested">Requested</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-600">Start Date</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-600">End Date</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
            />
          </div>
          <button
            onClick={() => {
              setFilterUser('all')
              setFilterStatus('all')
              setDateRange({ start: '', end: '' })
            }}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
          >
            Clear Filters
          </button>
        </div>

        {/* Attendance Records Table */}
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="border-b bg-neutral-50 px-4 py-3">
            <h2 className="font-semibold text-neutral-900">Attendance Records</h2>
            <p className="text-xs text-neutral-500">Showing {filteredRecords.length} of {records.length} records</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase text-neutral-600">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Check In</th>
                  <th className="px-4 py-3">Check Out</th>
                  <th className="px-4 py-3">Work Hours</th>
                  <th className="px-4 py-3">Remarks</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
                      No attendance records found
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map(record => (
                    <tr key={record._id} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700">
                            {record.user?.name?.split(' ').map(n => n[0]).join('') || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-neutral-900">{record.user?.name || 'Unknown'}</p>
                            <p className="text-xs text-neutral-500">{record.user?.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{formatDate(record.date)}</td>
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
                      <td className="px-4 py-3 text-neutral-600 max-w-37.5 truncate">{record.remarks || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {record.status === 'requested' && (
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => handleApprove(record._id)}
                              className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleReject(record._id)}
                              className="rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

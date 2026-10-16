import { useState, useEffect } from 'react'
import { attendanceAPI, type AttendanceRecord, type AttendanceStatus } from '../api/attendanceAPI'
import { userAPI } from '../api/userAPI'
import { getErrorMessage } from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { todayKey } from '../utils/date'

const approvalBadge = {
  pending: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  rejected: 'bg-red-50 text-red-700 ring-1 ring-red-200',
}

function Attendance() {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [date, setDate] = useState('')
  const [status, setStatus] = useState<AttendanceStatus>('present')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | AttendanceRecord['status']>('all')
  const [employees, setEmployees] = useState<{ _id: string; name: string }[]>([])
  const [employeeId, setEmployeeId] = useState('')

  const { isAdmin } = useAuth()

  // Admins choose who a new record is for
  useEffect(() => {
    if (!isAdmin) return
    userAPI.getUsers({ isActive: true })
      .then((response) => setEmployees(Array.isArray(response.data) ? response.data : []))
      .catch((err) => console.error('Failed to load employees:', err))
  }, [isAdmin])

  useEffect(() => {
    loadAttendance()
    
    // Auto-refresh every 30 seconds
    const refreshInterval = setInterval(() => {
      loadAttendance(true)
    }, 30000)
    
    return () => clearInterval(refreshInterval)
  }, [])

  const loadAttendance = async (silent = false) => {
    try {
      const response = await attendanceAPI.getAttendance()
      if (response.success) {
        setRecords(response.data)
      }
    } catch (err) {
      if (!silent) {
        console.error('Failed to load attendance:', err)
      }
    }
  }

  const handleCheckIn = async () => {
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      const response = await attendanceAPI.checkIn()
      console.log('Check-in response:', response)
      if (response.success) {
        setSuccess('Checked in successfully! Your attendance is pending admin approval.')
        loadAttendance()
      } else {
        setError(response.message || 'Failed to check in')
      }
    } catch (err) {
      console.error('Check-in error:', err)
      setError(getErrorMessage(err, 'Failed to check in. You may have already checked in today.'))
    } finally {
      setLoading(false)
    }
  }
  
  const handleCheckOut = async () => {
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      const response = await attendanceAPI.checkOut()
      console.log('Check-out response:', response)
      if (response.success) {
        setSuccess('Checked out successfully! Your work hours have been recorded.')
        loadAttendance()
      } else {
        setError(response.message || 'Failed to check out')
      }
    } catch (err) {
      console.error('Check-out error:', err)
      setError(getErrorMessage(err, 'Failed to check out. Make sure you have checked in first.'))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!employeeId) {
      setError('Please choose an employee.')
      return
    }

    if (!date) {
      setError('Date is required.')
      return
    }

    setLoading(true)
    try {
      const response = await attendanceAPI.createAttendance({
        user: employeeId,
        date,
        status,
        remarks: remarks.trim() || undefined,
      })

      if (response.success) {
        setSuccess('Attendance record added successfully!')
        setEmployeeId('')
        setDate('')
        setStatus('present')
        setRemarks('')
        loadAttendance()
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add attendance record.'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this attendance record?')) return

    try {
      await attendanceAPI.deleteAttendance(id)
      loadAttendance()
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete attendance record.'))
    }
  }

  const filteredRecords = filterStatus === 'all'
    ? records
    : records.filter((r) => r.status === filterStatus)

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  const formatTime = (dateString?: string) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleTimeString()
  }

  // Find today's attendance record
  const today = todayKey()
  const todayRecord = records.find(r => r.day === today)

  // Hours worked in the current calendar month
  const thisMonth = today.slice(0, 7)
  const totalHoursThisMonth = records
    .filter(r => r.day?.startsWith(thisMonth))
    .reduce((sum, r) => sum + (r.workHours || 0), 0)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="mb-2 text-2xl font-semibold text-neutral-900">Attendance Tracking</h1>
        <p className="text-sm text-neutral-600">
          Manage attendance records and track working hours.
        </p>
      </div>

      {/* Today's Summary */}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-neutral-500">Today's Status</p>
          <p className={`mt-1 text-lg font-semibold ${
            todayRecord?.status === 'present' ? 'text-green-600' :
            todayRecord?.status === 'late' ? 'text-yellow-600' :
            todayRecord?.status === 'absent' ? 'text-red-600' :
            'text-neutral-600'
          }`}>
            {todayRecord?.status ? todayRecord.status.charAt(0).toUpperCase() + todayRecord.status.slice(1) : 'Not Checked In'}
          </p>
          {todayRecord && (
            <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${approvalBadge[todayRecord.approvalStatus]}`}>
              {todayRecord.approvalStatus === 'pending' ? 'Awaiting approval' : todayRecord.approvalStatus}
            </span>
          )}
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-neutral-500">Check In Time</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">
            {todayRecord?.checkInTime ? formatTime(todayRecord.checkInTime) : '-'}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-neutral-500">Check Out Time</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">
            {todayRecord?.checkOutTime ? formatTime(todayRecord.checkOutTime) : '-'}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-neutral-500">Today's Work Hours</p>
          <p className="mt-1 text-lg font-semibold text-blue-600">
            {todayRecord?.workHours !== undefined && todayRecord?.workHours > 0
              ? `${todayRecord.workHours.toFixed(2)} hrs`
              : todayRecord?.checkInTime && !todayRecord?.checkOutTime
              ? 'In progress...'
              : '0 hrs'}
          </p>
        </div>
      </div>

      {/* Total Hours Summary */}
      <div className="mb-6 rounded-xl border bg-linear-to-r from-blue-500 to-emerald-500 p-6 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm opacity-90">Total Working Hours (This Month)</p>
            <p className="mt-1 text-3xl font-bold">{totalHoursThisMonth.toFixed(2)} hrs</p>
          </div>
          <div className="text-5xl opacity-80">⏱️</div>
        </div>
      </div>

      {/* Quick Check In/Out */}
      <div className="mb-6 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleCheckIn}
            disabled={loading || !!todayRecord?.checkInTime}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {todayRecord?.checkInTime ? '✓ Checked In' : loading ? 'Processing...' : 'Check In'}
          </button>
          <button
            onClick={handleCheckOut}
            disabled={loading || !todayRecord?.checkInTime || !!todayRecord?.checkOutTime}
            className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {todayRecord?.checkOutTime ? '✓ Checked Out' : loading ? 'Processing...' : 'Check Out'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Add Attendance Form - Admin Only */}
      {isAdmin && (
        <div className="mb-6 rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900">Add Attendance Record</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div>
                <label htmlFor="employee" className="mb-1 block text-sm font-medium text-neutral-800">
                  Employee
                </label>
                <select
                  id="employee"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  required
                  className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                >
                  <option value="">Select employee</option>
                  {employees.map((employee) => (
                    <option key={employee._id} value={employee._id}>{employee.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="date" className="mb-1 block text-sm font-medium text-neutral-800">
                  Date
                </label>
                <input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                />
              </div>

              <div>
                <label htmlFor="status" className="mb-1 block text-sm font-medium text-neutral-800">
                  Status
                </label>
                <select
                  id="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
                  className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="late">Late</option>
                  <option value="half-day">Half Day</option>
                  <option value="leave">Leave</option>
                </select>
              </div>

              <div>
                <label htmlFor="remarks" className="mb-1 block text-sm font-medium text-neutral-800">
                  Remarks
                </label>
                <input
                  id="remarks"
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  placeholder="Optional notes"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Record'}
            </button>
          </form>
        </div>
      )}

      {/* Records List */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">Attendance Records</h2>
          
          <div className="flex items-center gap-2">
            <label htmlFor="filter" className="text-sm text-neutral-600">Filter:</label>
            <select
              id="filter"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | AttendanceStatus)}
              className="rounded-md border px-3 py-1.5 text-sm outline-none"
            >
              <option value="all">All</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="late">Late</option>
              <option value="half-day">Half Day</option>
              <option value="leave">Leave</option>
            </select>
          </div>
        </div>

        {filteredRecords.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">No attendance records found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-neutral-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-neutral-900">Employee</th>
                  <th className="px-4 py-3 font-medium text-neutral-900">Date</th>
                  <th className="px-4 py-3 font-medium text-neutral-900">Status</th>
                  <th className="px-4 py-3 font-medium text-neutral-900">Check In</th>
                  <th className="px-4 py-3 font-medium text-neutral-900">Check Out</th>
                  <th className="px-4 py-3 font-medium text-neutral-900">Work Hours</th>
                  <th className="px-4 py-3 font-medium text-neutral-900">Remarks</th>
                  {isAdmin && <th className="px-4 py-3 font-medium text-neutral-900">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRecords.map((record) => (
                  <tr key={record._id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {record.user?.profileImage ? (
                          <img
                            src={record.user.profileImage}
                            alt={record.user?.name || 'User'}
                            className="h-8 w-8 rounded-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                              const fallback = e.currentTarget.nextElementSibling
                              if (fallback) fallback.classList.remove('hidden')
                            }}
                          />
                        ) : null}
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 ${record.user?.profileImage ? 'hidden' : ''}`}>
                          {record.user?.name ? record.user.name.split(' ').map(n => n[0]).join('') : '?'}
                        </div>
                        <span className="text-neutral-900">{record.user?.name || 'Unknown User'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{formatDate(record.date)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          record.status === 'present'
                            ? 'bg-green-100 text-green-800'
                            : record.status === 'absent'
                            ? 'bg-red-100 text-red-800'
                            : record.status === 'late'
                            ? 'bg-yellow-100 text-yellow-800'
                            : record.status === 'half-day'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {record.status}
                      </span>
                      <span className={`ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${approvalBadge[record.approvalStatus]}`}>
                        {record.approvalStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{formatTime(record.checkInTime)}</td>
                    <td className="px-4 py-3 text-neutral-700">{formatTime(record.checkOutTime)}</td>
                    <td className="px-4 py-3 text-neutral-700">
                      {record.workHours !== undefined && record.workHours !== null
                        ? `${record.workHours.toFixed(2)} hrs`
                        : record.checkInTime && !record.checkOutTime
                        ? 'In progress...'
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{record.remarks || '-'}</td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDelete(record._id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Attendance

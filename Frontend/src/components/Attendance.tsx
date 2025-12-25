import { useState, useEffect } from 'react'
import { attendanceAPI } from '../api/attendanceAPI'
import { useAuth } from '../context/AuthContext'

export type AttendanceRecord = {
  _id: string
  user: {
    _id: string
    name: string
    email: string
  }
  date: string
  status: 'present' | 'absent' | 'late' | 'half-day' | 'leave'
  checkInTime?: string
  checkOutTime?: string
  workHours?: number
  remarks?: string
}

function Attendance() {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [date, setDate] = useState('')
  const [status, setStatus] = useState<'present' | 'absent' | 'late' | 'half-day' | 'leave'>('present')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | AttendanceRecord['status']>('all')
  
  const { isAdmin } = useAuth()

  useEffect(() => {
    loadAttendance()
  }, [])

  const loadAttendance = async () => {
    try {
      const response = await attendanceAPI.getAttendance()
      if (response.success) {
        setRecords(response.data)
      }
    } catch (err) {
      console.error('Failed to load attendance:', err)
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
        setSuccess('Checked in successfully!')
        loadAttendance()
      } else {
        setError(response.message || 'Failed to check in')
      }
    } catch (err: any) {
      console.error('Check-in error:', err)
      const errorMsg = err.response?.data?.message || err.message || 'Failed to check in. You may have already checked in today.'
      setError(errorMsg)
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
        setSuccess('Checked out successfully!')
        loadAttendance()
      } else {
        setError(response.message || 'Failed to check out')
      }
    } catch (err: any) {
      console.error('Check-out error:', err)
      const errorMsg = err.response?.data?.message || err.message || 'Failed to check out. Make sure you have checked in first.'
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!date) {
      setError('Date is required.')
      return
    }

    setLoading(true)
    try {
      const response = await attendanceAPI.createAttendance({
        date,
        status,
        remarks: remarks.trim() || undefined,
      })
      
      if (response.success) {
        setSuccess('Attendance record added successfully!')
        setDate('')
        setStatus('present')
        setRemarks('')
        loadAttendance()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add attendance record.')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this attendance record?')) return

    try {
      await attendanceAPI.deleteAttendance(id)
      loadAttendance()
    } catch (err: any) {
      setError(err.message || 'Failed to delete attendance record.')
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="mb-2 text-2xl font-semibold text-neutral-900">Attendance Tracking</h1>
        <p className="text-sm text-neutral-600">
          Manage attendance records and track working hours.
        </p>
      </div>

      {/* Quick Check In/Out */}
      <div className="mb-6 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleCheckIn}
            disabled={loading}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Check In'}
          </button>
          <button
            onClick={handleCheckOut}
            disabled={loading}
            className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Check Out'}
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                  onChange={(e) => setStatus(e.target.value as any)}
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
              onChange={(e) => setFilterStatus(e.target.value as any)}
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
                  <th className="px-4 py-3 font-medium text-neutral-900">Name</th>
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
                    <td className="px-4 py-3 text-neutral-900">{record.user.name}</td>
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
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{formatTime(record.checkInTime)}</td>
                    <td className="px-4 py-3 text-neutral-700">{formatTime(record.checkOutTime)}</td>
                    <td className="px-4 py-3 text-neutral-700">{record.workHours || '-'}</td>
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

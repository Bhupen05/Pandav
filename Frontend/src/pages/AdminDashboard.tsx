import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { taskAPI } from '../api/taskAPI'
import { attendanceAPI } from '../api/attendanceAPI'
import { userAPI } from '../api/userAPI'
import { useAuth } from '../context/AuthContext'

type DashboardTask = {
  _id: string
  title: string
  description?: string
  assignedTo?: string | { _id: string; name: string }
  status: 'pending' | 'completed'
  dueDate?: string
}

type AttendanceRequest = {
  _id: string
  user: { _id: string; name: string }
  date: string
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
  const { isAdmin, isAuthenticated } = useAuth()

  const [tasks, setTasks] = useState<DashboardTask[]>([])
  const [attendanceRequests, setAttendanceRequests] = useState<AttendanceRequest[]>([])
  const [users, setUsers] = useState<DashboardUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingTask, setIsSavingTask] = useState(false)
  const [processedAttendance, setProcessedAttendance] = useState<Record<string, boolean>>({})
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    assignedTo: '',
    dueDate: '',
  })

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
      const [taskRes, attendanceRes, userRes] = await Promise.all([
        taskAPI.getTasks(),
        attendanceAPI.getAttendance(),
        userAPI.getUsers(),
      ])
      setTasks(Array.isArray(taskRes?.data) ? taskRes.data : [])
      const requested = Array.isArray(attendanceRes?.data)
        ? attendanceRes.data.filter((item) => item.status === 'requested')
        : []
      setAttendanceRequests(requested)
      setUsers(Array.isArray(userRes?.data) ? userRes.data : [])
    } catch (error) {
      console.error('Failed to load dashboard data', error)
    } finally {
      setIsLoading(false)
    }
  }

  const resolveAssigneeName = (task: DashboardTask) => {
    if (!task.assignedTo) return 'Unassigned'
    if (typeof task.assignedTo === 'string') {
      return users.find((user) => user._id === task.assignedTo)?.name || 'Unassigned'
    }
    return task.assignedTo.name
  }

  const handleCreateTask = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newTask.title.trim() || !newTask.assignedTo) {
      alert('Title and assignee are required')
      return
    }

    setIsSavingTask(true)
    try {
      await taskAPI.createTask({
        title: newTask.title.trim(),
        description: newTask.description.trim(),
        assignedTo: newTask.assignedTo,
        dueDate: newTask.dueDate || undefined,
        status: 'pending',
      })
      setNewTask({ title: '', description: '', assignedTo: '', dueDate: '' })
      await fetchAllData()
    } catch (error) {
      console.error('Failed to create task', error)
    } finally {
      setIsSavingTask(false)
    }
  }

  const handleTaskStatusChange = async (taskId: string, status: 'pending' | 'completed') => {
    try {
      await taskAPI.updateTask(taskId, { status })
      setTasks((prev) => prev.map((task) => (task._id === taskId ? { ...task, status } : task)))
    } catch (error) {
      console.error('Failed to update task status', error)
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

  const handleToggleUser = async (user: DashboardUser) => {
    try {
      await userAPI.updateUser(user._id, { isActive: !user.isActive })
      setUsers((prev) =>
        prev.map((item) => (item._id === user._id ? { ...item, isActive: !item.isActive } : item)),
      )
    } catch (error) {
      console.error('Failed to toggle user status', error)
    }
  }

  const totalTasks = tasks.length
  const pendingTasks = tasks.filter((task) => task.status === 'pending').length
  const pendingAttendance = attendanceRequests.length

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
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Total Tasks</p>
          <p className="mt-2 text-2xl font-semibold text-neutral-900">{totalTasks}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Pending Tasks</p>
          <p className="mt-2 text-2xl font-semibold text-neutral-900">{pendingTasks}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Pending Attendance Requests</p>
          <p className="mt-2 text-2xl font-semibold text-neutral-900">{pendingAttendance}</p>
        </div>
      </section>

      <section className="mt-6 rounded-lg border bg-white p-4">
        <h2 className="text-lg font-semibold text-neutral-900">Team Members</h2>
        <ul className="mt-3 space-y-2 text-sm text-neutral-700">
          {users.length === 0 ? (
            <li>No team members found.</li>
          ) : (
            users.map((user) => <li key={user._id}>{user.name}</li>)
          )}
        </ul>
      </section>

      <section className="mt-8 rounded-lg border bg-white p-4">
        <h2 className="text-lg font-semibold text-neutral-900">Task Management</h2>
        <form onSubmit={handleCreateTask} className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="col-span-full">
            <label className="text-xs font-medium text-neutral-600">Title</label>
            <input
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              placeholder="Enter task title"
              required
            />
          </div>
          <div className="col-span-full">
            <label className="text-xs font-medium text-neutral-600">Description</label>
            <textarea
              value={newTask.description}
              onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              rows={3}
              placeholder="Optional details"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Assign To</label>
            <select
              value={newTask.assignedTo}
              onChange={(e) => setNewTask({ ...newTask, assignedTo: e.target.value })}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              required
            >
              <option value="">Select member</option>
              {users.map((user) => (
                <option key={user._id} value={user._id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Due Date</label>
            <input
              type="date"
              value={newTask.dueDate}
              onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-full flex justify-end">
            <button
              type="submit"
              disabled={isSavingTask}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isSavingTask ? 'Saving...' : 'Create Task'}
            </button>
          </div>
        </form>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Assigned To</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Due Date</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y text-neutral-800">
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-neutral-500">
                    No tasks yet.
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr key={task._id}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-neutral-500">{task.description}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">{resolveAssigneeName(task)}</td>
                    <td className="px-3 py-2 text-capitalize">{task.status}</td>
                    <td className="px-3 py-2">
                      {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() =>
                          handleTaskStatusChange(
                            task._id,
                            task.status === 'pending' ? 'completed' : 'pending',
                          )
                        }
                        className="mr-2 rounded border px-3 py-1 text-xs text-neutral-700"
                      >
                        Edit Status
                      </button>
                      <button
                        onClick={() => handleDeleteTask(task._id)}
                        className="rounded border border-red-500 px-3 py-1 text-xs text-red-600"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 rounded-lg border bg-white p-4">
        <h2 className="text-lg font-semibold text-neutral-900">Attendance Approval</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
              <tr>
                <th className="px-3 py-2">User Name</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Approve</th>
                <th className="px-3 py-2">Reject</th>
              </tr>
            </thead>
            <tbody className="divide-y text-neutral-800">
              {attendanceRequests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-neutral-500">
                    Nothing to approve.
                  </td>
                </tr>
              ) : (
                attendanceRequests.map((request) => {
                  const disabled = processedAttendance[request._id]
                  return (
                    <tr key={request._id}>
                      <td className="px-3 py-2 font-medium">{request.user.name}</td>
                      <td className="px-3 py-2">
                        {new Date(request.date).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">{request.status}</td>
                      <td className="px-3 py-2">
                        <button
                          disabled={disabled}
                          onClick={() => handleAttendanceDecision(request._id, 'approved')}
                          className="rounded border border-emerald-500 px-3 py-1 text-xs text-emerald-600 disabled:opacity-50"
                        >
                          Approve
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          disabled={disabled}
                          onClick={() => handleAttendanceDecision(request._id, 'rejected')}
                          className="rounded border border-red-500 px-3 py-1 text-xs text-red-600 disabled:opacity-50"
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
      </section>

      <section className="mt-8 rounded-lg border bg-white p-4">
        <h2 className="text-lg font-semibold text-neutral-900">User Management</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y text-neutral-800">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-neutral-500">
                    No users available.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user._id}>
                    <td className="px-3 py-2 font-medium">{user.name}</td>
                    <td className="px-3 py-2">{user.email}</td>
                    <td className="px-3 py-2">{user.role || 'employee'}</td>
                    <td className="px-3 py-2">{user.isActive ? 'Enabled' : 'Disabled'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleToggleUser(user)}
                        className="rounded border px-3 py-1 text-xs text-neutral-700"
                      >
                        {user.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

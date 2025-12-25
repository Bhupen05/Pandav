import { useState, useEffect } from 'react'
import { taskAPI } from '../api/taskAPI'
import { useAuth } from '../context/AuthContext'
import Taskscard from '../components/Taskscard'
import type { TaskInput } from '../components/Tasksadd'

export default function Tasks() {
  const [tasks, setTasks] = useState<TaskInput[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | TaskInput['status']>('all')
  const { user, isAuthenticated } = useAuth()

  useEffect(() => {
    if (isAuthenticated && user) {
      loadTasks()
    }
  }, [isAuthenticated, user])

  const loadTasks = async () => {
    setLoading(true)
    setError(null)
    try {
      // Filter tasks by the current user's ID
      const filters = user?._id ? { assignedTo: user._id } : {}
      const response = await taskAPI.getTasks(filters)
      if (response.success && Array.isArray(response.data)) {
        setTasks(response.data)
      } else {
        setTasks([])
      }
    } catch (err: any) {
      console.error('Failed to load tasks:', err)
      setError('Failed to load tasks from server. Please make sure the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  const handleStatusChange = async (index: number, newStatus: TaskInput['status']) => {
    const task = filteredTasks[index]
    const originalIndex = tasks.findIndex(t => t === task)
    
    if (originalIndex === -1) return

    if (!task._id) {
      console.error('Task has no _id, cannot update')
      return
    }

    // Optimistically update UI
    const updatedTasks = [...tasks]
    updatedTasks[originalIndex] = { ...updatedTasks[originalIndex], status: newStatus }
    setTasks(updatedTasks)

    try {
      const response = await taskAPI.updateTask(task._id, { status: newStatus })
      if (response.success) {
        console.log('Task status updated successfully:', newStatus)
      }
    } catch (err: any) {
      console.error('Failed to update task status:', err)
      alert(err.response?.data?.message || 'Failed to update task status')
      // Revert on error
      setTasks(tasks)
    }
  }

  const handleEdit = (index: number) => {
    const task = filteredTasks[index]
    console.log('Edit task:', task)
    // TODO: Open edit modal
    alert('Edit functionality coming soon!')
  }

  const handleDelete = async (index: number) => {
    const task = filteredTasks[index]
    const originalIndex = tasks.findIndex(t => t === task)
    
    if (originalIndex === -1) return

    if (!task._id) {
      console.error('Task has no _id, cannot delete')
      return
    }

    if (!confirm('Are you sure you want to delete this task?')) return

    // Optimistically remove from UI
    const updatedTasks = tasks.filter((_, i) => i !== originalIndex)
    setTasks(updatedTasks)

    try {
      const response = await taskAPI.deleteTask(task._id)
      if (response.success) {
        console.log('Task deleted successfully')
      }
    } catch (err: any) {
      console.error('Failed to delete task:', err)
      alert(err.response?.data?.message || 'Failed to delete task')
      // Revert on error
      setTasks(tasks)
    }
  }

  const filteredTasks = filter === 'all' ? tasks : tasks.filter(t => t.status === filter)

  const statusCounts = {
    all: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    'in-progress': tasks.filter(t => t.status === 'in-progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h2 className="mb-2 text-2xl font-bold text-neutral-900">Please Login</h2>
          <p className="text-neutral-600">You need to be logged in to view tasks.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 py-8">
      <div className="mx-auto max-w-7xl px-4">
        {/* Header */}
        <div className="mb-6">
          <h1 className="mb-2 text-3xl font-bold text-neutral-900">My Tasks</h1>
          <p className="text-sm text-neutral-600">Manage and track your assigned tasks</p>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <button
            onClick={() => setFilter('all')}
            className={`rounded-xl border bg-white p-4 text-left transition-all hover:shadow-md ${
              filter === 'all' ? 'ring-2 ring-emerald-600' : ''
            }`}
          >
            <p className="text-sm text-neutral-600">All Tasks</p>
            <p className="text-2xl font-bold text-neutral-900">{statusCounts.all}</p>
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`rounded-xl border bg-white p-4 text-left transition-all hover:shadow-md ${
              filter === 'pending' ? 'ring-2 ring-amber-600' : ''
            }`}
          >
            <p className="text-sm text-neutral-600">Pending</p>
            <p className="text-2xl font-bold text-amber-600">{statusCounts.pending}</p>
          </button>
          <button
            onClick={() => setFilter('in-progress')}
            className={`rounded-xl border bg-white p-4 text-left transition-all hover:shadow-md ${
              filter === 'in-progress' ? 'ring-2 ring-blue-600' : ''
            }`}
          >
            <p className="text-sm text-neutral-600">In Progress</p>
            <p className="text-2xl font-bold text-blue-600">{statusCounts['in-progress']}</p>
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`rounded-xl border bg-white p-4 text-left transition-all hover:shadow-md ${
              filter === 'completed' ? 'ring-2 ring-emerald-600' : ''
            }`}
          >
            <p className="text-sm text-neutral-600">Completed</p>
            <p className="text-2xl font-bold text-emerald-600">{statusCounts.completed}</p>
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-emerald-600"></div>
              <p className="text-sm text-neutral-600">Loading tasks...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Tasks Grid */}
        {!loading && (
          <Taskscard
            tasks={filteredTasks}
            onStatusChange={handleStatusChange}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  )
}

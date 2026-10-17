import { useState, useEffect } from 'react'
import { taskAPI } from '../api/taskAPI'
import { getErrorMessage } from '../api/axios'
import { useAuth } from '../context/useAuth'
import Taskscard from '../components/Taskscard'
import Tasksadd from '../components/Tasksadd'
import type { TaskInput } from '../components/Tasksadd'
import { useFeedback } from '../context/useFeedback'

export default function Tasks() {
  const { notify, confirm } = useFeedback()
  const [tasks, setTasks] = useState<TaskInput[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | TaskInput['status']>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskInput | null>(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [rejectingTaskId, setRejectingTaskId] = useState<string | null>(null)
  const [isRejectSubmitting, setIsRejectSubmitting] = useState(false)
  const { user, isAuthenticated, isAdmin } = useAuth()

  useEffect(() => {
    if (isAuthenticated && user) {
      loadTasks()
      
      // Auto-refresh every 30 seconds, without the loading spinner
      const refreshInterval = setInterval(() => {
        loadTasks(true)
      }, 30000)
      
      return () => clearInterval(refreshInterval)
    }
  }, [isAuthenticated, user])

  const loadTasks = async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      // The API already limits regular users to their own tasks; admins get all of them
      const response = await taskAPI.getTasks()
      if (response.success && Array.isArray(response.data)) {
        setTasks(response.data)
      } else {
        setTasks([])
      }
    } catch (err) {
      console.error('Failed to load tasks:', err)
      if (!silent) {
        setError('Failed to load tasks from server. Please make sure the backend is running.')
      }
    } finally {
      if (!silent) setLoading(false)
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

    // Results come from the server: with several assignees, requesting
    // completion may only mark the caller's part as done
    const replaceTask = (updated: TaskInput) => {
      setTasks(prev => prev.map(t => (t._id === updated._id ? updated : t)))
    }

    // For completion-requested, use the special API endpoint
    if (newStatus === 'completion-requested') {
      try {
        const response = await taskAPI.requestCompletion(task._id)
        if (response.success) {
          replaceTask(response.data)
          notify(response.message || 'Completion request sent. Waiting for admin approval.', 'success')
        }
      } catch (err) {
        console.error('Failed to request task completion:', err)
        notify(getErrorMessage(err, 'Failed to request task completion'), 'error')
      }
      return
    }

    // Admin approving task completion
    if (isAdmin && newStatus === 'completed' && task.status === 'completion-requested') {
      try {
        const response = await taskAPI.approveCompletion(task._id)
        if (response.success) {
          replaceTask(response.data)
          notify('Task approved.', 'success')
        }
      } catch (err) {
        console.error('Failed to approve task:', err)
        notify(getErrorMessage(err, 'Failed to approve task'), 'error')
      }
      return
    }

    // Admin rejecting task completion (send to modal)
    if (isAdmin && newStatus === 'in-progress' && task.status === 'completion-requested') {
      setRejectingTaskId(task._id)
      setRejectionReason('')
      setShowRejectModal(true)
      return
    }

    // For other status changes (like starting a task)
    try {
      const response = await taskAPI.updateTask(task._id, { status: newStatus })
      if (response.success) replaceTask(response.data)
    } catch (err) {
      console.error('Failed to update task status:', err)
      notify(getErrorMessage(err, 'Failed to update task status'), 'error')
    }
  }

  const handleEdit = (index: number) => {
    setEditingTask(filteredTasks[index])
  }

  const handleDelete = async (index: number) => {
    const task = filteredTasks[index]
    const originalIndex = tasks.findIndex(t => t === task)
    
    if (originalIndex === -1) return

    if (!task._id) {
      console.error('Task has no _id, cannot delete')
      return
    }

    if (!(await confirm({ title: 'Delete this task?', message: `"${task.title}" will be removed for everyone. This can't be undone.`, confirmLabel: 'Delete', danger: true }))) return

    // Optimistically remove from UI
    const updatedTasks = tasks.filter((_, i) => i !== originalIndex)
    setTasks(updatedTasks)

    try {
      await taskAPI.deleteTask(task._id)
    } catch (err) {
      console.error('Failed to delete task:', err)
      notify(getErrorMessage(err, 'Failed to delete task'), 'error')
      // Revert on error
      setTasks(tasks)
    }
  }

  const handleRejectTask = async () => {
    if (!rejectingTaskId) return

    setIsRejectSubmitting(true)
    try {
      const response = await taskAPI.rejectCompletion(rejectingTaskId, {
        rejectionReason: rejectionReason.trim() || 'Task completion rejected by admin'
      })
      if (response.success) {
        // Update local state
        setTasks(prev => prev.map(t => 
          t._id === rejectingTaskId 
            ? { 
                ...t, 
                status: 'in-progress' as const,
                rejectionReason: rejectionReason.trim() || 'Task completion rejected by admin'
              }
            : t
        ))
        setShowRejectModal(false)
        setRejectionReason('')
        setRejectingTaskId(null)
        notify('Task rejected.', 'success')
      }
    } catch (err) {
      console.error('Failed to reject task:', err)
      notify(getErrorMessage(err, 'Failed to reject task'), 'error')
    } finally {
      setIsRejectSubmitting(false)
    }
  }

  const filteredTasks = (filter === 'all' ? tasks : tasks.filter(t => t.status === filter))
    .filter(t => searchQuery === '' || 
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
    )

  const statusCounts = {
    all: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    'in-progress': tasks.filter(t => t.status === 'in-progress').length,
    'completion-requested': tasks.filter(t => t.status === 'completion-requested').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    cancelled: tasks.filter(t => t.status === 'cancelled').length,
  }

  // Calculate progress percentage
  const completedPercentage = tasks.length > 0 
    ? Math.round((statusCounts.completed / tasks.length) * 100) 
    : 0

  // Get urgent/overdue tasks
  const overdueTasks = tasks.filter(t => {
    if (t.status === 'completed' || t.status === 'cancelled') return false
    if (!t.dueDate) return false
    return new Date(t.dueDate) < new Date()
  })

  const urgentTasks = tasks.filter(t => t.priority === 'urgent' && t.status !== 'completed')

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      {/* Hero Header */}
      <div className=" bg-linear-to-r from-blue-500 to-emerald-500 text-white">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl font-bold md:text-3xl">{isAdmin ? 'All Tasks' : 'My Tasks'}</h1>
                  <p className="text-sm text-neutral-300">Welcome back, {user?.name?.split(' ')[0] || 'User'}</p>
                </div>
              </div>
            </div>
            
            {/* Progress Circle */}
            <div className="flex items-center gap-6">
              <div className="relative h-20 w-20">
                <svg className="h-20 w-20 -rotate-90 transform">
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    className="text-white/20"
                  />
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={`${completedPercentage * 2.26} 226`}
                    className="text-blue-100 transition-all duration-500"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold">{completedPercentage}%</span>
                </div>
              </div>
              <div className="text-sm">
                <p className="text-neutral-300">Progress</p>
                <p className="font-semibold">{statusCounts.completed} of {tasks.length} done</p>
              </div>
            </div>
          </div>
          
          {/* Alert Badges */}
          {(overdueTasks.length > 0 || urgentTasks.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {overdueTasks.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-3 py-1 text-xs font-medium text-red-200">
                  <span>⚠️</span> {overdueTasks.length} overdue
                </span>
              )}
              {urgentTasks.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/20 px-3 py-1 text-xs font-medium text-orange-200">
                  <span>🔥</span> {urgentTasks.length} urgent
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Search and Actions Bar */}
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search tasks by title, description, or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border-0 bg-neutral-100 py-3 pl-10 pr-4 text-sm outline-none transition-all focus:bg-neutral-50 focus:ring-2 focus:ring-neutral-900"
            />
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:shadow-xl hover:opacity-90"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Task
            </button>
          )}
        </div>

        {/* Status Filter Pills */}
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { key: 'all', label: 'All', count: statusCounts.all, color: 'neutral' },
            { key: 'pending', label: 'Pending', count: statusCounts.pending, color: 'amber', icon: '⏳' },
            { key: 'in-progress', label: 'In Progress', count: statusCounts['in-progress'], color: 'blue', icon: '🔄' },
            { key: 'completion-requested', label: 'Requested', count: statusCounts['completion-requested'], color: 'purple', icon: '🔔' },
            { key: 'completed', label: 'Completed', count: statusCounts.completed, color: 'emerald', icon: '✅' },
            { key: 'cancelled', label: 'Cancelled', count: statusCounts.cancelled, color: 'neutral', icon: '❌' },
          ].map((status) => (
            <button
              key={status.key}
              onClick={() => setFilter(status.key as typeof filter)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                filter === status.key
                  ? status.color === 'amber' ? 'bg-amber-600 text-white shadow-lg shadow-amber-200' :
                    status.color === 'blue' ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' :
                    status.color === 'purple' ? 'bg-purple-600 text-white shadow-lg shadow-purple-200' :
                    status.color === 'emerald' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' :
                    'bg-neutral-900 text-white shadow-lg'
                  : 'bg-white text-neutral-700 border hover:bg-neutral-50'
              }`}
            >
              {status.icon && <span>{status.icon}</span>}
              {status.label}
              <span className={`rounded-full px-2 py-0.5 text-xs ${
                filter === status.key ? 'bg-white/20' : 'bg-neutral-100'
              }`}>
                {status.count}
              </span>
            </button>
          ))}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900"></div>
              <p className="text-sm font-medium text-neutral-600">Loading your tasks...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-xl">
              ⚠️
            </div>
            <div>
              <p className="font-medium text-red-800">Unable to load tasks</p>
              <p className="text-sm text-red-600">{error}</p>
            </div>
            <button 
              onClick={() => loadTasks()}
              className="ml-auto rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filteredTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-200 bg-white py-16 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100 text-4xl">
              {filter === 'all' ? '📋' : filter === 'completed' ? '🎉' : '📭'}
            </div>
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">
              {filter === 'all' ? 'No tasks yet' : `No ${filter.replace('-', ' ')} tasks`}
            </h3>
            <p className="mb-6 max-w-sm text-sm text-neutral-600">
              {filter === 'all' 
                ? "You don't have any tasks assigned yet. Check back later or contact your admin."
                : `You don't have any tasks with "${filter.replace('-', ' ')}" status.`}
            </p>
            {filter !== 'all' && (
              <button
                onClick={() => setFilter('all')}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                View All Tasks
              </button>
            )}
          </div>
        )}

        {/* Tasks Grid */}
        {!loading && !error && filteredTasks.length > 0 && (
          <div className="animate-fade-in">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-neutral-600">
                Showing <span className="font-semibold text-neutral-900">{filteredTasks.length}</span> 
                {filter !== 'all' && ` ${filter.replace('-', ' ')}`} task{filteredTasks.length !== 1 ? 's' : ''}
              </p>
              <button 
                onClick={() => loadTasks()}
                className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
            <Taskscard
              tasks={filteredTasks}
              onStatusChange={handleStatusChange}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isAdmin={isAdmin}
              currentUserId={user?._id}
            />
          </div>
        )}
      </div>

      {/* Add / Edit Task Modal */}
      <Tasksadd
        isOpen={showAddModal || !!editingTask}
        task={editingTask}
        onClose={() => {
          setShowAddModal(false)
          setEditingTask(null)
        }}
        onCreate={() => {
          loadTasks(true)
        }}
      />

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
                onClick={handleRejectTask}
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
    </div>
  )
}

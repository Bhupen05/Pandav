import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { taskAPI } from '../api/taskAPI'
import { attendanceAPI } from '../api/attendanceAPI'
import { socialV2API } from '../api/socialV2API'
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

type SocialPost = {
  _id: string
  content: string
  author: { _id: string; name: string; profileImage?: string }
  likes: number
  comments: number
  createdAt: string
}

type PersonalTodo = {
  _id: string
  title: string
  description?: string
  isCompleted: boolean
  createdAt: string
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
  const [, setAttendanceHistory] = useState<AttendanceRecord[]>([])
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([])
  const [personalTodos, setPersonalTodos] = useState<PersonalTodo[]>([])
  const [isLoading, setIsLoading] = useState(true)
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
      const [taskRes, attendanceRes, postsRes, todosRes] = await Promise.all([
        taskAPI.getTasks(user?._id ? { assignedTo: user._id } : {}),
        attendanceAPI.getAttendance(user?._id ? { user: user._id } : {}),
        socialV2API.getFeed().catch(() => []),
        socialV2API.getPersonalTasks().catch(() => []),
      ])

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

      // Process social data
      const posts = Array.isArray(postsRes) ? postsRes.slice(0, 5) : []
      setSocialPosts(posts)
      
      const todos = Array.isArray(todosRes) ? todosRes : []
      setPersonalTodos(todos)
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

  const leaderboard: any[] = []

  const pendingTasks = tasks.filter((task) => task.status === 'pending')
  const inProgressTasks = tasks.filter((task) => task.status === 'in-progress')
  const completedTasks = tasks.filter((task) => task.status === 'completed')


  
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

  const handleToggleTodo = async (todoId: string) => {
    try {
      await socialV2API.togglePersonalTask(todoId)
      setPersonalTodos((prev) =>
        prev.map((todo) =>
          todo._id === todoId ? { ...todo, isCompleted: !todo.isCompleted } : todo,
        ),
      )
    } catch (error) {
      console.error('Unable to toggle todo', error)
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

        </div>
      </div>

      {/* Quick Actions */}

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

      {/* Leaderboard & Recent Tasks Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Social Feed Section */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="border-b bg-linear-to-r from-purple-500 to-pink-500 px-5 py-4">
            <div className="flex items-center gap-2 text-white">
              <span className="text-2xl">📱</span>
              <h3 className="font-bold text-lg">Social Feed</h3>
            </div>
            <p className="text-purple-100 text-sm mt-1">Updates from your network</p>
          </div>
          {socialPosts.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">🌐</div>
              <p className="text-sm text-neutral-500">No posts yet. Visit the Social Hub to get started!</p>
              <button
                onClick={() => navigate('/social')}
                className="mt-3 text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                Go to Social Hub →
              </button>
            </div>
          ) : (
            <div className="divide-y max-h-96 overflow-y-auto">
              {socialPosts.map((post) => (
                <div key={post._id} className="p-4 hover:bg-neutral-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-600">
                      {post.author.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-900">{post.author.name}</p>
                      <p className="text-sm text-neutral-600 mt-1 line-clamp-2">{post.content}</p>
                      <div className="flex gap-4 mt-2 text-xs text-neutral-500">
                        <span>👍 {post.likes}</span>
                        <span>💬 {post.comments}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Personal Todos Section */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="border-b bg-linear-to-r from-teal-500 to-cyan-500 px-5 py-4">
            <div className="flex items-center gap-2 text-white">
              <span className="text-2xl">✅</span>
              <h3 className="font-bold text-lg">Personal Todos</h3>
            </div>
            <p className="text-teal-100 text-sm mt-1 flex items-center gap-1">
              {personalTodos.filter(t => !t.isCompleted).length} of {personalTodos.length} remaining
            </p>
          </div>
          {personalTodos.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">📝</div>
              <p className="text-sm text-neutral-500">No todos yet. Create one in the Social Hub!</p>
              <button
                onClick={() => navigate('/social')}
                className="mt-3 text-sm text-teal-600 hover:text-teal-700 font-medium"
              >
                Go to Social Hub →
              </button>
            </div>
          ) : (
            <div className="divide-y max-h-96 overflow-y-auto">
              {personalTodos.map((todo) => (
                <div
                  key={todo._id}
                  className={`p-4 flex items-start gap-3 hover:bg-neutral-50 transition-colors ${
                    todo.isCompleted ? 'bg-neutral-50' : ''
                  }`}
                >
                  <button
                    onClick={() => handleToggleTodo(todo._id)}
                    className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-all ${
                      todo.isCompleted
                        ? 'bg-teal-500 border-teal-500'
                        : 'border-neutral-300 hover:border-teal-500'
                    }`}
                  >
                    {todo.isCompleted && <span className="text-white text-xs">✓</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium ${
                        todo.isCompleted ? 'line-through text-neutral-400' : 'text-neutral-900'
                      }`}
                    >
                      {todo.title}
                    </p>
                    {todo.description && (
                      <p className="text-xs text-neutral-500 mt-1">{todo.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Leaderboard & Recent Tasks Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Leaderboard */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="border-b bg-linear-to-r from-amber-500 to-orange-500 px-5 py-4">
            <div className="flex items-center gap-2 text-white">
              <span className="text-2xl">🏆</span>
              <h3 className="font-bold text-lg">Leaderboard</h3>
            </div>
            <p className="text-amber-100 text-sm mt-1">Top performers this month</p>
          </div>
          {leaderboard.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">👥</div>
              <p className="text-sm text-neutral-500">No team members yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {leaderboard.slice(0, 5).map((member, index) => {
                const isCurrentUser = member._id === user?._id
                const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`
                return (
                  <div 
                    key={member._id} 
                    className={`flex items-center gap-4 px-5 py-3 ${isCurrentUser ? 'bg-emerald-50' : 'hover:bg-neutral-50'} transition-colors`}
                  >
                    {/* Rank */}
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                      index === 0 ? 'bg-amber-100 text-amber-700' :
                      index === 1 ? 'bg-neutral-200 text-neutral-700' :
                      index === 2 ? 'bg-orange-100 text-orange-700' :
                      'bg-neutral-100 text-neutral-600'
                    }`}>
                      {typeof rankEmoji === 'string' && rankEmoji.startsWith('#') ? rankEmoji : rankEmoji}
                    </div>
                    
                    {/* Avatar */}
                    <div className="relative">
                      {member.profileImage ? (
                        <img 
                          src={member.profileImage} 
                          alt={member.name} 
                          className="h-10 w-10 rounded-full object-cover border-2 border-white shadow"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-600 border-2 border-white shadow">
                          {member.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                      )}
                      {isCurrentUser && (
                        <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
                          <span className="text-[8px] text-white">✓</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate ${isCurrentUser ? 'text-emerald-700' : 'text-neutral-900'}`}>
                        {member.name}
                        {isCurrentUser && <span className="ml-2 text-xs text-emerald-600">(You)</span>}
                      </p>
                      <p className="text-xs text-neutral-500">{member.completedTasks} tasks completed</p>
                    </div>
                    
                    {/* Stats */}
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-16 rounded-full bg-neutral-100 overflow-hidden">
                          <div 
                            className="h-full bg-emerald-500 rounded-full transition-all" 
                            style={{ width: `${member.completionRate}%` }}
                          ></div>
                        </div>
                        <span className="text-xs font-medium text-neutral-600 w-8">{member.completionRate}%</span>
                      </div>
                      <p className="text-[10px] text-neutral-400 mt-0.5">{member.totalTasks} total</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {leaderboard.length > 5 && (
            <div className="border-t px-5 py-3 text-center">
              <span className="text-xs text-neutral-500">+{leaderboard.length - 5} more team members</span>
            </div>
          )}
        </div>

        {/* Recent Tasks */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-neutral-900">Recent Tasks</h3>
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


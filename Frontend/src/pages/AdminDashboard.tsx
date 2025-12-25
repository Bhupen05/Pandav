import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import type { TaskInput } from '../components/Tasksadd'
import type { AttendanceRecord } from '../components/Attendance'
import { taskAPI } from '../api/taskAPI'
import { authAPI } from '../api/authAPI'
import { userAPI } from '../api/userAPI'
import { attendanceAPI } from '../api/attendanceAPI'
import { useAuth } from '../context/AuthContext'

type User = {
  _id: string
  name: string
  email: string
  role?: string
}

type EmployeeRanking = {
  employeeId: string
  name: string
  role: string
  tasksCompleted: number
  attendanceRate: number
  performanceScore: number
  overallRank: number
}

// Pagination Component
type PaginationProps = {
  currentPage: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
}

function Pagination({ currentPage, totalItems, itemsPerPage, onPageChange }: PaginationProps) {
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  
  if (totalPages <= 1) return null

  const pages = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...')
    }
  }

  return (
    <div className="mt-4 flex items-center justify-between border-t pt-3">
      <p className="text-sm text-neutral-600">
        Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-50"
        >
          Previous
        </button>
        {pages.map((page, idx) => (
          typeof page === 'number' ? (
            <button
              key={idx}
              onClick={() => onPageChange(page)}
              className={`rounded-md px-3 py-1 text-sm ${
                currentPage === page
                  ? 'bg-neutral-900 text-white'
                  : 'border hover:bg-neutral-50'
              }`}
            >
              {page}
            </button>
          ) : (
            <span key={idx} className="px-2 text-neutral-500">...</span>
          )
        ))}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-50"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isAdmin, isAuthenticated } = useAuth()
  const [tasks, setTasks] = useState<TaskInput[]>([])
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [rankings, setRankings] = useState<EmployeeRanking[]>([])
  const [taskFilter, setTaskFilter] = useState<'all' | TaskInput['status']>('all')
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | AttendanceRecord['status']>('all')
  
  // Check admin access
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login')
      return
    }
    if (!isAdmin) {
      navigate('/')
      alert('Access denied. Admin privileges required.')
      return
    }
  }, [isAuthenticated, isAdmin, navigate])
  
  // Loading states
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [_isLoadingAttendance, setIsLoadingAttendance] = useState(false)
  const [_isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [isAddingTask, setIsAddingTask] = useState(false)
  const [isAddingUser, setIsAddingUser] = useState(false)
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPerformanceModalOpen, setIsPerformanceModalOpen] = useState(false)
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRanking | null>(null)
  const [performanceInput, setPerformanceInput] = useState({
    tasksCompleted: 0,
    attendanceRate: 0,
    performanceScore: 0,
  })

  // Pagination state
  const [taskPage, setTaskPage] = useState(1)
  const [attendancePage, setAttendancePage] = useState(1)
  const [rankingPage, setRankingPage] = useState(1)
  const itemsPerPage = 5
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium' as TaskInput['priority'],
    status: 'pending' as TaskInput['status'],
    dueDate: '',
    tags: '',
    assignedTo: '',
  })

  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user' as 'user' | 'admin',
  })

  // Check if modal should be opened from URL parameter
  useEffect(() => {
    if (searchParams.get('openModal') === 'true') {
      setIsModalOpen(true)
      // Remove the parameter from URL
      searchParams.delete('openModal')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Load all data from backend
  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      loadTasks()
      loadAttendance()
      loadUsers()
      
      // Auto-refresh every 30 seconds
      const refreshInterval = setInterval(() => {
        loadTasks(true)
        loadAttendance(true)
        loadUsers(true)
      }, 30000)
      
      return () => clearInterval(refreshInterval)
    }
  }, [isAuthenticated, isAdmin])

  const loadTasks = async (silent = false) => {
    if (!silent) setIsLoadingTasks(true)
    try {
      const response = await taskAPI.getTasks()
      console.log('Admin - Tasks API Response:', response)
      console.log('Admin - Tasks count:', response.data?.length || 0)
      if (response.success && Array.isArray(response.data)) {
        setTasks(response.data)
        console.log('Admin - Tasks state updated with', response.data.length, 'tasks')
      } else {
        console.warn('Admin - Invalid response format:', response)
      }
    } catch (error) {
      console.error('Error loading tasks:', error)
    } finally {
      if (!silent) setIsLoadingTasks(false)
    }
  }

  const loadAttendance = async (silent = false) => {
    if (!silent) setIsLoadingAttendance(true)
    try {
      const response = await attendanceAPI.getAttendance()
      if (response.success && Array.isArray(response.data)) {
        setAttendance(response.data)
      }
    } catch (error) {
      console.error('Error loading attendance:', error)
    } finally {
      if (!silent) setIsLoadingAttendance(false)
    }
  }

  const loadUsers = async (silent = false) => {
    if (!silent) setIsLoadingUsers(true)
    try {
      const response = await userAPI.getUsers({ isActive: true })
      if (response.success && Array.isArray(response.data)) {
        setUsers(response.data)
      }
    } catch (error) {
      console.error('Error loading users:', error)
    } finally {
      if (!silent) setIsLoadingUsers(false)
    }
  }

  const handleAddTask = async () => {
    if (!newTask.title.trim() || !newTask.assignedTo) {
      alert('Please fill in task title and assign to an employee')
      return
    }

    setIsAddingTask(true)
    try {
      const taskData = {
        title: newTask.title.trim(),
        description: newTask.description.trim() || '',
        priority: newTask.priority,
        status: newTask.status,
        dueDate: newTask.dueDate || new Date().toISOString().split('T')[0],
        tags: newTask.tags.split(',').map(t => t.trim()).filter(Boolean),
        assignedTo: newTask.assignedTo,
      }

      const response = await taskAPI.createTask(taskData)
      
      // Handle both successful responses with data and 204 No Content
      if (response && (response.success || response.task)) {
        // If we got the task back, add it to the list
        if (response.task) {
          setTasks([response.task, ...tasks])
        } else {
          // Otherwise reload tasks from backend
          await loadTasks()
        }
        alert('Task created successfully!')
      } else {
        alert('Failed to create task. Please try again.')
      }

      setIsModalOpen(false)
      setNewTask({
        title: '',
        description: '',
        priority: 'medium',
        status: 'pending',
        dueDate: '',
        tags: '',
        assignedTo: '',
      })
    } catch (error: any) {
      console.error('Error creating task:', error)
      // Handle 204 No Content as success
      if (error.response?.status === 204) {
        alert('Task created successfully!')
        setIsModalOpen(false)
        setNewTask({
          title: '',
          description: '',
          priority: 'medium',
          status: 'pending',
          dueDate: '',
          tags: '',
          assignedTo: '',
        })
        await loadTasks()
      } else {
        alert(error.response?.data?.message || 'Failed to create task. Please check if the backend is running.')
      }
    } finally {
      setIsAddingTask(false)
    }
  }

  const handleAddUser = async () => {
    if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim()) {
      alert('Please fill in all required fields')
      return
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(newUser.email)) {
      alert('Please enter a valid email address')
      return
    }

    // Password validation (minimum 6 characters)
    if (newUser.password.length < 6) {
      alert('Password must be at least 6 characters long')
      return
    }

    setIsAddingUser(true)
    try {
      const response = await authAPI.register({
        name: newUser.name.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        role: newUser.role,
      })

      if (response.success) {
        alert(`User ${newUser.name} registered successfully!`)
        setIsUserModalOpen(false)
        setNewUser({
          name: '',
          email: '',
          password: '',
          role: 'user',
        })
      } else {
        alert(response.message || 'Failed to register user')
      }
    } catch (error: any) {
      console.error('Error registering user:', error)
      alert(error.response?.data?.message || 'Failed to register user. Please check if the backend is running.')
    } finally {
      setIsAddingUser(false)
    }
  }

  const calculateRanking = (emp: EmployeeRanking): number => {
    // Weighted score: tasks (40%), attendance (30%), performance (30%)
    const taskScore = (emp.tasksCompleted / 50) * 40 // normalize to 40 points max
    const attendanceScore = (emp.attendanceRate / 100) * 30 // 30 points max
    const performanceScore = (emp.performanceScore / 10) * 30 // 30 points max
    return Math.round(taskScore + attendanceScore + performanceScore)
  }

  const sortedRankings = [...rankings]
    .map(emp => ({ ...emp, overallRank: calculateRanking(emp) }))
    .sort((a, b) => b.overallRank - a.overallRank)

  const filteredTasks = taskFilter === 'all' ? tasks : tasks.filter(t => t.status === taskFilter)
  const filteredAttendance = attendanceFilter === 'all' ? attendance : attendance.filter(a => a.status === attendanceFilter)
  
  // Paginated data
  const paginatedTasks = filteredTasks.slice((taskPage - 1) * itemsPerPage, taskPage * itemsPerPage)
  const paginatedAttendance = filteredAttendance.slice((attendancePage - 1) * itemsPerPage, attendancePage * itemsPerPage)
  const paginatedRankings = sortedRankings.slice((rankingPage - 1) * itemsPerPage, rankingPage * itemsPerPage)

  console.log('Admin - Tasks state:', tasks.length, 'tasks')
  console.log('Admin - Task filter:', taskFilter)
  console.log('Admin - Filtered tasks:', filteredTasks.length, 'tasks')
  console.log('Admin - Paginated tasks:', paginatedTasks.length, 'tasks on page', taskPage)

  const openPerformanceModal = (emp: EmployeeRanking) => {
    setSelectedEmployee(emp)
    setPerformanceInput({
      tasksCompleted: emp.tasksCompleted,
      attendanceRate: emp.attendanceRate,
      performanceScore: emp.performanceScore,
    })
    setIsPerformanceModalOpen(true)
  }

  const updatePerformance = () => {
    if (!selectedEmployee) return
    
    setRankings(rankings.map(emp => 
      emp.employeeId === selectedEmployee.employeeId
        ? { ...emp, ...performanceInput }
        : emp
    ))
    setIsPerformanceModalOpen(false)
    setSelectedEmployee(null)
  }

  // Analytics calculations
  const totalTasks = tasks.length
  const completedTasks = tasks.filter(t => t.status === 'completed').length
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  const totalAttendance = attendance.length
  const presentCount = attendance.filter(a => a.status === 'present').length
  const attendanceRate = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : 0

  const uniqueMembers = new Set(attendance.map(a => a.user.name)).size

  // Task priority breakdown
  const highPriority = tasks.filter(t => t.priority === 'high').length
  const mediumPriority = tasks.filter(t => t.priority === 'medium').length
  const lowPriority = tasks.filter(t => t.priority === 'low').length

  // Show loading or access denied message
  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-emerald-600"></div>
          <p className="text-sm text-neutral-600">Checking access...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 py-8">
      <div className="mx-auto max-w-7xl px-4">
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="mb-2 text-3xl font-bold text-neutral-900">Admin Dashboard</h1>
              <p className="text-sm text-neutral-600">Manage tasks, track attendance, and monitor team analytics.</p>
            </div>
            <button 
              onClick={() => setIsUserModalOpen(true)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors"
            >
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                Add User
              </span>
            </button>
          </div>
        </header>

        {/* Key Metrics */}
        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-600">Total Tasks</p>
              <div className="rounded-lg bg-blue-100 p-2">
                <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
            </div>
            <p className="text-2xl font-bold text-neutral-900">{totalTasks}</p>
            <p className="mt-1 text-xs text-neutral-500">{inProgressTasks} in progress</p>
          </div>

          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-600">Completion Rate</p>
              <div className="rounded-lg bg-emerald-100 p-2">
                <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-2xl font-bold text-neutral-900">{completionRate}%</p>
            <p className="mt-1 text-xs text-neutral-500">{completedTasks} completed</p>
          </div>

          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-600">Attendance Rate</p>
              <div className="rounded-lg bg-purple-100 p-2">
                <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <p className="text-2xl font-bold text-neutral-900">{attendanceRate}%</p>
            <p className="mt-1 text-xs text-neutral-500">{presentCount} present</p>
          </div>

          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-600">Team Members</p>
              <div className="rounded-lg bg-amber-100 p-2">
                <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
            </div>
            <p className="text-2xl font-bold text-neutral-900">{uniqueMembers}</p>
            <p className="mt-1 text-xs text-neutral-500">Active members</p>
          </div>
        </section>

        {/* Analytics Charts */}
        <section className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Task Status Breakdown */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-neutral-900">Task Status Overview</h2>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-neutral-700">Completed</span>
                  <span className="font-medium text-neutral-900">{completedTasks}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full bg-emerald-500" style={{ width: `${(completedTasks / totalTasks) * 100}%` }}></div>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-neutral-700">In Progress</span>
                  <span className="font-medium text-neutral-900">{inProgressTasks}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full bg-blue-500" style={{ width: `${(inProgressTasks / totalTasks) * 100}%` }}></div>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-neutral-700">To Do</span>
                  <span className="font-medium text-neutral-900">{totalTasks - completedTasks - inProgressTasks}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full bg-neutral-400" style={{ width: `${((totalTasks - completedTasks - inProgressTasks) / totalTasks) * 100}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Priority Breakdown */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-neutral-900">Task Priority Distribution</h2>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-neutral-700">High Priority</span>
                  <span className="font-medium text-neutral-900">{highPriority}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full bg-red-500" style={{ width: `${(highPriority / totalTasks) * 100}%` }}></div>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-neutral-700">Medium Priority</span>
                  <span className="font-medium text-neutral-900">{mediumPriority}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full bg-amber-500" style={{ width: `${(mediumPriority / totalTasks) * 100}%` }}></div>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-neutral-700">Low Priority</span>
                  <span className="font-medium text-neutral-900">{lowPriority}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full bg-neutral-400" style={{ width: `${(lowPriority / totalTasks) * 100}%` }}></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Task Management */}
        <section className="mb-8 rounded-xl border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">Task Management</h2>
            <div className="flex items-center gap-3">
              <select
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value as typeof taskFilter)}
                className="rounded-md border px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="in-progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
              <button 
                onClick={() => setIsModalOpen(true)}
                className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
              >
                Add Task
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {isLoadingTasks ? (
              <div className="py-12 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-neutral-900 border-r-transparent"></div>
                <p className="mt-3 text-sm text-neutral-600">Loading tasks...</p>
              </div>
            ) : paginatedTasks.length === 0 ? (
              <div className="py-12 text-center text-sm text-neutral-600">
                No tasks found. Click "Add Task" to create your first task.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-neutral-800">Title</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-800">Priority</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-800">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-800">Due Date</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-800">Tags</th>
                    <th className="px-4 py-3 text-right font-medium text-neutral-800">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paginatedTasks.map((task, idx) => (
                    <tr key={idx} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-900">{task.title}</div>
                        {task.description && <div className="text-xs text-neutral-600">{task.description}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs ${
                          task.priority === 'high' ? 'bg-red-100 text-red-800' :
                          task.priority === 'medium' ? 'bg-amber-100 text-amber-900' :
                          'bg-neutral-100 text-neutral-800'
                        }`}>
                          {task.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs ${
                          task.status === 'completed' ? 'bg-green-100 text-green-800' :
                          task.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                          'bg-neutral-100 text-neutral-800'
                        }`}>
                          {task.status.replace('-', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-700">
                        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(task.tags || []).map((tag, i) => (
                            <span key={i} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="mr-2 text-xs text-blue-600 hover:text-blue-800">Edit</button>
                        <button className="text-xs text-red-600 hover:text-red-800">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pagination
            currentPage={taskPage}
            totalItems={filteredTasks.length}
            itemsPerPage={itemsPerPage}
            onPageChange={setTaskPage}
          />
        </section>

        {/* Attendance Viewer */}
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">Attendance Records</h2>
            <select
              value={attendanceFilter}
              onChange={(e) => setAttendanceFilter(e.target.value as typeof attendanceFilter)}
              className="rounded-md border px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
            >
              <option value="all">All Status</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="late">Late</option>
              <option value="excused">Excused</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-neutral-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-neutral-800">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-800">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-800">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-800">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paginatedAttendance.map((record) => (
                  <tr key={record._id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-900">{record.user.name}</td>
                    <td className="px-4 py-3 text-neutral-700">{new Date(record.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${
                        record.status === 'present' ? 'bg-green-100 text-green-800' :
                        record.status === 'absent' ? 'bg-red-100 text-red-800' :
                        record.status === 'late' ? 'bg-amber-100 text-amber-900' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {record.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{record.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={attendancePage}
            totalItems={filteredAttendance.length}
            itemsPerPage={itemsPerPage}
            onPageChange={setAttendancePage}
          />
        </section>

        {/* Employee Rankings */}
        <section className="mb-8 rounded-xl border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">Employee Rankings</h2>
            <p className="text-xs text-neutral-600">Based on tasks, attendance & performance</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-neutral-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-neutral-800">Rank</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-800">Employee</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-800">Role</th>
                  <th className="px-4 py-3 text-center font-medium text-neutral-800">Tasks</th>
                  <th className="px-4 py-3 text-center font-medium text-neutral-800">Attendance</th>
                  <th className="px-4 py-3 text-center font-medium text-neutral-800">Performance</th>
                  <th className="px-4 py-3 text-center font-medium text-neutral-800">Score</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-800">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paginatedRankings.map((emp, index) => {
                  const globalIndex = (rankingPage - 1) * itemsPerPage + index
                  return (
                  <tr key={emp.employeeId} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full font-semibold ${
                        globalIndex === 0 ? 'bg-amber-100 text-amber-800' :
                        globalIndex === 1 ? 'bg-neutral-200 text-neutral-800' :
                        globalIndex === 2 ? 'bg-orange-100 text-orange-800' :
                        'bg-neutral-100 text-neutral-700'
                      }`}>
                        {globalIndex + 1}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-neutral-900">{emp.name}</td>
                    <td className="px-4 py-3 text-neutral-700">{emp.role}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                        {emp.tasksCompleted}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                        emp.attendanceRate >= 95 ? 'bg-green-100 text-green-800' :
                        emp.attendanceRate >= 85 ? 'bg-amber-100 text-amber-900' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {emp.attendanceRate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                        emp.performanceScore >= 8 ? 'bg-emerald-100 text-emerald-800' :
                        emp.performanceScore >= 6 ? 'bg-blue-100 text-blue-800' :
                        'bg-neutral-100 text-neutral-800'
                      }`}>
                        {emp.performanceScore}/10
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-lg font-bold text-neutral-900">{emp.overallRank}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button 
                        onClick={() => openPerformanceModal(emp)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Edit Metrics
                      </button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={rankingPage}
            totalItems={sortedRankings.length}
            itemsPerPage={itemsPerPage}
            onPageChange={setRankingPage}
          />

          <div className="mt-4 rounded-lg bg-neutral-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-neutral-900">Ranking Formula</h3>
            <p className="text-xs text-neutral-600">
              Overall Score = (Tasks Completed × 40%) + (Attendance Rate × 30%) + (Performance Score × 30%)
            </p>
          </div>
        </section>

        {/* Add Task Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setIsModalOpen(false)}>
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-neutral-900">Add New Task</h2>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg p-1 hover:bg-neutral-100"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleAddTask(); }} className="space-y-4">
                <div>
                  <label htmlFor="task-title" className="mb-1 block text-sm font-medium text-neutral-800">
                    Task Title *
                  </label>
                  <input
                    id="task-title"
                    type="text"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    required
                    className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                    placeholder="Enter task title"
                  />
                </div>

                <div>
                  <label htmlFor="task-description" className="mb-1 block text-sm font-medium text-neutral-800">
                    Description
                  </label>
                  <textarea
                    id="task-description"
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    rows={3}
                    className="block w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                    placeholder="Task details..."
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="task-priority" className="mb-1 block text-sm font-medium text-neutral-800">
                      Priority
                    </label>
                    <select
                      id="task-priority"
                      value={newTask.priority}
                      onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as TaskInput['priority'] })}
                      className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="task-status" className="mb-1 block text-sm font-medium text-neutral-800">
                      Status
                    </label>
                    <select
                      id="task-status"
                      value={newTask.status}
                      onChange={(e) => setNewTask({ ...newTask, status: e.target.value as TaskInput['status'] })}
                      className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                    >
                      <option value="pending">Pending</option>
                      <option value="in-progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="task-duedate" className="mb-1 block text-sm font-medium text-neutral-800">
                      Due Date
                    </label>
                    <input
                      id="task-duedate"
                      type="date"
                      value={newTask.dueDate}
                      onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                      className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                    />
                  </div>

                  <div>
                    <label htmlFor="task-assign" className="mb-1 block text-sm font-medium text-neutral-800">
                      Assign To *
                    </label>
                    <select
                      id="task-assign"
                      value={newTask.assignedTo}
                      onChange={(e) => setNewTask({ ...newTask, assignedTo: e.target.value })}
                      required
                      className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                    >
                      <option value="">Select employee</option>
                      {users.map((user) => (
                        <option key={user._id} value={user._id}>
                          {user.name} {user.email ? `(${user.email})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="task-tags" className="mb-1 block text-sm font-medium text-neutral-800">
                    Tags (comma-separated)
                  </label>
                  <input
                    id="task-tags"
                    type="text"
                    value={newTask.tags}
                    onChange={(e) => setNewTask({ ...newTask, tags: e.target.value })}
                    className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                    placeholder="urgent, dev, review"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    disabled={isAddingTask}
                    className="rounded-md border px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isAddingTask}
                    className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAddingTask ? 'Adding...' : 'Add Task'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Performance Modal */}
        {isPerformanceModalOpen && selectedEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setIsPerformanceModalOpen(false)}>
            <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-neutral-900">Update Performance Metrics</h2>
                <button
                  onClick={() => setIsPerformanceModalOpen(false)}
                  className="rounded-lg p-1 hover:bg-neutral-100"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-4 rounded-lg bg-neutral-50 p-3">
                <p className="text-sm font-medium text-neutral-900">{selectedEmployee.name}</p>
                <p className="text-xs text-neutral-600">{selectedEmployee.role}</p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); updatePerformance(); }} className="space-y-4">
                <div>
                  <label htmlFor="perf-tasks" className="mb-1 block text-sm font-medium text-neutral-800">
                    Tasks Completed
                  </label>
                  <input
                    id="perf-tasks"
                    type="number"
                    min="0"
                    value={performanceInput.tasksCompleted}
                    onChange={(e) => setPerformanceInput({ ...performanceInput, tasksCompleted: parseInt(e.target.value) || 0 })}
                    className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </div>

                <div>
                  <label htmlFor="perf-attendance" className="mb-1 block text-sm font-medium text-neutral-800">
                    Attendance Rate (%)
                  </label>
                  <input
                    id="perf-attendance"
                    type="number"
                    min="0"
                    max="100"
                    value={performanceInput.attendanceRate}
                    onChange={(e) => setPerformanceInput({ ...performanceInput, attendanceRate: Math.min(100, parseInt(e.target.value) || 0) })}
                    className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </div>

                <div>
                  <label htmlFor="perf-score" className="mb-1 block text-sm font-medium text-neutral-800">
                    Performance Score (1-10)
                  </label>
                  <input
                    id="perf-score"
                    type="number"
                    min="1"
                    max="10"
                    value={performanceInput.performanceScore}
                    onChange={(e) => setPerformanceInput({ ...performanceInput, performanceScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) })}
                    className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                  <p className="mt-1 text-xs text-neutral-600">Admin-assigned rating based on quality and initiative</p>
                </div>

                <div className="flex items-center justify-end gap-3 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setIsPerformanceModalOpen(false)}
                    className="rounded-md border px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                  >
                    Update
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add User Modal */}
        {isUserModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setIsUserModalOpen(false)}>
            <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-neutral-900">Register New User</h2>
                <button
                  onClick={() => setIsUserModalOpen(false)}
                  className="rounded-lg p-1 hover:bg-neutral-100"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleAddUser(); }} className="space-y-4">
                <div>
                  <label htmlFor="user-name" className="mb-1 block text-sm font-medium text-neutral-800">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="user-name"
                    type="text"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    placeholder="Enter full name"
                    className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="user-email" className="mb-1 block text-sm font-medium text-neutral-800">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="user-email"
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder="user@example.com"
                    className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="user-password" className="mb-1 block text-sm font-medium text-neutral-800">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="user-password"
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Minimum 6 characters"
                    className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                    required
                    minLength={6}
                  />
                  <p className="mt-1 text-xs text-neutral-600">Password must be at least 6 characters long</p>
                </div>

                <div>
                  <label htmlFor="user-role" className="mb-1 block text-sm font-medium text-neutral-800">
                    Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="user-role"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as 'user' | 'admin' })}
                    className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                    required
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <p className="mt-1 text-xs text-neutral-600">Admins have full access to dashboard and management features</p>
                </div>

                <div className="flex items-center justify-end gap-3 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setIsUserModalOpen(false)}
                    disabled={isAddingUser}
                    className="rounded-md border px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isAddingUser}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAddingUser ? 'Registering...' : 'Register User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

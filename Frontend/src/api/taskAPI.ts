import api from './axios'
import type { TaskInput } from '../components/Tasksadd'

// Query filters for GET /tasks; regular users only ever get their own tasks
export interface TaskFilters {
  status?: TaskInput['status']
  priority?: TaskInput['priority']
  assignedTo?: string
}

export const taskAPI = {
  // Get all tasks
  getTasks: async (filters?: TaskFilters) => {
    const response = await api.get('/tasks', { params: filters })
    return response.data
  },

  // Get single task
  getTask: async (id: string) => {
    const response = await api.get(`/tasks/${id}`)
    return response.data
  },

  // Create task
  createTask: async (data: TaskInput) => {
    const response = await api.post('/tasks', data)
    return response.data
  },

  // Update task
  updateTask: async (id: string, data: Partial<TaskInput>) => {
    const response = await api.put(`/tasks/${id}`, data)
    return response.data
  },

  // Delete task
  deleteTask: async (id: string) => {
    const response = await api.delete(`/tasks/${id}`)
    return response.data
  },

  // Request task completion (for users)
  requestCompletion: async (id: string) => {
    const response = await api.post(`/tasks/${id}/request-completion`)
    return response.data
  },
    
  // Approve task completion (admin only)
  approveCompletion: async (id: string) => {
    const response = await api.put(`/tasks/${id}/approve`)
    return response.data
  },

  // Reject task completion (admin only)
  rejectCompletion: async (id: string, data?: { rejectionReason?: string }) => {
    const response = await api.put(`/tasks/${id}/reject`, data || {})
    return response.data
  },

  // Get pending approval tasks (admin only)
  getPendingApprovalTasks: async () => {
    const response = await api.get('/tasks/pending-approval')
    return response.data
  },

  // Completed vs assigned tasks per team member
  getLeaderboard: async () => {
    const response = await api.get('/tasks/leaderboard')
    return response.data
  },
}

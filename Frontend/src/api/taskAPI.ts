import api from './axios';

interface TaskData {
  title: string;
  description?: string;
  assignedTo: string;
  dueDate?: string;
  priority?: string;
  status?: string;
  tags?: string[];
  notes?: string;
}

export const taskAPI = {
  // Get all tasks
  getTasks: async (filters?: { status?: string; priority?: string; assignedTo?: string }) => {
    const response = await api.get('/tasks', { params: filters });
    return response.data;
  },

  // Get single task
  getTask: async (id: string) => {
    const response = await api.get(`/tasks/${id}`);
    return response.data;
  },

  // Create task
  createTask: async (data: TaskData) => {
    const response = await api.post('/tasks', data);
    return response.data;
  },

  // Update task
  updateTask: async (id: string, data: Partial<TaskData>) => {
    const response = await api.put(`/tasks/${id}`, data);
    return response.data;
  },

  // Delete task
  deleteTask: async (id: string) => {
    const response = await api.delete(`/tasks/${id}`);
    return response.data;
  },
};

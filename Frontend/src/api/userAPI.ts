import api from './axios';

interface UpdateUserData {
  name?: string;
  email?: string;
  // Needed when changing your own email
  currentPassword?: string;
  phone?: string;
  department?: string;
  // null removes the photo
  profileImage?: string | null;
  emailNotifications?: boolean;
}

export const userAPI = {
  // Search users by name or email
  searchUsers: async (query: string) => {
    const response = await api.get('/users/search', { params: { q: query } });
    return response.data;
  },

  // Get all users (Admin only)
  getUsers: async (filters?: { role?: string; department?: string; isActive?: boolean }) => {
    const response = await api.get('/users', { params: filters });
    return response.data;
  },

  // Get single user
  getUser: async (id: string) => {
    const response = await api.get(`/users/${id}`);
    return response.data;
  },

  // Update user
  updateUser: async (id: string, data: UpdateUserData) => {
    const response = await api.put(`/users/${id}`, data);
    return response.data;
  },

  // Delete user (Admin only)
  deleteUser: async (id: string) => {
    const response = await api.delete(`/users/${id}`);
    return response.data;
  },

  // Toggle user active status (Admin only)
  toggleUserActive: async (id: string) => {
    const response = await api.put(`/users/${id}/toggle-active`);
    return response.data;
  },

  // Set a new password for a user who forgot theirs (Admin only)
  resetPassword: async (id: string, newPassword: string) => {
    const response = await api.put(`/users/${id}/reset-password`, { newPassword });
    return response.data;
  },

  // Delete your own account. The code is needed when two-step sign-in is on.
  deleteMe: async (password: string, code?: string) => {
    const response = await api.delete('/users/me', { data: { password, ...(code ? { code: code.trim() } : {}) } });
    return response.data;
  },

  // These two feed the profile page's figures. Tasks and attendance belong to
  // other screens, so this page reads them with its own calls.
  getTasksOf: async (userId: string) => {
    const response = await api.get('/tasks', { params: { assignedTo: userId } });
    return response.data;
  },

  getAttendanceOf: async (userId: string) => {
    const response = await api.get('/attendance', { params: { user: userId } });
    return response.data;
  },

  // Everyone the current user can chat with
  getChatUsers: async () => {
    const response = await api.get('/users/chat-list');
    return response.data;
  },
};

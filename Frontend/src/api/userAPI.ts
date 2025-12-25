import api from './axios';

interface UpdateUserData {
  name?: string;
  email?: string;
  phone?: string;
  department?: string;
  profileImage?: string;
}

export const userAPI = {
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
};

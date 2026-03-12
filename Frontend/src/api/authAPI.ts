import api from './axios';

interface LoginCredentials {
  email: string;
  password: string;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  phone?: string;
  department?: string;
  role?: string;
  profileImage?: string;
}

interface UpdatePasswordData {
  currentPassword: string;
  newPassword: string;
}

export const authAPI = {
  // Register new user
  register: async (data: RegisterData) => {
    const response = await api.post('/auth/register', data);
    return response.data;
  },

  // Login user
  login: async (credentials: LoginCredentials, rememberMe: boolean = false) => {
    const trimmedCredentials = {
      email: credentials.email.trim(),
      password: credentials.password
    };
    
    const response = await api.post('/auth/login', trimmedCredentials);
    
    const { success, data, message } = response.data;
    
    const token = data?.token;
    const user = data ? { 
      _id: data._id, 
      name: data.name, 
      email: data.email, 
      role: data.role,
      phone: data.phone,
      department: data.department,
      profileImage: data.profileImage,
      createdAt: data.createdAt
    } : null;
    
    if (success && token) {
      // Use localStorage for "Remember Me", sessionStorage for session-based (logout on close)
      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem('token', token);
      storage.setItem('user', JSON.stringify(user));
    }
    
    return { success, token, user, message };
  },

  // Get current user
  getMe: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },

  // Update password
  updatePassword: async (data: UpdatePasswordData) => {
    const response = await api.put('/auth/updatepassword', data);
    return response.data;
  },

  // Logout - clear both storage types
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
  },
};

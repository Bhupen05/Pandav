import api from './axios';

interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  phone?: string;
  department?: string;
  profileImage?: string;
}

interface UpdatePasswordData {
  currentPassword: string;
  newPassword: string;
}

// The signed-in user, as kept for the session
export interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  department?: string;
  createdAt?: string;
  profileImage?: string;
}

// Keeps the profile fields of a user returned by the API (login also sends the token)
const toUser = (data: User): User => ({
  _id: data._id,
  name: data.name,
  email: data.email,
  role: data.role,
  phone: data.phone,
  department: data.department,
  profileImage: data.profileImage,
  createdAt: data.createdAt,
});

export const authAPI = {
  // Register new user
  register: async (data: RegisterData) => {
    const response = await api.post('/auth/register', data);
    return response.data;
  },

  // Login user. Storing the session is up to the caller (AuthProvider).
  login: async (credentials: LoginCredentials) => {
    const response = await api.post('/auth/login', {
      email: credentials.email.trim(),
      password: credentials.password,
    });
    const { success, data, message } = response.data;
    return {
      success: Boolean(success),
      message: message as string | undefined,
      token: data?.token as string | undefined,
      user: data ? toUser(data) : null,
    };
  },

  // The current user, fresh from the server
  getMe: async (): Promise<User> => {
    const response = await api.get('/auth/me');
    return toUser(response.data.data);
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

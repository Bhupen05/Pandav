import api from './axios';

interface LoginCredentials {
  email: string;
  password: string;
  // Keep the session after the browser closes
  rememberMe?: boolean;
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
  teamId?: string | null;
}

// Keeps the profile fields of a user returned by the API
const toUser = (data: User): User => ({
  _id: data._id,
  name: data.name,
  email: data.email,
  role: data.role,
  phone: data.phone,
  department: data.department,
  profileImage: data.profileImage,
  createdAt: data.createdAt,
  teamId: data.teamId,
});

export const authAPI = {
  // Register new user
  register: async (data: RegisterData) => {
    const response = await api.post('/auth/register', data);
    return response.data;
  },

  // Login user. The server signs this browser in with an HttpOnly cookie.
  login: async (credentials: LoginCredentials) => {
    const response = await api.post('/auth/login', {
      email: credentials.email.trim(),
      password: credentials.password,
      rememberMe: credentials.rememberMe === true,
    });
    const { success, data, message } = response.data;
    return {
      success: Boolean(success),
      message: message as string | undefined,
      user: data ? toUser(data) : null,
    };
  },

  // The user this browser's session cookie belongs to. Rejects with status
  // 401 when signed out. The first request can wake a sleeping server, so it
  // waits longer than other requests.
  getMe: async (): Promise<User> => {
    const response = await api.get('/auth/me', { timeout: 90000 });
    return toUser(response.data.data);
  },

  // Update password
  updatePassword: async (data: UpdatePasswordData) => {
    const response = await api.put('/auth/updatepassword', data);
    return response.data;
  },

  // Clears the session cookie
  logout: async () => {
    await api.post('/auth/logout');
  },

  // One-minute ticket for opening the chat socket
  socketToken: async (): Promise<string> => {
    const response = await api.post('/auth/socket-token');
    return response.data.data.token;
  },
};

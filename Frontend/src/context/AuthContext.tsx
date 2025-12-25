import { createContext, useState, useContext, useEffect, type FC, type ReactNode } from 'react';
import { authAPI } from '../api/authAPI';

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  department?: string;
  bio?: string;
  createdAt?: string;
  profileImage?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (userData: any) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load user from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await authAPI.login({ email, password });
      if (response.success) {
        setUser(response.data);
        setToken(response.data.token);
      }
    } catch (error: any) {
      console.error('Login error:', error);
      // Provide more helpful error message
      if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
        throw new Error('Cannot connect to server. Please ensure the backend is running on http://localhost:5000');
      }
      throw new Error(error.message || 'Login failed');
    }
  };

  const register = async (userData: any) => {
    try {
      const response = await authAPI.register(userData);
      if (response.success) {
        setUser(response.data);
        setToken(response.data.token);
      }
    } catch (error: any) {
      throw new Error(error.message || 'Registration failed');
    }
  };

  const logout = () => {
    authAPI.logout();
    setUser(null);
    setToken(null);
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      localStorage.setItem('user', JSON.stringify({ ...parsed, ...updatedUser }));
    }
  };

  const value = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    isAdmin: user?.role === 'admin',
    loading,
    login,
    register,
    logout,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

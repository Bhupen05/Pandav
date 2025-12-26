import { createContext, useState, useContext, type FC, type ReactNode } from 'react';
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
  login: (email: string, password: string) => Promise<User>;  // Changed from Promise<void>
  register: (userData: any) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getInitialAuthState = () => {
  const storedUser = localStorage.getItem('user');
  const storedToken = localStorage.getItem('token');

  if (storedUser && storedToken) {
    try {
      const parsedUser = JSON.parse(storedUser) as User;
      return {
        user: parsedUser,
        token: storedToken,
        isAuthenticated: true,
        isAdmin: parsedUser.role === 'admin',
        loading: false,
      };
    } catch {
      return null;
    }
  }
  return null;
};

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => getInitialAuthState()?.user ?? null);
  const [token, setToken] = useState<string | null>(() => getInitialAuthState()?.token ?? null);
  const [loading, setLoading] = useState(() => getInitialAuthState()?.loading ?? false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => getInitialAuthState()?.isAuthenticated ?? false);
  const [isAdmin, setIsAdmin] = useState(() => getInitialAuthState()?.isAdmin ?? false);

  const hydrateSession = (authUser: User, authToken: string) => {
    setUser(authUser)
    setToken(authToken)
    setIsAuthenticated(true)
    setIsAdmin(authUser.role === 'admin')
    localStorage.setItem('user', JSON.stringify(authUser))
    localStorage.setItem('token', authToken)
    setLoading(false)
  }

  const login = async (email: string, password: string) => {
    const response = await authAPI.login({ email, password })
    
    console.log('Login API response:', response)  // Add this to debug
    
    const { success, token: authToken, user: authUser, message } = response

    if (!success || !authToken || !authUser) {
      console.log('Login failed - success:', success, 'token:', !!authToken, 'user:', authUser)
      throw new Error(message || 'Invalid credentials')
    }

    console.log('User role:', authUser.role)  // Check the role value
    
    hydrateSession(authUser, authToken)
    return authUser
  }

  const register = async (userData: any) => {
    const { success, token: authToken, user: authUser, message } = await authAPI.register(userData)
    if (!success || !authToken || !authUser) {
      throw new Error(message || 'Registration failed')
    }
    hydrateSession(authUser, authToken)
  }

  const logout = () => {
    authAPI.logout()
    setUser(null)
    setToken(null)
    setIsAuthenticated(false)
    setIsAdmin(false)
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
    isAuthenticated,
    isAdmin,
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

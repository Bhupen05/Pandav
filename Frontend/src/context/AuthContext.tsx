import { createContext, useState, useContext, type FC, type ReactNode } from 'react';
import { authAPI } from '../api/authAPI';
import { setSecureItem, removeSecureItem, CHAT_USER_ID_KEY, CHAT_USER_NAME_KEY } from '../utils/secureStorage';

interface User {
  id?: string;
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
  isTeamLeader: boolean;
  isTeamMember: boolean;
  loading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<User>;
  register: (userData: any) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getInitialAuthState = () => {
  // Check sessionStorage first (session-based login), then localStorage (remember me)
  const storedUser = sessionStorage.getItem('user') || localStorage.getItem('user');
  const storedToken = sessionStorage.getItem('token') || localStorage.getItem('token');

  if (storedUser && storedToken) {
    try {
      const parsedUser = JSON.parse(storedUser) as User;
      return {
        user: parsedUser,
        token: storedToken,
        isAuthenticated: true,
        isAdmin: parsedUser.role === 'admin',
        isTeamLeader: parsedUser.role === 'team_leader',
        isTeamMember: parsedUser.role === 'team_member',
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
  const [isTeamLeader, setIsTeamLeader] = useState(() => getInitialAuthState()?.isTeamLeader ?? false);
  const [isTeamMember, setIsTeamMember] = useState(() => getInitialAuthState()?.isTeamMember ?? false);

  const hydrateSession = (authUser: User, authToken: string, rememberMe: boolean = false) => {
    setUser(authUser)
    setToken(authToken)
    setIsAuthenticated(true)
    setIsAdmin(authUser.role === 'admin')
    setIsTeamLeader(authUser.role === 'team_leader')
    setIsTeamMember(authUser.role === 'team_member')
    
    // Use localStorage for "Remember Me", sessionStorage for session-based (logout on close)
    const storage = rememberMe ? localStorage : sessionStorage;
    storage.setItem('user', JSON.stringify(authUser))
    storage.setItem('token', authToken)
    // Store encrypted chat identity
    setSecureItem(CHAT_USER_ID_KEY, authUser._id)
    setSecureItem(CHAT_USER_NAME_KEY, authUser.name)
    setLoading(false)
  }

  const login = async (email: string, password: string, rememberMe: boolean = false) => {
    const response = await authAPI.login({ email, password }, rememberMe)
    
    console.log('Login API response:', response)  // Add this to debug
    
    const { success, token: authToken, user: authUser, message } = response

    if (!success || !authToken || !authUser) {
      console.log('Login failed - success:', success, 'token:', !!authToken, 'user:', authUser)
      throw new Error(message || 'Invalid credentials')
    }

    console.log('User role:', authUser.role)  // Check the role value
    
    hydrateSession(authUser, authToken, rememberMe)
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
    setIsTeamLeader(false)
    setIsTeamMember(false)
    removeSecureItem(CHAT_USER_ID_KEY)
    removeSecureItem(CHAT_USER_NAME_KEY)
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
    setIsAdmin(updatedUser.role === 'admin');
    setIsTeamLeader(updatedUser.role === 'team_leader');
    setIsTeamMember(updatedUser.role === 'team_member');
    // Check which storage is being used and update accordingly
    const sessionUser = sessionStorage.getItem('user');
    const localUser = localStorage.getItem('user');
    
    if (sessionUser) {
      const parsed = JSON.parse(sessionUser);
      sessionStorage.setItem('user', JSON.stringify({ ...parsed, ...updatedUser }));
    }
    if (localUser) {
      const parsed = JSON.parse(localUser);
      localStorage.setItem('user', JSON.stringify({ ...parsed, ...updatedUser }));
    }
  };

  const value = {
    user,
    token,
    isAuthenticated,
    isAdmin,
    isTeamLeader,
    isTeamMember,
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

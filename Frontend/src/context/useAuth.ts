import { createContext, useContext } from 'react';
import type { User } from '../api/authAPI';

export type { User };

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isTeamLeader: boolean;
  isTeamMember: boolean;
  // True while a session restored from storage is being confirmed with the server
  loading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<User>;
  logout: () => void;
  updateUser: (user: User) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

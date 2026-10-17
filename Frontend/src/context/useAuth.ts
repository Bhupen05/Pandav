import { createContext, useContext } from 'react';
import type { User } from '../api/authAPI';

export type { User };

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isTeamLeader: boolean;
  isTeamMember: boolean;
  // True until the server has said whether this browser is signed in
  loading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<User>;
  // Rejects, leaving the user signed in, if the server can't clear the session
  logout: () => Promise<void>;
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

import { createContext, useContext } from 'react';
import type { LoginResult, User } from '../api/authAPI';

export type { User };

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isTeamLeader: boolean;
  isTeamMember: boolean;
  // True until the server has said whether this browser is signed in
  loading: boolean;
  // First sign-in step. Resolves to the user, or, with two-step sign-in on, to
  // a ticket to pass to completeTwoFactor with a code. Rejects with the server's error.
  login: (email: string, password: string, rememberMe?: boolean) => Promise<LoginResult>;
  // Second step: the ticket from login and a code from the authenticator app (or a backup code)
  completeTwoFactor: (ticket: string, code: string) => Promise<User>;
  // Rejects, leaving the user signed in, if the server can't clear the session
  logout: () => Promise<void>;
  // Ends every session of the account, in every browser, this one included
  logoutAll: () => Promise<void>;
  updateUser: (user: User) => void;
  // Asks the server who is signed in and updates the user
  refreshUser: () => Promise<User>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

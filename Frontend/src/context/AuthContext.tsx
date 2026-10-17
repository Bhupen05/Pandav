import { useEffect, useState, type FC, type ReactNode } from 'react';
import { authAPI, type User } from '../api/authAPI';
import type { ApiError } from '../api/axios';
import { AuthContext } from './useAuth';

interface Session {
  user: User;
  token: string;
}

// "Remember me" sessions are kept in localStorage, others in sessionStorage
// (cleared when the browser closes)
const activeStorage = () =>
  sessionStorage.getItem('token') ? sessionStorage : localStorage.getItem('token') ? localStorage : null;

const readStoredSession = (): Session | null => {
  const storage = activeStorage();
  const token = storage?.getItem('token');
  const storedUser = storage?.getItem('user');
  if (!token || !storedUser) return null;
  try {
    return { token, user: JSON.parse(storedUser) as User };
  } catch {
    return null;
  }
};

const storeUser = (user: User) => activeStorage()?.setItem('user', JSON.stringify(user));

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(readStoredSession);
  const [loading, setLoading] = useState(() => readStoredSession() !== null);

  // A stored session (and the role in it) is only trusted once the server
  // confirms it. This also picks up profile changes made elsewhere.
  useEffect(() => {
    // Written by older versions; nothing reads them any more
    localStorage.removeItem('chat_uid');
    localStorage.removeItem('chat_uname');

    const stored = readStoredSession();
    if (!stored) return;

    let cancelled = false;
    const isStillCurrent = (current: Session | null) => current?.token === stored.token;

    authAPI
      .getMe()
      .then((user) => {
        if (cancelled || !isStillCurrent(readStoredSession())) return;
        storeUser(user);
        setSession((current) => (isStillCurrent(current) ? { ...stored, user } : current));
      })
      .catch((error: ApiError) => {
        // Expired, revoked or deactivated. If the server can't be reached,
        // keep the session: every API call is checked by the server anyway.
        if (cancelled || error.status !== 401) return;
        if (isStillCurrent(readStoredSession())) authAPI.logout();
        setSession((current) => (isStillCurrent(current) ? null : current));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string, rememberMe = false) => {
    const { success, token, user, message } = await authAPI.login({ email, password });
    if (!success || !token || !user) {
      throw new Error(message || 'Invalid credentials');
    }

    authAPI.logout();
    const storage = rememberMe ? localStorage : sessionStorage;
    storage.setItem('token', token);
    storage.setItem('user', JSON.stringify(user));
    setSession({ user, token });
    setLoading(false);
    return user;
  };

  const logout = () => {
    authAPI.logout();
    setSession(null);
    setLoading(false);
  };

  const updateUser = (user: User) => {
    storeUser(user);
    setSession((current) => (current ? { ...current, user } : current));
  };

  const user = session?.user ?? null;
  const value = {
    user,
    token: session?.token ?? null,
    isAuthenticated: session !== null,
    isAdmin: user?.role === 'admin',
    isTeamLeader: user?.role === 'team_leader',
    isTeamMember: user?.role === 'team_member',
    loading,
    login,
    logout,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

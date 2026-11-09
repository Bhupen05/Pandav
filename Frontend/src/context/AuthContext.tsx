import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { authAPI, type User } from '../api/authAPI';
import { onPasswordChangeRequired } from '../api/axios';
import { AuthContext } from './useAuth';

// Written by versions that kept the session in browser storage. Those tokens
// no longer work (the session is an HttpOnly cookie now), so drop them.
const LEGACY_KEYS = ['token', 'user', 'chat_uid', 'chat_uname'];

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Set when the user signs in or out here, so a slow session check can't undo it
  const sessionChangedRef = useRef(false);

  // Scripts can't read the session cookie, so ask the server whose it is.
  // This also picks up profile and role changes made elsewhere.
  useEffect(() => {
    LEGACY_KEYS.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });

    let cancelled = false;
    authAPI
      .getMe()
      .then((current) => {
        if (!cancelled && !sessionChangedRef.current) setUser(current);
      })
      .catch(() => {
        // Signed out, expired, deactivated, or the server is unreachable:
        // in every case this browser isn't signed in
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A request was refused because an admin reset this password: from now on
  // the app only lets the user choose a new one
  useEffect(
    () => onPasswordChangeRequired(() => setUser((current) => (current ? { ...current, mustChangePassword: true } : current))),
    [],
  );

  const signedIn = (next: User) => {
    sessionChangedRef.current = true;
    setUser(next);
    setLoading(false);
    return next;
  };

  const login = async (email: string, password: string, rememberMe = false) => {
    const result = await authAPI.login({ email, password, rememberMe });
    if (result.user) signedIn(result.user);
    return result;
  };

  const completeTwoFactor = async (ticket: string, code: string) => signedIn(await authAPI.verifyTwoFactor(ticket, code));

  const signedOut = () => {
    sessionChangedRef.current = true;
    setUser(null);
    setLoading(false);
  };

  // Only signs out here once the server has cleared the cookie; otherwise the
  // browser would still be signed in after a reload
  const logout = async () => {
    await authAPI.logout();
    signedOut();
  };

  const logoutAll = async () => {
    await authAPI.logoutAll();
    signedOut();
  };

  const refreshUser = useCallback(async () => {
    const current = await authAPI.getMe();
    setUser(current);
    return current;
  }, []);

  const value = {
    user,
    isAuthenticated: user !== null,
    isAdmin: user?.role === 'admin',
    isTeamLeader: user?.role === 'team_leader',
    isTeamMember: user?.role === 'team_member',
    loading,
    login,
    completeTwoFactor,
    logout,
    logoutAll,
    updateUser: setUser,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

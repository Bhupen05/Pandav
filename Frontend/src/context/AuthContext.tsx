import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { authAPI, type User } from '../api/authAPI';
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

  const login = async (email: string, password: string, rememberMe = false) => {
    const { success, user: signedIn, message } = await authAPI.login({ email, password, rememberMe });
    if (!success || !signedIn) {
      throw new Error(message || 'Invalid credentials');
    }

    sessionChangedRef.current = true;
    setUser(signedIn);
    setLoading(false);
    return signedIn;
  };

  // Only signs out here once the server has cleared the cookie; otherwise the
  // browser would still be signed in after a reload
  const logout = async () => {
    await authAPI.logout();
    sessionChangedRef.current = true;
    setUser(null);
    setLoading(false);
  };

  const value = {
    user,
    isAuthenticated: user !== null,
    isAdmin: user?.role === 'admin',
    isTeamLeader: user?.role === 'team_leader',
    isTeamMember: user?.role === 'team_member',
    loading,
    login,
    logout,
    updateUser: setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

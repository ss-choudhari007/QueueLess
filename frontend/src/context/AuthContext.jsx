import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { restartSocket } from '../lib/socket.js';

const AuthContext = createContext(null);

// Only internal paths are allowed as post-login redirects (no open redirects).
export function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : null;
}

export function homePathFor(user) {
  if (!user) return '/login';
  if (user.role === 'OWNER') return '/owner';
  if (user.role === 'STAFF') return '/staff';
  return '/app';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api.get('/api/auth/me');
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    reload().finally(() => {
      setLoading(false);
      restartSocket();
    });
    const ended = () => setUser(null);
    window.addEventListener('ql:session-ended', ended);
    return () => window.removeEventListener('ql:session-ended', ended);
  }, [reload]);

  const signedIn = useCallback((next) => {
    setUser(next);
    restartSocket();
    return next;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      reload,
      signedIn,
      async login(email, password) {
        const data = await api.post('/api/auth/login', { email, password });
        return signedIn(data.user);
      },
      async register(form) {
        const data = await api.post('/api/auth/register', form);
        return signedIn(data.user);
      },
      async logout(everywhere = false) {
        try {
          await api.post(everywhere ? '/api/auth/logout-all' : '/api/auth/logout');
        } finally {
          setUser(null);
          restartSocket();
        }
      },
    }),
    [user, loading, reload, signedIn]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

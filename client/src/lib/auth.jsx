import { createContext, useContext, useEffect, useState } from 'react';
import { api, tokenStore } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Restore cached user immediately so the app never flashes to /login on refresh
  const [user, setUser] = useState(() => tokenStore.get() ? tokenStore.getUser() : null);
  // If we have a cached token+user, mark ready right away (no white flash)
  const [ready, setReady] = useState(() => !!(tokenStore.get() && tokenStore.getUser()));

  const refresh = async () => {
    try {
      const data = await api.auth.me();
      if (data.user) {
        tokenStore.setUser(data.user); // keep cache fresh
        setUser(data.user);
      } else {
        // Server says no valid session — clear everything
        tokenStore.clear();
        setUser(null);
      }
    } catch {
      // Network error (server spinning up / offline) — keep cached user, don't log out
      console.warn('[auth] /me network error, keeping cached session');
    }
  };

  useEffect(() => {
    if (tokenStore.get()) {
      // Already marked ready above; verify session in background silently
      refresh();
    } else {
      // No token — must check server (will redirect to login if no session)
      refresh().finally(() => setReady(true));
    }
  }, []);

  const login = async (email, password) => {
    const data = await api.auth.login(email, password);
    if (data.token) tokenStore.set(data.token);
    if (data.user)  tokenStore.setUser(data.user);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api.auth.logout(); } catch {}
    tokenStore.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

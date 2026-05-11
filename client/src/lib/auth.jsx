import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = async () => {
    try {
      const data = await api.auth.me();
      setUser(data.user || null);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, []);

  const login = async (email, password) => {
    const data = await api.auth.login(email, password);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api.auth.logout(); } catch {}
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

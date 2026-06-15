import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, getToken } from '../api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setStudent(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      setStudent(data.student);
    } catch {
      setToken(null);
      setStudent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = (token, studentData) => {
    setToken(token);
    setStudent(studentData);
  };

  const logout = () => {
    setToken(null);
    setStudent(null);
  };

  return (
    <AuthCtx.Provider value={{ student, setStudent, loading, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}

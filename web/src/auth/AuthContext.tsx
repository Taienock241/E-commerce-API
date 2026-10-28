import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, configureApi } from "../api/client";
import type { AuthResponse, Role, User } from "../api/types";

const TOKEN_KEY = "ecommerce.token";
const USER_KEY = "ecommerce.user";

interface AuthValue {
  token: string | null;
  user: User | null;
  role: Role | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, name: string): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthValue | null>(null);

function storedUser(): User | null {
  try {
    const value = localStorage.getItem(USER_KEY);
    return value ? (JSON.parse(value) as User) : null;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(storedUser);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    configureApi({
      readToken: () => localStorage.getItem(TOKEN_KEY),
      onUnauthorized: () => {
        logout();
        window.location.hash = "#/login";
      },
    });
  }, [logout]);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setLoading(false);
      return () => { alive = false; };
    }
    setLoading(true);
    api.get<User>("/auth/me")
      .then((currentUser) => {
        if (!alive) return;
        setUser(currentUser);
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
      })
      .catch(() => {
        if (alive) logout();
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, logout]);

  const saveSession = useCallback((result: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setToken(result.token);
    setUser(result.user);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<AuthResponse>("/auth/login", { email, password });
    saveSession(result);
    navigate("/");
  }, [navigate, saveSession]);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const result = await api.post<AuthResponse>("/auth/register", { email, password, name });
    saveSession(result);
    navigate("/");
  }, [navigate, saveSession]);

  const value = useMemo<AuthValue>(() => ({ token, user, role: user?.role ?? null, loading, login, register, logout }), [token, user, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

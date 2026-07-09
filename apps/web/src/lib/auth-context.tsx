'use client';

import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiClient } from './api-client.js';
import { clearDashboardPreloadCache } from './dashboard-preload.js';
import { getWebEnv } from './env.js';
import { getSupabaseBrowserClient } from './supabase-client.js';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ token: string; user: AuthUser }>;
  logout: () => void;
  apiClient: ApiClient;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'lf_access_token';
const USER_KEY = 'lf_user';

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function mapSupabaseUser(user: SupabaseUser): AuthUser {
  const metadata =
    user.user_metadata && typeof user.user_metadata === 'object'
      ? (user.user_metadata as Record<string, unknown>)
      : {};

  const fullName = readString(metadata.full_name ?? metadata.name);
  const nameParts = fullName ? fullName.split(/\s+/).filter(Boolean) : [];

  const firstName =
    readString(metadata.first_name) ??
    nameParts[0] ??
    (user.email ? user.email.split('@')[0] : null) ??
    'User';

  const lastName =
    readString(metadata.last_name) ??
    (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '');

  return {
    id: user.id,
    email: user.email ?? '',
    firstName,
    lastName,
  };
}

function persistAuthState(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearAuthState(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearDashboardPreloadCache();
}

function readPersistedAuthState(): { token: string; user: AuthUser } | null {
  const storedToken = readString(localStorage.getItem(TOKEN_KEY));
  const storedUser = localStorage.getItem(USER_KEY);
  if (!storedToken || !storedUser) {
    return null;
  }

  try {
    const parsedUser = JSON.parse(storedUser) as Partial<AuthUser>;
    const id = readString(parsedUser.id);
    const email = readString(parsedUser.email);
    const firstName = readString(parsedUser.firstName);
    const lastName = typeof parsedUser.lastName === 'string' ? parsedUser.lastName : null;

    if (!id || !email || !firstName || lastName === null) {
      return null;
    }

    return {
      token: storedToken,
      user: {
        id,
        email,
        firstName,
        lastName,
      },
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let supabase: ReturnType<typeof getSupabaseBrowserClient> | null = null;

    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      if (process.env.NODE_ENV === 'production') {
        setIsLoading(false);
        return;
      }
      // Dev-only fallback when Supabase is not configured
      const devUser: AuthUser = { id: 'dev-user', email: 'dev@localhost', firstName: 'Dev', lastName: 'User' };
      setToken('dev-token');
      setUser(devUser);
      setIsLoading(false);
      return;
    }

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) {
          return;
        }

        if (error || !data.session || !data.session.user) {
          // Clear stale Supabase-internal tokens (e.g. after Supabase restart)
          void supabase!.auth.signOut().catch(() => {});
          clearAuthState();
          setToken(null);
          setUser(null);
          return;
        }

        const mappedUser = mapSupabaseUser(data.session.user);
        persistAuthState(data.session.access_token, mappedUser);
        setToken(data.session.access_token);
        setUser(mappedUser);
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        const persisted = readPersistedAuthState();
        if (persisted) {
          setToken(persisted.token);
          setUser(persisted.user);
          return;
        }

        void supabase?.auth.signOut().catch(() => {});
        clearAuthState();
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return;
      }

      if (!session || !session.user) {
        clearAuthState();
        setToken(null);
        setUser(null);
        return;
      }

      const mappedUser = mapSupabaseUser(session.user);
      persistAuthState(session.access_token, mappedUser);
      setToken(session.access_token);
      setUser(mappedUser);
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const apiClient = useMemo(() => {
    const env = getWebEnv();
    return new ApiClient(env.NEXT_PUBLIC_API_BASE_URL, () => token, env.NEXT_PUBLIC_API_TIMEOUT_MS);
  }, [token]);

  const login = useCallback(
    async (email: string, password: string) => {
      let supabase: ReturnType<typeof getSupabaseBrowserClient>;
      try {
        supabase = getSupabaseBrowserClient();
      } catch {
        throw new Error('Supabase auth is not configured');
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session || !data.user) {
        throw new Error(error?.message ?? 'Login failed');
      }

      const mappedUser = mapSupabaseUser(data.user);
      persistAuthState(data.session.access_token, mappedUser);
      setToken(data.session.access_token);
      setUser(mappedUser);
      return { token: data.session.access_token, user: mappedUser };
    },
    [],
  );

  const logout = useCallback(() => {
    try {
      void getSupabaseBrowserClient().auth.signOut();
    } catch {
      // Supabase not configured — just clear local state
    }
    clearAuthState();
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!token,
      isLoading,
      login,
      logout,
      apiClient,
    }),
    [user, token, isLoading, login, logout, apiClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

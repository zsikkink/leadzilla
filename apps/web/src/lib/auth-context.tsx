'use client';

import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiClient } from './api-client.js';
import { clearDashboardPreloadCache } from './dashboard-preload.js';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PREVIEW_USER,
  isDemoPreviewCredentials,
  shouldFallbackPersistedDemoSession,
} from './demo-preview.js';
import { getWebEnv } from './env.js';
import { getSupabaseBrowserClient } from './supabase-client.js';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export type AuthSessionMode = 'live' | 'preview';

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  sessionMode: AuthSessionMode | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (
    email: string,
    password: string,
  ) => Promise<{ token: string | null; user: AuthUser; sessionMode: AuthSessionMode }>;
  logout: () => void;
  apiClient: ApiClient;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'lf_access_token';
const USER_KEY = 'lf_user';
const SESSION_MODE_KEY = 'lf_session_mode';
const DEMO_SERVICE_DEADLINE_MS = 5_000;
const AUTH_BOOTSTRAP_DEADLINE_MS = 5_000;
const DEMO_READINESS_CACHE_TTL_MS = 10_000;

let demoReadinessCache: {
  accessToken: string;
  expiresAt: number;
  promise: Promise<boolean>;
} | null = null;

export function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new Error('Demo service readiness timed out')),
      timeoutMs,
    );
    void promise.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function isDemoUserEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === DEMO_EMAIL;
}

async function probeDemoApiReadiness(accessToken: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    DEMO_SERVICE_DEADLINE_MS,
  );

  try {
    const env = getWebEnv();
    const response = await fetch(
      `${env.NEXT_PUBLIC_API_BASE_URL}/v1/demo/readiness`,
      {
        method: 'GET',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      },
    );
    return response.ok;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function isDemoApiReady(accessToken: string): Promise<boolean> {
  const now = Date.now();
  if (
    demoReadinessCache?.accessToken === accessToken &&
    demoReadinessCache.expiresAt > now
  ) {
    return demoReadinessCache.promise;
  }

  const promise = probeDemoApiReadiness(accessToken);
  demoReadinessCache = {
    accessToken,
    expiresAt: now + DEMO_READINESS_CACHE_TTL_MS,
    promise,
  };
  void promise.then((isReady) => {
    if (!isReady && demoReadinessCache?.promise === promise) {
      demoReadinessCache = null;
    }
  });
  return promise;
}

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

function persistAuthState(
  token: string | null,
  user: AuthUser,
  sessionMode: AuthSessionMode,
): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(SESSION_MODE_KEY, sessionMode);
  } catch {
    // Storage can be unavailable in privacy-restricted browsers. In-memory auth remains usable.
  }
}

function clearAuthState(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(SESSION_MODE_KEY);
  } catch {
    // Storage cleanup is best-effort.
  }
  clearDashboardPreloadCache();
}

function readPersistedAuthState(): {
  token: string | null;
  user: AuthUser;
  sessionMode: AuthSessionMode;
} | null {
  let storedToken: string | null;
  let storedUser: string | null;
  let storedSessionMode: string | null;

  try {
    storedToken = readString(localStorage.getItem(TOKEN_KEY));
    storedUser = localStorage.getItem(USER_KEY);
    storedSessionMode = localStorage.getItem(SESSION_MODE_KEY);
  } catch {
    return null;
  }

  const sessionMode: AuthSessionMode =
    storedSessionMode === 'preview' ? 'preview' : 'live';

  if (!storedUser || (sessionMode === 'live' && !storedToken)) {
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
      sessionMode,
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
  const [sessionMode, setSessionMode] = useState<AuthSessionMode | null>(null);
  const sessionModeRef = useRef<AuthSessionMode | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let supabase: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    const persisted = readPersistedAuthState();

    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      if (persisted?.sessionMode === 'preview') {
        sessionModeRef.current = 'preview';
        setToken(null);
        setUser(persisted.user);
        setSessionMode('preview');
        setIsLoading(false);
        return;
      }
      if (process.env.NODE_ENV === 'production') {
        setIsLoading(false);
        return;
      }
      // Dev-only fallback when Supabase is not configured
      const devUser: AuthUser = { id: 'dev-user', email: 'dev@localhost', firstName: 'Dev', lastName: 'User' };
      setToken('dev-token');
      setUser(devUser);
      sessionModeRef.current = 'live';
      setSessionMode('live');
      setIsLoading(false);
      return;
    }

    const applyLiveSession = (accessToken: string, supabaseUser: SupabaseUser) => {
      const mappedUser = mapSupabaseUser(supabaseUser);
      persistAuthState(accessToken, mappedUser, 'live');
      setToken(accessToken);
      setUser(mappedUser);
      sessionModeRef.current = 'live';
      setSessionMode('live');
    };

    const applyPreviewSession = (previewUser: AuthUser = { ...DEMO_PREVIEW_USER }) => {
      persistAuthState(null, previewUser, 'preview');
      setToken(null);
      setUser(previewUser);
      sessionModeRef.current = 'preview';
      setSessionMode('preview');
    };

    const applyDemoSessionWhenReady = async (
      accessToken: string,
      supabaseUser: SupabaseUser,
    ) => {
      if (await isDemoApiReady(accessToken)) {
        if (isMounted) {
          applyLiveSession(accessToken, supabaseUser);
        }
        return;
      }

      if (isMounted) {
        applyPreviewSession();
      }
    };

    let unsubscribe = () => {};
    try {
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!isMounted) {
          return;
        }

        if (!session || !session.user) {
          if (sessionModeRef.current === 'preview') {
            return;
          }
          clearAuthState();
          setToken(null);
          setUser(null);
          sessionModeRef.current = null;
          setSessionMode(null);
          return;
        }

        if (isDemoUserEmail(session.user.email)) {
          void applyDemoSessionWhenReady(session.access_token, session.user);
          return;
        }

        applyLiveSession(session.access_token, session.user);
      });
      unsubscribe = () => subscription.subscription.unsubscribe();
    } catch {
      // Session restoration below still settles the UI when subscription setup is unavailable.
    }

    if (persisted?.sessionMode === 'preview') {
      applyPreviewSession(persisted.user);
      setIsLoading(false);

      void withDeadline(
        supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
        DEMO_SERVICE_DEADLINE_MS,
      )
        .then(({ data, error }) => {
          if (!isMounted || error || !data.session || !data.user) {
            return;
          }
          return applyDemoSessionWhenReady(data.session.access_token, data.user);
        })
        .catch(() => {
          // Keep the bundled preview available while live demo auth is unavailable.
        });

      return () => {
        isMounted = false;
        unsubscribe();
      };
    }

    const isPersistedDemoUser = isDemoUserEmail(persisted?.user.email);
    const boundedSessionRequest = (() => {
      try {
        return withDeadline(supabase.auth.getSession(), AUTH_BOOTSTRAP_DEADLINE_MS);
      } catch (error: unknown) {
        return Promise.reject(error);
      }
    })();

    void boundedSessionRequest
      .then(async ({ data, error }) => {
        if (!isMounted) {
          return;
        }

        if (error || !data.session || !data.session.user) {
          if (
            shouldFallbackPersistedDemoSession({
              email: persisted?.user.email,
              hasSession: Boolean(data.session?.user),
              hasSessionError: Boolean(error),
            })
          ) {
            applyPreviewSession();
            return;
          }

          // Clear stale Supabase-internal tokens (e.g. after Supabase restart)
          void supabase!.auth.signOut().catch(() => {});
          clearAuthState();
          setToken(null);
          setUser(null);
          sessionModeRef.current = null;
          setSessionMode(null);
          return;
        }

        if (isDemoUserEmail(data.session.user.email)) {
          await applyDemoSessionWhenReady(data.session.access_token, data.session.user);
          return;
        }

        applyLiveSession(data.session.access_token, data.session.user);
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        if (isPersistedDemoUser) {
          applyPreviewSession();
          return;
        }

        const currentPersisted = readPersistedAuthState();
        if (currentPersisted) {
          setToken(currentPersisted.token);
          setUser(currentPersisted.user);
          sessionModeRef.current = currentPersisted.sessionMode;
          setSessionMode(currentPersisted.sessionMode);
          return;
        }

        void supabase?.auth.signOut().catch(() => {});
        clearAuthState();
        setToken(null);
        setUser(null);
        sessionModeRef.current = null;
        setSessionMode(null);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const apiClient = useMemo(() => {
    const env = getWebEnv();
    return new ApiClient(env.NEXT_PUBLIC_API_BASE_URL, () => token, env.NEXT_PUBLIC_API_TIMEOUT_MS);
  }, [token]);

  const login = useCallback(
    async (email: string, password: string) => {
      const isDemoLogin = isDemoPreviewCredentials(email, password);
      const startPreviewSession = () => {
        const previewUser: AuthUser = { ...DEMO_PREVIEW_USER };
        persistAuthState(null, previewUser, 'preview');
        sessionModeRef.current = 'preview';
        setToken(null);
        setUser(previewUser);
        setSessionMode('preview');
        return { token: null, user: previewUser, sessionMode: 'preview' as const };
      };

      let supabase: ReturnType<typeof getSupabaseBrowserClient>;
      try {
        supabase = getSupabaseBrowserClient();
      } catch {
        if (isDemoLogin) {
          return startPreviewSession();
        }
        throw new Error('Supabase auth is not configured');
      }

      let authResult: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
      try {
        const authRequest = supabase.auth.signInWithPassword({ email, password });
        authResult = isDemoLogin
          ? await withDeadline(authRequest, DEMO_SERVICE_DEADLINE_MS)
          : await authRequest;
      } catch (error: unknown) {
        if (isDemoLogin) {
          return startPreviewSession();
        }
        throw error;
      }

      const { data, error } = authResult;
      if (error || !data.session || !data.user) {
        if (isDemoLogin) {
          return startPreviewSession();
        }
        throw new Error(error?.message ?? 'Login failed');
      }

      if (isDemoLogin && !(await isDemoApiReady(data.session.access_token))) {
        return startPreviewSession();
      }

      const mappedUser = mapSupabaseUser(data.user);
      persistAuthState(data.session.access_token, mappedUser, 'live');
      setToken(data.session.access_token);
      setUser(mappedUser);
      sessionModeRef.current = 'live';
      setSessionMode('live');
      return { token: data.session.access_token, user: mappedUser, sessionMode: 'live' as const };
    },
    [],
  );

  const logout = useCallback(() => {
    try {
      void getSupabaseBrowserClient().auth.signOut().catch(() => {});
    } catch {
      // Supabase not configured — just clear local state
    }
    clearAuthState();
    sessionModeRef.current = null;
    setToken(null);
    setUser(null);
    setSessionMode(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      sessionMode,
      isAuthenticated: sessionMode === 'preview' || !!token,
      isLoading,
      login,
      logout,
      apiClient,
    }),
    [user, token, sessionMode, isLoading, login, logout, apiClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

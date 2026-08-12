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
  DEMO_PREVIEW_USER,
  shouldUsePublicPreviewSession,
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
  logout: () => void;
  apiClient: ApiClient;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'lf_access_token';
const USER_KEY = 'lf_user';
const SESSION_MODE_KEY = 'lf_session_mode';
const AUTH_BOOTSTRAP_DEADLINE_MS = 5_000;

type RestorableAuthClient = {
  getUser: (
    accessToken: string,
  ) => Promise<{ data: { user: SupabaseUser | null }; error: unknown }>;
};

export function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new Error('Session check timed out')),
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

export async function verifyRestorableSession(
  auth: RestorableAuthClient,
  accessToken: string,
  expectedUserId: string,
): Promise<SupabaseUser | null> {
  try {
    const { data, error } = await withDeadline(
      auth.getUser(accessToken),
      AUTH_BOOTSTRAP_DEADLINE_MS,
    );
    const verifiedUser = data.user;

    if (
      error ||
      !verifiedUser ||
      verifiedUser.id !== expectedUserId ||
      shouldUsePublicPreviewSession(verifiedUser.email)
    ) {
      return null;
    }

    return verifiedUser;
  } catch {
    return null;
  }
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser>({ ...DEMO_PREVIEW_USER });
  const [sessionMode, setSessionMode] = useState<AuthSessionMode>('preview');
  const sessionRevisionRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    let sharedDemoSignOutStarted = false;
    let supabase: ReturnType<typeof getSupabaseBrowserClient>;

    const applyPreviewSession = () => {
      if (!isMounted) return;

      const previewUser: AuthUser = { ...DEMO_PREVIEW_USER };
      clearDashboardPreloadCache();
      persistAuthState(null, previewUser, 'preview');
      setToken(null);
      setUser(previewUser);
      setSessionMode('preview');
    };

    const applyLiveSession = (accessToken: string, supabaseUser: SupabaseUser) => {
      if (!isMounted) return;

      const mappedUser = mapSupabaseUser(supabaseUser);
      persistAuthState(accessToken, mappedUser, 'live');
      setToken(accessToken);
      setUser(mappedUser);
      setSessionMode('live');
    };

    const restoreVerifiedSession = async (
      accessToken: string,
      supabaseUser: SupabaseUser,
      revision: number,
    ) => {
      if (shouldUsePublicPreviewSession(supabaseUser.email)) {
        if (revision === sessionRevisionRef.current) {
          applyPreviewSession();
        }
        if (!sharedDemoSignOutStarted) {
          sharedDemoSignOutStarted = true;
          void supabase.auth.signOut().catch(() => {});
        }
        return;
      }

      const verifiedUser = await verifyRestorableSession(
        supabase.auth,
        accessToken,
        supabaseUser.id,
      );
      if (!isMounted || revision !== sessionRevisionRef.current) return;

      if (!verifiedUser) {
        applyPreviewSession();
        return;
      }

      applyLiveSession(accessToken, verifiedUser);
    };

    const handleSession = (
      session: { access_token: string; user: SupabaseUser } | null,
      revision = ++sessionRevisionRef.current,
    ) => {
      if (!isMounted || revision !== sessionRevisionRef.current) return;

      if (!session?.user) {
        applyPreviewSession();
        return;
      }

      void restoreVerifiedSession(session.access_token, session.user, revision);
    };

    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      applyPreviewSession();
      return;
    }

    let unsubscribe = () => {};
    try {
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!isMounted) return;
        const eventRevision = ++sessionRevisionRef.current;
        globalThis.setTimeout(() => handleSession(session, eventRevision), 0);
      });
      unsubscribe = () => subscription.subscription.unsubscribe();
    } catch {
      // The bounded restoration below still leaves the public preview usable.
    }

    const bootstrapRevision = sessionRevisionRef.current;
    const sessionRequest = (() => {
      try {
        return withDeadline(supabase.auth.getSession(), AUTH_BOOTSTRAP_DEADLINE_MS);
      } catch (error: unknown) {
        return Promise.reject(error);
      }
    })();

    void sessionRequest
      .then(({ data, error }) => {
        if (!isMounted || bootstrapRevision !== sessionRevisionRef.current) return;

        if (error || !data.session?.user) {
          handleSession(null);
          return;
        }

        handleSession(data.session);
      })
      .catch(() => {
        if (isMounted && bootstrapRevision === sessionRevisionRef.current) {
          handleSession(null);
        }
      });

    return () => {
      isMounted = false;
      sessionRevisionRef.current += 1;
      unsubscribe();
    };
  }, []);

  const apiClient = useMemo(() => {
    const env = getWebEnv();
    return new ApiClient(env.NEXT_PUBLIC_API_BASE_URL, () => token, env.NEXT_PUBLIC_API_TIMEOUT_MS);
  }, [token]);

  const logout = useCallback(() => {
    sessionRevisionRef.current += 1;
    try {
      void getSupabaseBrowserClient().auth.signOut().catch(() => {});
    } catch {
      // Supabase is optional for the bundled public preview.
    }

    const previewUser: AuthUser = { ...DEMO_PREVIEW_USER };
    clearAuthState();
    persistAuthState(null, previewUser, 'preview');
    setToken(null);
    setUser(previewUser);
    setSessionMode('preview');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      sessionMode,
      isAuthenticated: sessionMode === 'preview' || !!token,
      isLoading: false,
      logout,
      apiClient,
    }),
    [user, token, sessionMode, logout, apiClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

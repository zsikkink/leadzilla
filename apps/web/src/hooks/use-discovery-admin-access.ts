'use client';

import { useEffect, useState } from 'react';

import { withAppBasePath } from '@/lib/app-path.js';
import { toSafeApiErrorMessage, toSafeDisplayErrorMessage } from '@/lib/error-messages.js';
import { getSupabaseBrowserClient } from '@/lib/supabase-client.js';

const AUTH_TOKEN_STORAGE_KEY = 'lf_access_token';

class DiscoveryAdminAccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DiscoveryAdminAccessError';
  }
}

function readStoredAccessToken(): string | null {
  if (typeof globalThis.localStorage === 'undefined') {
    return null;
  }

  const token = globalThis.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
}

async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.auth.getSession();
    const accessToken = error ? null : data.session?.access_token?.trim();
    if (accessToken) {
      return accessToken;
    }
  } catch {
    // Fall through to the local storage fallback.
  }

  return readStoredAccessToken();
}

async function checkDiscoveryAdminAccess(): Promise<void> {
  const accessToken = await getAccessToken();
  const headers = new Headers();
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(
    withAppBasePath('/api/admin/search-tasks?page=1&pageSize=1&sortBy=updated_desc'),
    { headers },
  );
  if (response.ok) {
    return;
  }

  const body = await response.json().catch(() => null);
  throw new DiscoveryAdminAccessError(
    response.status,
    toSafeApiErrorMessage(response.status, (body as { error?: string } | null)?.error),
  );
}

interface DiscoveryAdminAccessState {
  isAllowed: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useDiscoveryAdminAccess(): DiscoveryAdminAccessState {
  const [state, setState] = useState<DiscoveryAdminAccessState>({
    isAllowed: false,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    void checkDiscoveryAdminAccess()
      .then(() => {
        if (!cancelled) {
          setState({
            isAllowed: true,
            isLoading: false,
            error: null,
          });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof DiscoveryAdminAccessError && error.status === 403
            ? 'Admin access is required for this surface.'
            : error instanceof DiscoveryAdminAccessError && error.status === 401
              ? 'This live-only surface is unavailable in the read-only demo.'
              : toSafeDisplayErrorMessage(
                  error,
                  'Admin access is being verified. Please try again in a moment.',
                );

        setState({
          isAllowed: false,
          isLoading: false,
          error: message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User as SupabaseUser } from '@supabase/supabase-js';

import { verifyRestorableSession, withDeadline } from './auth-context.js';

describe('auth bootstrap deadlines', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a session request that never settles', async () => {
    vi.useFakeTimers();
    const request = withDeadline(new Promise<never>(() => {}), 5_000);
    const assertion = expect(request).rejects.toThrow('Session check timed out');

    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
  });
});

describe('auth session restoration', () => {
  const operator = {
    id: 'operator-id',
    email: 'operator@example.com',
    user_metadata: {},
  } as SupabaseUser;

  it('restores only a server-verified non-demo user with the expected identity', async () => {
    const auth = {
      getUser: vi.fn().mockResolvedValue({ data: { user: operator }, error: null }),
    };

    await expect(verifyRestorableSession(auth, 'operator-token', operator.id)).resolves.toBe(operator);
    expect(auth.getUser).toHaveBeenCalledWith('operator-token');
  });

  it('rejects invalid, mismatched, and shared-demo sessions', async () => {
    const invalidAuth = {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('invalid') }),
    };
    const mismatchedAuth = {
      getUser: vi.fn().mockResolvedValue({ data: { user: operator }, error: null }),
    };
    const demoAuth = {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { ...operator, id: 'demo-id', email: 'demo@example.com' } },
        error: null,
      }),
    };

    await expect(verifyRestorableSession(invalidAuth, 'invalid-token', operator.id)).resolves.toBeNull();
    await expect(verifyRestorableSession(mismatchedAuth, 'operator-token', 'another-id')).resolves.toBeNull();
    await expect(verifyRestorableSession(demoAuth, 'demo-token', 'demo-id')).resolves.toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { withDeadline } from './auth-context.js';

describe('auth bootstrap deadlines', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a session request that never settles', async () => {
    vi.useFakeTimers();
    const request = withDeadline(new Promise<never>(() => {}), 5_000);
    const assertion = expect(request).rejects.toThrow('Demo service readiness timed out');

    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
  });
});

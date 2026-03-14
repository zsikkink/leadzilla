import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  query: dbMock.query,
}));

import { WhatsAppRateLimiter } from './rate-limiter.js';

describe('WhatsAppRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks sends outside business hours without querying the database', async () => {
    vi.setSystemTime(new Date('2026-03-14T02:00:00.000Z'));

    const limiter = new WhatsAppRateLimiter({} as never, { dailySendLimit: 10 });

    await expect(limiter.canSend()).resolves.toEqual({
      allowed: false,
      nextWindowAt: new Date('2026-03-14T05:00:00.000Z'),
      reason: 'OUTSIDE_BUSINESS_HOURS',
    });
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('blocks sends when the SQL-backed daily count reaches the limit', async () => {
    vi.setSystemTime(new Date('2026-03-14T08:00:00.000Z'));
    dbMock.query.mockResolvedValue({ rows: [{ count: 10 }] });

    const limiter = new WhatsAppRateLimiter({} as never, { dailySendLimit: 10 });

    await expect(limiter.canSend()).resolves.toEqual({
      allowed: false,
      nextWindowAt: new Date('2026-03-15T05:00:00.000Z'),
      reason: 'DAILY_LIMIT_REACHED',
    });
    expect(dbMock.query).toHaveBeenCalledTimes(1);
  });

  it('allows sends when the SQL-backed daily count is below the limit', async () => {
    vi.setSystemTime(new Date('2026-03-14T08:00:00.000Z'));
    dbMock.query.mockResolvedValue({ rows: [{ count: '3' }] });

    const limiter = new WhatsAppRateLimiter({} as never, { dailySendLimit: 10 });

    await expect(limiter.canSend()).resolves.toEqual({ allowed: true });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    getPipelineSetting: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  getPipelineSetting: dbMock.getPipelineSetting,
  query: dbMock.query,
}));

import { EmailRateLimiter } from './email-rate-limiter.js';

describe('EmailRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the warmup start date from the shared pipeline settings helper', async () => {
    dbMock.getPipelineSetting.mockResolvedValue({
      key: 'email_warmup_start_date',
      valueJson: '2026-03-01T00:00:00.000Z',
    });

    const result = await EmailRateLimiter.loadWarmupStartDate({} as never);

    expect(dbMock.getPipelineSetting).toHaveBeenCalledWith('email_warmup_start_date');
    expect(result.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('falls back to now when the warmup setting lookup fails', async () => {
    dbMock.getPipelineSetting.mockRejectedValue(new Error('db unavailable'));

    const result = await EmailRateLimiter.loadWarmupStartDate({} as never);

    expect(result.toISOString()).toBe('2026-03-14T12:00:00.000Z');
  });

  it('uses SQL-backed counts to throttle the daily limit', async () => {
    dbMock.getPipelineSetting.mockResolvedValue({
      key: 'email_warmup_start_date',
      valueJson: '2026-03-07T00:00:00.000Z',
    });
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ count: 10 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const limiter = new EmailRateLimiter({} as never);

    await expect(limiter.computeDailyLimit()).resolves.toEqual({
      limit: 5,
      week: 2,
      throttled: true,
    });
  });

  it('blocks sends when the SQL-backed daily count reaches the computed limit', async () => {
    dbMock.getPipelineSetting.mockResolvedValue({
      key: 'email_warmup_start_date',
      valueJson: '2026-03-07T00:00:00.000Z',
    });
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ count: 10 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 5 }] });

    const limiter = new EmailRateLimiter({} as never);

    await expect(limiter.canSend()).resolves.toEqual({
      allowed: false,
      nextWindowAt: new Date('2026-03-15T00:00:00.000Z'),
      reason: 'WARMUP_THROTTLED_BOUNCE_RATE (week 2, limit 5)',
    });
  });
});

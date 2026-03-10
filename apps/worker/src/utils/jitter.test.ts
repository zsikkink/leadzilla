import { describe, expect, it } from 'vitest';

import { computeNextFollowUpAfter, computeOooFollowUpAfter } from './jitter.js';

describe('computeNextFollowUpAfter', () => {
  it('follow-up 0 returns a date ~72h + 1-3h jitter from now', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const result = computeNextFollowUpAfter(0, now);

    expect(result).not.toBeNull();
    const diffMs = result!.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // 72h base + 1-3h jitter = 73h to 75h
    expect(diffHours).toBeGreaterThanOrEqual(73);
    expect(diffHours).toBeLessThanOrEqual(75);
  });

  it('follow-up 1 returns a date ~168h + 1-3h jitter from now', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const result = computeNextFollowUpAfter(1, now);

    expect(result).not.toBeNull();
    const diffMs = result!.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // 168h base + 1-3h jitter = 169h to 171h
    expect(diffHours).toBeGreaterThanOrEqual(169);
    expect(diffHours).toBeLessThanOrEqual(171);
  });

  it('returns null when max follow-ups reached', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const result = computeNextFollowUpAfter(3, now);
    expect(result).toBeNull();
  });

  it('produces different values across multiple calls (randomness)', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const results = new Set<number>();

    for (let i = 0; i < 20; i++) {
      const r = computeNextFollowUpAfter(0, now);
      if (r) results.add(r.getTime());
    }

    // With 20 random calls, we should get at least 2 distinct values
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('computeOooFollowUpAfter', () => {
  it('returns a date ~168h + 1-3h jitter from now', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const result = computeOooFollowUpAfter(now);

    const diffMs = result.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // 168h base + 1-3h jitter = 169h to 171h
    expect(diffHours).toBeGreaterThanOrEqual(169);
    expect(diffHours).toBeLessThanOrEqual(171);
  });
});

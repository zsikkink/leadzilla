import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { EnrichmentProviderRotator } from './provider-rotation.js';

describe('EnrichmentProviderRotator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Default priority: HUNTER → PEOPLE_DATA_LABS (cheapest first)

  describe('getNextProvider', () => {
    it('returns first provider when none have failed', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(rotator.getNextProvider('lead-1', [])).toBe('HUNTER');
    });

    it('skips previously failed providers', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(rotator.getNextProvider('lead-1', ['HUNTER'])).toBe('PEOPLE_DATA_LABS');
    });

    it('returns null when all providers have failed', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(
        rotator.getNextProvider('lead-1', [
          'HUNTER',
          'PEOPLE_DATA_LABS',
        ]),
      ).toBeNull();
    });

    it('respects custom priority order', () => {
      const rotator = new EnrichmentProviderRotator([
        'PEOPLE_DATA_LABS',
        'HUNTER',
      ]);
      expect(rotator.getNextProvider('lead-1', [])).toBe('PEOPLE_DATA_LABS');
    });
  });

  describe('circuit breaker', () => {
    it('skips provider after 5 failures within 1 hour', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 5; i++) {
        rotator.recordFailure('HUNTER');
      }

      expect(rotator.getNextProvider('lead-1', [])).toBe('PEOPLE_DATA_LABS');
    });

    it('does not skip provider with fewer than 5 failures', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 4; i++) {
        rotator.recordFailure('HUNTER');
      }

      expect(rotator.getNextProvider('lead-1', [])).toBe('HUNTER');
    });

    it('resets circuit breaker after 1 hour window', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 5; i++) {
        rotator.recordFailure('HUNTER');
      }

      // Verify tripped
      expect(rotator.getNextProvider('lead-1', [])).toBe('PEOPLE_DATA_LABS');

      // Advance past the 1-hour window
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      // Should be available again
      expect(rotator.getNextProvider('lead-1', [])).toBe('HUNTER');
    });

    it('resets failure count when failures span across windows', () => {
      const rotator = new EnrichmentProviderRotator();

      // Record 4 failures
      for (let i = 0; i < 4; i++) {
        rotator.recordFailure('HUNTER');
      }

      // Advance past the window
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      // Record 1 more failure — should reset count to 1, not accumulate to 5
      rotator.recordFailure('HUNTER');

      expect(rotator.getNextProvider('lead-1', [])).toBe('HUNTER');
    });
  });

  describe('recordSuccess', () => {
    it('resets failure count on success', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 5; i++) {
        rotator.recordFailure('HUNTER');
      }

      // Circuit is open
      expect(rotator.getNextProvider('lead-1', [])).toBe('PEOPLE_DATA_LABS');

      // Success resets it
      rotator.recordSuccess('HUNTER');
      expect(rotator.getNextProvider('lead-1', [])).toBe('HUNTER');
    });
  });

  describe('getPriorityIndex', () => {
    it('returns index for known provider', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(rotator.getPriorityIndex('HUNTER')).toBe(0);
      expect(rotator.getPriorityIndex('PEOPLE_DATA_LABS')).toBe(1);
    });

    it('returns -1 for unknown provider', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(rotator.getPriorityIndex('UNKNOWN' as never)).toBe(-1);
    });
  });

  describe('getNextProviderAfter', () => {
    it('returns next provider after given index', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(rotator.getNextProviderAfter(0, [])).toBe('PEOPLE_DATA_LABS');
    });

    it('returns null when no providers after given index', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(rotator.getNextProviderAfter(1, [])).toBeNull();
    });

    it('skips failed providers', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(rotator.getNextProviderAfter(0, ['PEOPLE_DATA_LABS'])).toBeNull();
    });

    it('respects circuit breaker', () => {
      const rotator = new EnrichmentProviderRotator();
      for (let i = 0; i < 5; i++) {
        rotator.recordFailure('PEOPLE_DATA_LABS');
      }
      // PDL is tripped, should return null
      expect(rotator.getNextProviderAfter(0, [])).toBeNull();
    });
  });

  describe('getProviderStatus', () => {
    it('returns status for all providers', () => {
      const rotator = new EnrichmentProviderRotator();

      expect(rotator.getProviderStatus()).toEqual([
        { provider: 'HUNTER', available: true, failCount: 0 },
        { provider: 'PEOPLE_DATA_LABS', available: true, failCount: 0 },
      ]);
    });

    it('reflects failure counts and availability', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 5; i++) {
        rotator.recordFailure('HUNTER');
      }
      rotator.recordFailure('PEOPLE_DATA_LABS');
      rotator.recordFailure('PEOPLE_DATA_LABS');

      expect(rotator.getProviderStatus()).toEqual([
        { provider: 'HUNTER', available: false, failCount: 5 },
        { provider: 'PEOPLE_DATA_LABS', available: true, failCount: 2 },
      ]);
    });
  });
});

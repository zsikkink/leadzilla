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

  describe('getNextProvider', () => {
    it('returns first provider when none have failed', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(rotator.getNextProvider('lead-1', [])).toBe('PEOPLE_DATA_LABS');
    });

    it('skips previously failed providers', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(rotator.getNextProvider('lead-1', ['PEOPLE_DATA_LABS'])).toBe('HUNTER');
    });

    it('falls through to third provider when first two failed', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(
        rotator.getNextProvider('lead-1', ['PEOPLE_DATA_LABS', 'HUNTER']),
      ).toBe('OTHER_FREE');
    });

    it('returns null when all providers have failed', () => {
      const rotator = new EnrichmentProviderRotator();
      expect(
        rotator.getNextProvider('lead-1', [
          'PEOPLE_DATA_LABS',
          'HUNTER',
          'OTHER_FREE',
        ]),
      ).toBeNull();
    });

    it('respects custom priority order', () => {
      const rotator = new EnrichmentProviderRotator([
        'HUNTER',
        'OTHER_FREE',
        'PEOPLE_DATA_LABS',
      ]);
      expect(rotator.getNextProvider('lead-1', [])).toBe('HUNTER');
    });
  });

  describe('circuit breaker', () => {
    it('skips provider after 5 failures within 1 hour', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 5; i++) {
        rotator.recordFailure('PEOPLE_DATA_LABS');
      }

      expect(rotator.getNextProvider('lead-1', [])).toBe('HUNTER');
    });

    it('does not skip provider with fewer than 5 failures', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 4; i++) {
        rotator.recordFailure('PEOPLE_DATA_LABS');
      }

      expect(rotator.getNextProvider('lead-1', [])).toBe('PEOPLE_DATA_LABS');
    });

    it('resets circuit breaker after 1 hour window', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 5; i++) {
        rotator.recordFailure('PEOPLE_DATA_LABS');
      }

      // Verify tripped
      expect(rotator.getNextProvider('lead-1', [])).toBe('HUNTER');

      // Advance past the 1-hour window
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      // Should be available again
      expect(rotator.getNextProvider('lead-1', [])).toBe('PEOPLE_DATA_LABS');
    });

    it('resets failure count when failures span across windows', () => {
      const rotator = new EnrichmentProviderRotator();

      // Record 4 failures
      for (let i = 0; i < 4; i++) {
        rotator.recordFailure('PEOPLE_DATA_LABS');
      }

      // Advance past the window
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      // Record 1 more failure — should reset count to 1, not accumulate to 5
      rotator.recordFailure('PEOPLE_DATA_LABS');

      expect(rotator.getNextProvider('lead-1', [])).toBe('PEOPLE_DATA_LABS');
    });
  });

  describe('recordSuccess', () => {
    it('resets failure count on success', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 5; i++) {
        rotator.recordFailure('PEOPLE_DATA_LABS');
      }

      // Circuit is open
      expect(rotator.getNextProvider('lead-1', [])).toBe('HUNTER');

      // Success resets it
      rotator.recordSuccess('PEOPLE_DATA_LABS');
      expect(rotator.getNextProvider('lead-1', [])).toBe('PEOPLE_DATA_LABS');
    });
  });

  describe('getProviderStatus', () => {
    it('returns status for all providers', () => {
      const rotator = new EnrichmentProviderRotator();

      expect(rotator.getProviderStatus()).toEqual([
        { provider: 'PEOPLE_DATA_LABS', available: true, failCount: 0 },
        { provider: 'HUNTER', available: true, failCount: 0 },
        { provider: 'OTHER_FREE', available: true, failCount: 0 },
      ]);
    });

    it('reflects failure counts and availability', () => {
      const rotator = new EnrichmentProviderRotator();

      for (let i = 0; i < 5; i++) {
        rotator.recordFailure('PEOPLE_DATA_LABS');
      }
      rotator.recordFailure('HUNTER');
      rotator.recordFailure('HUNTER');

      expect(rotator.getProviderStatus()).toEqual([
        { provider: 'PEOPLE_DATA_LABS', available: false, failCount: 5 },
        { provider: 'HUNTER', available: true, failCount: 2 },
        { provider: 'OTHER_FREE', available: true, failCount: 0 },
      ]);
    });
  });
});

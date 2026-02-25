import { describe, expect, it } from 'vitest';

import { computePopulationRates, detectFeatureDrift } from './feature-drift.js';

describe('detectFeatureDrift', () => {
  it('returns features that dropped from >threshold to 0%', () => {
    const previous = { has_email: 0.8, has_domain: 0.5, country: 0.1 };
    const current = { has_email: 0, has_domain: 0, country: 0 };

    const result = detectFeatureDrift(previous, current, 0.3);

    expect(result).toEqual([
      { feature: 'has_email', previousRate: 0.8, currentRate: 0 },
      { feature: 'has_domain', previousRate: 0.5, currentRate: 0 },
    ]);
  });

  it('ignores features below the threshold', () => {
    const previous = { has_email: 0.2, has_domain: 0.1 };
    const current = { has_email: 0, has_domain: 0 };

    const result = detectFeatureDrift(previous, current, 0.3);

    expect(result).toEqual([]);
  });

  it('ignores features that are still populated in current batch', () => {
    const previous = { has_email: 0.8, has_domain: 0.9 };
    const current = { has_email: 0.6, has_domain: 0.3 };

    const result = detectFeatureDrift(previous, current, 0.3);

    expect(result).toEqual([]);
  });

  it('ignores features missing from current rates', () => {
    const previous = { has_email: 0.8 };
    const current = {};

    const result = detectFeatureDrift(previous, current, 0.3);

    expect(result).toEqual([]);
  });

  it('returns empty array when no drift detected', () => {
    const previous = { has_email: 0.8, has_domain: 0.5 };
    const current = { has_email: 0.7, has_domain: 0.4 };

    const result = detectFeatureDrift(previous, current, 0.3);

    expect(result).toEqual([]);
  });

  it('sorts results by previousRate descending', () => {
    const previous = { a: 0.5, b: 0.9, c: 0.7 };
    const current = { a: 0, b: 0, c: 0 };

    const result = detectFeatureDrift(previous, current, 0.3);

    expect(result).toEqual([
      { feature: 'b', previousRate: 0.9, currentRate: 0 },
      { feature: 'c', previousRate: 0.7, currentRate: 0 },
      { feature: 'a', previousRate: 0.5, currentRate: 0 },
    ]);
  });

  it('handles empty inputs gracefully', () => {
    expect(detectFeatureDrift({}, {}, 0.3)).toEqual([]);
    expect(detectFeatureDrift({ a: 0.5 }, {}, 0.3)).toEqual([]);
    expect(detectFeatureDrift({}, { a: 0 }, 0.3)).toEqual([]);
  });

  it('treats exactly-at-threshold features as not drifted', () => {
    const previous = { has_email: 0.3 };
    const current = { has_email: 0 };

    // threshold is 0.3, previous is exactly 0.3 — should NOT be flagged (> not >=)
    const result = detectFeatureDrift(previous, current, 0.3);

    expect(result).toEqual([]);
  });
});

describe('computePopulationRates', () => {
  const keys = ['has_email', 'country', 'review_count', 'has_whatsapp'] as const;

  it('computes correct rates for a batch', () => {
    const snapshots = [
      { has_email: true, country: 'UAE', review_count: 5, has_whatsapp: true },
      { has_email: true, country: null, review_count: 0, has_whatsapp: false },
      { has_email: false, country: 'KSA', review_count: 10, has_whatsapp: true },
    ];

    const rates = computePopulationRates(snapshots, keys);

    // has_email: 2/3 (true, true, false)
    expect(rates['has_email']).toBeCloseTo(2 / 3);
    // country: 2/3 (UAE, null, KSA)
    expect(rates['country']).toBeCloseTo(2 / 3);
    // review_count: 2/3 (5, 0, 10)
    expect(rates['review_count']).toBeCloseTo(2 / 3);
    // has_whatsapp: 2/3 (true, false, true)
    expect(rates['has_whatsapp']).toBeCloseTo(2 / 3);
  });

  it('returns empty object for empty batch', () => {
    const rates = computePopulationRates([], keys);
    expect(rates).toEqual({});
  });

  it('treats empty strings as not populated', () => {
    const snapshots = [{ country: '' }, { country: '  ' }, { country: 'UAE' }];

    const rates = computePopulationRates(snapshots, ['country']);

    expect(rates['country']).toBeCloseTo(1 / 3);
  });

  it('treats null and undefined as not populated', () => {
    const snapshots = [{ has_email: null }, { has_email: undefined }, { has_email: true }];

    const rates = computePopulationRates(snapshots, ['has_email']);

    expect(rates['has_email']).toBeCloseTo(1 / 3);
  });

  it('handles all-populated features', () => {
    const snapshots = [{ has_email: true }, { has_email: true }];

    const rates = computePopulationRates(snapshots, ['has_email']);

    expect(rates['has_email']).toBe(1);
  });

  it('handles all-empty features', () => {
    const snapshots = [{ has_email: false }, { has_email: null }];

    const rates = computePopulationRates(snapshots, ['has_email']);

    expect(rates['has_email']).toBe(0);
  });
});

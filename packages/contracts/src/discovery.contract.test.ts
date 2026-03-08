import { describe, expect, it } from 'vitest';

import {
  CreateDiscoveryRunRequestSchema,
  normalizeDiscoveryCountryCode,
  normalizeDiscoveryCountryCodes,
} from './discovery.contract.js';

describe('normalizeDiscoveryCountryCode', () => {
  it('maps aliases and names to ISO-2 codes', () => {
    expect(normalizeDiscoveryCountryCode('UAE')).toBe('AE');
    expect(normalizeDiscoveryCountryCode('KSA')).toBe('SA');
    expect(normalizeDiscoveryCountryCode('Algeria')).toBe('DZ');
    expect(normalizeDiscoveryCountryCode('Saudi Arabia')).toBe('SA');
  });

  it('accepts existing ISO-2 codes (case-insensitive)', () => {
    expect(normalizeDiscoveryCountryCode('ae')).toBe('AE');
    expect(normalizeDiscoveryCountryCode('JO')).toBe('JO');
  });

  it('returns null for unknown countries', () => {
    expect(normalizeDiscoveryCountryCode('Atlantis')).toBeNull();
    expect(normalizeDiscoveryCountryCode('')).toBeNull();
    expect(normalizeDiscoveryCountryCode(undefined)).toBeNull();
  });
});

describe('normalizeDiscoveryCountryCodes', () => {
  it('deduplicates while preserving first-seen order', () => {
    expect(normalizeDiscoveryCountryCodes(['UAE', 'AE', 'KSA', 'Saudi Arabia', 'Egypt'])).toEqual([
      'AE',
      'SA',
      'EG',
    ]);
  });
});

describe('CreateDiscoveryRunRequestSchema', () => {
  it('accepts normalized countries', () => {
    const normalized = normalizeDiscoveryCountryCodes(['UAE', 'KSA', 'Bahrain']);
    expect(() =>
      CreateDiscoveryRunRequestSchema.parse({
        icpProfileIds: ['icp_1'],
        countries: normalized,
      }),
    ).not.toThrow();
  });
});

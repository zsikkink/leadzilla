import { describe, expect, it } from 'vitest';

import { countryName, toDiscoveryCountryCode, toDiscoveryCountryCodes } from './countries.js';

describe('countries lib', () => {
  it('normalizes discovery country aliases to ISO-2 codes', () => {
    expect(toDiscoveryCountryCode('UAE')).toBe('AE');
    expect(toDiscoveryCountryCode('KSA')).toBe('SA');
    expect(toDiscoveryCountryCode('Algeria')).toBe('DZ');
  });

  it('deduplicates normalized country codes', () => {
    expect(toDiscoveryCountryCodes(['UAE', 'AE', 'KSA', 'Saudi Arabia'])).toEqual(['AE', 'SA']);
  });

  it('resolves display names for codes and aliases', () => {
    expect(countryName('AE')).toBe('UAE');
    expect(countryName('UAE')).toBe('UAE');
    expect(countryName('Saudi Arabia')).toBe('KSA');
  });
});

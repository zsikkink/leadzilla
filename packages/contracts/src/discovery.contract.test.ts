import { describe, expect, it } from 'vitest';

import {
  CuratedCountryCitiesByCode,
  SerpApiSupportedCountryCitiesByCode,
  buildSerpApiCountryCitiesMap,
} from './country.contract.js';
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

  it('normalizes alias and full-name countries before enum validation', () => {
    const parsed = CreateDiscoveryRunRequestSchema.parse({
      icpProfileIds: ['icp_1'],
      countries: ['Algeria', 'UAE', 'KSA', 'Bahrain'],
    });
    expect(parsed.countries).toEqual(['DZ', 'AE', 'SA', 'BH']);
  });

  it('defaults discovery prequalification to no minimum review count', () => {
    const parsed = CreateDiscoveryRunRequestSchema.parse({
      icpProfileIds: ['icp_1'],
      countries: ['AE'],
      advancedSettings: {},
    });

    expect(parsed.advancedSettings?.minReviewCount).toBe(0);
  });
});

describe('CuratedCountryCitiesByCode', () => {
  it('stores only the SerpAPI-backed discovery location registry', () => {
    expect(CuratedCountryCitiesByCode).toBe(SerpApiSupportedCountryCitiesByCode);
    expect(CuratedCountryCitiesByCode.AE).toEqual(
      expect.arrayContaining(['Dubai', 'Abu Dhabi', 'Sharjah', 'Al Ain']),
    );
    expect(CuratedCountryCitiesByCode.SA).toEqual(
      expect.arrayContaining(['Riyadh', 'Jeddah', 'Makkah', 'Madinah', 'Dammam']),
    );
    expect(CuratedCountryCitiesByCode.EG).toEqual(
      expect.arrayContaining(['Cairo', 'Alexandria', 'Giza', 'Port Said']),
    );
    expect(CuratedCountryCitiesByCode.JO).toEqual(
      expect.arrayContaining([
        'Amman',
        'Zarqa Governorate',
        'Irbid Governorate',
        'Aqaba Governorate',
      ]),
    );

    expect(CuratedCountryCitiesByCode.AE?.length).toBeGreaterThanOrEqual(10);
    expect(CuratedCountryCitiesByCode.SA?.length).toBeGreaterThanOrEqual(20);
    expect(CuratedCountryCitiesByCode.EG?.length).toBeGreaterThanOrEqual(20);
    expect(CuratedCountryCitiesByCode.JO?.length).toBeGreaterThanOrEqual(8);
  });

  it('does not keep broad defaults for countries without SerpAPI discovery coverage', () => {
    expect(CuratedCountryCitiesByCode.DE).toBeUndefined();
  });

  it('does not include blank or duplicate default city entries', () => {
    for (const [countryCode, cities] of Object.entries(CuratedCountryCitiesByCode)) {
      expect(cities.length, countryCode).toBeGreaterThan(0);
      expect(
        cities.every((city) => city.trim().length > 0),
        countryCode,
      ).toBe(true);
      expect(new Set(cities.map((city) => city.toLowerCase())).size, countryCode).toBe(
        cities.length,
      );
    }
  });
});

describe('SerpApiSupportedCountryCitiesByCode', () => {
  it('keeps launch-country discovery defaults to SerpAPI-supported search locations', () => {
    expect(SerpApiSupportedCountryCitiesByCode.EG).toEqual(
      expect.arrayContaining(['Cairo', 'Abu Kabir']),
    );
    expect(SerpApiSupportedCountryCitiesByCode.JO).toEqual(
      expect.arrayContaining(['Amman', 'Aqaba Governorate']),
    );
    expect(SerpApiSupportedCountryCitiesByCode.SA).toEqual(
      expect.arrayContaining(['Riyadh', 'Diriyah']),
    );
    expect(SerpApiSupportedCountryCitiesByCode.US).toEqual([
      'New York',
      'Los Angeles',
      'Chicago',
      'Houston',
      'Phoenix',
      'Philadelphia',
      'San Antonio',
      'San Diego',
      'Dallas',
      'Austin',
      'San Francisco',
      'Seattle',
      'Denver',
      'Boston',
      'Washington',
      'Miami',
      'Atlanta',
      'Charlotte',
      'Nashville',
      'Portland',
    ]);
  });

  it('filters configured launch-country cities against the SerpAPI-safe list', () => {
    const countryCities = buildSerpApiCountryCitiesMap({
      Egypt: ['Cairo', 'not-serpapi-location'],
      KSA: ['Riyadh', 'not-serpapi-location'],
      DE: ['Berlin'],
    });

    expect(countryCities.EG).toEqual(['Cairo']);
    expect(countryCities.SA).toEqual(['Riyadh']);
    expect(countryCities.DE).toBeUndefined();
  });
});

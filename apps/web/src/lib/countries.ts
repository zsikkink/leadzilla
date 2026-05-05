import {
  SerpApiSupportedCountryCitiesByCode,
  SupportedCountryOptions,
  buildSerpApiCountryCitiesMap,
  countryDisplayName,
  normalizeCountryCodeOrAlias,
  normalizeCountryCodes,
  type CountryCitiesMap,
  type SupportedCountryCode,
} from '@lead-flood/contracts';

export type DiscoveryCountryCodeContract = SupportedCountryCode;

export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  const normalizedCode = normalizeCountryCodeOrAlias(code);
  if (normalizedCode) {
    return countryDisplayName(normalizedCode);
  }
  return code;
}

export function toDiscoveryCountryCode(
  value: string | null | undefined,
): DiscoveryCountryCodeContract | null {
  return normalizeCountryCodeOrAlias(value);
}

export function toDiscoveryCountryCodes(
  values: readonly (string | null | undefined)[],
): DiscoveryCountryCodeContract[] {
  return normalizeCountryCodes(values);
}

export const SupportedCountryPickerOptions = SupportedCountryOptions;

export const CuratedCountryCities = SerpApiSupportedCountryCitiesByCode;

export const MENA_COUNTRIES = [
  'AE',
  'SA',
  'EG',
  'JO',
  'BH',
  'KW',
  'OM',
  'QA',
  'LB',
  'IQ',
  'MA',
  'TN',
  'DZ',
  'LY',
  'YE',
  'SY',
  'PS',
  'SD',
] as const;

export function buildDiscoveryCountryCities(
  value: unknown,
  options?: { includeCuratedDefaults?: boolean | undefined },
): CountryCitiesMap {
  return buildSerpApiCountryCitiesMap(value, options);
}

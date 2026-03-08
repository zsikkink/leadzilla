import {
  normalizeDiscoveryCountryCode,
  normalizeDiscoveryCountryCodes,
  type DiscoveryCountryCodeContract,
} from '@lead-flood/contracts';

/** ISO 3166-1 alpha-2 → full country name for MENA region + common codes */
const COUNTRY_NAMES: Record<string, string> = {
  // MENA core (18 countries)
  AE: 'UAE',
  SA: 'KSA',
  BH: 'Bahrain',
  KW: 'Kuwait',
  QA: 'Qatar',
  OM: 'Oman',
  EG: 'Egypt',
  JO: 'Jordan',
  LB: 'Lebanon',
  IQ: 'Iraq',
  SY: 'Syria',
  YE: 'Yemen',
  PS: 'Palestine',
  SD: 'Sudan',
  LY: 'Libya',
  TN: 'Tunisia',
  DZ: 'Algeria',
  MA: 'Morocco',
  // Non-MENA
  US: 'United States',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  IN: 'India',
  PK: 'Pakistan',
  TR: 'Turkey',
  IR: 'Iran',
};

/**
 * Convert a country code to its full name.
 * Returns the original code if no mapping is found.
 */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  const normalizedCode = normalizeDiscoveryCountryCode(code);
  if (normalizedCode) {
    return COUNTRY_NAMES[normalizedCode] ?? normalizedCode;
  }
  return COUNTRY_NAMES[code.toUpperCase()] ?? code;
}

export function toDiscoveryCountryCode(
  value: string | null | undefined,
): DiscoveryCountryCodeContract | null {
  return normalizeDiscoveryCountryCode(value);
}

export function toDiscoveryCountryCodes(
  values: readonly (string | null | undefined)[],
): DiscoveryCountryCodeContract[] {
  return normalizeDiscoveryCountryCodes(values);
}

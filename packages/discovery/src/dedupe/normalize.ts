import { normalizeCountryCodeOrAlias } from '@lead-flood/contracts';
import type { DiscoveryCountryCode } from '../providers/types.js';

export function normalizeQuery(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeCountrySynonyms(value: string): DiscoveryCountryCode | null {
  return normalizeCountryCodeOrAlias(value);
}

export function normalizeCity(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeQuery(value);
  return normalized.length > 0 ? normalized : null;
}

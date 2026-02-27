/**
 * Extract root domain from a URL, stripping "www." prefix.
 * Shared utility — used by both SerpAPI and Google Places providers.
 */
export function deriveRootDomainFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

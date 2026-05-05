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

const NON_BUSINESS_WEBSITE_DOMAINS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'tiktok.com',
  'wa.me',
  'whatsapp.com',
  'm.me',
];

function hostMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isNonBusinessWebsiteUrl(url: string | null): boolean {
  const hostname = deriveRootDomainFromUrl(url);
  if (!hostname) {
    return false;
  }

  return isNonBusinessWebsiteDomain(hostname);
}

export function isNonBusinessWebsiteDomain(domain: string | null): boolean {
  if (!domain) {
    return false;
  }
  const hostname = domain.toLowerCase().replace(/^www\./, '');

  return NON_BUSINESS_WEBSITE_DOMAINS.some((blockedDomain) =>
    hostMatchesDomain(hostname, blockedDomain),
  );
}

export function deriveBusinessWebsiteDomainFromUrl(url: string | null): string | null {
  if (isNonBusinessWebsiteUrl(url)) {
    return null;
  }

  return deriveRootDomainFromUrl(url);
}

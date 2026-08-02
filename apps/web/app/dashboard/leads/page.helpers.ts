const PLACEHOLDER_EMAIL_PATTERNS = [
  /@lead-flood\.invalid$/i,
  /^no-email\+/i,
  /%20/i,
];

function normalizeDisplayText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const candidate = value.slice(0, maxLength + 1);
  const boundary = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, boundary > maxLength * 0.65 ? boundary : maxLength).trim()}…`;
}

export function isPlaceholderLeadEmail(email: string | null | undefined): boolean {
  const normalized = normalizeDisplayText(email);
  if (!normalized || !normalized.includes('@')) return true;
  return PLACEHOLDER_EMAIL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getLeadEmailLabel(email: string | null | undefined): string | null {
  if (isPlaceholderLeadEmail(email)) return null;
  return normalizeDisplayText(email);
}

export function getLeadContactName(input: {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  companyName: string | null | undefined;
}): string {
  const contactName = normalizeDisplayText([input.firstName, input.lastName].filter(Boolean).join(' '));
  if (contactName && !/^unknown(?: contact)?$/i.test(contactName)) {
    return truncateAtWord(contactName, 64);
  }

  const companyName = normalizeDisplayText(input.companyName);
  return companyName ? truncateAtWord(companyName, 64) : 'Contact research underway';
}

export function getLeadCompanyLabel(value: string | null | undefined): string | null {
  const normalized = normalizeDisplayText(value);
  return normalized ? truncateAtWord(normalized, 72) : null;
}

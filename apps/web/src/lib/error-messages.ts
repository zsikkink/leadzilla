function normalizeErrorFragment(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export const LIVE_DATA_REFRESH_MESSAGE =
  'Live data is refreshing. Please try again in a moment.';
export const LIVE_ACCESS_ENDED_MESSAGE =
  'Live access ended. Refresh to continue in the read-only demo.';
export const PUBLIC_DEMO_SESSION_LIMIT_MESSAGE =
  'This browser session has reached today’s discovery limit. Try again tomorrow.';
export const PUBLIC_DEMO_GLOBAL_LIMIT_MESSAGE =
  'Today’s live demo discovery limit has been reached. Try again tomorrow.';
export const PUBLIC_DEMO_BUSY_MESSAGE =
  'The live demo is busy. Try again in a moment.';

const INTERNAL_ERROR_PATTERN =
  /\b(?:api|database|deno|edge function|fetch|foreign key|gateway|html|http|index|internal server|json|network|openai|pg|postgres|postgrest|prisma|provider|relation|request failed|schema|serpapi|sql|stack|supabase|table|timeout|timed out|unique constraint|violates)\b|(?:code|status)\s*[:=]?\s*\d{3,5}|(?:failed to fetch|load failed|duplicate key)/i;

const SAFE_USER_ACTION_MESSAGES = new Set([
  'choose at least one country',
  'choose one or more active icps before starting discovery',
  'company size fields must be positive whole numbers.',
  'select at least one country.',
  PUBLIC_DEMO_SESSION_LIMIT_MESSAGE.toLowerCase(),
  PUBLIC_DEMO_GLOBAL_LIMIT_MESSAGE.toLowerCase(),
  PUBLIC_DEMO_BUSY_MESSAGE.toLowerCase(),
]);

function errorText(error: unknown): string | null {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return null;
}

export function collapseRepeatedErrorMessage(message: string | null | undefined): string | null {
  if (typeof message !== 'string') {
    return null;
  }

  const fragments = message
    .split(/\s*;\s*/)
    .map(normalizeErrorFragment)
    .filter((fragment) => fragment.length > 0);
  if (fragments.length === 0) {
    return null;
  }

  const seen = new Set<string>();
  const uniqueFragments: string[] = [];
  for (const fragment of fragments) {
    const key = fragment.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueFragments.push(fragment);
  }

  return uniqueFragments.join('; ');
}

export function uniqueCollapsedErrorMessages(messages: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const uniqueMessages: string[] = [];

  for (const message of messages) {
    const normalized = collapseRepeatedErrorMessage(message);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueMessages.push(normalized);
  }

  return uniqueMessages;
}

export function isGenericDatabaseErrorMessage(message: string | null | undefined): boolean {
  return collapseRepeatedErrorMessage(message)?.toLowerCase() === 'database query failed';
}

export function toSafeDisplayErrorMessage(
  error: unknown,
  fallback = LIVE_DATA_REFRESH_MESSAGE,
): string {
  const normalized = collapseRepeatedErrorMessage(errorText(error));
  if (!normalized) {
    return fallback;
  }

  if (/invalid login credentials/i.test(normalized)) {
    return LIVE_ACCESS_ENDED_MESSAGE;
  }
  if (/session expired|unauthorized|invalid token|missing or invalid authorization/i.test(normalized)) {
    return LIVE_ACCESS_ENDED_MESSAGE;
  }
  if (/outbound.*disabled|sending.*disabled|delivery.*disabled/i.test(normalized)) {
    return 'Outbound delivery is disabled in this demo. Drafts remain available for review.';
  }
  if (/forbidden|admin access/i.test(normalized)) {
    return 'This action is not available in the demo workspace.';
  }
  if (/not found/i.test(normalized)) {
    return 'This item is no longer available. Return to the previous page and try again.';
  }
  if (/rate limit|too many requests|quota/i.test(normalized)) {
    return 'The demo is busy right now. Please try again in a moment.';
  }
  if (normalized.length > 180 || INTERNAL_ERROR_PATTERN.test(normalized)) {
    return fallback;
  }
  if (SAFE_USER_ACTION_MESSAGES.has(normalized.toLowerCase())) {
    return normalized;
  }

  return fallback;
}

export function toSafeApiErrorMessage(
  status: number,
  error: unknown,
): string {
  if (status === 401) {
    return LIVE_ACCESS_ENDED_MESSAGE;
  }
  if (status === 403) {
    return toSafeDisplayErrorMessage(
      error,
      'This action is not available in the demo workspace.',
    );
  }
  if (status === 404) {
    return 'This item is no longer available. Return to the previous page and try again.';
  }
  if (status === 409) {
    return 'This item changed while you were working. Refresh and try again.';
  }
  if (status === 429) {
    return toSafeDisplayErrorMessage(
      error,
      'The demo is busy right now. Please try again in a moment.',
    );
  }
  if (status >= 500) {
    return LIVE_DATA_REFRESH_MESSAGE;
  }
  if (status === 400 || status === 422) {
    return toSafeDisplayErrorMessage(
      error,
      'Check the selected options and try again.',
    );
  }

  return toSafeDisplayErrorMessage(error);
}

export function toDiscoveryRunNotice(message: string | null | undefined): string | null {
  const normalized = collapseRepeatedErrorMessage(message);
  if (!normalized) {
    return null;
  }

  if (/duplicate key|unique constraint|already exists/i.test(normalized)) {
    return 'Existing businesses were detected and skipped during deduplication.';
  }
  if (/serpapi|provider|request failed|status 4\d\d/i.test(normalized)) {
    return 'A search source returned fewer usable results than expected.';
  }
  if (/database|postgres|postgrest|storage|constraint|relation|schema|table/i.test(normalized)) {
    return 'Some results could not be saved during this run.';
  }

  return 'Some results were skipped during processing.';
}

export function uniqueDiscoveryRunNotices(
  messages: readonly (string | null | undefined)[],
): string[] {
  return Array.from(
    new Set(
      messages
        .map(toDiscoveryRunNotice)
        .filter((message): message is string => message !== null),
    ),
  );
}

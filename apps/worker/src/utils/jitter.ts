const HOURS_MS = 60 * 60 * 1000;

/**
 * Graduated follow-up cadence (3-7-7) with 1-3 hour random jitter.
 *
 * - Follow-up 1: 3 days after initial    (72h base)
 * - Follow-up 2: 7 days after follow-up 1 (168h base)
 * - Follow-up 3: 7 days after follow-up 2 (168h base)
 *
 * Jitter: +1 to +3 hours random offset to make timing feel human.
 */
const FOLLOW_UP_BASE_HOURS: readonly number[] = [72, 168, 168];

function randomJitterMs(): number {
  // 1-3 hours in milliseconds
  return (1 + Math.random() * 2) * HOURS_MS;
}

/**
 * Compute the next follow-up time based on the current follow-up number (0-indexed).
 *
 * @param followUpNumber - The follow-up that just sent (0 = initial, 1 = FU1, 2 = FU2)
 * @param from - Base time to compute from (defaults to now)
 * @returns Date for next follow-up, or null if max follow-ups reached
 */
export function computeNextFollowUpAfter(
  followUpNumber: number = 0,
  from: Date = new Date(),
): Date | null {
  if (followUpNumber >= FOLLOW_UP_BASE_HOURS.length) return null;

  const baseHours = FOLLOW_UP_BASE_HOURS[followUpNumber]!;
  const baseMs = baseHours * HOURS_MS;
  const jitterMs = randomJitterMs();

  return new Date(from.getTime() + baseMs + jitterMs);
}

/**
 * Compute OOO follow-up: 7 days base + 1-3h jitter.
 * Used when a lead replies with OUT_OF_OFFICE.
 */
export function computeOooFollowUpAfter(from: Date = new Date()): Date {
  const baseMs = 168 * HOURS_MS; // 7 days
  const jitterMs = randomJitterMs();
  return new Date(from.getTime() + baseMs + jitterMs);
}

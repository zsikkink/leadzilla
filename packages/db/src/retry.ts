/**
 * Retry wrapper for Prisma queries that fail due to connection pool exhaustion.
 *
 * Cloud Supabase free tier has ~15 max connections. Our worker uses:
 *   - Prisma connection pool: 3 connections (connection_limit=3 in DATABASE_URL)
 *   - pg-boss: 2 connections (max: 2 in pg-boss config)
 *   - Total: ~5 connections per worker process
 *
 * During peak concurrency (multiple search tasks running in parallel with
 * batchSize=3), all 3 Prisma pool connections may be in use. Additional queries
 * hit the "FATAL: MaxClientsInSessionMode: max clients reached" error.
 *
 * This wrapper catches that specific error and retries with exponential backoff
 * (500ms, 1000ms, 2000ms) rather than failing the entire job.
 */

import { setTimeout as delay } from 'node:timers/promises';

const MAX_RETRY_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;

/**
 * Check if an error is a Prisma pool exhaustion / max clients error.
 * Matches both PrismaClientUnknownRequestError and PrismaClientKnownRequestError
 * that contain the "MaxClientsInSessionMode" message from Supabase.
 */
function isPoolExhaustedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  return (
    message.includes('MaxClientsInSessionMode') ||
    message.includes('max clients reached') ||
    message.includes('remaining connection slots are reserved') ||
    message.includes('too many clients already') ||
    message.includes('Connection pool timeout')
  );
}

/**
 * Execute a Prisma query with automatic retry on connection pool exhaustion.
 *
 * Uses exponential backoff: attempt 1 waits 500ms, attempt 2 waits 1000ms,
 * attempt 3 waits 2000ms. Non-pool errors are re-thrown immediately.
 *
 * @example
 * ```ts
 * const business = await withPoolRetry(() =>
 *   prisma.business.findFirst({ where: { websiteDomain } })
 * );
 * ```
 */
export async function withPoolRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (!isPoolExhaustedError(error)) {
        throw error;
      }

      lastError = error;

      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delayMs = BACKOFF_BASE_MS * (2 ** (attempt - 1)); // 500, 1000, 2000
        await delay(delayMs);
      }
    }
  }

  // All retries exhausted — re-throw the last pool error
  throw lastError;
}

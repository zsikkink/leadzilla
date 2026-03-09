/**
 * Shared error classification for worker jobs.
 *
 * Two categories:
 * - RetryableError: throw → pg-boss retries automatically (network, 429, 5xx)
 * - PermanentError: DO NOT throw → update DB, log, return (400-499 except 429, missing data, parse)
 *
 * Terminal/maintenance jobs (health, recovery, cleanup) should never throw either type.
 */

export class RetryableError extends Error {
  readonly retryable = true as const;

  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class PermanentError extends Error {
  readonly retryable = false as const;

  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'PermanentError';
  }
}

/** Prisma P2002 unique constraint violation — permanent, skip duplicates. */
export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  );
}

/** Prisma P2025 record not found — permanent, resource doesn't exist. */
export function isPrismaNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && (error as { code: string }).code === 'P2025') return true;
  if ('name' in error && (error as { name: string }).name === 'NotFoundError') return true;
  return false;
}

/** Prisma connection/timeout errors — retryable. */
function isPrismaConnectionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error)) return false;
  const code = (error as { code: string }).code;
  // P1001 = can't reach DB, P1002 = timed out, P1008 = operations timed out, P1017 = connection closed
  return ['P1001', 'P1002', 'P1008', 'P1017'].includes(code);
}

/**
 * Classify an unknown error into RetryableError or PermanentError.
 * Use in catch blocks of pipeline jobs that rethrow.
 */
export function classifyError(error: unknown): RetryableError | PermanentError {
  if (error instanceof RetryableError) return error;
  if (error instanceof PermanentError) return error;

  // Prisma connection errors → retryable
  if (isPrismaConnectionError(error)) {
    return new RetryableError(formatErrorMessage(error), error);
  }

  // Prisma unique constraint → permanent
  if (isPrismaUniqueConstraintError(error)) {
    return new PermanentError(`Duplicate record: ${formatErrorMessage(error)}`, error);
  }

  // Prisma not found → permanent
  if (isPrismaNotFoundError(error)) {
    return new PermanentError(`Record not found: ${formatErrorMessage(error)}`, error);
  }

  // Zod validation errors → permanent
  if (typeof error === 'object' && error !== null && 'issues' in error) {
    return new PermanentError(`Validation failed: ${formatErrorMessage(error)}`, error);
  }

  // Network/fetch errors → retryable by default
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return new RetryableError(error.message, error);
  }

  // Unknown errors → retryable (let pg-boss retry, then DLQ)
  return new RetryableError(formatErrorMessage(error), error);
}

/** Consistent error message extraction. */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

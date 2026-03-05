import type { EnrichmentProvider } from '@lead-flood/contracts';

/**
 * Circuit breaker threshold: if a provider fails this many times
 * within the lookback window, it is temporarily skipped.
 */
const CIRCUIT_BREAKER_THRESHOLD = 5;

/**
 * Lookback window for circuit breaker (1 hour in milliseconds).
 */
const CIRCUIT_BREAKER_WINDOW_MS = 60 * 60 * 1000;

/**
 * Default rotation priority: cheapest first (HUNTER → PDL).
 * Escalation is handled by the completeness check — if the cheaper provider
 * returns sparse data (missing industry OR employee count), we escalate.
 */
const DEFAULT_PRIORITY: readonly EnrichmentProvider[] = [
  'HUNTER',
  'PEOPLE_DATA_LABS',
] as const;

interface ProviderFailureRecord {
  failCount: number;
  lastFailedAt: Date;
}

export interface ProviderStatus {
  provider: string;
  available: boolean;
  failCount: number;
}

/**
 * Enrichment provider rotator with circuit breaker pattern.
 *
 * Tracks per-provider failure counts in memory. When a provider
 * accumulates >= CIRCUIT_BREAKER_THRESHOLD failures within the
 * last hour, it is temporarily marked unavailable and skipped
 * during rotation.
 *
 * Priority order: HUNTER → PEOPLE_DATA_LABS (cheapest first)
 */
export class EnrichmentProviderRotator {
  private readonly priority: readonly EnrichmentProvider[];
  private readonly failures: Map<string, ProviderFailureRecord> = new Map();

  constructor(priority?: readonly EnrichmentProvider[] | undefined) {
    this.priority = priority ?? DEFAULT_PRIORITY;
  }

  /**
   * Get the next provider to try for a given lead.
   *
   * Iterates through the priority list, skipping any provider that
   * appears in `previouslyFailed` or is tripped by the circuit breaker.
   *
   * @returns The next provider to try, or `null` if all providers are exhausted.
   */
  getNextProvider(
    _leadId: string,
    previouslyFailed: string[],
  ): EnrichmentProvider | null {
    const failedSet = new Set(previouslyFailed);

    for (const provider of this.priority) {
      if (failedSet.has(provider)) {
        continue;
      }

      if (this.isCircuitOpen(provider)) {
        continue;
      }

      return provider;
    }

    return null;
  }

  /**
   * Record a successful call to a provider, resetting its failure state.
   */
  recordSuccess(provider: string): void {
    this.failures.delete(provider);
  }

  /**
   * Record a failed call to a provider, incrementing its failure count.
   */
  recordFailure(provider: string): void {
    const now = new Date();
    const existing = this.failures.get(provider);

    if (existing && this.isWithinWindow(existing.lastFailedAt, now)) {
      existing.failCount += 1;
      existing.lastFailedAt = now;
    } else {
      // Outside window or first failure — start fresh count
      this.failures.set(provider, {
        failCount: 1,
        lastFailedAt: now,
      });
    }
  }

  /**
   * Get the index of a provider in the priority list.
   * Returns -1 if not found.
   */
  getPriorityIndex(provider: EnrichmentProvider): number {
    return this.priority.indexOf(provider);
  }

  /**
   * Get the next provider to try that comes AFTER `afterIndex` in the priority list.
   * Used for forward-only escalation (cheaper → richer).
   */
  getNextProviderAfter(
    afterIndex: number,
    previouslyFailed: string[],
  ): EnrichmentProvider | null {
    const failedSet = new Set(previouslyFailed);

    for (let i = afterIndex + 1; i < this.priority.length; i++) {
      const provider = this.priority[i];
      if (!provider) continue;
      if (failedSet.has(provider)) continue;
      if (this.isCircuitOpen(provider)) continue;
      return provider;
    }

    return null;
  }

  /**
   * Get the current status of all providers in the rotation.
   */
  getProviderStatus(): ProviderStatus[] {
    return this.priority.map((provider) => {
      const record = this.failures.get(provider);
      const failCount = record ? record.failCount : 0;
      const available = !this.isCircuitOpen(provider);

      return { provider, available, failCount };
    });
  }

  /**
   * Check if the circuit breaker is open (provider should be skipped).
   */
  private isCircuitOpen(provider: string): boolean {
    const record = this.failures.get(provider);
    if (!record) {
      return false;
    }

    if (!this.isWithinWindow(record.lastFailedAt, new Date())) {
      // Failures are stale — reset and allow
      this.failures.delete(provider);
      return false;
    }

    return record.failCount >= CIRCUIT_BREAKER_THRESHOLD;
  }

  private isWithinWindow(timestamp: Date, now: Date): boolean {
    return now.getTime() - timestamp.getTime() < CIRCUIT_BREAKER_WINDOW_MS;
  }
}

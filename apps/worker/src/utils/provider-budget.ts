/**
 * Provider Budget Ceiling — tracks daily spend per provider and prevents
 * overspending on external API calls (Apollo, Apify, PDL, Hunter, etc.).
 *
 * Current implementation: in-memory Map scoped to the worker process lifetime.
 * Production upgrade: replace with a DB table (e.g. ProviderCostEvent) queried
 * via Prisma so ceilings are shared across horizontally-scaled workers.
 */

const DEFAULT_DAILY_BUDGET_CENTS = 5_000; // $50 per provider per day

export interface BudgetCheckResult {
  allowed: boolean;
  remainingCents: number;
  reason?: string | undefined;
}

export interface ProviderSpendEntry {
  provider: string;
  costCents: number;
  jobId: string;
  recordedAt: Date;
}

export interface ProviderBudgetLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
}

/**
 * Returns the start of the current UTC day (midnight).
 * All budget windows are aligned to UTC days.
 */
function startOfUtcDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export class ProviderBudgetTracker {
  /**
   * In-memory store: Map<"provider:YYYY-MM-DD", ProviderSpendEntry[]>
   *
   * Production: this would be a Prisma query against a ProviderCostEvent table
   * with columns (id, provider, costCents, jobId, recordedAt) and a daily
   * aggregate query: SELECT SUM(costCents) WHERE provider = ? AND recordedAt >= startOfDay
   */
  private readonly spendLog = new Map<string, ProviderSpendEntry[]>();
  private readonly dailyBudgetCents: number;

  constructor(dailyBudgetCents?: number | undefined) {
    const envBudget = process.env['PROVIDER_DAILY_BUDGET_CENTS'];
    if (dailyBudgetCents !== undefined) {
      this.dailyBudgetCents = dailyBudgetCents;
    } else if (envBudget && Number.isFinite(Number(envBudget))) {
      this.dailyBudgetCents = Number(envBudget);
    } else {
      this.dailyBudgetCents = DEFAULT_DAILY_BUDGET_CENTS;
    }
  }

  private bucketKey(provider: string, date: Date = new Date()): string {
    const day = startOfUtcDay(date);
    const yyyy = day.getUTCFullYear();
    const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(day.getUTCDate()).padStart(2, '0');
    return `${provider}:${yyyy}-${mm}-${dd}`;
  }

  private getDailySpendCents(provider: string, date: Date = new Date()): number {
    const key = this.bucketKey(provider, date);
    const entries = this.spendLog.get(key);
    if (!entries || entries.length === 0) {
      return 0;
    }
    return entries.reduce((sum, entry) => sum + entry.costCents, 0);
  }

  /**
   * Check whether spending `estimatedCostCents` for `provider` is within
   * the daily budget ceiling.
   */
  async canSpend(
    provider: string,
    estimatedCostCents: number,
  ): Promise<BudgetCheckResult> {
    const currentSpend = this.getDailySpendCents(provider);
    const remainingCents = Math.max(this.dailyBudgetCents - currentSpend, 0);

    if (currentSpend + estimatedCostCents > this.dailyBudgetCents) {
      return {
        allowed: false,
        remainingCents,
        reason: `Daily budget ceiling reached for ${provider}: spent ${currentSpend}c / ${this.dailyBudgetCents}c, requested ${estimatedCostCents}c`,
      };
    }

    return {
      allowed: true,
      remainingCents: remainingCents - estimatedCostCents,
    };
  }

  /**
   * Record actual spend after a successful provider call.
   */
  async recordSpend(
    provider: string,
    costCents: number,
    jobId: string,
  ): Promise<void> {
    const now = new Date();
    const key = this.bucketKey(provider, now);
    const entries = this.spendLog.get(key) ?? [];
    entries.push({
      provider,
      costCents,
      jobId,
      recordedAt: now,
    });
    this.spendLog.set(key, entries);
  }

  /**
   * Get current daily spend for a provider (useful for logging/monitoring).
   */
  getDailySpend(provider: string): number {
    return this.getDailySpendCents(provider);
  }

  /**
   * Get the configured daily budget ceiling in cents.
   */
  getDailyBudget(): number {
    return this.dailyBudgetCents;
  }

  /**
   * Purge entries older than the current UTC day to prevent unbounded memory growth.
   * Call periodically (e.g. on a schedule or at worker startup).
   */
  pruneStaleEntries(): number {
    const todayStart = startOfUtcDay();
    let pruned = 0;

    for (const [key, entries] of this.spendLog.entries()) {
      // Key format: "provider:YYYY-MM-DD"
      const datePart = key.split(':').slice(1).join(':');
      const bucketDate = new Date(`${datePart}T00:00:00.000Z`);

      if (bucketDate.getTime() < todayStart.getTime()) {
        pruned += entries.length;
        this.spendLog.delete(key);
      }
    }

    return pruned;
  }
}

/**
 * Estimated cost per provider call in cents.
 *
 * Research basis (last verified March 2026):
 *
 * - APOLLO: Basic plan $49/mo for ~900 export credits. Domain search uses 1 credit.
 *   Effective cost ~$0.05/credit at low volume, ~$0.02/call at scale. Using 2c.
 *
 * - HUNTER: Starter plan $49/mo includes 500 domain searches.
 *   $49/500 = ~$0.098/call ≈ 3 cents (conservative, accounts for bundled finder credits).
 *
 * - GOOGLE_PLACES: Text Search (New) Basic SKU = $0.032/call.
 *   With Google's $200/mo free credit, effective cost is ~$0.02/call. Using 2c.
 *
 * - GOOGLE_CUSTOM_SEARCH: First 100 queries/day free, then $5/1K queries = $0.005/call.
 *   Most usage falls within free tier. Using 1c as conservative estimate.
 *
 * - Others are legacy/unused but kept for completeness.
 */
export const PROVIDER_COST_CENTS: Record<string, number> = {
  APOLLO: 2,
  PEOPLE_DATA_LABS: 5,
  HUNTER: 3,
  APIFY: 1,
  BRAVE_SEARCH: 1,
  GOOGLE_PLACES: 2,
  GOOGLE_CUSTOM_SEARCH: 1,
  LINKEDIN_SCRAPE: 1,
  COMPANY_SEARCH_FREE: 0,
  CLEARBIT: 5,
};

/**
 * Look up the estimated cost for a provider call.
 * Returns 0 for unknown providers (conservative — won't block).
 */
export function getProviderCostCents(provider: string): number {
  return PROVIDER_COST_CENTS[provider] ?? 0;
}

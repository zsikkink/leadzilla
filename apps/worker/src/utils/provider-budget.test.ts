import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  ProviderBudgetTracker,
  getProviderCostCents,
  PROVIDER_COST_CENTS,
} from './provider-budget.js';

describe('ProviderBudgetTracker', () => {
  let tracker: ProviderBudgetTracker;

  beforeEach(() => {
    tracker = new ProviderBudgetTracker(100); // 100 cents = $1 ceiling
  });

  it('allows spend when under budget', async () => {
    const result = await tracker.canSpend('APOLLO', 2);
    expect(result.allowed).toBe(true);
    expect(result.remainingCents).toBe(98);
  });

  it('denies spend when over budget', async () => {
    await tracker.recordSpend('APOLLO', 99, 'job-1');
    const result = await tracker.canSpend('APOLLO', 2);
    expect(result.allowed).toBe(false);
    expect(result.remainingCents).toBe(1);
    expect(result.reason).toContain('Daily budget ceiling reached');
    expect(result.reason).toContain('APOLLO');
  });

  it('tracks spend per provider independently', async () => {
    await tracker.recordSpend('APOLLO', 90, 'job-1');
    const apolloCheck = await tracker.canSpend('APOLLO', 20);
    expect(apolloCheck.allowed).toBe(false);

    const hunterCheck = await tracker.canSpend('HUNTER', 20);
    expect(hunterCheck.allowed).toBe(true);
  });

  it('accumulates spend across multiple recordSpend calls', async () => {
    await tracker.recordSpend('APOLLO', 30, 'job-1');
    await tracker.recordSpend('APOLLO', 30, 'job-2');
    await tracker.recordSpend('APOLLO', 30, 'job-3');

    const result = await tracker.canSpend('APOLLO', 11);
    expect(result.allowed).toBe(false);
    expect(result.remainingCents).toBe(10);
  });

  it('allows spend exactly at the ceiling boundary', async () => {
    await tracker.recordSpend('APOLLO', 98, 'job-1');
    const result = await tracker.canSpend('APOLLO', 2);
    expect(result.allowed).toBe(true);
    expect(result.remainingCents).toBe(0);
  });

  it('denies spend at exactly one cent over ceiling', async () => {
    await tracker.recordSpend('APOLLO', 99, 'job-1');
    const result = await tracker.canSpend('APOLLO', 2);
    expect(result.allowed).toBe(false);
  });

  it('reports daily spend correctly', async () => {
    await tracker.recordSpend('HUNTER', 10, 'job-1');
    await tracker.recordSpend('HUNTER', 15, 'job-2');
    expect(tracker.getDailySpend('HUNTER')).toBe(25);
  });

  it('reports zero spend for unused providers', () => {
    expect(tracker.getDailySpend('UNKNOWN_PROVIDER')).toBe(0);
  });

  it('returns configured daily budget', () => {
    expect(tracker.getDailyBudget()).toBe(100);
  });

  it('uses default budget when none provided', () => {
    const defaultTracker = new ProviderBudgetTracker();
    expect(defaultTracker.getDailyBudget()).toBe(5000);
  });

  describe('pruneStaleEntries', () => {
    it('returns 0 when no stale entries exist', async () => {
      await tracker.recordSpend('APOLLO', 10, 'job-1');
      const pruned = tracker.pruneStaleEntries();
      expect(pruned).toBe(0);
      expect(tracker.getDailySpend('APOLLO')).toBe(10);
    });
  });

  describe('env var override', () => {
    const originalEnv = process.env['PROVIDER_DAILY_BUDGET_CENTS'];

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env['PROVIDER_DAILY_BUDGET_CENTS'];
      } else {
        process.env['PROVIDER_DAILY_BUDGET_CENTS'] = originalEnv;
      }
    });

    it('reads PROVIDER_DAILY_BUDGET_CENTS from env when no constructor arg', () => {
      process.env['PROVIDER_DAILY_BUDGET_CENTS'] = '2500';
      const envTracker = new ProviderBudgetTracker();
      expect(envTracker.getDailyBudget()).toBe(2500);
    });

    it('constructor arg takes precedence over env var', () => {
      process.env['PROVIDER_DAILY_BUDGET_CENTS'] = '2500';
      const explicitTracker = new ProviderBudgetTracker(999);
      expect(explicitTracker.getDailyBudget()).toBe(999);
    });
  });
});

describe('getProviderCostCents', () => {
  it('returns known provider costs', () => {
    expect(getProviderCostCents('APOLLO')).toBe(2);
    expect(getProviderCostCents('PEOPLE_DATA_LABS')).toBe(5);
    expect(getProviderCostCents('HUNTER')).toBe(3);
    expect(getProviderCostCents('APIFY')).toBe(1);
  });

  it('returns 0 for free providers', () => {
    expect(getProviderCostCents('COMPANY_SEARCH_FREE')).toBe(0);
  });

  it('returns 0 for unknown providers', () => {
    expect(getProviderCostCents('TOTALLY_UNKNOWN')).toBe(0);
  });
});

describe('PROVIDER_COST_CENTS', () => {
  it('has entries for all expected providers', () => {
    const expectedProviders = [
      'APOLLO',
      'PEOPLE_DATA_LABS',
      'HUNTER',
      'APIFY',
      'BRAVE_SEARCH',
      'GOOGLE_PLACES',
      'LINKEDIN_SCRAPE',
      'COMPANY_SEARCH_FREE',
      'CLEARBIT',
    ];

    for (const provider of expectedProviders) {
      expect(PROVIDER_COST_CENTS).toHaveProperty(provider);
      expect(typeof PROVIDER_COST_CENTS[provider]).toBe('number');
    }
  });
});

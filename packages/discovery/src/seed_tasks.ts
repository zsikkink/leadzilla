import { prisma } from '@lead-flood/db';

import type { DiscoverySeedConfig } from './config.js';
import { generateTasksV2 } from './queries/generate_tasks.js';
import type { GenerateTasksV2Input, GeneratedSearchTask } from './queries/generate_tasks.js';
import { mapIcpIndustriesWithOverrides } from './queries/icp-category-map.js';
import { COUNTRY_NAME_TO_ISO } from './queries/seeds.js';

export interface SeedTasksResult {
  generated: number;
  inserted: number;
}

/**
 * V2 seed config for ICP-driven task generation.
 * When provided, uses generateTasksV2 with ICP target industries
 * instead of hardcoded profile-based categories.
 */
export interface IcpSeedConfig {
  targetIndustries: string[];
  targetCountries: string[];
  cities?: string[] | undefined;
  maxPagesPerQuery?: number | undefined;
  searchProvider?: 'SERPAPI' | 'GOOGLE_PLACES' | undefined;
  categoryOverrides?: Record<string, { add?: string[]; remove?: string[] }> | undefined;
}

/**
 * Normalize country names/abbreviations (e.g. "UAE", "KSA", "Egypt") to ISO alpha-2 codes.
 * Passes through values that are already ISO codes. Deduplicates results.
 */
function normalizeCountriesToIso(countries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of countries) {
    const iso = COUNTRY_NAME_TO_ISO[c.toLowerCase()] ?? c;
    if (!seen.has(iso)) {
      seen.add(iso);
      result.push(iso);
    }
  }
  return result;
}

/**
 * Resolve countries for task generation.
 * Priority: ICP targetCountries wins (user-configured per ICP profile).
 * Config countries (from env var DISCOVERY_COUNTRIES) are only a fallback
 * when the ICP has no target countries set.
 */
function resolveCountries(configCountries: string[], icpTargetCountries: string[]): string[] {
  // ICP target countries take priority — they're user-configured per profile
  const normalized = normalizeCountriesToIso(icpTargetCountries);
  if (normalized.length > 0) {
    return normalized;
  }
  // Fallback to config countries (env var defaults)
  return configCountries;
}

/**
 * Extract the search category from a query like "bakery in Dubai".
 */
function extractCategory(queryText: string): string {
  const match = queryText.match(/^(.+?)\s+in\s+/i);
  return match?.[1]?.trim().toLowerCase() ?? queryText.toLowerCase();
}

/**
 * Stratified sample: guarantee at least 1 task per (category, city) stratum,
 * then distribute remaining budget randomly. Final shuffle for FIFO fairness.
 */
function stratifiedSample(
  tasks: GeneratedSearchTask[],
  maxTasks: number,
): GeneratedSearchTask[] {
  // Group by (category, city) — the meaningful diversity dimensions
  const strata = new Map<string, GeneratedSearchTask[]>();
  for (const task of tasks) {
    const cat = extractCategory(task.queryText);
    const city = (task.city ?? 'unknown').toLowerCase();
    const key = `${city}::${cat}`;
    const group = strata.get(key) ?? [];
    group.push(task);
    strata.set(key, group);
  }

  const result: GeneratedSearchTask[] = [];
  const strataList = [...strata.values()];

  // If we can't even fit 1 per stratum, fall back to pure random
  if (maxTasks < strataList.length) {
    const shuffled = [...tasks];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    return shuffled.slice(0, maxTasks);
  }

  // Round 1: 1 random task per stratum
  for (const group of strataList) {
    const idx = Math.floor(Math.random() * group.length);
    result.push(group.splice(idx, 1)[0]!);
  }

  // Round 2: Fill remaining budget randomly from leftover tasks
  if (result.length < maxTasks) {
    const remaining = strataList.flatMap((g) => g);
    for (let i = remaining.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = remaining[i]!;
      remaining[i] = remaining[j]!;
      remaining[j] = tmp;
    }
    const needed = maxTasks - result.length;
    result.push(...remaining.slice(0, needed));
  }

  // Final shuffle so DB insertion order is random (prevents FIFO bias)
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }

  return result.slice(0, maxTasks);
}

export async function seedSearchTasks(
  config: Pick<
    DiscoverySeedConfig,
    | 'countries'
    | 'languages'
    | 'maxPagesPerQuery'
    | 'refreshBucket'
    | 'seedProfile'
    | 'maxTasks'
    | 'taskTypes'
    | 'seedBucket'
  >,
  now: Date = new Date(),
  icpConfig?: IcpSeedConfig | undefined,
  discoveryRunId?: string | undefined,
): Promise<SeedTasksResult> {
  if (!icpConfig) {
    throw new Error(
      'ICP config with targetIndustries is required for task generation. ' +
      'The v1 generateTasks path has been removed — ensure the ICP profile has targetIndustries set.',
    );
  }

  const generatedTasks = generateTasksV2(
    {
      categories: mapIcpIndustriesWithOverrides(
        icpConfig.targetIndustries,
        icpConfig.categoryOverrides,
      ),
      countries: resolveCountries(config.countries, icpConfig.targetCountries),
      cities: icpConfig.cities,
      maxPagesPerQuery: icpConfig.maxPagesPerQuery ?? config.maxPagesPerQuery,
      taskTypes: config.taskTypes,
      searchProvider: icpConfig.searchProvider,
    } satisfies GenerateTasksV2Input,
    { now },
  );

  // When generated tasks exceed the budget, use stratified sampling to guarantee
  // at least 1 task per (category, city) pair before distributing remaining budget.
  let tasksToInsert = generatedTasks;
  if (generatedTasks.length > config.maxTasks) {
    tasksToInsert = stratifiedSample(generatedTasks, config.maxTasks);
  }

  let inserted = 0;

  for (const task of tasksToInsert) {
    const runIdValue = discoveryRunId ?? null;
    const result = await prisma.$executeRaw`
      INSERT INTO "search_tasks" (
        "id",
        "task_type",
        "country_code",
        "city",
        "language",
        "query_text",
        "normalized_query_key",
        "query_hash",
        "params_json",
        "page",
        "time_bucket",
        "status",
        "attempts",
        "run_after",
        "created_at",
        "updated_at",
        "discovery_run_id"
      )
      VALUES (
        ${task.id},
        ${task.taskType}::"SearchTaskType",
        ${task.countryCode},
        ${task.city},
        ${task.language},
        ${task.queryText},
        ${task.normalizedQueryKey},
        ${task.queryHash},
        ${JSON.stringify(task.paramsJson)}::jsonb,
        ${task.page},
        ${task.timeBucket},
        'PENDING'::"SearchTaskStatus",
        0,
        NOW(),
        NOW(),
        NOW(),
        ${runIdValue}
      )
      ON CONFLICT ("task_type", "query_hash", "discovery_run_id") DO NOTHING
    `;

    inserted += Number(result);
  }

  return {
    generated: tasksToInsert.length,
    inserted,
  };
}

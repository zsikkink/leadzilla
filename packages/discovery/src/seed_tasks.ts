import { normalizeCountryCodes } from '@lead-flood/contracts';
import { prisma } from '@lead-flood/db';

import type { DiscoverySeedConfig } from './config.js';
import { generateTasksV2 } from './queries/generate_tasks.js';
import type { GenerateTasksV2Input, GeneratedSearchTask } from './queries/generate_tasks.js';
import { mapIcpIndustriesWithOverrides } from './queries/icp-category-map.js';

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
 * Resolve countries for task generation.
 * Priority: ICP targetCountries wins (user-configured per ICP profile).
 * Config countries (from env var DISCOVERY_COUNTRIES) are only a fallback
 * when the ICP has no target countries set.
 */
function resolveCountries(configCountries: string[], icpTargetCountries: string[]): string[] {
  // ICP target countries take priority — they're user-configured per profile
  const normalized = normalizeCountryCodes(icpTargetCountries);
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

interface IndexedGeneratedSearchTask {
  task: GeneratedSearchTask;
  originalIndex: number;
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareNullableStrings(left: string | null, right: string | null): number {
  return compareStrings(left ?? '', right ?? '');
}

function compareIndexedTasks(
  left: IndexedGeneratedSearchTask,
  right: IndexedGeneratedSearchTask,
): number {
  return (
    compareStrings(left.task.queryHash, right.task.queryHash) ||
    compareStrings(left.task.normalizedQueryKey, right.task.normalizedQueryKey) ||
    compareStrings(left.task.queryText, right.task.queryText) ||
    compareStrings(left.task.taskType, right.task.taskType) ||
    compareStrings(left.task.countryCode, right.task.countryCode) ||
    compareNullableStrings(left.task.city, right.task.city) ||
    compareStrings(left.task.language, right.task.language) ||
    left.task.page - right.task.page ||
    compareStrings(left.task.timeBucket, right.task.timeBucket) ||
    left.originalIndex - right.originalIndex
  );
}

/**
 * Stratified sample: guarantee at least 1 task per (category, city) stratum,
 * then distribute remaining budget deterministically.
 */
function stratifiedSample(
  tasks: GeneratedSearchTask[],
  maxTasks: number,
): GeneratedSearchTask[] {
  const indexedTasks = tasks.map((task, originalIndex) => ({ task, originalIndex }));

  // Group by (category, city) — the meaningful diversity dimensions
  const strata = new Map<string, IndexedGeneratedSearchTask[]>();
  for (const indexedTask of indexedTasks) {
    const { task } = indexedTask;
    const cat = extractCategory(task.queryText);
    const city = (task.city ?? 'unknown').toLowerCase();
    const key = `${city}::${cat}`;
    const group = strata.get(key) ?? [];
    group.push(indexedTask);
    strata.set(key, group);
  }

  const result: IndexedGeneratedSearchTask[] = [];
  const strataList = [...strata.values()].map((group) => [...group].sort(compareIndexedTasks));

  // If we can't even fit 1 per stratum, use the stable global ordering.
  if (maxTasks < strataList.length) {
    return [...indexedTasks]
      .sort(compareIndexedTasks)
      .slice(0, maxTasks)
      .map(({ task }) => task);
  }

  // Round 1: 1 deterministic task per stratum
  for (const group of strataList) {
    result.push(group[0]!);
  }

  // Round 2: Fill remaining budget from the stable leftover ordering.
  if (result.length < maxTasks) {
    const remaining = strataList
      .flatMap((group) => group.slice(1))
      .sort(compareIndexedTasks);
    const needed = maxTasks - result.length;
    result.push(...remaining.slice(0, needed));
  }

  return result
    .sort(compareIndexedTasks)
    .slice(0, maxTasks)
    .map(({ task }) => task);
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

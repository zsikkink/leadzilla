import { createHash } from 'node:crypto';
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

interface IndexedGeneratedSearchTask {
  task: GeneratedSearchTask;
  originalIndex: number;
}

interface RankedGeneratedSearchTask extends IndexedGeneratedSearchTask {
  lastExecutedAtMs: number | null;
}

type SamplingSeedInput = {
  discoveryRunId?: string | undefined;
  now: Date;
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
  >;
  icpConfig: IcpSeedConfig;
};

const SEARCH_TASK_QUERY_CHUNK_SIZE_CAP = 1000;
const SEARCH_TASK_QUERY_MIN_CHUNK_SIZE = 100;
const SEARCH_TASK_BIND_BUDGET = 30_000;

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareNullableStrings(left: string | null, right: string | null): number {
  return compareStrings(left ?? '', right ?? '');
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function resolveSearchTaskQueryChunkSize(taskTypesCount: number, pagesCount: number): number {
  const safeTaskTypesCount = Math.max(1, taskTypesCount);
  const safePagesCount = Math.max(1, pagesCount);
  const multiplicativeFactor = safeTaskTypesCount * safePagesCount;
  const computed = Math.floor(
    (SEARCH_TASK_BIND_BUDGET - safeTaskTypesCount - safePagesCount) / multiplicativeFactor,
  );

  return Math.max(
    SEARCH_TASK_QUERY_MIN_CHUNK_SIZE,
    Math.min(SEARCH_TASK_QUERY_CHUNK_SIZE_CAP, computed),
  );
}

function buildSamplingSeed(input: SamplingSeedInput): string {
  return (
    input.discoveryRunId ??
    [
      input.now.toISOString(),
      input.config.seedBucket ?? '',
      input.config.seedProfile,
      input.config.refreshBucket,
      input.config.maxPagesPerQuery,
      input.config.maxTasks,
      input.config.countries.join(','),
      input.config.languages.join(','),
      input.config.taskTypes.join(','),
      input.icpConfig.targetIndustries.join(','),
      input.icpConfig.targetCountries.join(','),
      input.icpConfig.cities?.join(',') ?? '',
    ].join('::')
  );
}

function computeSeededOrderToken(seed: string, key: string): string {
  return createHash('sha256').update(seed).update('\0').update(key).digest('hex');
}

function compareIndexedTasks(
  left: IndexedGeneratedSearchTask,
  right: IndexedGeneratedSearchTask,
): number {
  return (
    left.task.page - right.task.page ||
    compareStrings(left.task.queryHash, right.task.queryHash) ||
    compareStrings(left.task.taskType, right.task.taskType) ||
    compareStrings(left.task.countryCode, right.task.countryCode) ||
    compareNullableStrings(left.task.city, right.task.city) ||
    compareStrings(left.task.language, right.task.language) ||
    compareStrings(left.task.normalizedQueryKey, right.task.normalizedQueryKey) ||
    compareStrings(left.task.queryText, right.task.queryText) ||
    compareStrings(left.task.timeBucket, right.task.timeBucket) ||
    left.originalIndex - right.originalIndex
  );
}

function buildQueryFreshnessKey(
  task: Pick<GeneratedSearchTask, 'taskType' | 'normalizedQueryKey' | 'page'>,
): string {
  return `${task.taskType}::${task.normalizedQueryKey}::${task.page}`;
}

function buildQueryFamilyKey(
  task: Pick<GeneratedSearchTask, 'taskType' | 'normalizedQueryKey'>,
): string {
  return `${task.taskType}::${task.normalizedQueryKey}`;
}

function compareRankedTasks(
  left: RankedGeneratedSearchTask,
  right: RankedGeneratedSearchTask,
): number {
  if (left.lastExecutedAtMs === null && right.lastExecutedAtMs !== null) {
    return -1;
  }
  if (left.lastExecutedAtMs !== null && right.lastExecutedAtMs === null) {
    return 1;
  }
  if (
    left.lastExecutedAtMs !== null &&
    right.lastExecutedAtMs !== null &&
    left.lastExecutedAtMs !== right.lastExecutedAtMs
  ) {
    return left.lastExecutedAtMs - right.lastExecutedAtMs;
  }

  return compareIndexedTasks(left, right);
}

function compareRankedTasksForSampling(
  left: RankedGeneratedSearchTask,
  right: RankedGeneratedSearchTask,
  randomizationSeed: string,
): number {
  if (left.lastExecutedAtMs === null && right.lastExecutedAtMs !== null) {
    return -1;
  }
  if (left.lastExecutedAtMs !== null && right.lastExecutedAtMs === null) {
    return 1;
  }
  if (
    left.lastExecutedAtMs !== null &&
    right.lastExecutedAtMs !== null &&
    left.lastExecutedAtMs !== right.lastExecutedAtMs
  ) {
    return left.lastExecutedAtMs - right.lastExecutedAtMs;
  }

  if (left.task.page !== right.task.page) {
    return left.task.page - right.task.page;
  }

  const leftFamilyToken = computeSeededOrderToken(
    randomizationSeed,
    buildQueryFamilyKey(left.task),
  );
  const rightFamilyToken = computeSeededOrderToken(
    randomizationSeed,
    buildQueryFamilyKey(right.task),
  );
  const familyComparison = compareStrings(leftFamilyToken, rightFamilyToken);
  if (familyComparison !== 0) {
    return familyComparison;
  }

  const leftTaskToken = computeSeededOrderToken(
    randomizationSeed,
    `${left.task.queryHash}::${left.originalIndex}`,
  );
  const rightTaskToken = computeSeededOrderToken(
    randomizationSeed,
    `${right.task.queryHash}::${right.originalIndex}`,
  );
  const taskComparison = compareStrings(leftTaskToken, rightTaskToken);
  if (taskComparison !== 0) {
    return taskComparison;
  }

  return compareIndexedTasks(left, right);
}

async function loadHistoricalQueryFreshness(
  tasks: GeneratedSearchTask[],
): Promise<Map<string, number>> {
  if (tasks.length === 0) {
    return new Map();
  }

  const freshnessByKey = new Map<string, number>();

  const normalizedQueryKeys = [...new Set(tasks.map((task) => task.normalizedQueryKey))];
  const taskTypes = [...new Set(tasks.map((task) => task.taskType))];
  const pages = [...new Set(tasks.map((task) => task.page))];
  const chunkSize = resolveSearchTaskQueryChunkSize(taskTypes.length, pages.length);

  for (const normalizedQueryKeyChunk of chunkValues(normalizedQueryKeys, chunkSize)) {
    const historicalRows = await prisma.searchTask.findMany({
      where: {
        normalizedQueryKey: {
          in: normalizedQueryKeyChunk,
        },
        taskType: {
          in: taskTypes,
        },
        page: {
          in: pages,
        },
      },
      select: {
        taskType: true,
        normalizedQueryKey: true,
        page: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    for (const row of historicalRows) {
      const key = buildQueryFreshnessKey(row);
      if (!freshnessByKey.has(key)) {
        freshnessByKey.set(key, row.updatedAt.getTime());
      }
    }
  }

  return freshnessByKey;
}

async function loadExistingRunQueryHashes(
  tasks: GeneratedSearchTask[],
  discoveryRunId: string,
): Promise<Set<string>> {
  if (tasks.length === 0) {
    return new Set();
  }

  const existingQueryHashes = new Set<string>();
  const queryHashes = [...new Set(tasks.map((task) => task.queryHash))];
  const taskTypes = [...new Set(tasks.map((task) => task.taskType))];
  const pages = [...new Set(tasks.map((task) => task.page))];
  const chunkSize = resolveSearchTaskQueryChunkSize(taskTypes.length, pages.length);

  for (const queryHashChunk of chunkValues(queryHashes, chunkSize)) {
    const existingTasks = await prisma.searchTask.findMany({
      where: {
        discoveryRunId,
        queryHash: {
          in: queryHashChunk,
        },
      },
      select: {
        queryHash: true,
      },
    });

    for (const task of existingTasks) {
      existingQueryHashes.add(task.queryHash);
    }
  }

  return existingQueryHashes;
}

/**
 * Stratified sample: guarantee at least 1 task per unique query family
 * (task type + normalized query) before spending budget on deeper pagination.
 */
function stratifiedSample(
  tasks: RankedGeneratedSearchTask[],
  maxTasks: number,
  randomizationSeed: string,
): RankedGeneratedSearchTask[] {
  // Group by unique query family first so page-1 coverage wins over page-depth.
  const strata = new Map<string, RankedGeneratedSearchTask[]>();
  for (const rankedTask of tasks) {
    const key = buildQueryFamilyKey(rankedTask.task);
    const group = strata.get(key) ?? [];
    group.push(rankedTask);
    strata.set(key, group);
  }

  const result: RankedGeneratedSearchTask[] = [];
  const strataList = [...strata.values()].map((group) => [...group].sort(compareRankedTasks));

  // If we can't even fit 1 per stratum, use the stable global ordering.
  if (maxTasks < strataList.length) {
    return strataList
      .map((group) => group[0]!)
      .sort((left, right) => compareRankedTasksForSampling(left, right, randomizationSeed))
      .slice(0, maxTasks);
  }

  // Round 1: 1 deterministic task per query family.
  result.push(
    ...strataList
      .map((group) => group[0]!)
      .sort((left, right) => compareRankedTasksForSampling(left, right, randomizationSeed)),
  );

  // Round 2: Fill remaining budget from the stable leftover ordering.
  if (result.length < maxTasks) {
    const remaining = strataList
      .flatMap((group) => group.slice(1))
      .sort((left, right) => compareRankedTasksForSampling(left, right, randomizationSeed));
    const needed = maxTasks - result.length;
    result.push(...remaining.slice(0, needed));
  }

  return result
    .sort((left, right) => compareRankedTasksForSampling(left, right, randomizationSeed))
    .slice(0, maxTasks);
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
  icpProfileId?: string | undefined,
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
      languages: config.languages,
      cities: icpConfig.cities,
      maxPagesPerQuery: icpConfig.maxPagesPerQuery ?? config.maxPagesPerQuery,
      taskTypes: config.taskTypes,
      searchProvider: icpConfig.searchProvider,
    } satisfies GenerateTasksV2Input,
    { now },
  );

  const existingRunQueryHashes = discoveryRunId
    ? await loadExistingRunQueryHashes(generatedTasks, discoveryRunId)
    : new Set<string>();
  const freshnessByKey = await loadHistoricalQueryFreshness(generatedTasks);
  const rankedTasks = generatedTasks
    .map((task, originalIndex) => ({
      task,
      originalIndex,
      lastExecutedAtMs: freshnessByKey.get(buildQueryFreshnessKey(task)) ?? null,
    }))
    .filter(({ task }) => !existingRunQueryHashes.has(task.queryHash));

  const randomizationSeed = buildSamplingSeed({
    discoveryRunId,
    now,
    config,
    icpConfig,
  });

  const maxInsertions = Math.max(0, config.maxTasks);
  const candidateTasks =
    rankedTasks.length > 0
      ? stratifiedSample(rankedTasks, rankedTasks.length, randomizationSeed)
      : [];

  let inserted = 0;

  for (const { task } of candidateTasks) {
    if (inserted >= maxInsertions) {
      break;
    }

    const runIdValue = discoveryRunId ?? null;
    const paramsJson = icpProfileId ? { ...task.paramsJson, icpProfileId } : task.paramsJson;
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
        ${JSON.stringify(paramsJson)}::jsonb,
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
    generated: Math.min(maxInsertions, candidateTasks.length),
    inserted,
  };
}

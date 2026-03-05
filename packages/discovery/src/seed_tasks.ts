import { prisma } from '@lead-flood/db';

import type { DiscoverySeedConfig } from './config.js';
import { generateTasks, generateTasksV2 } from './queries/generate_tasks.js';
import type { GenerateTasksV2Input } from './queries/generate_tasks.js';
import { mapIcpIndustriesToCategories } from './queries/icp-category-map.js';
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
 * Priority: config.countries (from API request, already filtered by ALLOWED_COUNTRIES)
 * takes precedence. ICP targetCountries is only used as fallback when config has none.
 */
function resolveCountries(configCountries: string[], icpTargetCountries: string[]): string[] {
  // API request countries are already validated/filtered — prefer them
  if (configCountries.length > 0) {
    return configCountries;
  }
  // Fallback to normalized ICP countries
  const normalized = normalizeCountriesToIso(icpTargetCountries);
  return normalized.length > 0 ? normalized : configCountries;
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
): Promise<SeedTasksResult> {
  // Use v2 generation if ICP config is provided with target industries
  const generatedTasks = icpConfig
    ? generateTasksV2(
        {
          categories: mapIcpIndustriesToCategories(icpConfig.targetIndustries),
          countries: resolveCountries(config.countries, icpConfig.targetCountries),
          cities: icpConfig.cities,
          maxPagesPerQuery: icpConfig.maxPagesPerQuery ?? config.maxPagesPerQuery,
          taskTypes: config.taskTypes,
          searchProvider: icpConfig.searchProvider,
        } satisfies GenerateTasksV2Input,
        { now },
      )
    : generateTasks(config, { now });

  if (config.seedProfile === 'small' && generatedTasks.length > config.maxTasks) {
    throw new Error(
      `Discovery seed generated ${generatedTasks.length} tasks, which exceeds DISCOVERY_SEED_MAX_TASKS=${config.maxTasks}. Reduce seed scope or increase the cap.`,
    );
  }

  let inserted = 0;

  for (const task of generatedTasks) {
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
        "updated_at"
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
        NOW()
      )
      ON CONFLICT ("task_type", "query_hash") DO NOTHING
    `;

    inserted += Number(result);
  }

  return {
    generated: generatedTasks.length,
    inserted,
  };
}

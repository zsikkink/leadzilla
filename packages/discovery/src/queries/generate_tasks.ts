import { randomUUID } from 'node:crypto';
import {
  countryDisplayName,
  normalizeCountryCodeOrAlias,
} from '@lead-flood/contracts';

import type { DiscoverySeedConfig } from '../config.js';
import { normalizeCity, normalizeQuery } from '../dedupe/normalize.js';
import { computeQueryHash, computeTimeBucket } from '../dedupe/task_key.js';
import type {
  DiscoveryCountryCode,
  DiscoveryLanguageCode,
  SearchTaskType,
} from '../providers/types.js';
import {
  defaultCitiesByCountry,
  queryTemplatesV2EN,
} from './seeds.js';

function renderTemplate(
  template: string,
  params: {
    category: string;
    city: string;
    country: string;
  },
): string {
  return template
    .replaceAll('{category}', params.category)
    .replaceAll('{city}', params.city)
    .replaceAll('{country}', params.country);
}

function buildSerpParams(
  taskType: SearchTaskType,
  queryText: string,
  countryCode: DiscoveryCountryCode,
  language: DiscoveryLanguageCode,
  city: string,
  page: number,
): Record<string, unknown> {
  const start = Math.max(0, (page - 1) * 10);
  const params: Record<string, unknown> = {
    q: queryText,
    gl: countryCode.toLowerCase(),
    hl: language,
    location: `${city}, ${countryDisplayName(countryCode)}`,
    start,
  };

  if (taskType === 'SERP_GOOGLE') {
    return {
      ...params,
      engine: 'google',
    };
  }

  if (taskType === 'SERP_GOOGLE_LOCAL') {
    return {
      ...params,
      engine: 'google_local',
    };
  }

  return {
    ...params,
    engine: 'google_maps',
    type: 'search',
  };
}

export interface GeneratedSearchTask {
  id: string;
  taskType: SearchTaskType;
  countryCode: DiscoveryCountryCode;
  city: string | null;
  language: DiscoveryLanguageCode;
  queryText: string;
  normalizedQueryKey: string;
  queryHash: string;
  paramsJson: Record<string, unknown>;
  page: number;
  timeBucket: string;
}

export interface GenerateTasksOptions {
  now?: Date;
}

function buildTimeBucket(
  now: Date,
  refreshBucket: DiscoverySeedConfig['refreshBucket'],
  seedBucket: string | null,
): string {
  const baseBucket = computeTimeBucket(now, refreshBucket);
  if (!seedBucket) {
    return baseBucket;
  }
  return `${baseBucket}:${seedBucket}`;
}

export function createGeneratedTask(
  taskType: SearchTaskType,
  countryCode: DiscoveryCountryCode,
  language: DiscoveryLanguageCode,
  cityRaw: string,
  queryText: string,
  page: number,
  timeBucket: string,
): GeneratedSearchTask {
  const city = normalizeCity(cityRaw);
  const normalizedQuery = normalizeQuery(queryText);
  const normalizedQueryKey = normalizeQuery(
    `${normalizedQuery}|${countryCode}|${language}|${city ?? ''}`,
  );
  const queryHash = computeQueryHash(
    taskType,
    countryCode,
    language,
    normalizedQueryKey,
    page,
    timeBucket,
  );

  return {
    id: randomUUID(),
    taskType,
    countryCode,
    city: cityRaw,
    language,
    queryText,
    normalizedQueryKey,
    queryHash,
    paramsJson: buildSerpParams(
      taskType,
      queryText,
      countryCode,
      language,
      cityRaw,
      page,
    ),
    page,
    timeBucket,
  };
}

/* ------------------------------------------------------------------ */
/* V2 — ICP-driven task generation                                    */
/* ------------------------------------------------------------------ */

export interface GenerateTasksV2Input {
  categories: string[];
  countries: string[];
  cities?: string[] | undefined;
  maxPagesPerQuery?: number | undefined;
  taskTypes?: SearchTaskType[] | undefined;
  /** When 'GOOGLE_PLACES', collapses to single task type and clamps maxPages to 1 */
  searchProvider?: 'SERPAPI' | 'GOOGLE_PLACES' | undefined;
}

/**
 * Resolve the list of cities for a single country.
 *
 * - If explicit `cities` are provided and do NOT include "All", filter them
 *   to only cities that belong to this country (case-insensitive match against
 *   defaultCitiesByCountry). This prevents cross-country pollution, e.g.
 *   selecting ["Dubai", "Cairo"] won't create "Cairo in UAE" tasks.
 * - If `cities` includes the literal string "All" (case-insensitive), expand
 *   to all default cities for every country.
 * - If `cities` is omitted, look up `defaultCitiesByCountry` and fall back to
 *   an empty list. Upstream validation should already block country-only runs
 *   without configured cities.
 */
function resolveCitiesForCountry(
  countryCode: string,
  explicitCities: string[] | undefined,
): string[] {
  if (explicitCities && explicitCities.length > 0) {
    const hasAll = explicitCities.some((c) => c.toLowerCase() === 'all');
    if (hasAll) {
      return defaultCitiesByCountry[countryCode] ?? [];
    }

    // Filter explicit cities to only those belonging to this country.
    // Build a lowercase set of this country's known cities for O(1) lookup.
    const countryCities = defaultCitiesByCountry[countryCode];
    if (countryCities && countryCities.length > 0) {
      const knownCitiesLower = new Set(countryCities.map((c) => c.toLowerCase()));
      const filtered = explicitCities.filter((c) => knownCitiesLower.has(c.toLowerCase()));
      if (filtered.length > 0) {
        return filtered;
      }
    // None of the explicit cities belong to this country — skip it entirely
    // by returning an empty array (the caller's loop will produce no tasks).
    return [];
  }

    // No curated city list for this country — pass explicit cities through as-is.
    return explicitCities;
  }

  return defaultCitiesByCountry[countryCode] ?? [];
}

export function generateTasksV2(
  input: GenerateTasksV2Input,
  options?: GenerateTasksOptions | undefined,
): GeneratedSearchTask[] {
  const now = options?.now ?? new Date();
  const timeBucket = buildTimeBucket(now, 'weekly', 'v2');
  const isGooglePlaces = input.searchProvider === 'GOOGLE_PLACES';

  let maxPages = input.maxPagesPerQuery ?? 1;
  if (isGooglePlaces && maxPages > 1) {
    console.warn(
      `[generate_tasks] maxPagesPerQuery=${maxPages} clamped to 1 for GOOGLE_PLACES provider ` +
        '(token-based pagination is incompatible with task model)',
    );
    maxPages = 1;
  }

  const defaultTaskTypes: SearchTaskType[] = isGooglePlaces
    ? ['SERP_GOOGLE_LOCAL']
    : ['SERP_MAPS_LOCAL'];
  const taskTypes: SearchTaskType[] = input.taskTypes ?? defaultTaskTypes;
  const templates = queryTemplatesV2EN;
  const language: DiscoveryLanguageCode = 'en';

  const tasks: GeneratedSearchTask[] = [];

  for (const rawCountry of input.countries) {
    const countryCode = normalizeCountryCodeOrAlias(rawCountry);
    if (!countryCode) {
      continue;
    }
    const countryName = countryDisplayName(countryCode);
    const cities = resolveCitiesForCountry(countryCode, input.cities);

    for (const cityRaw of cities) {
      for (const category of input.categories) {
        for (const template of templates) {
          const queryText = renderTemplate(template, {
            category,
            city: cityRaw,
            country: countryName,
          });

          for (let page = 1; page <= maxPages; page += 1) {
            for (const taskType of taskTypes) {
              tasks.push(
                createGeneratedTask(
                  taskType,
                  countryCode as DiscoveryCountryCode,
                  language,
                  cityRaw,
                  queryText,
                  page,
                  timeBucket,
                ),
              );
            }
          }
        }
      }
    }
  }

  return tasks;
}

import { randomUUID } from 'node:crypto';

import type { DiscoverySeedConfig } from '../config.js';
import { normalizeCity, normalizeQuery } from '../dedupe/normalize.js';
import { computeQueryHash, computeTimeBucket } from '../dedupe/task_key.js';
import type {
  DiscoveryCountryCode,
  DiscoveryLanguageCode,
  SearchTaskType,
} from '../providers/types.js';
import {
  COUNTRY_NAMES,
  defaultCitiesByCountry,
  queryTemplatesV2EN,
} from './seeds.js';

/**
 * Normalise country names/abbreviations from ICP profiles to ISO 3166-1 alpha-2.
 * Handles common variants: "UAE" → "AE", "KSA" → "SA", "Egypt" → "EG", etc.
 */
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  uae: 'AE',
  'united arab emirates': 'AE',
  ksa: 'SA',
  'saudi arabia': 'SA',
  egypt: 'EG',
  jordan: 'JO',
  qatar: 'QA',
  bahrain: 'BH',
  kuwait: 'KW',
  oman: 'OM',
  lebanon: 'LB',
  iraq: 'IQ',
  morocco: 'MA',
  tunisia: 'TN',
  algeria: 'DZ',
  libya: 'LY',
  yemen: 'YE',
  syria: 'SY',
  palestine: 'PS',
  sudan: 'SD',
  'united states': 'US',
  'united kingdom': 'GB',
};

function normalizeCountryCode(input: string): string {
  // Already a 2-letter ISO code?
  if (input.length === 2 && input === input.toUpperCase()) {
    return input;
  }
  return COUNTRY_NAME_TO_ISO[input.toLowerCase().trim()] ?? input;
}

function toCountrySearchName(countryCode: DiscoveryCountryCode): string {
  return COUNTRY_NAMES[countryCode] ?? countryCode;
}

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
    location: `${city}, ${toCountrySearchName(countryCode)}`,
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
 * - If explicit `cities` are provided and do NOT include "All", use them.
 * - If `cities` includes the literal string "All" (case-insensitive), expand
 *   to all default cities for every country.
 * - If `cities` is omitted, look up `defaultCitiesByCountry` and fall back to
 *   the country code itself (so queries still run even without city data).
 */
function resolveCitiesForCountry(
  countryCode: string,
  explicitCities: string[] | undefined,
): string[] {
  if (explicitCities && explicitCities.length > 0) {
    const hasAll = explicitCities.some((c) => c.toLowerCase() === 'all');
    if (hasAll) {
      return defaultCitiesByCountry[countryCode] ?? [countryCode];
    }
    return explicitCities;
  }

  return defaultCitiesByCountry[countryCode] ?? [countryCode];
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
    : ['SERP_GOOGLE_LOCAL', 'SERP_MAPS_LOCAL'];
  const taskTypes: SearchTaskType[] = input.taskTypes ?? defaultTaskTypes;
  const templates = queryTemplatesV2EN;
  const language: DiscoveryLanguageCode = 'en';

  const tasks: GeneratedSearchTask[] = [];

  for (const rawCountry of input.countries) {
    const countryCode = normalizeCountryCode(rawCountry);
    const countryName = COUNTRY_NAMES[countryCode] ?? countryCode;
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

import { randomUUID } from 'node:crypto';
import { getPipelineSetting } from '@lead-flood/db';
import type {
  CreateDiscoveryRunRequest,
  CreateDiscoveryRunResponse,
  CancelDiscoveryRunResponse,
  DiscoveryRunStatusResponse,
  ListDiscoveryRecordsQuery,
  ListDiscoveryRecordsResponse,
  ListDiscoveryRunsQuery,
  ListDiscoveryRunsResponse,
  PipelineRunStatus,
} from '@lead-flood/contracts';
import {
  buildSerpApiCountryCitiesMap,
  countryDisplayName,
  findCountriesMissingCities,
  normalizeCountryCodes,
} from '@lead-flood/contracts';

import type { DiscoveryRepository } from './discovery.repository.js';
import { DiscoveryInvalidRequestError } from './discovery.errors.js';

type DiscoverySeedLanguageCode = 'en' | 'ar';
type DiscoverySeedTaskType = 'SERP_GOOGLE' | 'SERP_GOOGLE_LOCAL' | 'SERP_MAPS_LOCAL';

const DASHBOARD_BULK_LANGUAGES: DiscoverySeedLanguageCode[] = ['en', 'ar'];
const DASHBOARD_BULK_TASK_TYPES: DiscoverySeedTaskType[] = ['SERP_MAPS_LOCAL'];
const DASHBOARD_BULK_MAX_PAGES = 1;
const DASHBOARD_BULK_MIN_REVIEW_COUNT = 0;

export interface DiscoveryRunJobPayload {
  runId: string;
  icpProfileId: string;
  countries: string[];
  cities?: string[] | undefined;
  searchCategories?: string[] | undefined;
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
  limit?: number | undefined;
  validationMode?: boolean | undefined;
  minReviewCount?: number | undefined;
  maxPages?: number | undefined;
  taskTypes?: DiscoverySeedTaskType[] | undefined;
  languages?: DiscoverySeedLanguageCode[] | undefined;
  requestedByUserId?: string | undefined;
}

export interface DiscoverySeedShardJobPayload {
  reason: 'api';
  correlationId: string;
  jobExecutionId: string;
  discoveryRunId: string;
  icpProfileId: string;
  countries: CreateDiscoveryRunRequest['countries'];
  cities?: CreateDiscoveryRunRequest['cities'];
  searchCategories?: string[] | undefined;
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
  /** Per-ICP seed cap; the sum across seed shards equals the requested search-task budget. */
  maxTasks?: number | undefined;
  /** Whole-run search-task budget used by discovery.run_search_task workers. */
  runMaxTasks?: number | undefined;
  maxPages?: number | undefined;
  taskTypes?: DiscoverySeedTaskType[] | undefined;
  languages?: DiscoverySeedLanguageCode[] | undefined;
  validationMode?: boolean | undefined;
  minReviewCount?: number | undefined;
  enqueueRunTasks: true;
}

export interface DiscoveryServiceDependencies {
  enqueueDiscoveryRun: (payload: DiscoveryRunJobPayload) => Promise<void>;
}

export interface DiscoveryService {
  createDiscoveryRun(input: CreateDiscoveryRunRequest): Promise<CreateDiscoveryRunResponse>;
  getDiscoveryRunStatus(
    runId: string,
    requestedByUserId?: string | undefined,
  ): Promise<DiscoveryRunStatusResponse>;
  listDiscoveryRecords(query: ListDiscoveryRecordsQuery): Promise<ListDiscoveryRecordsResponse>;
  listDiscoveryRuns(
    query: ListDiscoveryRunsQuery,
    requestedByUserId?: string | undefined,
  ): Promise<ListDiscoveryRunsResponse>;
  cancelDiscoveryRun(
    runId: string,
    requestedByUserId?: string | undefined,
  ): Promise<CancelDiscoveryRunResponse>;
}

async function resolveSupportedDiscoveryCities(
  input: CreateDiscoveryRunRequest,
): Promise<string[] | undefined> {
  const setting = await getPipelineSetting('countryCities');
  const countryCities = buildSerpApiCountryCitiesMap(setting?.valueJson, {
    includeCuratedDefaults: true,
  });
  const missingCountries = findCountriesMissingCities(input.countries, countryCities);

  if (missingCountries.length > 0) {
    throw new DiscoveryInvalidRequestError(
      `Add at least one city in Controls & Settings for ${missingCountries.map((country) => countryDisplayName(country)).join(', ')} before starting discovery.`,
    );
  }

  if (!input.cities || input.cities.length === 0) {
    return undefined;
  }

  const selectedCityKeys = new Set(input.cities.map((city) => city.trim().toLowerCase()));
  const supportedCities: string[] = [];

  for (const country of normalizeCountryCodes(input.countries)) {
    for (const city of countryCities[country] ?? []) {
      if (selectedCityKeys.has(city.toLowerCase())) {
        supportedCities.push(city);
      }
    }
  }

  if (supportedCities.length === 0) {
    throw new DiscoveryInvalidRequestError(
      'Select at least one SerpAPI-supported city before starting discovery.',
    );
  }

  return Array.from(new Set(supportedCities));
}

/**
 * Resolve the ICP profile IDs from the request.
 * Accepts either `icpProfileIds` (array) or legacy `icpProfileId` (single).
 */
function resolveIcpProfileIds(input: CreateDiscoveryRunRequest): string[] {
  if (input.icpProfileIds && input.icpProfileIds.length > 0) {
    return input.icpProfileIds;
  }
  if (input.icpProfileId) {
    return [input.icpProfileId];
  }
  return [];
}

function resolveRequestedSearchCategories(input: CreateDiscoveryRunRequest): string[] | undefined {
  const searchCategories = input.advancedSettings?.searchCategories;
  if (!searchCategories || searchCategories.length === 0) {
    return undefined;
  }

  return [...searchCategories];
}

function buildDiscoverySeedShardJobPayloads(
  runId: string,
  input: CreateDiscoveryRunRequest,
  icpProfileIds: string[],
): DiscoverySeedShardJobPayload[] {
  const totalLimit = input.limit;
  const icpCount = icpProfileIds.length;
  const perIcpLimit =
    totalLimit !== undefined && icpCount > 0 ? Math.floor(totalLimit / icpCount) : undefined;
  const remainderLimit =
    totalLimit !== undefined && perIcpLimit !== undefined ? totalLimit - perIcpLimit * icpCount : 0;
  const seedPayloads: DiscoverySeedShardJobPayload[] = [];
  const searchCategories = resolveRequestedSearchCategories(input);
  const minReviewCount = input.advancedSettings?.minReviewCount ?? DASHBOARD_BULK_MIN_REVIEW_COUNT;

  for (let i = 0; i < icpProfileIds.length; i += 1) {
    const icpProfileId = icpProfileIds[i]!;
    let maxTasks = perIcpLimit;

    if (maxTasks !== undefined && i < remainderLimit) {
      maxTasks += 1;
    }

    // Explicitly skip zero-budget shards instead of falling back to worker defaults.
    if (maxTasks !== undefined && maxTasks <= 0) {
      continue;
    }

    seedPayloads.push({
      reason: 'api',
      correlationId: runId,
      jobExecutionId: randomUUID(),
      discoveryRunId: runId,
      icpProfileId,
      countries: input.countries,
      cities: input.cities,
      ...(searchCategories ? { searchCategories } : {}),
      includeWebsiteAnalysis: input.includeWebsiteAnalysis,
      includeSocialMediaAnalysis: input.includeSocialMediaAnalysis,
      maxTasks,
      runMaxTasks: totalLimit,
      maxPages: DASHBOARD_BULK_MAX_PAGES,
      taskTypes: [...DASHBOARD_BULK_TASK_TYPES],
      languages: [...DASHBOARD_BULK_LANGUAGES],
      validationMode: (input.limit ?? 0) <= 10,
      minReviewCount,
      enqueueRunTasks: true,
    });
  }

  return seedPayloads;
}

export function buildDiscoveryService(
  repository: DiscoveryRepository,
  _dependencies: DiscoveryServiceDependencies,
): DiscoveryService {
  const queuedStatus: PipelineRunStatus = 'QUEUED';

  return {
    async createDiscoveryRun(input) {
      await repository.assertDiscoveryWorkerAvailable();
      const supportedCities = await resolveSupportedDiscoveryCities(input);
      const normalizedInput: CreateDiscoveryRunRequest = {
        ...input,
        ...(supportedCities ? { cities: supportedCities } : {}),
      };

      const runId = randomUUID();
      const icpProfileIds = resolveIcpProfileIds(normalizedInput);

      // Store the first ICP as the primary for backward compat in payload/display
      const primaryIcpProfileId = icpProfileIds[0] ?? '';
      const searchCategories = resolveRequestedSearchCategories(normalizedInput);
      const minReviewCount =
        normalizedInput.advancedSettings?.minReviewCount ?? DASHBOARD_BULK_MIN_REVIEW_COUNT;

      const payload: DiscoveryRunJobPayload = {
        runId,
        icpProfileId: primaryIcpProfileId,
        countries: normalizedInput.countries,
        cities: normalizedInput.cities,
        ...(searchCategories ? { searchCategories } : {}),
        includeWebsiteAnalysis: normalizedInput.includeWebsiteAnalysis,
        includeSocialMediaAnalysis: normalizedInput.includeSocialMediaAnalysis,
        limit: normalizedInput.limit,
        minReviewCount,
        maxPages: DASHBOARD_BULK_MAX_PAGES,
        taskTypes: [...DASHBOARD_BULK_TASK_TYPES],
        languages: [...DASHBOARD_BULK_LANGUAGES],
        requestedByUserId: normalizedInput.requestedByUserId,
      };

      const seedPayloads = buildDiscoverySeedShardJobPayloads(
        runId,
        normalizedInput,
        icpProfileIds,
      );
      await repository.createDiscoveryRun(runId, normalizedInput, payload, seedPayloads);

      return {
        runId,
        status: queuedStatus,
      };
    },
    async getDiscoveryRunStatus(runId, requestedByUserId) {
      return repository.getDiscoveryRunStatus(runId, requestedByUserId);
    },
    async listDiscoveryRecords(query) {
      return repository.listDiscoveryRecords(query);
    },
    async listDiscoveryRuns(query, requestedByUserId) {
      return repository.listDiscoveryRuns(query, requestedByUserId);
    },
    async cancelDiscoveryRun(runId, requestedByUserId) {
      return repository.cancelDiscoveryRun(runId, requestedByUserId);
    },
  };
}

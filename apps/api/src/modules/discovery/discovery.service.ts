import { randomUUID } from 'node:crypto';
import type {
  CreateDiscoveryRunRequest,
  CreateDiscoveryRunResponse,
  DiscoveryRunStatusResponse,
  ListDiscoveryRecordsQuery,
  ListDiscoveryRecordsResponse,
  ListDiscoveryRunsQuery,
  ListDiscoveryRunsResponse,
  PipelineRunStatus,
} from '@lead-flood/contracts';

import type { DiscoveryRepository } from './discovery.repository.js';

export interface DiscoveryRunJobPayload {
  runId: string;
  icpProfileId: string;
  countries: string[];
  cities?: string[] | undefined;
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
  limit?: number | undefined;
  validationMode?: boolean | undefined;
  minReviewCount?: number | undefined;
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
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
  maxTasks?: number | undefined;
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

function buildDiscoverySeedShardJobPayloads(
  runId: string,
  input: CreateDiscoveryRunRequest,
  icpProfileIds: string[],
): DiscoverySeedShardJobPayload[] {
  const totalLimit = input.limit;
  const icpCount = icpProfileIds.length;
  const perIcpLimit = totalLimit !== undefined && icpCount > 0
    ? Math.floor(totalLimit / icpCount)
    : undefined;
  const remainderLimit = totalLimit !== undefined && perIcpLimit !== undefined
    ? totalLimit - perIcpLimit * icpCount
    : 0;
  const seedPayloads: DiscoverySeedShardJobPayload[] = [];

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
      includeWebsiteAnalysis: input.includeWebsiteAnalysis,
      includeSocialMediaAnalysis: input.includeSocialMediaAnalysis,
      maxTasks,
      validationMode: (input.limit ?? 0) <= 10,
      minReviewCount: input.advancedSettings?.minReviewCount,
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

      const runId = randomUUID();
      const icpProfileIds = resolveIcpProfileIds(input);

      // Store the first ICP as the primary for backward compat in payload/display
      const primaryIcpProfileId = icpProfileIds[0] ?? '';

      const payload: DiscoveryRunJobPayload = {
        runId,
        icpProfileId: primaryIcpProfileId,
        countries: input.countries,
        cities: input.cities,
        includeWebsiteAnalysis: input.includeWebsiteAnalysis,
        includeSocialMediaAnalysis: input.includeSocialMediaAnalysis,
        limit: input.limit,
        minReviewCount: input.advancedSettings?.minReviewCount,
        requestedByUserId: input.requestedByUserId,
      };

      const seedPayloads = buildDiscoverySeedShardJobPayloads(runId, input, icpProfileIds);
      await repository.createDiscoveryRun(runId, input, payload, seedPayloads);

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
  };
}

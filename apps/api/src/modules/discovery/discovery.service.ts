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

export interface DiscoveryServiceDependencies {
  enqueueDiscoveryRun: (payload: DiscoveryRunJobPayload) => Promise<void>;
}

export interface DiscoveryService {
  createDiscoveryRun(input: CreateDiscoveryRunRequest): Promise<CreateDiscoveryRunResponse>;
  getDiscoveryRunStatus(runId: string): Promise<DiscoveryRunStatusResponse>;
  listDiscoveryRecords(query: ListDiscoveryRecordsQuery): Promise<ListDiscoveryRecordsResponse>;
  listDiscoveryRuns(query: ListDiscoveryRunsQuery): Promise<ListDiscoveryRunsResponse>;
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

export function buildDiscoveryService(
  repository: DiscoveryRepository,
  dependencies: DiscoveryServiceDependencies,
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

      await repository.createDiscoveryRun(runId, input, payload);

      try {
        // Split limit across ICPs: distribute remainder one-by-one from the front.
        const totalLimit = input.limit;
        const icpCount = icpProfileIds.length;
        const perIcpLimit = totalLimit !== undefined
          ? Math.floor(totalLimit / icpCount)
          : undefined;
        const remainderLimit = totalLimit !== undefined && perIcpLimit !== undefined
          ? totalLimit - perIcpLimit * icpCount
          : 0;

        for (let i = 0; i < icpProfileIds.length; i++) {
          const icpId = icpProfileIds[i]!;
          let icpLimit = perIcpLimit;
          if (icpLimit !== undefined && i < remainderLimit) {
            icpLimit += 1;
          }

          // Explicitly skip zero-budget shards instead of falling back to worker defaults.
          if (icpLimit !== undefined && icpLimit <= 0) {
            continue;
          }

          await dependencies.enqueueDiscoveryRun({
            runId,
            icpProfileId: icpId,
            countries: input.countries,
            includeWebsiteAnalysis: input.includeWebsiteAnalysis,
            includeSocialMediaAnalysis: input.includeSocialMediaAnalysis,
            limit: icpLimit,
            validationMode: (input.limit ?? 0) <= 10,
            minReviewCount: input.advancedSettings?.minReviewCount,
            requestedByUserId: input.requestedByUserId,
          });
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to enqueue discovery.run job';
        await repository.markDiscoveryRunFailed(runId, errorMessage);
        throw error;
      }

      return {
        runId,
        status: queuedStatus,
      };
    },
    async getDiscoveryRunStatus(runId) {
      return repository.getDiscoveryRunStatus(runId);
    },
    async listDiscoveryRecords(query) {
      return repository.listDiscoveryRecords(query);
    },
    async listDiscoveryRuns(query) {
      return repository.listDiscoveryRuns(query);
    },
  };
}

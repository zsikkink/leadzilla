import { prisma, toInputJson } from '@lead-flood/db';
import type {
  CreateDiscoveryRunRequest,
  DiscoveryRunStatusResponse,
  ListDiscoveryRecordsQuery,
  ListDiscoveryRecordsResponse,
  ListDiscoveryRunsQuery,
  ListDiscoveryRunsResponse,
  PipelineRunStatus,
} from '@lead-flood/contracts';

import {
  DiscoveryNotImplementedError,
  DiscoveryRunNotFoundError,
  DiscoveryWorkerUnavailableError,
} from './discovery.errors.js';
import type { DiscoveryRunJobPayload } from './discovery.service.js';

const DISCOVERY_RUN_JOB_TYPE = 'discovery.run';
const DEFAULT_PG_BOSS_SCHEMA = 'pgboss';

interface DiscoveryRunProgress {
  totalItems: number;
  processedItems: number;
  failedItems: number;
}

function toDayStart(value: string): Date {
  const source = new Date(value);
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  return 0;
}

export function readRunProgress(result: unknown): DiscoveryRunProgress {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return {
      totalItems: 0,
      processedItems: 0,
      failedItems: 0,
    };
  }

  const payload = result as Record<string, unknown>;
  const totalItems = (() => {
    const newFound = toCount(payload.newFound);
    if (newFound > 0) {
      return newFound;
    }

    const newBusinesses = toCount(payload.newBusinesses);
    if (newBusinesses > 0) {
      return newBusinesses;
    }

    return toCount(payload.totalItems);
  })();

  const failedItems = (() => {
    const explicitLeadFailures = toCount(payload.leadFailedItems);
    if (explicitLeadFailures > 0) {
      return explicitLeadFailures;
    }

    const rawFailedItems = toCount(payload.failedItems);
    const disqualified = toCount(payload.disqualified);
    return Math.max(0, rawFailedItems - disqualified);
  })();

  return {
    totalItems,
    processedItems: toCount(payload.processedItems),
    failedItems,
  };
}

function deriveCurrentStage(result: Record<string, unknown>, status: string): string | null {
  if (status !== 'running') return null;
  if (!result.searchTasksComplete) return 'searching';
  return 'processing';
}

function mapJobStatusToPipelineStatus(
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
  failedItems: number,
): PipelineRunStatus {
  switch (status) {
    case 'queued':
      return 'QUEUED';
    case 'running':
      return 'RUNNING';
    case 'failed':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    case 'completed':
    default:
      return failedItems > 0 ? 'PARTIAL' : 'SUCCEEDED';
  }
}

export interface DiscoveryRepository {
  assertDiscoveryWorkerAvailable(): Promise<void>;
  createDiscoveryRun(
    runId: string,
    input: CreateDiscoveryRunRequest,
    payload: DiscoveryRunJobPayload,
  ): Promise<void>;
  markDiscoveryRunFailed(runId: string, message: string): Promise<void>;
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

export class StubDiscoveryRepository implements DiscoveryRepository {
  async assertDiscoveryWorkerAvailable(): Promise<void> {
    throw new DiscoveryNotImplementedError('TODO: discovery worker availability check');
  }

  async createDiscoveryRun(
    _runId: string,
    _input: CreateDiscoveryRunRequest,
    _payload: DiscoveryRunJobPayload,
  ): Promise<void> {
    throw new DiscoveryNotImplementedError('TODO: create discovery run persistence');
  }

  async markDiscoveryRunFailed(_runId: string, _message: string): Promise<void> {
    throw new DiscoveryNotImplementedError('TODO: mark discovery run failed persistence');
  }

  async getDiscoveryRunStatus(
    _runId: string,
    _requestedByUserId?: string | undefined,
  ): Promise<DiscoveryRunStatusResponse> {
    throw new DiscoveryNotImplementedError('TODO: get discovery run status persistence');
  }

  async listDiscoveryRecords(_query: ListDiscoveryRecordsQuery): Promise<ListDiscoveryRecordsResponse> {
    throw new DiscoveryNotImplementedError('TODO: list discovery records persistence');
  }

  async listDiscoveryRuns(
    _query: ListDiscoveryRunsQuery,
    _requestedByUserId?: string | undefined,
  ): Promise<ListDiscoveryRunsResponse> {
    throw new DiscoveryNotImplementedError('TODO: list discovery runs persistence');
  }
}

export class PrismaDiscoveryRepository implements DiscoveryRepository {
  async assertDiscoveryWorkerAvailable(): Promise<void> {
    const schema = process.env.PG_BOSS_SCHEMA ?? DEFAULT_PG_BOSS_SCHEMA;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new DiscoveryWorkerUnavailableError('Invalid pg-boss schema configuration');
    }

    const [row] = await prisma.$queryRawUnsafe<Array<{ active: boolean }>>(
      `
        select exists (
          select 1
          from ${schema}.job
          where name = 'system.heartbeat'
            and completed_on >= now() - interval '3 minutes'
        ) as active
      `,
    );

    if (!row?.active) {
      throw new DiscoveryWorkerUnavailableError();
    }
  }

  async createDiscoveryRun(
    runId: string,
    input: CreateDiscoveryRunRequest,
    payload: DiscoveryRunJobPayload,
  ): Promise<void> {
    // Store the full ICP list in the payload for multi-ICP tracking
    const icpProfileIds = input.icpProfileIds?.length
      ? input.icpProfileIds
      : input.icpProfileId
        ? [input.icpProfileId]
        : [payload.icpProfileId];

    await prisma.jobExecution.create({
      data: {
        id: runId,
        type: DISCOVERY_RUN_JOB_TYPE,
        status: 'queued',
        attempts: 0,
        payload: toInputJson({
          ...payload,
          icpProfileIds,
        }),
        result: toInputJson({
          totalItems: 0,
          processedItems: 0,
          failedItems: 0,
        }),
        error: null,
      },
    });
  }

  async markDiscoveryRunFailed(runId: string, message: string): Promise<void> {
    await prisma.jobExecution.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error: message,
        finishedAt: new Date(),
      },
    });
  }

  async getDiscoveryRunStatus(
    runId: string,
    requestedByUserId?: string | undefined,
  ): Promise<DiscoveryRunStatusResponse> {
    const run = await prisma.jobExecution.findFirst({
      where: {
        id: runId,
        type: DISCOVERY_RUN_JOB_TYPE,
        ...(requestedByUserId
          ? {
              payload: {
                path: ['requestedByUserId'],
                equals: requestedByUserId,
              },
            }
          : {}),
      },
    });

    if (!run) {
      throw new DiscoveryRunNotFoundError();
    }

    const progress = readRunProgress(run.result);
    const status = mapJobStatusToPipelineStatus(run.status, progress.failedItems);
    const resultJson = run.result && typeof run.result === 'object' && !Array.isArray(run.result)
      ? run.result as Record<string, unknown>
      : {};

    return {
      runId: run.id,
      runType: 'DISCOVERY',
      status,
      totalItems: progress.totalItems,
      processedItems: progress.processedItems,
      failedItems: progress.failedItems,
      startedAt: run.startedAt?.toISOString() ?? null,
      endedAt: run.finishedAt?.toISOString() ?? null,
      errorMessage: run.error,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      currentStage: deriveCurrentStage(resultJson, run.status),
    };
  }

  async listDiscoveryRecords(query: ListDiscoveryRecordsQuery): Promise<ListDiscoveryRecordsResponse> {
    const where = {
      ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            discoveredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [total, rows, qualityRows] = await Promise.all([
      prisma.leadDiscoveryRecord.count({ where }),
      prisma.leadDiscoveryRecord.findMany({
        where,
        orderBy: [{ discoveredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      query.includeQualityMetrics
        ? prisma.analyticsDailyRollup.findMany({
            where: {
              ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
              ...(query.from || query.to
                ? {
                    day: {
                      ...(query.from ? { gte: toDayStart(query.from) } : {}),
                      ...(query.to ? { lte: toDayStart(query.to) } : {}),
                    },
                  }
                : {}),
            },
            select: {
              discoveredCount: true,
              validEmailCount: true,
              validDomainCount: true,
              industryMatchRate: true,
              geoMatchRate: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const qualityDenominator = qualityRows.reduce((sum, row) => sum + row.discoveredCount, 0);
    const qualityMetrics = query.includeQualityMetrics
      ? {
          validEmailCount: qualityRows.reduce((sum, row) => sum + row.validEmailCount, 0),
          validDomainCount: qualityRows.reduce((sum, row) => sum + row.validDomainCount, 0),
          industryMatchRate:
            qualityDenominator > 0
              ? Number(
                  (
                    qualityRows.reduce(
                      (sum, row) => sum + row.industryMatchRate * row.discoveredCount,
                      0,
                    ) / qualityDenominator
                  ).toFixed(6),
                )
              : 0,
          geoMatchRate:
            qualityDenominator > 0
              ? Number(
                  (
                    qualityRows.reduce((sum, row) => sum + row.geoMatchRate * row.discoveredCount, 0) /
                    qualityDenominator
                  ).toFixed(6),
                )
              : 0,
        }
      : undefined;

    return {
      items: rows.map((row) => ({
        id: row.id,
        leadId: row.leadId,
        icpProfileId: row.icpProfileId,
        provider: row.provider,
        providerSource: row.providerSource,
        providerConfidence: row.providerConfidence,
        providerRecordId: row.providerRecordId,
        providerCursor: row.providerCursor,
        queryHash: row.queryHash,
        status: row.status,
        rawPayload: row.rawPayload,
        provenanceJson: row.provenanceJson,
        errorMessage: row.errorMessage,
        discoveredAt: row.discoveredAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      qualityMetrics,
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listDiscoveryRuns(
    query: ListDiscoveryRunsQuery,
    requestedByUserId?: string | undefined,
  ): Promise<ListDiscoveryRunsResponse> {
    const where = {
      type: DISCOVERY_RUN_JOB_TYPE,
      ...(requestedByUserId
        ? {
            payload: {
              path: ['requestedByUserId'],
              equals: requestedByUserId,
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.jobExecution.count({ where }),
      prisma.jobExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      runs: rows.map((row) => {
        const progress = readRunProgress(row.result);
        const status = mapJobStatusToPipelineStatus(row.status, progress.failedItems);
        const payload = (row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload))
          ? row.payload as Record<string, unknown>
          : {};
        const rowResultJson = (row.result && typeof row.result === 'object' && !Array.isArray(row.result))
          ? row.result as Record<string, unknown>
          : {};

        const countries: string[] = Array.isArray(payload.countries)
          ? (payload.countries as string[])
          : [];
        const limit = typeof payload.limit === 'number' ? payload.limit : 0;
        const icpProfileId = typeof payload.icpProfileId === 'string'
          ? payload.icpProfileId
          : null;
        const icpProfileIds = Array.isArray(payload.icpProfileIds)
          ? (payload.icpProfileIds as string[])
          : icpProfileId
            ? [icpProfileId]
            : [];

        return {
          runId: row.id,
          status,
          totalItems: progress.totalItems,
          processedItems: progress.processedItems,
          failedItems: progress.failedItems,
          createdAt: row.createdAt.toISOString(),
          startedAt: row.startedAt?.toISOString() ?? null,
          finishedAt: row.finishedAt?.toISOString() ?? null,
          icpProfileId,
          icpProfileIds,
          countries,
          limit,
          errorMessage: row.error,
          currentStage: deriveCurrentStage(rowResultJson, row.status),
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}

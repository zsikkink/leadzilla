import { prisma, type Prisma } from '@lead-flood/db';

const DEFAULT_PG_BOSS_SCHEMA = 'pgboss';

export interface CancelDiscoveryRunResult {
  success: boolean;
  outcome: 'cancelled' | 'already_cancelled' | 'already_terminal';
  terminalStatus: 'completed' | 'failed' | 'cancelled' | null;
  cancelledPendingJobsCount: number;
}

export class CancelDiscoveryRunConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CancelDiscoveryRunConfigurationError';
  }
}

export class CancelDiscoveryRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CancelDiscoveryRunConflictError';
  }
}

function readPgBossSchema(): string {
  const schema = process.env.PG_BOSS_SCHEMA ?? DEFAULT_PG_BOSS_SCHEMA;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new CancelDiscoveryRunConfigurationError('Invalid pg-boss schema configuration');
  }
  return schema;
}

export async function cancelDiscoveryRun(
  id: string,
  requestedByUserId?: string | undefined,
): Promise<CancelDiscoveryRunResult | null> {
  const run = await prisma.jobExecution.findFirst({
    where: {
      id,
      ...(requestedByUserId
        ? {
            payload: {
              path: ['requestedByUserId'],
              equals: requestedByUserId,
            },
          }
        : {}),
    },
    select: { status: true, result: true },
  });

  if (!run) {
    return null;
  }

  if (run.status === 'cancelled') {
    return {
      success: true,
      outcome: 'already_cancelled',
      terminalStatus: 'cancelled',
      cancelledPendingJobsCount: 0,
    };
  }

  const terminalStatuses = ['completed', 'failed'] as const;
  if (terminalStatuses.includes(run.status as (typeof terminalStatuses)[number])) {
    return {
      success: false,
      outcome: 'already_terminal',
      terminalStatus: run.status as 'completed' | 'failed',
      cancelledPendingJobsCount: 0,
    };
  }

  const now = new Date();
  const schema = readPgBossSchema();
  let cancelledPendingJobsCount = 0;
  let cancelledSearchTasksCount = 0;
  let queueCleanupError: string | null = null;
  let searchTaskCleanupError: string | null = null;

  try {
    const cleanupRows = await prisma.$queryRawUnsafe<Array<{ deleted_count: number }>>(
      `
        with deleted as (
          delete from ${schema}.job
          where state in ('created', 'retry', 'active')
            and name in (
              'discovery.seed',
              'discovery.run_search_task',
              'business.prequalify',
              'business.convert',
              'features.compute',
              'scoring.compute',
              'apollo.enrich',
              'message.generate',
              'message.send'
            )
            and (
              data ->> 'discoveryRunId' = $1
              or data ->> 'runId' = $2
              or singleton_key like $3
            )
          returning 1
        )
        select count(*)::int as deleted_count from deleted
      `,
      id,
      id,
      `%${id}%`,
    );
    cancelledPendingJobsCount = cleanupRows[0]?.deleted_count ?? 0;
  } catch (error: unknown) {
    queueCleanupError = error instanceof Error ? error.message : 'queue cleanup failed';
  }

  try {
    const searchTaskCleanup = await prisma.searchTask.updateMany({
      where: {
        discoveryRunId: id,
        status: { in: ['PENDING', 'RUNNING'] },
      },
      data: {
        status: 'FAILED',
        error: 'Cancelled: discovery run was cancelled',
      },
    });
    cancelledSearchTasksCount = searchTaskCleanup.count;
  } catch (error: unknown) {
    searchTaskCleanupError = error instanceof Error ? error.message : 'search task cleanup failed';
  }

  const existingResult =
    run.result && typeof run.result === 'object' && !Array.isArray(run.result)
      ? run.result as Record<string, unknown>
      : {};

  try {
    await prisma.jobExecution.update({
      where: { id },
      data: {
        status: 'cancelled',
        finishedAt: now,
        result: {
          ...existingResult,
          cancellation: {
            outcome: 'cancelled',
            cancelledAt: now.toISOString(),
            cancelledPendingJobsCount,
            cancelledSearchTasksCount,
            ...(queueCleanupError ? { queueCleanupError } : {}),
            ...(searchTaskCleanupError ? { searchTaskCleanupError } : {}),
          },
        } as Prisma.InputJsonValue,
      },
    });
  } catch {
    const latest = await prisma.jobExecution.findFirst({
      where: {
        id,
        ...(requestedByUserId
          ? {
              payload: {
                path: ['requestedByUserId'],
                equals: requestedByUserId,
              },
            }
          : {}),
      },
      select: { status: true },
    });
    if (latest?.status === 'cancelled') {
      return {
        success: true,
        outcome: 'already_cancelled',
        terminalStatus: 'cancelled',
        cancelledPendingJobsCount,
      };
    }
    if (latest && terminalStatuses.includes(latest.status as (typeof terminalStatuses)[number])) {
      return {
        success: false,
        outcome: 'already_terminal',
        terminalStatus: latest.status as 'completed' | 'failed',
        cancelledPendingJobsCount,
      };
    }
    throw new CancelDiscoveryRunConflictError('Unable to cancel run due to concurrent state update');
  }

  return {
    success: true,
    outcome: 'cancelled',
    terminalStatus: 'cancelled',
    cancelledPendingJobsCount,
  };
}

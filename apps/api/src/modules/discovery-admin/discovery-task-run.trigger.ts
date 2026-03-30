import { prisma, toInputJson, type Prisma } from '@lead-flood/db';
import type { RunDiscoveryTasksRequest, TriggerJobRunResponse } from '@lead-flood/contracts';
import type PgBoss from 'pg-boss';

export function buildTriggerDiscoveryTaskRun(
  boss: Pick<PgBoss, 'send'>,
): (input: RunDiscoveryTasksRequest) => Promise<TriggerJobRunResponse> {
  return async (input: RunDiscoveryTasksRequest): Promise<TriggerJobRunResponse> => {
    const startedAt = new Date();
    const concurrency = input.concurrency ?? 1;
    const run = await prisma.jobRun.create({
      data: {
        jobName: 'discovery.run_search_task',
        status: 'RUNNING',
        startedAt,
        paramsJson: toInputJson({
          ...input,
          concurrency,
        }),
        countersJson: {
          tasks_processed: 0,
          done: 0,
          failed: 0,
          skipped: 0,
          new_businesses: 0,
          new_sources: 0,
        } as Prisma.InputJsonValue,
        resourceJson: {
          serpapi_requests: 0,
          serpapi_cached_responses: 0,
          estimated_serpapi_cost_units: 0,
          db_writes: {
            businesses_inserted: 0,
            sources_inserted: 0,
            evidence_inserted: 0,
          },
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    try {
      for (let slot = 0; slot < concurrency; slot += 1) {
        await boss.send(
          'discovery.run_search_task',
          {
            slot,
            reason: 'api',
            correlationId: `api:job_run:${run.id}`,
            jobRunId: run.id,
            maxTasks: input.maxTasks,
            timeBucket: input.timeBucket,
          },
          {
            retryLimit: 5,
            retryDelay: 30,
            retryBackoff: true,
          },
        );
      }
    } catch (error: unknown) {
      await prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorText:
            error instanceof Error
              ? error.message
              : 'Failed to enqueue discovery.run_search_task job',
        },
      });
      throw error;
    }

    return {
      jobRunId: run.id,
      status: 'RUNNING',
    };
  };
}

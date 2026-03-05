import { getMetricSnapshot, logDiscoveryEvent, runSearchTask } from '@lead-flood/discovery';
import type {
  DiscoveryProvider as SerpDiscoveryProvider,
  DiscoveryRuntimeConfig,
} from '@lead-flood/discovery';
import { prisma, toInputJson } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { classifyError } from '../errors.js';

export const DISCOVERY_RUN_SEARCH_TASK_JOB_NAME = 'discovery.run_search_task';
export const DISCOVERY_RUN_SEARCH_TASK_IDEMPOTENCY_KEY_PATTERN =
  'discovery.run_search_task:${slot}';

export const DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  deadLetter: 'discovery.run_search_task.dead_letter',
};

export interface DiscoveryRunSearchTaskJobPayload {
  slot?: number;
  reason?: string;
  correlationId?: string;
  jobRunId?: string;
  maxTasks?: number;
  timeBucket?: string;
  /** Pipeline v2 fields — passed from discovery.seed to enable business.prequalify chaining. */
  discoveryRunId?: string | undefined;
  icpProfileId?: string | undefined;
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
}

export interface DiscoveryRunSearchTaskLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface DiscoveryRunSearchTaskDependencies {
  boss: Pick<PgBoss, 'send'>;
  provider: SerpDiscoveryProvider;
  config: DiscoveryRuntimeConfig;
  maxTasks?: number;
  enqueueBusinessPrequalify?: ((payload: {
    businessId: string;
    discoveryRunId: string;
    icpProfileId: string;
    includeWebsiteAnalysis?: boolean | undefined;
    includeSocialMediaAnalysis?: boolean | undefined;
    correlationId?: string | undefined;
  }) => Promise<void>) | undefined;
}

interface RunState {
  processedTaskCount: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
  newBusinesses: number;
  newSources: number;
  serpapiRequests: number;
  startedAtMs: number;
  finalized: boolean;
  /** Number of concurrent slots actively using this state. */
  activeSlots: number;
}

function getRunKey(job: Job<DiscoveryRunSearchTaskJobPayload>): string {
  if (job.data.jobRunId) {
    return `jobRun:${job.data.jobRunId}`;
  }
  if (job.data.correlationId) {
    return `correlation:${job.data.correlationId}`;
  }
  return `slot:${job.data.slot ?? 0}`;
}

const runStates = new Map<string, RunState>();

function getRunState(runKey: string): RunState {
  const existing = runStates.get(runKey);
  if (existing) {
    return existing;
  }
  const created: RunState = {
    processedTaskCount: 0,
    doneCount: 0,
    failedCount: 0,
    skippedCount: 0,
    newBusinesses: 0,
    newSources: 0,
    serpapiRequests: 0,
    startedAtMs: Date.now(),
    finalized: false,
    activeSlots: 0,
  };
  runStates.set(runKey, created);
  return created;
}

/**
 * Release a slot from the run state. Cleans up the Map entry only when
 * no more concurrent slots are using it (with a grace period).
 */
function releaseSlot(runKey: string, state: RunState): void {
  state.activeSlots = Math.max(0, state.activeSlots - 1);
  if (state.finalized && state.activeSlots === 0) {
    // Grace period: let any in-flight slot finish before removing
    setTimeout(() => {
      const current = runStates.get(runKey);
      if (current && current.finalized && current.activeSlots === 0) {
        runStates.delete(runKey);
      }
    }, 30_000);
  }
}

function nextPollDelaySeconds(status: 'EMPTY' | 'DONE' | 'FAILED' | 'SKIPPED'): number {
  if (status === 'EMPTY') {
    return 30;
  }
  if (status === 'SKIPPED') {
    return 15;
  }
  return 1;
}

async function updateJobRunProgress(jobRunId: string, state: RunState): Promise<void> {
  await prisma.jobRun.update({
    where: { id: jobRunId },
    data: {
      status: 'RUNNING',
      countersJson: toInputJson({
        tasks_processed: state.processedTaskCount,
        done: state.doneCount,
        failed: state.failedCount,
        skipped: state.skippedCount,
        new_businesses: state.newBusinesses,
        new_sources: state.newSources,
      }),
      resourceJson: toInputJson({
        serpapi_requests: state.serpapiRequests,
        serpapi_cached_responses: 0,
        estimated_serpapi_cost_units: state.serpapiRequests,
        db_writes: {
          businesses_inserted: state.newBusinesses,
          sources_inserted: state.newSources,
          evidence_inserted: state.newBusinesses,
        },
      }),
    },
  });
}

async function updateDiscoveryRunProgress(discoveryRunId: string, state: RunState): Promise<void> {
  await prisma.jobExecution.update({
    where: { id: discoveryRunId },
    data: {
      status: 'running',
      result: toInputJson({
        processedItems: state.processedTaskCount,
        failedItems: state.failedCount,
        newBusinesses: state.newBusinesses,
        newSources: state.newSources,
        serpapiRequests: state.serpapiRequests,
      }),
    },
  });
}

async function finalizeDiscoveryRun(
  discoveryRunId: string,
  state: RunState,
  status: 'completed' | 'failed',
  errorMessage: string | null,
  icpProfileId?: string | undefined,
): Promise<void> {
  if (state.finalized) {
    return;
  }
  state.finalized = true;

  const yieldRate = state.processedTaskCount > 0
    ? state.newBusinesses / state.processedTaskCount
    : 0;

  await prisma.jobExecution.update({
    where: { id: discoveryRunId },
    data: {
      status,
      finishedAt: new Date(),
      ...(errorMessage ? { error: errorMessage } : {}),
      result: toInputJson({
        processedItems: state.processedTaskCount,
        failedItems: state.failedCount,
        newBusinesses: state.newBusinesses,
        newSources: state.newSources,
        serpapiRequests: state.serpapiRequests,
        durationMs: Math.max(0, Date.now() - state.startedAtMs),
        yieldRate,
      }),
    },
  });

  // 5C: Store yield rate for adaptive budget computation (EMA smoothing)
  if (icpProfileId && yieldRate > 0) {
    try {
      const setting = await prisma.pipelineSetting.findUnique({
        where: { key: `discovery_yield_rate:${icpProfileId}` },
      });
      const historicalRate = setting?.valueJson ? Number(setting.valueJson) : yieldRate;
      const smoothedRate = 0.3 * yieldRate + 0.7 * historicalRate;

      await prisma.pipelineSetting.upsert({
        where: { key: `discovery_yield_rate:${icpProfileId}` },
        create: {
          key: `discovery_yield_rate:${icpProfileId}`,
          valueJson: smoothedRate,
        },
        update: {
          valueJson: smoothedRate,
        },
      });
    } catch {
      // Best-effort — don't fail the run finalization
    }
  }
}

async function finalizeJobRun(
  jobRunId: string,
  state: RunState,
  status: 'SUCCESS' | 'FAILED',
  errorText: string | null,
): Promise<void> {
  if (state.finalized) {
    return;
  }
  state.finalized = true;

  await prisma.jobRun.update({
    where: { id: jobRunId },
    data: {
      status,
      finishedAt: new Date(),
      durationMs: Math.max(0, Date.now() - state.startedAtMs),
      errorText,
      countersJson: toInputJson({
        tasks_processed: state.processedTaskCount,
        done: state.doneCount,
        failed: state.failedCount,
        skipped: state.skippedCount,
        new_businesses: state.newBusinesses,
        new_sources: state.newSources,
      }),
      resourceJson: toInputJson({
        serpapi_requests: state.serpapiRequests,
        serpapi_cached_responses: 0,
        estimated_serpapi_cost_units: state.serpapiRequests,
        db_writes: {
          businesses_inserted: state.newBusinesses,
          sources_inserted: state.newSources,
          evidence_inserted: state.newBusinesses,
        },
      }),
    },
  });
}

export async function handleDiscoveryRunSearchTaskJob(
  logger: DiscoveryRunSearchTaskLogger,
  job: Job<DiscoveryRunSearchTaskJobPayload>,
  dependencies: DiscoveryRunSearchTaskDependencies,
): Promise<void> {
  const slot = job.data.slot ?? 0;
  const correlationId = job.data.correlationId ?? job.id;
  const runKey = getRunKey(job);
  const runState = getRunState(runKey);
  runState.activeSlots += 1;
  const effectiveMaxTasks = job.data.maxTasks ?? dependencies.maxTasks;
  try {

  if (effectiveMaxTasks !== undefined && runState.processedTaskCount >= effectiveMaxTasks) {
    if (job.data.jobRunId) {
      await finalizeJobRun(job.data.jobRunId, runState, 'SUCCESS', null);
      releaseSlot(runKey, runState);
    }
    if (job.data.discoveryRunId) {
      await finalizeDiscoveryRun(job.data.discoveryRunId, runState, 'completed', null, job.data.icpProfileId);
      releaseSlot(runKey, runState);
    }
    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        maxTasks: effectiveMaxTasks,
        processedTaskCount: runState.processedTaskCount,
      },
      'Skipping discovery.run_search_task loop because DISCOVERY_RUN_MAX_TASKS has been reached',
    );
    return;
  }

  const runResult = await runSearchTask(
    dependencies.provider,
    dependencies.config,
    {
      ...(job.data.timeBucket ? { timeBucket: job.data.timeBucket } : {}),
      ...(job.data.discoveryRunId ? { discoveryRunId: job.data.discoveryRunId } : {}),
    },
  );

  // ── Enqueue business.prequalify for each newly created business ──
  // B8: Cross-ICP dedup — skip businesses that already have leads from other ICPs
  if (
    runResult.newBusinessIds.length > 0 &&
    dependencies.enqueueBusinessPrequalify &&
    job.data.discoveryRunId &&
    job.data.icpProfileId
  ) {
    // Check which new businesses already have leads (converted by another ICP run)
    const existingConversions = runResult.newBusinessIds.length > 0
      ? await prisma.businessConversion.findMany({
          where: { businessId: { in: runResult.newBusinessIds } },
          select: { businessId: true },
        })
      : [];
    const alreadyConvertedIds = new Set(existingConversions.map((c) => c.businessId));

    let enqueuedCount = 0;
    let skippedCount = 0;

    for (const businessId of runResult.newBusinessIds) {
      if (alreadyConvertedIds.has(businessId)) {
        skippedCount += 1;
        continue;
      }
      await dependencies.enqueueBusinessPrequalify({
        businessId,
        discoveryRunId: job.data.discoveryRunId,
        icpProfileId: job.data.icpProfileId,
        ...(job.data.includeWebsiteAnalysis !== undefined
          ? { includeWebsiteAnalysis: job.data.includeWebsiteAnalysis }
          : {}),
        ...(job.data.includeSocialMediaAnalysis !== undefined
          ? { includeSocialMediaAnalysis: job.data.includeSocialMediaAnalysis }
          : {}),
        ...(correlationId ? { correlationId } : {}),
      });
      enqueuedCount += 1;
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        discoveryRunId: job.data.discoveryRunId,
        enqueuedPrequalifyCount: enqueuedCount,
        skippedAlreadyConvertedCount: skippedCount,
      },
      'Enqueued business.prequalify for newly discovered businesses',
    );
  }

  if (runResult.taskId) {
    runState.processedTaskCount += 1;
    runState.serpapiRequests += 1;
    runState.newBusinesses += runResult.newBusinesses;
    runState.newSources += runResult.newSources;
    if (runResult.status === 'DONE') {
      runState.doneCount += 1;
    }
    if (runResult.status === 'FAILED') {
      runState.failedCount += 1;
    }
    if (runResult.status === 'SKIPPED') {
      runState.skippedCount += 1;
    }
  }

  if (job.data.jobRunId) {
    if (runResult.status === 'FAILED' && effectiveMaxTasks === undefined) {
      await finalizeJobRun(job.data.jobRunId, runState, 'FAILED', runResult.error ?? 'Task failed');
      releaseSlot(runKey, runState);
    } else {
      await updateJobRunProgress(job.data.jobRunId, runState);
    }
  }

  // Update discovery run progress counters
  if (job.data.discoveryRunId) {
    if (runResult.status === 'FAILED' && effectiveMaxTasks === undefined) {
      await finalizeDiscoveryRun(job.data.discoveryRunId, runState, 'failed', runResult.error ?? 'Task failed', job.data.icpProfileId);
      releaseSlot(runKey, runState);
    } else {
      await updateDiscoveryRunProgress(job.data.discoveryRunId, runState);
    }
  }

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      slot,
      correlationId,
      taskId: runResult.taskId,
      status: runResult.status,
      taskType: runResult.taskType ?? null,
      queryHash: runResult.queryHash ?? null,
      countryCode: runResult.countryCode ?? null,
      language: runResult.language ?? null,
      attempts: runResult.attempts ?? null,
      durationMs: runResult.durationMs,
      newBusinesses: runResult.newBusinesses,
      newSources: runResult.newSources,
      localBusinessCount: runResult.localBusinessCount,
      organicResultCount: runResult.organicResultCount,
      error: runResult.error ?? null,
      processedTaskCount: runState.processedTaskCount,
      maxTasks: effectiveMaxTasks ?? null,
      metrics: getMetricSnapshot(),
      timeBucket: job.data.timeBucket ?? null,
      jobRunId: job.data.jobRunId ?? null,
    },
    'Processed discovery.run_search_task job',
  );

  logDiscoveryEvent('discovery.run_search_task.completed', {
    slot,
    correlationId,
    taskId: runResult.taskId,
    status: runResult.status,
    queryHash: runResult.queryHash ?? null,
    duration_ms: runResult.durationMs,
    new_businesses: runResult.newBusinesses,
    new_sources: runResult.newSources,
    local_businesses: runResult.localBusinessCount,
    organic_results: runResult.organicResultCount,
    error: runResult.error ?? null,
    processed_task_count: runState.processedTaskCount,
    max_tasks: effectiveMaxTasks ?? null,
    time_bucket: job.data.timeBucket ?? null,
  });

  if (effectiveMaxTasks !== undefined && runState.processedTaskCount >= effectiveMaxTasks) {
    if (job.data.jobRunId) {
      await finalizeJobRun(job.data.jobRunId, runState, 'SUCCESS', null);
      releaseSlot(runKey, runState);
    }
    if (job.data.discoveryRunId) {
      await finalizeDiscoveryRun(job.data.discoveryRunId, runState, 'completed', null, job.data.icpProfileId);
      releaseSlot(runKey, runState);
    }
    logger.info(
      {
        slot,
        correlationId,
        processedTaskCount: runState.processedTaskCount,
        maxTasks: effectiveMaxTasks,
      },
      'Stopping discovery.run_search_task loop after hitting DISCOVERY_RUN_MAX_TASKS',
    );
    return;
  }

  if (effectiveMaxTasks !== undefined && runResult.status === 'EMPTY') {
    if (job.data.jobRunId) {
      await finalizeJobRun(job.data.jobRunId, runState, 'SUCCESS', null);
      releaseSlot(runKey, runState);
    }
    if (job.data.discoveryRunId) {
      await finalizeDiscoveryRun(job.data.discoveryRunId, runState, 'completed', null, job.data.icpProfileId);
      releaseSlot(runKey, runState);
    }
    logger.info(
      {
        slot,
        correlationId,
        processedTaskCount: runState.processedTaskCount,
        maxTasks: effectiveMaxTasks,
      },
      'Stopping discovery.run_search_task loop because bounded run reached empty queue',
    );
    return;
  }

  const startAfterSeconds = nextPollDelaySeconds(runResult.status);
  // singletonKey prevents duplicate loops if pg-boss retries while self-enqueue is pending
  const runId = job.data.discoveryRunId ?? job.data.jobRunId ?? correlationId;
  const singletonKey = `discovery.run_search_task:${runId}:slot-${slot}`;
  await dependencies.boss.send(
    DISCOVERY_RUN_SEARCH_TASK_JOB_NAME,
    {
      slot,
      reason: 'loop',
      correlationId,
      jobRunId: job.data.jobRunId,
      maxTasks: effectiveMaxTasks,
      timeBucket: job.data.timeBucket,
      discoveryRunId: job.data.discoveryRunId,
      icpProfileId: job.data.icpProfileId,
      includeWebsiteAnalysis: job.data.includeWebsiteAnalysis,
      includeSocialMediaAnalysis: job.data.includeSocialMediaAnalysis,
    },
    {
      startAfter: startAfterSeconds,
      singletonKey,
      ...DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS,
    },
  );
  } catch (error: unknown) {
    releaseSlot(runKey, runState);
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        slot,
        correlationId,
        error,
      },
      'Failed discovery.run_search_task job',
    );
    throw classifyError(error);
  }
  releaseSlot(runKey, runState);
}

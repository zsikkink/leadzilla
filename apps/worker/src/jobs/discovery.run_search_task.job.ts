import { randomUUID } from 'node:crypto';

import { getMetricSnapshot, logDiscoveryEvent, runSearchTask } from '@lead-flood/discovery';
import type {
  DiscoveryProvider as SerpDiscoveryProvider,
  DiscoveryRuntimeConfig,
} from '@lead-flood/discovery';
import { prisma, toInputJson } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { classifyError } from '../errors.js';
import {
  markSearchTasksComplete,
  tryFinalizeDiscoveryRun,
  isLeadTargetReached,
} from '../utils/discovery-run-tracker.js';

export const DISCOVERY_RUN_SEARCH_TASK_JOB_NAME = 'discovery.run_search_task';
export const DISCOVERY_RUN_SEARCH_TASK_IDEMPOTENCY_KEY_PATTERN =
  'discovery.run_search_task:${slot}';
export const DISCOVERY_ATTRIBUTION_ASSIGNMENT_MODE_SEARCH_TASK_FIRST_TOUCH =
  'SEARCH_TASK_FIRST_TOUCH';

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
  /** Early-stop: stop searching when this many unique businesses are found. */
  targetUniqueBusinesses?: number | undefined;
  /** User-configured minimum review count for pre-qualification. */
  minReviewCount?: number | undefined;
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
    minReviewCount?: number | undefined;
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

interface DiscoveryAttributionAssignmentBusinessIds {
  newBusinessIds: string[];
  observedBusinessIds?: string[] | undefined;
}

interface DiscoveryAttributionAssignmentCreateManyDelegate {
  createMany: (args: {
    data: Array<{
      id: string;
      discoveryRunId: string;
      icpProfileId: string;
      businessId: string;
      searchTaskId: string;
      assignmentMode: string;
      assignedAt: Date;
    }>;
    skipDuplicates?: boolean;
  }) => Promise<{ count: number }>;
}

export function shouldFinalizeAfterEmptyPoll(state: Pick<RunState, 'activeSlots'>): boolean {
  return state.activeSlots <= 1;
}

/**
 * Returns true if the discovery run status is terminal (completed, failed, or cancelled).
 * Used to short-circuit the search task loop when the run has been finalized externally.
 */
export function shouldStopForTerminalRunStatus(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Returns true when this search task slot has no linked discovery run and the
 * poll returned no tasks — an orphan loop that should be terminated.
 */
export function shouldStopOrphanLoop(
  payload: Pick<DiscoveryRunSearchTaskJobPayload, 'discoveryRunId'>,
  pollResult: 'EMPTY' | 'HAS_TASKS',
): boolean {
  return !payload.discoveryRunId && pollResult === 'EMPTY';
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

function toNonNegativeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function getObservedBusinessIds(
  runResult: DiscoveryAttributionAssignmentBusinessIds,
): string[] {
  return Array.isArray(runResult.observedBusinessIds)
    ? runResult.observedBusinessIds ?? []
    : runResult.newBusinessIds;
}

function getAssignedBusinessIds(
  runResult: DiscoveryAttributionAssignmentBusinessIds,
): string[] {
  return [...new Set([
    ...runResult.newBusinessIds,
    ...getObservedBusinessIds(runResult),
  ])].filter((businessId) => businessId.length > 0);
}

export async function persistDiscoveryAttributionAssignments(
  delegate: DiscoveryAttributionAssignmentCreateManyDelegate,
  params: {
    discoveryRunId: string;
    icpProfileId: string;
    searchTaskId: string;
    newBusinessIds: string[];
    observedBusinessIds?: string[] | undefined;
    assignedAt?: Date | undefined;
  },
): Promise<{
  attemptedCount: number;
  insertedCount: number;
  businessIds: string[];
}> {
  const businessIds = getAssignedBusinessIds(params);
  if (businessIds.length === 0) {
    return {
      attemptedCount: 0,
      insertedCount: 0,
      businessIds,
    };
  }

  const assignedAt = params.assignedAt ?? new Date();
  const result = await delegate.createMany({
    data: businessIds.map((businessId) => ({
      id: randomUUID(),
      discoveryRunId: params.discoveryRunId,
      icpProfileId: params.icpProfileId,
      businessId,
      searchTaskId: params.searchTaskId,
      assignmentMode: DISCOVERY_ATTRIBUTION_ASSIGNMENT_MODE_SEARCH_TASK_FIRST_TOUCH,
      assignedAt,
    })),
    skipDuplicates: true,
  });

  return {
    attemptedCount: businessIds.length,
    insertedCount: result.count,
    businessIds,
  };
}

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

async function hydrateRunStateFromExecution(
  discoveryRunId: string,
  state: RunState,
): Promise<void> {
  if (
    state.processedTaskCount > 0 ||
    state.doneCount > 0 ||
    state.failedCount > 0 ||
    state.newBusinesses > 0 ||
    state.newSources > 0 ||
    state.serpapiRequests > 0
  ) {
    return;
  }

  const execution = await prisma.jobExecution.findUnique({
    where: { id: discoveryRunId },
    select: { result: true },
  });

  const result = execution?.result && typeof execution.result === 'object' && !Array.isArray(execution.result)
    ? execution.result as Record<string, unknown>
    : {};

  state.processedTaskCount = Math.max(state.processedTaskCount, toNonNegativeCount(result.searchTasksProcessed));
  state.failedCount = Math.max(state.failedCount, toNonNegativeCount(result.failedItems));
  state.newBusinesses = Math.max(state.newBusinesses, toNonNegativeCount(result.newBusinesses));
  state.newSources = Math.max(state.newSources, toNonNegativeCount(result.newSources));
  state.serpapiRequests = Math.max(state.serpapiRequests, toNonNegativeCount(result.serpapiRequests));
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
  await prisma.jobRun.updateMany({
    where: {
      id: jobRunId,
      status: 'RUNNING',
      finishedAt: null,
    },
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

async function updateDiscoveryRunProgress(discoveryRunId: string, state: RunState, targetLeads?: number | undefined): Promise<void> {
  // Read existing result to preserve processedItems set by downstream pipeline jobs
  const existing = await prisma.jobExecution.findUnique({
    where: { id: discoveryRunId },
    select: { result: true },
  });
  const existingResult = existing?.result && typeof existing.result === 'object'
    ? existing.result as Record<string, unknown>
    : {};

  await prisma.jobExecution.updateMany({
    where: {
      id: discoveryRunId,
      status: { in: ['queued', 'running'] },
      finishedAt: null,
    },
    data: {
      status: 'running',
      result: toInputJson({
        ...existingResult,
        // Preserve processedItems from downstream jobs (leads at terminal state)
        // — don't overwrite with search task count
        ...(targetLeads !== undefined ? { totalItems: targetLeads } : {}),
        searchTasksProcessed: state.processedTaskCount,
        failedItems: state.failedCount,
        newBusinesses: state.newBusinesses,
        newSources: state.newSources,
        serpapiRequests: state.serpapiRequests,
      }),
    },
  });
}

/**
 * Mark search tasks as complete and check if the pipeline can be finalized.
 * The run stays in 'running' until ALL leads reach a terminal pipeline state
 * (message drafted, scored LOW, or failed).
 */
async function completeSearchPhase(
  discoveryRunId: string,
  state: RunState,
  logger: DiscoveryRunSearchTaskLogger,
  icpProfileId?: string | undefined,
): Promise<void> {
  if (state.finalized) {
    return;
  }
  state.finalized = true;

  const yieldRate = state.processedTaskCount > 0
    ? state.newBusinesses / state.processedTaskCount
    : 0;

  await markSearchTasksComplete(
    discoveryRunId,
    {
      searchTasksProcessed: state.processedTaskCount,
      failedItems: state.failedCount,
      newBusinesses: state.newBusinesses,
      newSources: state.newSources,
      serpapiRequests: state.serpapiRequests,
      durationMs: Math.max(0, Date.now() - state.startedAtMs),
      yieldRate,
    },
    icpProfileId,
    logger,
  );

  // Check if the pipeline is already complete (e.g. zero businesses found)
  await tryFinalizeDiscoveryRun(discoveryRunId, logger);
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

  await prisma.jobRun.updateMany({
    where: {
      id: jobRunId,
      status: 'RUNNING',
      finishedAt: null,
    },
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
  if (job.data.discoveryRunId) {
    await hydrateRunStateFromExecution(job.data.discoveryRunId, runState);
  }

  if (effectiveMaxTasks !== undefined && runState.processedTaskCount >= effectiveMaxTasks) {
    if (job.data.jobRunId) {
      await finalizeJobRun(job.data.jobRunId, runState, 'SUCCESS', null);
      releaseSlot(runKey, runState);
    }
    if (job.data.discoveryRunId) {
      await completeSearchPhase(job.data.discoveryRunId, runState, logger, job.data.icpProfileId);
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

  const observedBusinessIds = getObservedBusinessIds(runResult);

  if (job.data.discoveryRunId && job.data.icpProfileId && runResult.taskId) {
    await persistDiscoveryAttributionAssignments(
      prisma.discoveryAttributionAssignment,
      {
        discoveryRunId: job.data.discoveryRunId,
        icpProfileId: job.data.icpProfileId,
        searchTaskId: runResult.taskId,
        newBusinessIds: runResult.newBusinessIds,
        observedBusinessIds,
      },
    );
  }

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
        ...(job.data.minReviewCount !== undefined ? { minReviewCount: job.data.minReviewCount } : {}),
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

  if (
    observedBusinessIds.length > 0 &&
    dependencies.enqueueBusinessPrequalify &&
    job.data.discoveryRunId &&
    job.data.icpProfileId
  ) {
    const newBusinessIds = new Set(runResult.newBusinessIds);
    const existingObservedBusinessIds = observedBusinessIds.filter(
      (businessId: string) => !newBusinessIds.has(businessId),
    );

    let enqueuedCount = 0;

    for (const businessId of existingObservedBusinessIds) {
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
        ...(job.data.minReviewCount !== undefined ? { minReviewCount: job.data.minReviewCount } : {}),
        ...(correlationId ? { correlationId } : {}),
      });
      enqueuedCount += 1;
    }

    if (existingObservedBusinessIds.length > 0) {
      logger.info(
        {
          jobId: job.id,
          queue: job.name,
          discoveryRunId: job.data.discoveryRunId,
          icpProfileId: job.data.icpProfileId,
          observedExistingBusinessCount: existingObservedBusinessIds.length,
          enqueuedPrequalifyCount: enqueuedCount,
        },
        'Enqueued business.prequalify for existing businesses observed in the current search task',
      );
    }
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
      // Search task failed in unbounded mode — mark search phase complete
      // and let tryFinalizeDiscoveryRun decide if pipeline items are still in flight
      await completeSearchPhase(job.data.discoveryRunId, runState, logger, job.data.icpProfileId);
      releaseSlot(runKey, runState);
    } else {
      await updateDiscoveryRunProgress(job.data.discoveryRunId, runState, job.data.targetUniqueBusinesses);
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
      await completeSearchPhase(job.data.discoveryRunId, runState, logger, job.data.icpProfileId);
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

  // Early-stop: enough unique businesses found for the lead target.
  // Use 2x buffer because not all discovered businesses become qualified leads
  // (disqualification, low scores, missing contacts reduce yield).
  const targetBiz = job.data.targetUniqueBusinesses;
  const earlyStopThreshold = targetBiz !== undefined ? targetBiz * 2 : undefined;
  if (earlyStopThreshold !== undefined && runState.newBusinesses >= earlyStopThreshold) {
    if (job.data.discoveryRunId) {
      await completeSearchPhase(job.data.discoveryRunId, runState, logger, job.data.icpProfileId);
      releaseSlot(runKey, runState);
    }
    if (job.data.jobRunId) {
      await finalizeJobRun(job.data.jobRunId, runState, 'SUCCESS', null);
      releaseSlot(runKey, runState);
    }
    logger.info(
      {
        slot,
        correlationId,
        newBusinesses: runState.newBusinesses,
        targetUniqueBusinesses: targetBiz,
      },
      'Early-stop: reached target unique business count',
    );
    return;
  }

  // Early-stop: lead target already reached (flagged by business.convert)
  if (job.data.discoveryRunId && await isLeadTargetReached(job.data.discoveryRunId)) {
    if (job.data.discoveryRunId) {
      await completeSearchPhase(job.data.discoveryRunId, runState, logger, job.data.icpProfileId);
      releaseSlot(runKey, runState);
    }
    if (job.data.jobRunId) {
      await finalizeJobRun(job.data.jobRunId, runState, 'SUCCESS', null);
      releaseSlot(runKey, runState);
    }
    logger.info(
      {
        slot,
        correlationId,
        newBusinesses: runState.newBusinesses,
      },
      'Early-stop: lead target reached — stopping search task loop',
    );
    return;
  }

  if (effectiveMaxTasks !== undefined && runResult.status === 'EMPTY') {
    if (!shouldFinalizeAfterEmptyPoll(runState)) {
      logger.info(
        {
          slot,
          correlationId,
          activeSlots: runState.activeSlots,
          processedTaskCount: runState.processedTaskCount,
          maxTasks: effectiveMaxTasks,
        },
        'Empty poll observed while sibling slots are still active — deferring finalization',
      );
      releaseSlot(runKey, runState);
      return;
    }

    if (job.data.jobRunId) {
      await finalizeJobRun(job.data.jobRunId, runState, 'SUCCESS', null);
      releaseSlot(runKey, runState);
    }
    if (job.data.discoveryRunId) {
      await completeSearchPhase(job.data.discoveryRunId, runState, logger, job.data.icpProfileId);
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

  // ── Cancel check: stop loop gracefully if the run was cancelled ──
  if (job.data.discoveryRunId) {
    const execution = await prisma.jobExecution.findUnique({
      where: { id: job.data.discoveryRunId },
      select: { status: true },
    });
    if (execution?.status === 'cancelled') {
      logger.warn(
        { jobId: job.id, queue: job.name, discoveryRunId: job.data.discoveryRunId, slot },
        'Discovery run cancelled — stopping search task loop',
      );
      await completeSearchPhase(job.data.discoveryRunId, runState, logger, job.data.icpProfileId);
      releaseSlot(runKey, runState);
      return;
    }
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
      targetUniqueBusinesses: job.data.targetUniqueBusinesses,
      minReviewCount: job.data.minReviewCount,
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

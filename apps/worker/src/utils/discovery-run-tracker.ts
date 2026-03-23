import type { Prisma } from '@prisma/client';
import { getPipelineSetting, prisma, toInputJson, upsertPipelineSetting } from '@lead-flood/db';
import type { SendOptions } from 'pg-boss';

import { getQualificationThreshold } from '../scoring/shared.js';

/**
 * Discovery Run Pipeline Tracker
 *
 * Tracks pipeline completion for discovery runs. Instead of finalizing when
 * search tasks finish, the run stays in `running` status until ALL businesses
 * have reached a terminal state in the pipeline:
 *
 * Terminal states:
 *   - Disqualified in business.prequalify (preQualified=false)
 *   - Failed in business.convert (no lead created)
 *   - Lead scored LOW (no message.generate enqueued)
 *   - Lead has a MessageDraft (message.generate completed)
 *   - Lead has status=failed or is soft-deleted
 *
 * Safety timeout: if a run is stuck for > 2 hours after search tasks completed,
 * force-finalize it.
 */

const SAFETY_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

function extractStringFieldFromJson(
  value: Prisma.JsonValue | null | undefined,
  key: string,
): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const extracted = (value as Record<string, unknown>)[key];
  return typeof extracted === 'string' && extracted.length > 0 ? extracted : null;
}

interface TrackerLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

interface TryFinalizeDiscoveryRunOptions {
  excludeActiveJobId?: string | undefined;
}

interface SearchTaskCounters {
  searchTasksProcessed: number;
  failedItems: number;
  newBusinesses: number;
  newSources: number;
  serpapiRequests: number;
  durationMs: number;
  yieldRate: number;
}

interface PgBossPendingJobRow {
  name: string;
  state: string;
  count: number;
}

interface StaleDiscoveryPipelineJobRow {
  id: string;
  name: string;
  data: Prisma.JsonValue | null;
}

interface QueueRepairBoss {
  cancel: (name: string, id: string) => Promise<void>;
  send: (name: string, data: Record<string, unknown>, options?: SendOptions | undefined) => Promise<string | null>;
}

const STALE_DISCOVERY_PIPELINE_QUEUES = [
  'discovery.seed',
  'discovery.run_search_task',
  'business.prequalify',
  'business.convert',
] as const;

type StaleDiscoveryPipelineQueueName = (typeof STALE_DISCOVERY_PIPELINE_QUEUES)[number];

interface SweepStaleDiscoveryPipelineJobsInput {
  boss: QueueRepairBoss;
  logger: TrackerLogger;
  staleMinutes?: number | undefined;
  discoveryRunId?: string | undefined;
  retryOptionsByQueue?: Partial<Record<StaleDiscoveryPipelineQueueName, Pick<SendOptions, 'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'> | undefined>> | undefined;
}

function toNonNegativeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

async function countPendingPipelineJobs(
  discoveryRunId: string,
  excludeActiveJobId?: string | undefined,
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<PgBossPendingJobRow[]>(
    `
      select name, state, count(*)::int as count
      from pgboss.job
      where state in ('created', 'retry', 'active')
        and name in ('business.prequalify', 'business.convert')
        and data ->> 'discoveryRunId' = $1
        and ($2::text is null or id::text <> $2::text)
      group by name, state
    `,
    discoveryRunId,
    excludeActiveJobId ?? null,
  );

  return rows.reduce((sum, row) => sum + toNonNegativeCount(row.count), 0);
}

function toPayloadObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readStringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function buildQueueSingletonKey(
  queueName: StaleDiscoveryPipelineQueueName,
  payload: Record<string, unknown>,
): string | null {
  if (queueName === 'business.prequalify') {
    const businessId = readStringField(payload, 'businessId');
    return businessId ? `business.prequalify:${businessId}` : null;
  }
  if (queueName === 'business.convert') {
    const businessId = readStringField(payload, 'businessId');
    return businessId ? `business.convert:${businessId}` : null;
  }
  if (queueName === 'discovery.run_search_task') {
    const discoveryRunId = readStringField(payload, 'discoveryRunId');
    const correlationId = readStringField(payload, 'correlationId');
    const slot = typeof payload.slot === 'number' ? payload.slot : 0;
    const runId = discoveryRunId ?? correlationId;
    return runId ? `discovery.run_search_task:${runId}:slot-${slot}` : null;
  }
  if (queueName === 'discovery.seed') {
    const discoveryRunId = readStringField(payload, 'discoveryRunId');
    const icpProfileId = readStringField(payload, 'icpProfileId');
    if (!discoveryRunId || !icpProfileId) {
      return null;
    }
    return `discovery.seed:${discoveryRunId}:${icpProfileId}`;
  }
  return null;
}

function isValidPayloadForQueue(
  queueName: StaleDiscoveryPipelineQueueName,
  payload: Record<string, unknown>,
): boolean {
  const discoveryRunId = readStringField(payload, 'discoveryRunId');
  if (!discoveryRunId) {
    return false;
  }
  if (queueName === 'business.prequalify' || queueName === 'business.convert') {
    return Boolean(readStringField(payload, 'businessId') && readStringField(payload, 'icpProfileId'));
  }
  if (queueName === 'discovery.seed') {
    return Boolean(readStringField(payload, 'icpProfileId'));
  }
  return true;
}

async function fetchStaleDiscoveryPipelineJobs(
  staleMinutes: number,
  discoveryRunId?: string | undefined,
): Promise<StaleDiscoveryPipelineJobRow[]> {
  const queueNamesSql = STALE_DISCOVERY_PIPELINE_QUEUES.map((name) => `'${name}'`).join(', ');

  if (discoveryRunId) {
    return prisma.$queryRawUnsafe<StaleDiscoveryPipelineJobRow[]>(
      `
        select id::text, name, data
        from pgboss.job
        where state in ('created', 'retry')
          and name in (${queueNamesSql})
          and created_on < now() - ($1 * interval '1 minute')
          and (
            data ->> 'discoveryRunId' = $2
            or data ->> 'runId' = $2
            or singleton_key like $3
          )
        order by created_on asc
        limit 500
      `,
      staleMinutes,
      discoveryRunId,
      `%${discoveryRunId}%`,
    );
  }

  return prisma.$queryRawUnsafe<StaleDiscoveryPipelineJobRow[]>(
    `
      select id::text, name, data
      from pgboss.job
      where state in ('created', 'retry')
        and name in (${queueNamesSql})
        and created_on < now() - ($1 * interval '1 minute')
      order by created_on asc
      limit 500
    `,
    staleMinutes,
  );
}

export async function sweepStaleDiscoveryPipelineJobs(
  input: SweepStaleDiscoveryPipelineJobsInput,
): Promise<{ scanned: number; requeued: number; cancelled: number }> {
  const staleMinutes = Math.max(10, input.staleMinutes ?? 10);
  const rows = await fetchStaleDiscoveryPipelineJobs(staleMinutes, input.discoveryRunId);

  let requeued = 0;
  let cancelled = 0;

  for (const row of rows) {
    const queueName = row.name as StaleDiscoveryPipelineQueueName;
    const payload = toPayloadObject(row.data);

    // Always cancel stale queue rows first.
    await input.boss.cancel(queueName, row.id);
    cancelled += 1;

    if (!payload || !isValidPayloadForQueue(queueName, payload)) {
      continue;
    }

    const discoveryRunId = readStringField(payload, 'discoveryRunId');
    if (!discoveryRunId) {
      continue;
    }

    const run = await prisma.jobExecution.findUnique({
      where: { id: discoveryRunId },
      select: { id: true, status: true, type: true },
    });

    const isRunnableRun =
      run?.id === discoveryRunId &&
      run.status === 'running' &&
      (run.type === 'discovery.run' || run.type === 'discovery.seed');

    if (!isRunnableRun) {
      continue;
    }

    if (queueName === 'business.prequalify' || queueName === 'business.convert') {
      const businessId = readStringField(payload, 'businessId');
      if (!businessId) {
        continue;
      }
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        select: { id: true, preQualified: true },
      });
      if (!business || business.preQualified === false) {
        continue;
      }
    }

    const singletonKey = buildQueueSingletonKey(queueName, payload);
    if (!singletonKey) {
      continue;
    }

    const sendResult = await input.boss.send(
      queueName,
      payload,
      {
        singletonKey,
        ...(input.retryOptionsByQueue?.[queueName] ?? {}),
      },
    );
    if (sendResult !== null) {
      requeued += 1;
    }
  }

  if (rows.length > 0) {
    input.logger.info(
      {
        discoveryRunId: input.discoveryRunId ?? null,
        staleMinutes,
        scanned: rows.length,
        requeued,
        cancelled,
      },
      'Swept stale discovery pipeline created/retry jobs',
    );
  }

  return {
    scanned: rows.length,
    requeued,
    cancelled,
  };
}

export async function sweepStaleBusinessConvertJobs(
  input: {
    boss: QueueRepairBoss;
    logger: TrackerLogger;
    staleMinutes?: number | undefined;
    retryOptions?: Pick<SendOptions, 'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'> | undefined;
  },
): Promise<{ scanned: number; requeued: number; cancelled: number }> {
  return sweepStaleDiscoveryPipelineJobs({
    boss: input.boss,
    logger: input.logger,
    staleMinutes: input.staleMinutes,
    retryOptionsByQueue: {
      'business.convert': input.retryOptions,
    },
  });
}

/**
 * Mark search tasks as complete but keep the discovery run in `running` status.
 * Stores counters and a timestamp for safety timeout tracking.
 */
export async function markSearchTasksComplete(
  discoveryRunId: string,
  counters: SearchTaskCounters,
  icpProfileId: string | undefined,
  logger: TrackerLogger,
): Promise<void> {
  // Read existing result to preserve processedItems set by downstream pipeline jobs
  const existing = await prisma.jobExecution.findUnique({
    where: { id: discoveryRunId },
    select: { result: true },
  });
  const existingResult = existing?.result && typeof existing.result === 'object'
    ? existing.result as Record<string, unknown>
    : {};

  await prisma.jobExecution.update({
    where: { id: discoveryRunId },
    data: {
      // Keep status as 'running' — don't finalize yet
      result: toInputJson({
        ...existingResult,
        ...counters,
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        ...(icpProfileId ? { icpProfileId } : {}),
      }),
    },
  });

  logger.info(
    { discoveryRunId, ...counters },
    'Search tasks complete — run stays running until pipeline finishes',
  );
}

/**
 * Check if a discovery run is ready to be finalized. Call this from any
 * pipeline terminal point (prequalify disqualification, convert failure,
 * message.generate completion, etc.).
 *
 * Safe to call with non-discovery-run IDs — silently returns if the ID
 * doesn't match a running discovery JobExecution.
 *
 * The function is idempotent: multiple concurrent calls will not produce
 * duplicate finalizations because the first one transitions the status
 * away from 'running'.
 */
export async function tryFinalizeDiscoveryRun(
  possibleRunId: string,
  logger: TrackerLogger,
  options?: TryFinalizeDiscoveryRunOptions,
): Promise<void> {
  // 1. Load the JobExecution — bail if not a running discovery run
  const execution = await prisma.jobExecution.findUnique({
    where: { id: possibleRunId },
  });

  const isDiscoveryRunType =
    execution?.type === 'discovery.run' || execution?.type === 'discovery.seed';
  if (!execution || !isDiscoveryRunType || execution.status !== 'running') {
    return;
  }

  const result = execution.result && typeof execution.result === 'object'
    ? execution.result as Record<string, unknown>
    : {};
  const runIcpProfileId = extractStringFieldFromJson(
    execution.payload as Prisma.JsonValue | null | undefined,
    'icpProfileId',
  );

  // Only finalize after search tasks are done
  if (!result.searchTasksComplete) {
    return;
  }

  // Safety timeout check
  const searchCompletedAt = typeof result.searchTasksCompletedAt === 'string'
    ? new Date(result.searchTasksCompletedAt)
    : null;
  const isTimedOut = searchCompletedAt !== null &&
    Date.now() - searchCompletedAt.getTime() > SAFETY_TIMEOUT_MS;

  const businesses = await prisma.business.findMany({
    where: {
      OR: [
        { discoveryRunId: possibleRunId },
        {
          evidence: {
            some: {
              searchTask: {
                is: { discoveryRunId: possibleRunId },
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      discoveryRunId: true,
      preQualified: true,
      disqualificationReason: true,
    },
  });
  const businessesById = new Map(businesses.map((business) => [business.id, business]));
  const pipelineBusinessIds = businesses.map((business) => business.id);
  const totalBusinesses = Math.max(
    pipelineBusinessIds.length,
    toNonNegativeCount(result.totalFound),
  );
  const pendingQueueItems = await countPendingPipelineJobs(
    possibleRunId,
    options?.excludeActiveJobId,
  );

  if (pipelineBusinessIds.length === 0) {
    const newBusinesses = typeof result.newBusinesses === 'number' ? result.newBusinesses : 0;
    if (newBusinesses === 0 && totalBusinesses > 0) {
      // No new businesses to process (all already known) — finalize successfully.
      await finalizeRun(possibleRunId, result, 'completed', 0, 0, 0, 0, 0, logger, null, totalBusinesses, {});
      return;
    }
    if (totalBusinesses === 0 || isTimedOut) {
      // Truly zero businesses found, or timed out waiting for prequalify
      await finalizeRun(
        possibleRunId,
        result,
        'failed',
        0,
        0,
        0,
        0,
        0,
        logger,
        'No businesses found by search tasks',
        totalBusinesses,
        {},
      );
      return;
    }
    // Businesses haven't been materialized yet — return without finalizing.
    return;
  }

  const disqualifiedIds = new Set(
    businesses.filter((b) => b.preQualified === false).map((b) => b.id),
  );

  // Aggregate disqualification reasons for outcome summary
  const disqualReasons: Record<string, number> = {};
  for (const biz of businesses) {
    if (biz.preQualified === false && biz.disqualificationReason) {
      disqualReasons[biz.disqualificationReason] = (disqualReasons[biz.disqualificationReason] ?? 0) + 1;
    }
  }
  // preQualified=null means still processing or not yet checked
  const qualifiedOrPendingIds = pipelineBusinessIds.filter((id) => !disqualifiedIds.has(id));

  // 4. For qualified/pending businesses, check lead pipeline status
  const qualificationThreshold = await getQualificationThreshold();
  let messageDraftedLeads = 0;
  let convertedLeads = 0;
  let rejectedLeads = 0;
  let failedLeads = 0;
  let inFlightItems = 0;
  let recoveryTerminalCount = 0;
  let existingAlreadyKnownTerminalCount = 0;
  const leadTargetReached = result.leadTargetReached === true;

  if (qualifiedOrPendingIds.length > 0) {
    const newQualifiedOrPendingIds = qualifiedOrPendingIds.filter(
      (id) => businessesById.get(id)?.discoveryRunId === possibleRunId,
    );
    const existingObservedQualifiedOrPendingIds = qualifiedOrPendingIds.filter(
      (id) => businessesById.get(id)?.discoveryRunId !== possibleRunId,
    );
    const [runOwnedRecoveryRows, sharedExistingRecoveryRows] = await Promise.all([
      newQualifiedOrPendingIds.length > 0
        ? prisma.contactRecoveryItem.findMany({
            where: {
              discoveryRunId: possibleRunId,
              businessId: { in: newQualifiedOrPendingIds },
            },
            select: { businessId: true, reason: true },
          })
        : Promise.resolve([]),
      runIcpProfileId && existingObservedQualifiedOrPendingIds.length > 0
        ? prisma.contactRecoveryItem.findMany({
            where: {
              businessId: { in: existingObservedQualifiedOrPendingIds },
              icpProfileId: runIcpProfileId,
            },
            select: { businessId: true, reason: true },
          })
        : Promise.resolve([]),
    ]);
    const recoveryRows = [...runOwnedRecoveryRows, ...sharedExistingRecoveryRows];
    const businessesWithRecovery = new Set(recoveryRows.map((row) => row.businessId));
    recoveryTerminalCount = businessesWithRecovery.size;
    for (const row of recoveryRows) {
      disqualReasons[row.reason] = (disqualReasons[row.reason] ?? 0) + 1;
    }

    if (newQualifiedOrPendingIds.length > 0) {
      const conversions = await prisma.businessConversion.findMany({
        where: { businessId: { in: newQualifiedOrPendingIds } },
        select: { businessId: true, leadId: true, metadata: true },
      });
      const runConversions = conversions.filter(
        (c) => extractStringFieldFromJson(c.metadata as Prisma.JsonValue | null, 'discoveryRunId') === possibleRunId,
      );
      const businessesWithConversion = new Set(runConversions.map((c) => c.businessId));
      const leadIds = [...new Set(runConversions.map((c) => c.leadId))];

      const noConversionCount = newQualifiedOrPendingIds.filter(
        (id) => !businessesWithConversion.has(id) && !businessesWithRecovery.has(id),
      ).length;
      inFlightItems += noConversionCount;

      if (leadIds.length > 0) {
        const leads = await prisma.lead.findMany({
          where: { id: { in: leadIds } },
          select: {
            id: true,
            status: true,
            deletedAt: true,
            messageDrafts: { select: { id: true }, take: 1 },
            scorePredictions: {
              select: { scoreBand: true, blendedScore: true },
              orderBy: { predictedAt: 'desc' },
              take: 1,
            },
          },
        });

        for (const lead of leads) {
          if (lead.deletedAt || lead.status === 'failed') {
            failedLeads++;
          } else if (lead.status === 'rejected') {
            rejectedLeads++;
          } else if (
            lead.status === 'qualified'
            || lead.status === 'drafted'
            || lead.status === 'messaged'
            || lead.status === 'replied'
            || lead.status === 'cold'
          ) {
            convertedLeads++;
            if (lead.messageDrafts.length > 0) {
              messageDraftedLeads++;
            }
          } else if (lead.messageDrafts.length > 0) {
            convertedLeads++;
            messageDraftedLeads++;
          } else if (lead.scorePredictions.length > 0) {
            const latest = lead.scorePredictions[0]!;
            if (latest.scoreBand === 'LOW' || latest.blendedScore < qualificationThreshold) {
              rejectedLeads++;
            } else {
              inFlightItems++;
            }
          } else {
            inFlightItems++;
          }
        }
      }
    }

    if (existingObservedQualifiedOrPendingIds.length > 0) {
      const existingObservedBusinessIdsWithoutRecovery = existingObservedQualifiedOrPendingIds.filter(
        (id) => !businessesWithRecovery.has(id),
      );

      if (!runIcpProfileId) {
        inFlightItems += existingObservedBusinessIdsWithoutRecovery.length;
      } else if (existingObservedBusinessIdsWithoutRecovery.length > 0) {
        const activeExistingLeadRows = await prisma.lead.findMany({
          where: {
            businessId: { in: existingObservedBusinessIdsWithoutRecovery },
            deletedAt: null,
          },
          select: {
            id: true,
            businessId: true,
          },
        });
        const activeExistingLeadIds = activeExistingLeadRows.map((lead) => lead.id);
        const [drafts, scorePredictions] = activeExistingLeadIds.length > 0
          ? await Promise.all([
              prisma.messageDraft.findMany({
                where: {
                  leadId: { in: activeExistingLeadIds },
                  icpProfileId: runIcpProfileId,
                },
                select: {
                  id: true,
                  leadId: true,
                },
              }),
              prisma.leadScorePrediction.findMany({
                where: {
                  leadId: { in: activeExistingLeadIds },
                  icpProfileId: runIcpProfileId,
                },
                select: {
                  leadId: true,
                  scoreBand: true,
                  blendedScore: true,
                  predictedAt: true,
                  createdAt: true,
                },
                orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
              }),
            ])
          : [[], []];

        const activeLeadsByBusinessId = new Map<string, Array<{ id: string }>>();
        for (const lead of activeExistingLeadRows) {
          if (!lead.businessId) {
            continue;
          }
          const existing = activeLeadsByBusinessId.get(lead.businessId) ?? [];
          existing.push({ id: lead.id });
          activeLeadsByBusinessId.set(lead.businessId, existing);
        }

        const draftLeadIds = new Set(drafts.map((draft) => draft.leadId));
        const latestScoreByLeadId = new Map<string, (typeof scorePredictions)[number]>();
        for (const prediction of scorePredictions) {
          if (!latestScoreByLeadId.has(prediction.leadId)) {
            latestScoreByLeadId.set(prediction.leadId, prediction);
          }
        }

        for (const businessId of existingObservedBusinessIdsWithoutRecovery) {
          const business = businessesById.get(businessId);
          if (!business || business.preQualified !== true) {
            inFlightItems++;
            continue;
          }

          const activeLeads = activeLeadsByBusinessId.get(businessId) ?? [];
          if (activeLeads.length !== 1) {
            existingAlreadyKnownTerminalCount++;
            continue;
          }

          const leadId = activeLeads[0]!.id;
          if (draftLeadIds.has(leadId) || latestScoreByLeadId.has(leadId)) {
            existingAlreadyKnownTerminalCount++;
          } else {
            inFlightItems++;
          }
        }
      }
    }
  }

  if (!leadTargetReached && !isTimedOut && pendingQueueItems > 0) {
    inFlightItems += pendingQueueItems;
  }

  // 5. Compute terminal count for progress tracking
  const completedLeads = convertedLeads;
  const terminalCount =
    completedLeads
    + rejectedLeads
    + failedLeads
    + disqualifiedIds.size
    + recoveryTerminalCount
    + existingAlreadyKnownTerminalCount;

  // 6. Finalize if all items are terminal OR safety timeout
  if (leadTargetReached || inFlightItems === 0 || isTimedOut) {
    const status = isTimedOut && inFlightItems > 0 ? 'failed' : 'completed';

    const timeoutNote = isTimedOut && inFlightItems > 0
      ? `Safety timeout: ${inFlightItems} items still in flight after ${SAFETY_TIMEOUT_MS / 60000}min`
      : null;

    const disqualOrRecoveryCount = disqualifiedIds.size + recoveryTerminalCount;
    const disqualNote = completedLeads === 0 && disqualOrRecoveryCount > 0
      ? `0 leads produced — all ${disqualOrRecoveryCount} of ${pipelineBusinessIds.length} businesses reached terminal disqualification/recovery outcomes`
      : null;

    const failedLeadsNote = completedLeads === 0 && failedLeads > 0 && disqualifiedIds.size === 0
      ? `0 successful leads — all ${failedLeads} leads failed during pipeline processing`
      : null;

    await finalizeRun(
      possibleRunId,
      result,
      status,
      completedLeads,
      messageDraftedLeads,
      rejectedLeads,
      failedLeads,
      disqualifiedIds.size + recoveryTerminalCount,
      logger,
      disqualNote ?? failedLeadsNote ?? timeoutNote,
      totalBusinesses,
      disqualReasons,
    );

    if (timeoutNote) {
      logger.warn(
        { discoveryRunId: possibleRunId, inFlightItems, completedLeads, failedLeads },
        timeoutNote,
      );
    }
  } else if (terminalCount > 0) {
    // Not ready to finalize, but update progress so the frontend shows accurate lead count
    const newBiz = toNonNegativeCount(result.newBusinesses);
    const alreadyKnownBiz = Math.max(0, totalBusinesses - newBiz);

    await prisma.jobExecution.update({
      where: { id: possibleRunId },
      data: {
        result: toInputJson({
          ...result,
          totalItems: newBiz,
          processedItems: terminalCount,
          failedItems: failedLeads,
          leadFailedItems: failedLeads,
          rejectedLeads,
          // Full funnel counts for frontend display
          totalFound: totalBusinesses,
          alreadyKnown: alreadyKnownBiz,
          newFound: newBiz,
          disqualified: disqualifiedIds.size + recoveryTerminalCount,
          converted: completedLeads,
          outcome: {
            businessesFound: totalBusinesses,
            businessesDisqualified: disqualifiedIds.size + recoveryTerminalCount,
            leadsCreated: completedLeads,
            rejectedLeads,
            messagesDrafted: messageDraftedLeads,
            disqualificationReasons: disqualReasons,
          },
        }),
      },
    });
  }
}

/**
 * Periodic check for stale discovery runs. Call from a cron/interval to
 * ensure the safety timeout fires even when no pipeline events trigger it.
 */
export async function checkStaleDiscoveryRuns(logger: TrackerLogger): Promise<void> {
  const staleRuns = await prisma.jobExecution.findMany({
    where: {
      type: { in: ['discovery.run', 'discovery.seed'] },
      status: 'running',
    },
    select: { id: true, startedAt: true, result: true },
  });

  for (const run of staleRuns) {
    // First try the normal finalization path (checks searchTasksComplete flag)
    await tryFinalizeDiscoveryRun(run.id, logger);

    // Fallback: if the run is STILL running (tryFinalize didn't help because
    // searchTasksComplete was never set — e.g. worker crash), force-finalize
    // after the safety timeout based on startedAt
    const stillRunning = await prisma.jobExecution.findUnique({
      where: { id: run.id },
      select: { status: true },
    });
    if (stillRunning?.status !== 'running') continue;

    const startedAt = run.startedAt;
    if (!startedAt) continue;

    const elapsedMs = Date.now() - startedAt.getTime();
    if (elapsedMs > SAFETY_TIMEOUT_MS) {
      const result = run.result && typeof run.result === 'object'
        ? run.result as Record<string, unknown>
        : {};

      logger.warn(
        { discoveryRunId: run.id, elapsedMs },
        'Force-finalizing stuck discovery run — searchTasksComplete flag was never set',
      );

      await finalizeRun(
        run.id,
        result,
        'failed',
        0,
        0,
        0,
        0,
        0,
        logger,
        `Force-finalized: run stuck in running state for ${Math.round(elapsedMs / 60000)}min without searchTasksComplete flag`,
        0,
        {},
      );
    }
  }

  if (staleRuns.length > 0) {
    logger.info(
      { checkedCount: staleRuns.length },
      'Checked stale discovery runs for finalization',
    );
  }
}

/**
 * Check if the lead target for a discovery run has been reached.
 * Returns true if the run has a `limit` in its payload and the number of
 * non-deleted leads linked to businesses in this run meets or exceeds it.
 *
 * When the target IS reached, sets `leadTargetReached: true` on the run's
 * result JSON and marks search tasks as complete (if not already).
 * Downstream jobs (business.prequalify, business.convert, run_search_task)
 * check this flag and skip processing, effectively draining the pipeline.
 */
export async function checkLeadTargetReached(
  discoveryRunId: string,
  logger: TrackerLogger,
): Promise<boolean> {
  const execution = await prisma.jobExecution.findUnique({
    where: { id: discoveryRunId },
    select: { payload: true, result: true, status: true },
  });

  if (!execution || execution.status !== 'running') return false;

  const result = execution.result && typeof execution.result === 'object' && !Array.isArray(execution.result)
    ? execution.result as Record<string, unknown>
    : {};

  // Already flagged — skip re-checking
  if (result.leadTargetReached === true) return true;

  const payload = execution.payload && typeof execution.payload === 'object' && !Array.isArray(execution.payload)
    ? execution.payload as Record<string, unknown>
    : null;
  if (!payload) return false;

  const targetLeads = typeof payload.limit === 'number' ? payload.limit : null;
  if (targetLeads === null || targetLeads <= 0) return false;

  // Count non-deleted, non-terminal-failure leads whose business belongs to this discovery run.
  const leadCount = await prisma.lead.count({
    where: {
      deletedAt: null,
      status: { notIn: ['rejected', 'failed'] },
      business: { discoveryRunId },
    },
  });

  if (leadCount < targetLeads) return false;

  // Target reached — set flag and mark search complete
  logger.info(
    { discoveryRunId, leadCount, targetLeads },
    'Lead target reached — flagging run for graceful cancellation',
  );

  await prisma.jobExecution.update({
    where: { id: discoveryRunId },
    data: {
      result: toInputJson({
        ...result,
        leadTargetReached: true,
        leadTargetReachedAt: new Date().toISOString(),
        leadTargetCount: targetLeads,
        actualLeadCount: leadCount,
        // Also mark search tasks complete so tryFinalizeDiscoveryRun can finalize
        searchTasksComplete: true,
        ...(!result.searchTasksCompletedAt
          ? { searchTasksCompletedAt: new Date().toISOString() }
          : {}),
      }),
    },
  });

  return true;
}

/**
 * Quick check: has the lead target flag been set on a discovery run?
 * Used by pipeline jobs to short-circuit processing when enough leads exist.
 * Returns false for non-existent runs or runs without the flag.
 */
export async function isLeadTargetReached(
  discoveryRunId: string,
): Promise<boolean> {
  const execution = await prisma.jobExecution.findUnique({
    where: { id: discoveryRunId },
    select: { result: true },
  });

  if (!execution) return false;

  const result = execution.result && typeof execution.result === 'object' && !Array.isArray(execution.result)
    ? execution.result as Record<string, unknown>
    : null;

  return result?.leadTargetReached === true;
}

// ── Internal ──────────────────────────────────────────────────────────────

async function finalizeRun(
  discoveryRunId: string,
  currentResult: Record<string, unknown>,
  status: 'completed' | 'failed',
  completedLeads: number,
  messageDraftedLeads: number,
  rejectedLeads: number,
  failedLeads: number,
  disqualifiedCount: number,
  logger: TrackerLogger,
  error?: string | null | undefined,
  totalBusinesses: number = 0,
  disqualificationReasons: Record<string, number> = {},
): Promise<void> {
  const failedItems = failedLeads;

  // Derive full funnel counts from run data
  const newBusinesses = toNonNegativeCount(currentResult.newBusinesses);
  const alreadyKnown = Math.max(0, totalBusinesses - newBusinesses);
  const converted = completedLeads;
  const terminalItems = completedLeads + rejectedLeads + failedLeads + disqualifiedCount;

  // Atomic update: only finalize if still running (prevents double-finalization)
  const updated = await prisma.jobExecution.updateMany({
    where: { id: discoveryRunId, status: 'running' },
    data: {
      status,
      finishedAt: new Date(),
      error: error ?? null,
      result: toInputJson({
        ...currentResult,
        pipelineCompleted: true,
        totalItems: newBusinesses,
        processedItems: terminalItems,
        failedItems,
        leadFailedItems: failedLeads,
        completedLeads,
        rejectedLeads,
        pipelineFailedItems: failedLeads,
        // Full funnel counts for frontend display
        totalFound: totalBusinesses,
        alreadyKnown,
        newFound: newBusinesses,
        disqualified: disqualifiedCount,
        converted,
        outcome: {
          businessesFound: totalBusinesses,
          businessesDisqualified: disqualifiedCount,
          leadsCreated: converted,
          rejectedLeads,
          messagesDrafted: messageDraftedLeads,
          disqualificationReasons,
        },
      }),
    },
  });

  if (updated.count === 0) {
    return; // Already finalized by another concurrent call
  }

  logger.info(
    { discoveryRunId, status, completedLeads, failedItems },
    'Discovery run finalized after full pipeline completion',
  );

  // ── Failed run cleanup: delete stuck leads ──────────────────────────
  // When a run fails, clean up leads that never progressed past processing/new.
  // Leads that already reached scored/qualified/enriched/messaged etc. are kept.
  if (status === 'failed') {
    try {
      // Find businesses linked to this run via DiscoveryCostEvent
      const runCostEvents = await prisma.discoveryCostEvent.findMany({
        where: { discoveryRunId, businessId: { not: null } },
        select: { businessId: true },
        distinct: ['businessId'],
      });
      const runBusinessIds = runCostEvents
        .map((e) => e.businessId)
        .filter((id): id is string => id !== null);

      if (runBusinessIds.length > 0) {
        // Find leads created from these businesses
        const conversions = await prisma.businessConversion.findMany({
          where: { businessId: { in: runBusinessIds } },
          select: { leadId: true, metadata: true },
        });
        const leadIds = [
          ...new Set(
            conversions
              .filter(
                (c) =>
                  extractStringFieldFromJson(c.metadata as Prisma.JsonValue | null, 'discoveryRunId') === discoveryRunId,
              )
              .map((c) => c.leadId),
          ),
        ];

        if (leadIds.length > 0) {
          const deleted = await prisma.lead.deleteMany({
            where: {
              id: { in: leadIds },
              status: { in: ['new', 'processing'] },
            },
          });

          if (deleted.count > 0) {
            logger.info(
              { discoveryRunId, deletedLeads: deleted.count },
              'Cleaned up stuck leads from failed discovery run',
            );
          }
        }
      }
    } catch {
      // Best-effort cleanup — don't fail the finalization
    }
  }

  // Store yield rate for adaptive budget computation (EMA smoothing)
  const icpProfileId = typeof currentResult.icpProfileId === 'string'
    ? currentResult.icpProfileId
    : null;
  const searchTasksProcessed = typeof currentResult.searchTasksProcessed === 'number'
    ? currentResult.searchTasksProcessed
    : 0;
  // Reuse newBusinesses already derived above for funnel counts

  if (icpProfileId && searchTasksProcessed > 0) {
    const yieldRate = newBusinesses / searchTasksProcessed;
    try {
      // Store smoothed yield rate (legacy)
      const yieldRateKey = `discovery_yield_rate:${icpProfileId}`;
      const setting = await getPipelineSetting(yieldRateKey);
      const historicalRate = setting?.valueJson ? Number(setting.valueJson) : yieldRate;
      const smoothedRate = 0.3 * yieldRate + 0.7 * historicalRate;

      await upsertPipelineSetting(yieldRateKey, smoothedRate);

      // Store search efficiency (businesses per task) for new two-rate formula
      if (newBusinesses > 0) {
        const searchEfficiency = newBusinesses / searchTasksProcessed;
        await upsertPipelineSetting(
          `discovery_search_efficiency:${icpProfileId}`,
          searchEfficiency,
        );
      }

      // Store conversion rate (qualified leads / unique businesses) — EMA-smoothed
      if (completedLeads > 0 && newBusinesses > 0) {
        const conversionRate = completedLeads / newBusinesses;
        const convKey = `discovery_conversion_rate:${icpProfileId}`;
        const existingConv = await getPipelineSetting(convKey);
        const historicalConv = existingConv?.valueJson ? Number(existingConv.valueJson) : conversionRate;
        const smoothedConv = 0.3 * conversionRate + 0.7 * historicalConv;

        await upsertPipelineSetting(convKey, smoothedConv);
      }
    } catch {
      // Best-effort — don't fail the finalization
    }
  }
}

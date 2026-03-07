import { prisma, toInputJson } from '@lead-flood/db';

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

interface TrackerLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

interface SearchTaskCounters {
  processedItems: number;
  failedItems: number;
  newBusinesses: number;
  newSources: number;
  serpapiRequests: number;
  durationMs: number;
  yieldRate: number;
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
  await prisma.jobExecution.update({
    where: { id: discoveryRunId },
    data: {
      // Keep status as 'running' — don't finalize yet
      result: toInputJson({
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
 * doesn't match a running discovery.run JobExecution.
 *
 * The function is idempotent: multiple concurrent calls will not produce
 * duplicate finalizations because the first one transitions the status
 * away from 'running'.
 */
export async function tryFinalizeDiscoveryRun(
  possibleRunId: string,
  logger: TrackerLogger,
): Promise<void> {
  // 1. Load the JobExecution — bail if not a running discovery.run
  const execution = await prisma.jobExecution.findUnique({
    where: { id: possibleRunId },
  });

  if (!execution || execution.type !== 'discovery.run' || execution.status !== 'running') {
    return;
  }

  const result = execution.result && typeof execution.result === 'object'
    ? execution.result as Record<string, unknown>
    : {};

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

  // 2. Get all businesses from this discovery run via DiscoveryCostEvent
  const costEvents = await prisma.discoveryCostEvent.findMany({
    where: {
      discoveryRunId: possibleRunId,
      apiCallType: 'prequalify_check',
    },
    select: { businessId: true },
    distinct: ['businessId'],
  });

  const businessIds = costEvents
    .map((e) => e.businessId)
    .filter((id): id is string => id !== null);

  // Zero DiscoveryCostEvents — but check whether prequalify has even run yet.
  // If newBusinesses > 0 but no cost events exist, prequalify jobs haven't fired.
  if (businessIds.length === 0) {
    const newBusinesses = typeof result.newBusinesses === 'number' ? result.newBusinesses : 0;
    if (newBusinesses === 0 || isTimedOut) {
      // Truly zero businesses found, or timed out waiting — finalize
      await finalizeRun(possibleRunId, result, 'completed', 0, 0, logger);
      return;
    }
    // Prequalify events don't exist yet — return without finalizing
    return;
  }

  // 3. Load businesses to check qualification status
  const businesses = await prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: { id: true, preQualified: true },
  });

  const disqualifiedIds = new Set(
    businesses.filter((b) => b.preQualified === false).map((b) => b.id),
  );
  // preQualified=null means still processing or not yet checked
  const qualifiedOrPendingIds = businessIds.filter((id) => !disqualifiedIds.has(id));

  // 4. For qualified/pending businesses, check lead pipeline status
  const qualificationThreshold = await getQualificationThreshold();
  let completedLeads = 0;
  let failedLeads = 0;
  let inFlightItems = 0;

  if (qualifiedOrPendingIds.length > 0) {
    // Get BusinessConversions to find associated leads
    const conversions = await prisma.businessConversion.findMany({
      where: { businessId: { in: qualifiedOrPendingIds } },
      select: { businessId: true, leadId: true },
    });

    const businessesWithConversion = new Set(conversions.map((c) => c.businessId));
    const leadIds = [...new Set(conversions.map((c) => c.leadId))];

    // Businesses still waiting for conversion
    const noConversionCount = qualifiedOrPendingIds.filter(
      (id) => !businessesWithConversion.has(id),
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
        } else if (lead.messageDrafts.length > 0) {
          // message.generate completed — terminal success
          completedLeads++;
        } else if (lead.scorePredictions.length > 0) {
          const latest = lead.scorePredictions[0]!;
          if (latest.scoreBand === 'LOW' || latest.blendedScore < qualificationThreshold) {
            // Scored LOW or below qualification threshold → no downstream enqueued, terminal
            completedLeads++;
          } else {
            // Scored above threshold — waiting for apollo.enrich → message.generate
            inFlightItems++;
          }
        } else {
          // No score yet — still in flight (waiting for features, scoring, etc.)
          inFlightItems++;
        }
      }
    }
  }

  // 5. Finalize if all items are terminal OR safety timeout
  if (inFlightItems === 0 || isTimedOut) {
    const status = completedLeads > 0 || disqualifiedIds.size > 0 ? 'completed' : 'failed';

    const timeoutNote = isTimedOut && inFlightItems > 0
      ? `Safety timeout: ${inFlightItems} items still in flight after ${SAFETY_TIMEOUT_MS / 60000}min`
      : null;

    await finalizeRun(
      possibleRunId,
      result,
      status,
      completedLeads,
      failedLeads + disqualifiedIds.size,
      logger,
      timeoutNote,
    );

    if (timeoutNote) {
      logger.warn(
        { discoveryRunId: possibleRunId, inFlightItems, completedLeads, failedLeads },
        timeoutNote,
      );
    }
  }
}

/**
 * Periodic check for stale discovery runs. Call from a cron/interval to
 * ensure the safety timeout fires even when no pipeline events trigger it.
 */
export async function checkStaleDiscoveryRuns(logger: TrackerLogger): Promise<void> {
  const staleRuns = await prisma.jobExecution.findMany({
    where: {
      type: 'discovery.run',
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
        'completed',
        0,
        0,
        logger,
        `Force-finalized: run stuck in running state for ${Math.round(elapsedMs / 60000)}min without searchTasksComplete flag`,
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

// ── Internal ──────────────────────────────────────────────────────────────

async function finalizeRun(
  discoveryRunId: string,
  currentResult: Record<string, unknown>,
  status: 'completed' | 'failed',
  completedLeads: number,
  failedItems: number,
  logger: TrackerLogger,
  error?: string | null | undefined,
): Promise<void> {
  // Atomic update: only finalize if still running (prevents double-finalization)
  const updated = await prisma.jobExecution.updateMany({
    where: { id: discoveryRunId, status: 'running' },
    data: {
      status,
      finishedAt: new Date(),
      ...(error ? { error } : {}),
      result: toInputJson({
        ...currentResult,
        pipelineCompleted: true,
        completedLeads,
        pipelineFailedItems: failedItems,
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

  // Store yield rate for adaptive budget computation (EMA smoothing)
  const icpProfileId = typeof currentResult.icpProfileId === 'string'
    ? currentResult.icpProfileId
    : null;
  const processedItems = typeof currentResult.processedItems === 'number'
    ? currentResult.processedItems
    : 0;
  const newBusinesses = typeof currentResult.newBusinesses === 'number'
    ? currentResult.newBusinesses
    : 0;

  if (icpProfileId && processedItems > 0) {
    const yieldRate = newBusinesses / processedItems;
    try {
      // Store smoothed yield rate (legacy)
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

      // Store search efficiency (businesses per task) for new two-rate formula
      if (newBusinesses > 0) {
        const searchEfficiency = newBusinesses / processedItems;
        await prisma.pipelineSetting.upsert({
          where: { key: `discovery_search_efficiency:${icpProfileId}` },
          create: {
            key: `discovery_search_efficiency:${icpProfileId}`,
            valueJson: searchEfficiency,
          },
          update: {
            valueJson: searchEfficiency,
          },
        });
      }

      // Store conversion rate (qualified leads / unique businesses) — EMA-smoothed
      if (completedLeads > 0 && newBusinesses > 0) {
        const conversionRate = completedLeads / newBusinesses;
        const convKey = `discovery_conversion_rate:${icpProfileId}`;
        const existingConv = await prisma.pipelineSetting.findUnique({
          where: { key: convKey },
        });
        const historicalConv = existingConv?.valueJson ? Number(existingConv.valueJson) : conversionRate;
        const smoothedConv = 0.3 * conversionRate + 0.7 * historicalConv;

        await prisma.pipelineSetting.upsert({
          where: { key: convKey },
          create: {
            key: convKey,
            valueJson: smoothedConv,
          },
          update: {
            valueJson: smoothedConv,
          },
        });
      }
    } catch {
      // Best-effort — don't fail the finalization
    }
  }
}

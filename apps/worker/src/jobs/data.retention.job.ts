import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { formatErrorMessage } from '../errors.js';

export const DATA_RETENTION_JOB_NAME = 'data.retention';

export const DATA_RETENTION_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 300,
  retryBackoff: true,
  deadLetter: 'data.retention.dead_letter',
};

/** Default retention period in days. */
const DEFAULT_RETENTION_DAYS = 90;

/** Batch size per delete operation to avoid long transactions. */
const DELETE_BATCH_SIZE = 500;

export interface DataRetentionJobPayload {
  retentionDays?: number | undefined;
  correlationId?: string | undefined;
}

export interface DataRetentionLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

interface RetentionResult {
  table: string;
  deleted: number;
}

async function purgeCompletedSearchTasks(
  cutoff: Date,
): Promise<RetentionResult> {
  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await prisma.searchTask.findMany({
      where: {
        status: { in: ['DONE', 'FAILED'] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
      take: DELETE_BATCH_SIZE,
    });

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    const ids = batch.map((r) => r.id);
    const { count } = await prisma.searchTask.deleteMany({
      where: { id: { in: ids } },
    });

    totalDeleted += count;

    if (batch.length < DELETE_BATCH_SIZE) {
      hasMore = false;
    }
  }

  return { table: 'SearchTask', deleted: totalDeleted };
}

async function nullifyOldBusinessEvidenceRawJson(
  cutoff: Date,
): Promise<RetentionResult> {
  // Instead of deleting rows, null out the large rawJson blobs.
  // The evidence record itself is kept for audit trail.
  let totalUpdated = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await prisma.businessEvidence.findMany({
      where: {
        createdAt: { lt: cutoff },
        NOT: { rawJson: { equals: {} } },
      },
      select: { id: true },
      take: DELETE_BATCH_SIZE,
    });

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    const ids = batch.map((r) => r.id);
    const { count } = await prisma.businessEvidence.updateMany({
      where: { id: { in: ids } },
      data: { rawJson: {} },
    });

    totalUpdated += count;

    if (batch.length < DELETE_BATCH_SIZE) {
      hasMore = false;
    }
  }

  return { table: 'BusinessEvidence.rawJson', deleted: totalUpdated };
}

async function purgeOldFeatureSnapshots(
  cutoff: Date,
): Promise<RetentionResult> {
  // Keep only the latest snapshot per lead+ICP, delete older ones past retention
  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await prisma.leadFeatureSnapshot.findMany({
      where: {
        computedAt: { lt: cutoff },
      },
      select: { id: true, leadId: true, icpProfileId: true, computedAt: true },
      orderBy: { computedAt: 'asc' },
      take: DELETE_BATCH_SIZE,
    });

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    // For each snapshot, check if it's the latest for that lead+ICP pair.
    // Only delete if a newer snapshot exists.
    const idsToDelete: string[] = [];
    for (const snap of batch) {
      const newerExists = await prisma.leadFeatureSnapshot.count({
        where: {
          leadId: snap.leadId,
          icpProfileId: snap.icpProfileId,
          computedAt: { gt: snap.computedAt },
        },
      });
      if (newerExists > 0) {
        idsToDelete.push(snap.id);
      }
    }

    if (idsToDelete.length > 0) {
      const { count } = await prisma.leadFeatureSnapshot.deleteMany({
        where: { id: { in: idsToDelete } },
      });
      totalDeleted += count;
    }

    if (batch.length < DELETE_BATCH_SIZE) {
      hasMore = false;
    }
  }

  return { table: 'LeadFeatureSnapshot', deleted: totalDeleted };
}

async function purgeOldEnrichmentRecords(
  cutoff: Date,
): Promise<RetentionResult> {
  // Delete completed enrichment records older than retention, keeping the latest per lead
  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await prisma.leadEnrichmentRecord.findMany({
      where: {
        status: 'COMPLETED',
        createdAt: { lt: cutoff },
      },
      select: { id: true, leadId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: DELETE_BATCH_SIZE,
    });

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    const idsToDelete: string[] = [];
    for (const rec of batch) {
      const newerExists = await prisma.leadEnrichmentRecord.count({
        where: {
          leadId: rec.leadId,
          createdAt: { gt: rec.createdAt },
        },
      });
      if (newerExists > 0) {
        idsToDelete.push(rec.id);
      }
    }

    if (idsToDelete.length > 0) {
      const { count } = await prisma.leadEnrichmentRecord.deleteMany({
        where: { id: { in: idsToDelete } },
      });
      totalDeleted += count;
    }

    if (batch.length < DELETE_BATCH_SIZE) {
      hasMore = false;
    }
  }

  return { table: 'LeadEnrichmentRecord', deleted: totalDeleted };
}

export async function handleDataRetentionJob(
  logger: DataRetentionLogger,
  job: Job<DataRetentionJobPayload>,
): Promise<void> {
  const retentionDays = job.data.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  logger.info(
    { jobId: job.id, retentionDays, cutoff: cutoff.toISOString() },
    'Starting data retention sweep',
  );

  const results: RetentionResult[] = [];

  try {
    results.push(await purgeCompletedSearchTasks(cutoff));
    results.push(await nullifyOldBusinessEvidenceRawJson(cutoff));
    results.push(await purgeOldFeatureSnapshots(cutoff));
    results.push(await purgeOldEnrichmentRecords(cutoff));

    const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);

    logger.info(
      {
        jobId: job.id,
        retentionDays,
        totalDeleted,
        breakdown: Object.fromEntries(results.map((r) => [r.table, r.deleted])),
      },
      'Data retention sweep complete',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        retentionDays,
        completedTables: results.map((r) => r.table),
        error: formatErrorMessage(error),
      },
      'Data retention sweep failed — partial progress saved',
    );
    // Terminal job — don't throw. Partial cleanup is fine, next run catches the rest.
  }
}

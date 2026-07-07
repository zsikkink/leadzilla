import {
  ENRICHED_LEAD_STATUSES,
  MESSAGED_LEAD_STATUSES,
  SCORED_LEAD_STATUSES,
} from '@lead-flood/contracts';

import { query, type SqlQueryable } from './postgres.js';

export interface PipelineStatsSnapshot {
  leadDistribution: {
    discovered: number;
    enriched: number;
    scored: number;
    messaged: number;
  };
  pendingApprovals: number;
}

interface LeadDistributionRow {
  discovered: number | string;
  enriched: number | string;
  scored: number | string;
  messaged: number | string;
}

interface PendingApprovalsRow {
  pendingApprovals: number | string;
}

function toQueryable(): SqlQueryable {
  return { query };
}

function toNonNegativeInt(value: number | string): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function getPipelineStatsSnapshot(
  db: SqlQueryable = toQueryable(),
): Promise<PipelineStatsSnapshot> {
  const [distributionResult, pendingApprovalsResult] = await Promise.all([
    db.query<LeadDistributionRow>(
      `
        select
          count(*)::integer as discovered,
          count(*) filter (
            where "status" = any($1::text[])
          )::integer as enriched,
          count(*) filter (
            where "status" = any($2::text[])
          )::integer as scored,
          count(*) filter (
            where "status" = any($3::text[])
          )::integer as messaged
        from "Lead"
        where "deletedAt" is null
      `,
      [
        [...ENRICHED_LEAD_STATUSES],
        [...SCORED_LEAD_STATUSES],
        [...MESSAGED_LEAD_STATUSES],
      ],
    ),
    db.query<PendingApprovalsRow>(
      `
        select count(*)::integer as "pendingApprovals"
        from "MessageDraft"
        where "approvalStatus" = 'PENDING'
      `,
    ),
  ]);

  const distributionRow = distributionResult.rows[0];
  const pendingApprovalsRow = pendingApprovalsResult.rows[0];

  return {
    leadDistribution: {
      discovered: toNonNegativeInt(distributionRow?.discovered ?? 0),
      enriched: toNonNegativeInt(distributionRow?.enriched ?? 0),
      scored: toNonNegativeInt(distributionRow?.scored ?? 0),
      messaged: toNonNegativeInt(distributionRow?.messaged ?? 0),
    },
    pendingApprovals: toNonNegativeInt(pendingApprovalsRow?.pendingApprovals ?? 0),
  };
}

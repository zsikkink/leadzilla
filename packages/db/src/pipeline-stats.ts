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
          count(*) filter (
            where "status" in ('new', 'processing', 'stuck')
          )::integer as discovered,
          count(*) filter (
            where "status" in ('enriched', 'failed')
          )::integer as enriched,
          count(*) filter (
            where "status" in ('scored', 'qualified', 'drafted', 'rejected')
          )::integer as scored,
          count(*) filter (
            where "status" in ('messaged', 'replied', 'cold')
          )::integer as messaged
        from "Lead"
        where "deletedAt" is null
      `,
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

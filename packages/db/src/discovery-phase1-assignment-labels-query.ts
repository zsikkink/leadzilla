import { query, type SqlQueryable } from './postgres.js';

export interface DiscoveryPhase1AssignmentLabelRow {
  assignment_id: string;
  discovery_run_id: string;
  icp_profile_id: string;
  business_id: string;
  search_task_id: string;
  primary_outcome_code: string | null;
  phase1_class: string;
  exclusion_reason: string | null;
}

export interface DiscoveryPhase1AssignmentLocationSummaryRow {
  icp_profile_id: string;
  country_code: string;
  city: string | null;
  assignment_count: number;
  phase1_positive_count: number;
  phase1_negative_count: number;
  holdout_ambiguous_count: number;
  exclude_operational_count: number;
  exclude_incomplete_count: number;
}

function toQueryable(): SqlQueryable {
  return { query };
}

export async function listDiscoveryPhase1AssignmentLabels(
  discoveryRunId: string,
  db: SqlQueryable = toQueryable(),
): Promise<DiscoveryPhase1AssignmentLabelRow[]> {
  const result = await db.query<DiscoveryPhase1AssignmentLabelRow>(
    `
      select
        assignment_id,
        discovery_run_id,
        icp_profile_id,
        business_id,
        search_task_id,
        primary_outcome_code,
        phase1_class,
        exclusion_reason
      from public.discovery_phase1_assignment_labels_v1
      where discovery_run_id = $1
      order by assignment_id asc
    `,
    [discoveryRunId],
  );

  return result.rows;
}

export async function listDiscoveryPhase1AssignmentLocationSummaries(
  discoveryRunIds: readonly string[],
  db: SqlQueryable = toQueryable(),
): Promise<DiscoveryPhase1AssignmentLocationSummaryRow[]> {
  const result = await db.query<DiscoveryPhase1AssignmentLocationSummaryRow>(
    `
      select
        label.icp_profile_id,
        search_task.country_code,
        search_task.city,
        count(*)::integer as assignment_count,
        count(*) filter (
          where label.phase1_class = 'PHASE1_POSITIVE'
        )::integer as phase1_positive_count,
        count(*) filter (
          where label.phase1_class = 'PHASE1_NEGATIVE'
        )::integer as phase1_negative_count,
        count(*) filter (
          where label.phase1_class = 'HOLDOUT_AMBIGUOUS'
        )::integer as holdout_ambiguous_count,
        count(*) filter (
          where label.phase1_class = 'EXCLUDE_OPERATIONAL'
        )::integer as exclude_operational_count,
        count(*) filter (
          where label.phase1_class = 'EXCLUDE_INCOMPLETE'
        )::integer as exclude_incomplete_count
      from public.discovery_phase1_assignment_labels_v1 as label
      join (
        select
          id,
          country_code,
          city
        from public.search_tasks
      ) as search_task
        on search_task.id = label.search_task_id
      where label.discovery_run_id = any($1::text[])
      group by
        label.icp_profile_id,
        search_task.country_code,
        search_task.city
      order by
        label.icp_profile_id asc,
        search_task.country_code asc,
        search_task.city asc nulls first
    `,
    [discoveryRunIds],
  );

  return result.rows;
}

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

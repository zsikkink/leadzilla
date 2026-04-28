import { query, type SqlQueryable } from './postgres.js';

export interface DiscoveryPhase1AssignmentSearchInputRow {
  assignment_id: string;
  discovery_run_id: string;
  icp_profile_id: string;
  business_id: string;
  search_task_id: string;
  primary_outcome_code: string | null;
  phase1_class: string;
  exclusion_reason: string | null;
  task_type: string;
  country_code: string;
  city: string | null;
  language: string;
  query_text: string;
  normalized_query_key: string;
  query_hash: string;
  page: number;
  time_bucket: string;
}

function toQueryable(): SqlQueryable {
  return { query };
}

export async function listDiscoveryPhase1AssignmentSearchInputs(
  discoveryRunId: string,
  db: SqlQueryable = toQueryable(),
): Promise<DiscoveryPhase1AssignmentSearchInputRow[]> {
  const result = await db.query<DiscoveryPhase1AssignmentSearchInputRow>(
    `
      select
        label.assignment_id,
        label.discovery_run_id,
        label.icp_profile_id,
        label.business_id,
        label.search_task_id,
        label.primary_outcome_code,
        label.phase1_class,
        label.exclusion_reason,
        search_task.task_type,
        search_task.country_code,
        search_task.city,
        search_task.language,
        search_task.query_text,
        search_task.normalized_query_key,
        search_task.query_hash,
        search_task.page,
        search_task.time_bucket
      from public.discovery_phase1_assignment_labels_v1 as label
      join (
        select
          id,
          task_type,
          country_code,
          city,
          language,
          query_text,
          normalized_query_key,
          query_hash,
          page,
          time_bucket
        from public.search_tasks
      ) as search_task
        on search_task.id = label.search_task_id
      where label.discovery_run_id = $1
      order by label.assignment_id asc
    `,
    [discoveryRunId],
  );

  return result.rows;
}

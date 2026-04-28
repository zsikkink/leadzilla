import { query, type SqlQueryable } from './postgres.js';

export interface DiscoveryPhase1SearchInputCohortSummaryRow {
  discovery_run_id: string;
  icp_profile_id: string;
  task_type: string;
  country_code: string;
  city: string | null;
  language: string;
  normalized_query_key: string;
  query_hash: string;
  page: number;
  time_bucket: string;
  assignment_count: number;
  phase1_positive_count: number;
  phase1_negative_count: number;
  exclude_operational_count: number;
  exclude_incomplete_count: number;
}

function toQueryable(): SqlQueryable {
  return { query };
}

export async function listDiscoveryPhase1SearchInputCohortSummaries(
  discoveryRunId: string,
  db: SqlQueryable = toQueryable(),
): Promise<DiscoveryPhase1SearchInputCohortSummaryRow[]> {
  const result = await db.query<DiscoveryPhase1SearchInputCohortSummaryRow>(
    `
      select
        label.discovery_run_id,
        label.icp_profile_id,
        search_task.task_type,
        search_task.country_code,
        search_task.city,
        search_task.language,
        search_task.normalized_query_key,
        search_task.query_hash,
        search_task.page,
        search_task.time_bucket,
        count(*)::integer as assignment_count,
        count(*) filter (
          where label.phase1_class = 'PHASE1_POSITIVE'
        )::integer as phase1_positive_count,
        count(*) filter (
          where label.phase1_class = 'PHASE1_NEGATIVE'
        )::integer as phase1_negative_count,
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
          task_type,
          country_code,
          city,
          language,
          normalized_query_key,
          query_hash,
          page,
          time_bucket
        from public.search_tasks
      ) as search_task
        on search_task.id = label.search_task_id
      where label.discovery_run_id = $1
      group by
        label.discovery_run_id,
        label.icp_profile_id,
        search_task.task_type,
        search_task.country_code,
        search_task.city,
        search_task.language,
        search_task.normalized_query_key,
        search_task.query_hash,
        search_task.page,
        search_task.time_bucket
      order by
        label.discovery_run_id asc,
        label.icp_profile_id asc,
        search_task.task_type asc,
        search_task.country_code asc,
        search_task.city asc nulls first,
        search_task.language asc,
        search_task.normalized_query_key asc,
        search_task.query_hash asc,
        search_task.page asc,
        search_task.time_bucket asc
    `,
    [discoveryRunId],
  );

  return result.rows;
}

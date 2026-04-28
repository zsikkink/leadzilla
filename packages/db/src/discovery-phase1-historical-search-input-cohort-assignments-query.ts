import type { DiscoveryPhase1SearchInputCohortSummariesAcrossRunsFilters } from './discovery-phase1-search-input-cohort-summaries-across-runs-query.js';
import { query, type SqlQueryable } from './postgres.js';

export interface DiscoveryPhase1HistoricalSearchInputCohortAssignmentsFilters
  extends DiscoveryPhase1SearchInputCohortSummariesAcrossRunsFilters {
  icpProfileId: string;
  taskType: string;
  countryCode: string;
  city: string | null;
  language: string;
  normalizedQueryKey: string;
  queryHash: string;
  page: number;
  timeBucket: string;
}

export interface DiscoveryPhase1HistoricalSearchInputCohortAssignmentRow {
  assignment_id: string;
  discovery_run_id: string;
  assigned_at: Date;
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

export async function listDiscoveryPhase1HistoricalSearchInputCohortAssignments(
  filters: DiscoveryPhase1HistoricalSearchInputCohortAssignmentsFilters,
  db: SqlQueryable = toQueryable(),
): Promise<DiscoveryPhase1HistoricalSearchInputCohortAssignmentRow[]> {
  const result = await db.query<DiscoveryPhase1HistoricalSearchInputCohortAssignmentRow>(
    `
      select
        label.assignment_id,
        label.discovery_run_id,
        assignment.assigned_at,
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
          assigned_at
        from public.discovery_attribution_assignments
      ) as assignment
        on assignment.id = label.assignment_id
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
      where assignment.assigned_at >= $1
        and assignment.assigned_at < $2
        and label.icp_profile_id = $3
        and search_task.task_type = $4
        and search_task.country_code = $5
        and search_task.city is not distinct from $6
        and search_task.language = $7
        and search_task.normalized_query_key = $8
        and search_task.query_hash = $9
        and search_task.page = $10
        and search_task.time_bucket = $11
      order by
        assignment.assigned_at asc,
        label.discovery_run_id asc,
        label.assignment_id asc
    `,
    [
      filters.assignedAtStart,
      filters.assignedAtEnd,
      filters.icpProfileId,
      filters.taskType,
      filters.countryCode,
      filters.city,
      filters.language,
      filters.normalizedQueryKey,
      filters.queryHash,
      filters.page,
      filters.timeBucket,
    ],
  );

  return result.rows;
}

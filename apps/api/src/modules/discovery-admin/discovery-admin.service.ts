import {
  listDiscoveryPhase1AssignmentLocationSummaries,
  listDiscoveryPhase1HistoricalSearchInputCohortAssignments,
  listDiscoveryPhase1HistoricalSearchInputCohortSummaries,
} from '@lead-flood/db';
import { CreateDiscoveryRunRequestSchema } from '@lead-flood/contracts';
import type {
  AdminBulkCreateDiscoveryRunsRequest,
  AdminBulkCreateDiscoveryRunsResponse,
  AdminBusinessDetailResponse,
  AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsRequest,
  AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsResponse,
  AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesRequest,
  AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesResponse,
  AdminDiscoveryPhase1IcpLocationSummaryRequest,
  AdminDiscoveryPhase1IcpLocationSummaryResponse,
  AdminListBusinessesQuery,
  AdminListBusinessesResponse,
  AdminLeadDetailResponse,
  AdminListLeadsQuery,
  AdminListLeadsResponse,
  AdminListSearchTasksQuery,
  AdminListSearchTasksResponse,
  AdminSearchTaskDetailResponse,
  CreateDiscoveryRunRequest,
  CreateDiscoveryRunResponse,
  JobRunDetailResponse,
  JobRunListQuery,
  ListJobRunsResponse,
  RunDiscoverySeedRequest,
  RunDiscoveryTasksRequest,
  SearchTaskType,
  TriggerJobRunResponse,
} from '@lead-flood/contracts';

import { DiscoveryAdminNotImplementedError } from './discovery-admin.errors.js';
import type {
  CancelDiscoveryRunResult,
  DiscoveryAdminListStaleApolloRevealAttemptsQuery,
  DiscoveryAdminListStaleApolloRevealAttemptsResponse,
  DiscoveryAdminListJobRequestsQuery,
  DiscoveryAdminListJobRequestsResponse,
  DiscoveryAdminListStaleMessageSendsQuery,
  DiscoveryAdminListStaleMessageSendsResponse,
  DiscoveryAdminResolveMessageSendResult,
  DiscoveryAdminResolveApolloRevealAttemptResult,
  DiscoveryAdminRepository,
} from './discovery-admin.repository.js';

export interface DiscoveryAdminServiceDependencies {
  createDiscoveryRun?: (input: CreateDiscoveryRunRequest) => Promise<CreateDiscoveryRunResponse>;
  triggerDiscoverySeedJob?: (input: RunDiscoverySeedRequest) => Promise<TriggerJobRunResponse>;
  triggerDiscoveryTaskRun?: (input: RunDiscoveryTasksRequest) => Promise<TriggerJobRunResponse>;
}

export interface DiscoveryAdminService {
  createBulkDiscoveryRuns(
    input: AdminBulkCreateDiscoveryRunsRequest,
    requestedByUserId: string,
  ): Promise<AdminBulkCreateDiscoveryRunsResponse>;
  getDiscoveryPhase1IcpLocationSummary(
    input: AdminDiscoveryPhase1IcpLocationSummaryRequest,
  ): Promise<AdminDiscoveryPhase1IcpLocationSummaryResponse>;
  getDiscoveryPhase1HistoricalSearchInputCohortSummaries(
    input: AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesRequest,
  ): Promise<AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesResponse>;
  getDiscoveryPhase1HistoricalSearchInputCohortAssignments(
    input: AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsRequest,
  ): Promise<AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsResponse>;
  listBusinesses(query: AdminListBusinessesQuery): Promise<AdminListBusinessesResponse>;
  getBusinessById(id: string): Promise<AdminBusinessDetailResponse>;
  listLeads(query: AdminListLeadsQuery): Promise<AdminListLeadsResponse>;
  getLeadById(id: string): Promise<AdminLeadDetailResponse>;
  listSearchTasks(query: AdminListSearchTasksQuery): Promise<AdminListSearchTasksResponse>;
  getSearchTaskById(id: string): Promise<AdminSearchTaskDetailResponse>;
  triggerDiscoverySeed(input: RunDiscoverySeedRequest): Promise<TriggerJobRunResponse>;
  triggerDiscoveryTaskRun(input: RunDiscoveryTasksRequest): Promise<TriggerJobRunResponse>;
  listJobRequests(query: DiscoveryAdminListJobRequestsQuery): Promise<DiscoveryAdminListJobRequestsResponse>;
  listStaleMessageSends(
    query: DiscoveryAdminListStaleMessageSendsQuery,
  ): Promise<DiscoveryAdminListStaleMessageSendsResponse>;
  resolveMessageSend(id: string): Promise<DiscoveryAdminResolveMessageSendResult>;
  listStaleApolloRevealAttempts(
    query: DiscoveryAdminListStaleApolloRevealAttemptsQuery,
  ): Promise<DiscoveryAdminListStaleApolloRevealAttemptsResponse>;
  resolveApolloRevealAttempt(
    id: string,
    resolvedByUserId: string,
  ): Promise<DiscoveryAdminResolveApolloRevealAttemptResult>;
  listJobRuns(query: JobRunListQuery): Promise<ListJobRunsResponse>;
  getJobRunById(id: string): Promise<JobRunDetailResponse>;
  cancelDiscoveryRun(
    id: string,
    requestedByUserId?: string | undefined,
  ): Promise<CancelDiscoveryRunResult>;
  approveContactRecoveryItem(
    id: string,
    approvedByUserId: string,
  ): Promise<{ leadId: string; businessName: string }>;
  getDiscoveryRunDetail(id: string): Promise<Awaited<ReturnType<DiscoveryAdminRepository['getDiscoveryRunDetail']>>>;
}

function formatValidationIssues(issues: ReadonlyArray<{ path: (string | number)[]; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function toFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Failed to create discovery run';
}

export function buildDiscoveryAdminService(
  repository: DiscoveryAdminRepository,
  dependencies: DiscoveryAdminServiceDependencies,
): DiscoveryAdminService {
  return {
    async createBulkDiscoveryRuns(input, requestedByUserId) {
      if (!dependencies.createDiscoveryRun) {
        throw new DiscoveryAdminNotImplementedError('Bulk discovery run creation is not configured');
      }

      const results: AdminBulkCreateDiscoveryRunsResponse['results'] = [];
      let createdCount = 0;

      for (const [index, item] of input.items.entries()) {
        const parsedItem = CreateDiscoveryRunRequestSchema.safeParse(item);
        if (!parsedItem.success) {
          results.push({
            index,
            success: false,
            error: formatValidationIssues(parsedItem.error.issues),
          });
          continue;
        }

        try {
          const result = await dependencies.createDiscoveryRun({
            ...parsedItem.data,
            requestedByUserId,
          });
          results.push({
            index,
            success: true,
            runId: result.runId,
            status: result.status,
          });
          createdCount += 1;
        } catch (error: unknown) {
          results.push({
            index,
            success: false,
            error: toFailureMessage(error),
          });
        }
      }

      return {
        results,
        createdCount,
        failedCount: results.length - createdCount,
      };
    },
    async getDiscoveryPhase1IcpLocationSummary(input) {
      const rows = await listDiscoveryPhase1AssignmentLocationSummaries(input.runIds);

      return {
        locationBasis: 'ASSIGNED_SEARCH_TASK_LOCATION',
        cohorts: rows.map((row) => {
          const measuredAssignmentCount =
            row.phase1_positive_count + row.phase1_negative_count;

          return {
            icpProfileId: row.icp_profile_id,
            countryCode: row.country_code,
            city: row.city,
            assignmentCount: row.assignment_count,
            measuredAssignmentCount,
            phase1PositiveCount: row.phase1_positive_count,
            phase1NegativeCount: row.phase1_negative_count,
            holdoutAmbiguousCount: row.holdout_ambiguous_count,
            excludeOperationalCount: row.exclude_operational_count,
            excludeIncompleteCount: row.exclude_incomplete_count,
            measurementCoverageRate: measuredAssignmentCount / row.assignment_count,
            phase1PositiveRateAmongMeasuredAssignments:
              measuredAssignmentCount > 0
                ? row.phase1_positive_count / measuredAssignmentCount
                : null,
          };
        }),
      };
    },
    async getDiscoveryPhase1HistoricalSearchInputCohortSummaries(input) {
      const rows = await listDiscoveryPhase1HistoricalSearchInputCohortSummaries({
        assignedAtStart: new Date(input.assignedAtStart),
        assignedAtEnd: new Date(input.assignedAtEnd),
      });

      return {
        searchInputBasis: 'ASSIGNED_SEARCH_TASK_INPUT',
        cohorts: rows.map((row) => {
          const measuredAssignmentCount =
            row.phase1_positive_count + row.phase1_negative_count;

          return {
            icpProfileId: row.icp_profile_id,
            taskType: row.task_type as SearchTaskType,
            countryCode: row.country_code,
            city: row.city,
            language: row.language,
            normalizedQueryKey: row.normalized_query_key,
            queryHash: row.query_hash,
            page: row.page,
            timeBucket: row.time_bucket,
            discoveryRunCount: row.discovery_run_count,
            assignmentCount: row.assignment_count,
            measuredAssignmentCount,
            phase1PositiveCount: row.phase1_positive_count,
            phase1NegativeCount: row.phase1_negative_count,
            excludeOperationalCount: row.exclude_operational_count,
            excludeIncompleteCount: row.exclude_incomplete_count,
            measurementCoverageRate: measuredAssignmentCount / row.assignment_count,
            phase1PositiveRateAmongMeasuredAssignments:
              measuredAssignmentCount > 0
                ? row.phase1_positive_count / measuredAssignmentCount
                : null,
          };
        }),
      };
    },
    async getDiscoveryPhase1HistoricalSearchInputCohortAssignments(input) {
      const rows = await listDiscoveryPhase1HistoricalSearchInputCohortAssignments({
        assignedAtStart: new Date(input.assignedAtStart),
        assignedAtEnd: new Date(input.assignedAtEnd),
        icpProfileId: input.icpProfileId,
        taskType: input.taskType,
        countryCode: input.countryCode,
        city: input.city,
        language: input.language,
        normalizedQueryKey: input.normalizedQueryKey,
        queryHash: input.queryHash,
        page: input.page,
        timeBucket: input.timeBucket,
      });

      return {
        searchInputBasis: 'ASSIGNED_SEARCH_TASK_INPUT',
        assignments: rows.map((row) => ({
          assignmentId: row.assignment_id,
          discoveryRunId: row.discovery_run_id,
          assignedAt: row.assigned_at.toISOString(),
          icpProfileId: row.icp_profile_id,
          businessId: row.business_id,
          searchTaskId: row.search_task_id,
          primaryOutcomeCode: row.primary_outcome_code,
          phase1Class: row.phase1_class,
          exclusionReason: row.exclusion_reason,
          taskType: row.task_type as SearchTaskType,
          countryCode: row.country_code,
          city: row.city,
          language: row.language,
          queryText: row.query_text,
          normalizedQueryKey: row.normalized_query_key,
          queryHash: row.query_hash,
          page: row.page,
          timeBucket: row.time_bucket,
        })),
      };
    },
    async listBusinesses(query) {
      return repository.listBusinesses(query);
    },
    async getBusinessById(id) {
      return repository.getBusinessById(id);
    },
    async listLeads(query) {
      return repository.listLeads(query);
    },
    async getLeadById(id) {
      return repository.getLeadById(id);
    },
    async listSearchTasks(query) {
      return repository.listSearchTasks(query);
    },
    async getSearchTaskById(id) {
      return repository.getSearchTaskById(id);
    },
    async triggerDiscoverySeed(input) {
      if (!dependencies.triggerDiscoverySeedJob) {
        throw new DiscoveryAdminNotImplementedError('Discovery seed trigger is not configured');
      }
      return dependencies.triggerDiscoverySeedJob(input);
    },
    async triggerDiscoveryTaskRun(input) {
      if (!dependencies.triggerDiscoveryTaskRun) {
        throw new DiscoveryAdminNotImplementedError('Discovery task run trigger is not configured');
      }
      return dependencies.triggerDiscoveryTaskRun(input);
    },
    async listJobRequests(query) {
      return repository.listJobRequests(query);
    },
    async listStaleMessageSends(query) {
      return repository.listStaleMessageSends(query);
    },
    async resolveMessageSend(id) {
      return repository.resolveMessageSend(id);
    },
    async listStaleApolloRevealAttempts(query) {
      return repository.listStaleApolloRevealAttempts(query);
    },
    async resolveApolloRevealAttempt(id, resolvedByUserId) {
      return repository.resolveApolloRevealAttempt(id, resolvedByUserId);
    },
    async listJobRuns(query) {
      return repository.listJobRuns(query);
    },
    async getJobRunById(id) {
      return repository.getJobRunById(id);
    },
    async cancelDiscoveryRun(id, requestedByUserId) {
      return repository.cancelDiscoveryRun(id, requestedByUserId);
    },
    async approveContactRecoveryItem(id, approvedByUserId) {
      return repository.approveContactRecoveryItem(id, approvedByUserId);
    },
    async getDiscoveryRunDetail(id) {
      return repository.getDiscoveryRunDetail(id);
    },
  };
}

import { listDiscoveryPhase1AssignmentLocationSummaries } from '@lead-flood/db';
import type {
  AdminBusinessDetailResponse,
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
  JobRunDetailResponse,
  JobRunListQuery,
  ListJobRunsResponse,
  RunDiscoverySeedRequest,
  RunDiscoveryTasksRequest,
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
  triggerDiscoverySeedJob?: (input: RunDiscoverySeedRequest) => Promise<TriggerJobRunResponse>;
  triggerDiscoveryTaskRun?: (input: RunDiscoveryTasksRequest) => Promise<TriggerJobRunResponse>;
}

export interface DiscoveryAdminService {
  getDiscoveryPhase1IcpLocationSummary(
    input: AdminDiscoveryPhase1IcpLocationSummaryRequest,
  ): Promise<AdminDiscoveryPhase1IcpLocationSummaryResponse>;
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

export function buildDiscoveryAdminService(
  repository: DiscoveryAdminRepository,
  dependencies: DiscoveryAdminServiceDependencies,
): DiscoveryAdminService {
  return {
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

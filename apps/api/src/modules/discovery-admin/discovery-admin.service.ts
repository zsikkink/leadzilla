import type {
  AdminBusinessDetailResponse,
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

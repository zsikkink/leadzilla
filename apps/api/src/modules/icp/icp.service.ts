import type {
  CreateIcpProfileRequest,
  CreateQualificationRuleRequest,
  IcpDebugSampleQuery,
  IcpDebugSampleResponse,
  IcpProfileResponse,
  IcpStatusResponse,
  ListIcpProfilesQuery,
  ListIcpProfilesResponse,
  ListIcpRulesResponse,
  QualificationRuleResponse,
  ReplaceIcpRulesRequest,
  UpdateIcpProfileRequest,
  UpdateQualificationRuleRequest,
} from '@lead-flood/contracts';

import { prisma } from '@lead-flood/db';

import type { IcpRepository } from './icp.repository.js';
import { IcpHasActiveDataError } from './icp.errors.js';

export interface IcpService {
  createIcpProfile(input: CreateIcpProfileRequest): Promise<IcpProfileResponse>;
  listIcpProfiles(query: ListIcpProfilesQuery): Promise<ListIcpProfilesResponse>;
  getIcpProfile(icpId: string): Promise<IcpProfileResponse>;
  updateIcpProfile(icpId: string, input: UpdateIcpProfileRequest): Promise<IcpProfileResponse>;
  deleteIcpProfile(icpId: string): Promise<void>;
  createQualificationRule(
    icpId: string,
    input: CreateQualificationRuleRequest,
  ): Promise<QualificationRuleResponse>;
  updateQualificationRule(
    icpId: string,
    ruleId: string,
    input: UpdateQualificationRuleRequest,
  ): Promise<QualificationRuleResponse>;
  deleteQualificationRule(icpId: string, ruleId: string): Promise<void>;
  listIcpRules(icpId: string): Promise<ListIcpRulesResponse>;
  replaceIcpRules(icpId: string, input: ReplaceIcpRulesRequest): Promise<ListIcpRulesResponse>;
  getIcpStatus(icpId: string): Promise<IcpStatusResponse>;
  getIcpDebugSample(icpProfileId: string, query: IcpDebugSampleQuery): Promise<IcpDebugSampleResponse>;
}

export function buildIcpService(repository: IcpRepository): IcpService {
  return {
    async createIcpProfile(input) {
      // TODO: add ICP business validation and orchestration.
      return repository.createIcpProfile(input);
    },
    async listIcpProfiles(query) {
      // TODO: add ICP search/filter orchestration.
      return repository.listIcpProfiles(query);
    },
    async getIcpProfile(icpId) {
      // TODO: add access control checks.
      return repository.getIcpProfile(icpId);
    },
    async updateIcpProfile(icpId, input) {
      // TODO: add rule consistency checks before update.
      return repository.updateIcpProfile(icpId, input);
    },
    async deleteIcpProfile(icpId) {
      // Safe-delete: block if ICP has active leads, active discovery jobs,
      // active score predictions, or pending message drafts
      const [leadCount, activeJobCount, activeLeadCount, pendingDraftCount] = await Promise.all([
        prisma.leadDiscoveryRecord.count({ where: { icpProfileId: icpId } }),
        prisma.jobExecution.count({
          where: {
            type: { startsWith: 'discovery' },
            status: { in: ['queued', 'running'] },
            payload: { path: ['icpProfileId'], equals: icpId },
          },
        }),
        prisma.leadScorePrediction.count({
          where: {
            icpProfileId: icpId,
            lead: { deletedAt: null, status: { notIn: ['rejected'] } },
          },
        }),
        prisma.messageDraft.count({
          where: {
            icpProfileId: icpId,
            approvalStatus: { in: ['PENDING', 'APPROVED', 'AUTO_APPROVED'] },
          },
        }),
      ]);

      const reasons: string[] = [];
      if (leadCount > 0) {
        reasons.push(`${leadCount} lead${leadCount > 1 ? 's' : ''} linked to this ICP`);
      }
      if (activeJobCount > 0) {
        reasons.push(`${activeJobCount} active discovery job${activeJobCount > 1 ? 's' : ''}`);
      }
      if (activeLeadCount > 0) {
        reasons.push(`${activeLeadCount} active lead score${activeLeadCount !== 1 ? 's' : ''}`);
      }
      if (pendingDraftCount > 0) {
        reasons.push(`${pendingDraftCount} pending message draft${pendingDraftCount !== 1 ? 's' : ''}`);
      }
      if (reasons.length > 0) {
        throw new IcpHasActiveDataError(
          `Cannot delete ICP: ${reasons.join(', ')}. Remove or reassign them first.`,
        );
      }

      await repository.deleteIcpProfile(icpId);
    },
    async createQualificationRule(icpId, input) {
      // TODO: validate weighted vs hard-filter rule constraints.
      return repository.createQualificationRule(icpId, input);
    },
    async updateQualificationRule(icpId, ruleId, input) {
      // TODO: validate rule compatibility.
      return repository.updateQualificationRule(icpId, ruleId, input);
    },
    async deleteQualificationRule(icpId, ruleId) {
      // TODO: enforce minimum required rules.
      await repository.deleteQualificationRule(icpId, ruleId);
    },
    async listIcpRules(icpId) {
      return repository.listIcpRules(icpId);
    },
    async replaceIcpRules(icpId, input) {
      return repository.replaceIcpRules(icpId, input);
    },
    async getIcpStatus(icpId) {
      // TODO: include discovery/scoring freshness metadata.
      return repository.getIcpStatus(icpId);
    },
    async getIcpDebugSample(icpProfileId, query) {
      return repository.getIcpDebugSample(icpProfileId, query);
    },
  };
}

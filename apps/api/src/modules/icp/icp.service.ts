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
      // Safe-delete check: block deletion if active leads (via score predictions)
      // or pending message drafts still reference this ICP
      const [activeLeadCount, pendingDraftCount] = await Promise.all([
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

      const blockers: string[] = [];
      if (activeLeadCount > 0) {
        blockers.push(`${activeLeadCount} active lead score${activeLeadCount !== 1 ? 's' : ''}`);
      }
      if (pendingDraftCount > 0) {
        blockers.push(`${pendingDraftCount} pending message draft${pendingDraftCount !== 1 ? 's' : ''}`);
      }
      if (blockers.length > 0) {
        const { IcpBadRequestError } = await import('./icp.errors.js');
        throw new IcpBadRequestError(
          `Cannot delete ICP profile: ${blockers.join(' and ')} still reference this ICP. Deactivate or remove them first.`,
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

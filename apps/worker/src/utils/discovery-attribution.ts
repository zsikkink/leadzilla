import { prisma } from '@lead-flood/db';

export const DISCOVERY_ATTRIBUTION_PRIMARY_OUTCOME_CODES = {
  PREQUALIFY_DISQUALIFIED: 'PREQUALIFY_DISQUALIFIED',
  RECOVERY_OPENED: 'RECOVERY_OPENED',
  LEAD_CREATED: 'LEAD_CREATED',
  EXISTING_SAME_BUSINESS_LEAD_REUSED: 'EXISTING_SAME_BUSINESS_LEAD_REUSED',
} as const;

export type DiscoveryAttributionPrimaryOutcomeCode =
  typeof DISCOVERY_ATTRIBUTION_PRIMARY_OUTCOME_CODES[keyof typeof DISCOVERY_ATTRIBUTION_PRIMARY_OUTCOME_CODES];

export async function recordDiscoveryAttributionPrimaryOutcome(input: {
  businessId: string;
  discoveryRunId: string;
  icpProfileId: string;
  primaryOutcomeCode: DiscoveryAttributionPrimaryOutcomeCode;
  primaryOutcomeAt?: Date | undefined;
}): Promise<boolean> {
  const result = await prisma.discoveryAttributionAssignment.updateMany({
    where: {
      discoveryRunId: input.discoveryRunId,
      icpProfileId: input.icpProfileId,
      businessId: input.businessId,
      primaryOutcomeCode: null,
    },
    data: {
      primaryOutcomeCode: input.primaryOutcomeCode,
      primaryOutcomeAt: input.primaryOutcomeAt ?? new Date(),
    },
  });

  return result.count > 0;
}

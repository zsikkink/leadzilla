export interface FeaturesComputeQueueIdentityInput {
  leadId: string;
  icpProfileId: string;
  snapshotVersion: number;
}

export const FEATURES_COMPUTE_IDEMPOTENCY_KEY_PATTERN =
  'features.compute:${leadId}:${icpProfileId}:${snapshotVersion}';

export function buildFeaturesComputeSingletonKey(
  input: FeaturesComputeQueueIdentityInput,
): string {
  return `features.compute:${input.leadId}:${input.icpProfileId}:${input.snapshotVersion}`;
}

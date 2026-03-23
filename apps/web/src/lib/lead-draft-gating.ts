export interface PipelineSettingListItem {
  key: string;
  value: unknown;
}

export interface LeadDraftGenerationStateInput {
  leadStatus: string;
  hasIcpProfileId: boolean;
  blendedScore: number | null;
  qualificationThreshold: number | null;
  isQualificationThresholdLoading: boolean;
  qualificationThresholdError: string | null;
}

export type LeadDraftGenerationState =
  | { kind: 'hidden' }
  | {
      kind: 'blocked';
      reason:
        | 'missing_icp_profile'
        | 'missing_score'
        | 'below_threshold'
        | 'threshold_loading'
        | 'threshold_unavailable';
    }
  | { kind: 'enabled' };

const SCORE_QUALIFICATION_THRESHOLD_KEY = 'scoreQualificationThreshold';

function toThresholdNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return null;
  }
  return parsed;
}

export function parseScoreQualificationThreshold(
  items: readonly PipelineSettingListItem[],
): number | null {
  const setting = items.find(
    (item) => item.key === SCORE_QUALIFICATION_THRESHOLD_KEY,
  );

  if (!setting) {
    return null;
  }

  return toThresholdNumber(setting.value);
}

export function getLeadDraftGenerationState(
  input: LeadDraftGenerationStateInput,
): LeadDraftGenerationState {
  if (input.leadStatus !== 'qualified') {
    return { kind: 'hidden' };
  }

  if (!input.hasIcpProfileId) {
    return { kind: 'blocked', reason: 'missing_icp_profile' };
  }

  if (input.isQualificationThresholdLoading) {
    return { kind: 'blocked', reason: 'threshold_loading' };
  }

  if (input.qualificationThresholdError || input.qualificationThreshold === null) {
    return { kind: 'blocked', reason: 'threshold_unavailable' };
  }

  if (input.blendedScore === null) {
    return { kind: 'blocked', reason: 'missing_score' };
  }

  if (input.blendedScore >= input.qualificationThreshold) {
    return { kind: 'enabled' };
  }

  return { kind: 'blocked', reason: 'below_threshold' };
}

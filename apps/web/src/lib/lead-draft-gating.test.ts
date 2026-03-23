import { describe, expect, it } from 'vitest';

import {
  getLeadDraftGenerationState,
  parseScoreQualificationThreshold,
} from './lead-draft-gating.js';

describe('parseScoreQualificationThreshold', () => {
  it('returns the numeric score qualification threshold when present', () => {
    expect(
      parseScoreQualificationThreshold([
        { key: 'scoreQualificationThreshold', value: 0.62 },
      ]),
    ).toBe(0.62);
  });

  it('accepts numeric strings from settings payloads', () => {
    expect(
      parseScoreQualificationThreshold([
        { key: 'scoreQualificationThreshold', value: '0.55' },
      ]),
    ).toBe(0.55);
  });

  it('returns null when the threshold is missing or invalid', () => {
    expect(parseScoreQualificationThreshold([])).toBeNull();
    expect(
      parseScoreQualificationThreshold([
        { key: 'scoreQualificationThreshold', value: 'not-a-number' },
      ]),
    ).toBeNull();
    expect(
      parseScoreQualificationThreshold([
        { key: 'scoreQualificationThreshold', value: 1.2 },
      ]),
    ).toBeNull();
  });
});

describe('getLeadDraftGenerationState', () => {
  it('enables draft generation only when the verified threshold is loaded and met', () => {
    expect(
      getLeadDraftGenerationState({
        leadStatus: 'qualified',
        hasIcpProfileId: true,
        blendedScore: 0.73,
        qualificationThreshold: 0.7,
        isQualificationThresholdLoading: false,
        qualificationThresholdError: null,
      }),
    ).toEqual({ kind: 'enabled' });
  });

  it('disables draft generation while the threshold is still loading', () => {
    expect(
      getLeadDraftGenerationState({
        leadStatus: 'qualified',
        hasIcpProfileId: true,
        blendedScore: 0.73,
        qualificationThreshold: null,
        isQualificationThresholdLoading: true,
        qualificationThresholdError: null,
      }),
    ).toEqual({ kind: 'blocked', reason: 'threshold_loading' });
  });

  it('disables draft generation when the threshold is unavailable', () => {
    expect(
      getLeadDraftGenerationState({
        leadStatus: 'qualified',
        hasIcpProfileId: true,
        blendedScore: 0.73,
        qualificationThreshold: null,
        isQualificationThresholdLoading: false,
        qualificationThresholdError: 'Unable to load settings',
      }),
    ).toEqual({ kind: 'blocked', reason: 'threshold_unavailable' });
  });

  it('surfaces a block reason when the lead does not meet the verified threshold', () => {
    expect(
      getLeadDraftGenerationState({
        leadStatus: 'qualified',
        hasIcpProfileId: true,
        blendedScore: 0.49,
        qualificationThreshold: 0.5,
        isQualificationThresholdLoading: false,
        qualificationThresholdError: null,
      }),
    ).toEqual({ kind: 'blocked', reason: 'below_threshold' });
  });

  it('surfaces a block reason when a qualified lead has no assigned ICP', () => {
    expect(
      getLeadDraftGenerationState({
        leadStatus: 'qualified',
        hasIcpProfileId: false,
        blendedScore: 0.82,
        qualificationThreshold: 0.5,
        isQualificationThresholdLoading: false,
        qualificationThresholdError: null,
      }),
    ).toEqual({ kind: 'blocked', reason: 'missing_icp_profile' });
  });

  it('surfaces a block reason when a qualified lead has no score for the ICP', () => {
    expect(
      getLeadDraftGenerationState({
        leadStatus: 'qualified',
        hasIcpProfileId: true,
        blendedScore: null,
        qualificationThreshold: 0.5,
        isQualificationThresholdLoading: false,
        qualificationThresholdError: null,
      }),
    ).toEqual({ kind: 'blocked', reason: 'missing_score' });
  });
});

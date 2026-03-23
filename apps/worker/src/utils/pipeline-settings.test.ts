import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    getPipelineSetting: vi.fn(),
    listPipelineSettingsByKeys: vi.fn(),
    prisma: {
      discoveryCostEvent: {
        aggregate: vi.fn(),
      },
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  getPipelineSetting: dbMock.getPipelineSetting,
  listPipelineSettingsByKeys: dbMock.listPipelineSettingsByKeys,
  prisma: dbMock.prisma,
}));

import {
  getMessagingRole,
  getPipelineSettings,
  loadVerifiedScoreQualificationThreshold,
  loadAutoApproveConfig,
} from './pipeline-settings.js';

describe('pipeline settings utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses defaults when batched settings lookup fails', async () => {
    dbMock.listPipelineSettingsByKeys.mockRejectedValue(new Error('db unavailable'));

    await expect(getPipelineSettings()).resolves.toEqual({
      outboxRetentionDays: 30,
      stuckLeadThresholdMs: 60 * 60 * 1000,
      dlqMaxRetries: 3,
      dlqBatchSize: 100,
      retrainThreshold: 50,
      coldLeadTimeoutDays: 30,
      healthDlqDepthThreshold: 10,
      healthStaleJobMinutes: 60,
    });
  });

  it('loads auto-approve settings from the shared db helper batch lookup', async () => {
    dbMock.listPipelineSettingsByKeys.mockResolvedValue([
      { key: 'auto_approve_enabled', valueJson: true },
      { key: 'auto_approve_score_min', valueJson: 0.2 },
      { key: 'auto_approve_score_max', valueJson: 0.8 },
    ]);

    await expect(loadAutoApproveConfig()).resolves.toEqual({
      enabled: true,
      scoreMin: 0.2,
      scoreMax: 0.8,
    });
  });

  it('returns trimmed messaging role strings', async () => {
    dbMock.getPipelineSetting.mockResolvedValue({
      key: 'messagingRole',
      valueJson: '  founder whisperer  ',
    });

    await expect(getMessagingRole()).resolves.toBe('founder whisperer');
  });

  it('loads the verified score qualification threshold without falling back', async () => {
    dbMock.getPipelineSetting.mockResolvedValue({
      key: 'scoreQualificationThreshold',
      valueJson: '0.68',
    });

    await expect(loadVerifiedScoreQualificationThreshold()).resolves.toBe(0.68);
  });

  it('throws when the verified score qualification threshold is missing or invalid', async () => {
    dbMock.getPipelineSetting.mockResolvedValue(null);
    await expect(loadVerifiedScoreQualificationThreshold()).rejects.toThrow(
      'scoreQualificationThreshold is missing or invalid in pipeline settings',
    );

    dbMock.getPipelineSetting.mockResolvedValue({
      key: 'scoreQualificationThreshold',
      valueJson: 1.4,
    });
    await expect(loadVerifiedScoreQualificationThreshold()).rejects.toThrow(
      'scoreQualificationThreshold is missing or invalid in pipeline settings',
    );
  });
});

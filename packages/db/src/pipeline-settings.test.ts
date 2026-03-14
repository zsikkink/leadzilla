import { describe, expect, it, vi } from 'vitest';

import {
  getPipelineSetting,
  getScoreQualificationThresholdSetting,
  listPipelineSettingsByKeys,
  upsertPipelineSetting,
} from './pipeline-settings.js';
import type { SqlQueryable } from './postgres.js';

function createQueryable(
  rows: unknown[],
): SqlQueryable {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as SqlQueryable;
}

describe('pipeline settings sql helpers', () => {
  it('returns null when a setting key is absent', async () => {
    const db = createQueryable([]);

    await expect(getPipelineSetting('missing', db)).resolves.toBeNull();
  });

  it('returns an empty array without querying when batch keys are empty', async () => {
    const db = createQueryable([]);

    await expect(listPipelineSettingsByKeys([], db)).resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('maps updatedAt from SQL rows on upsert', async () => {
    const db = createQueryable([
      {
        key: 'auto_approve_enabled',
        valueJson: true,
        updatedAtMs: Date.UTC(2026, 0, 1),
      },
    ]);

    await expect(upsertPipelineSetting('auto_approve_enabled', true, db)).resolves.toEqual({
      key: 'auto_approve_enabled',
      valueJson: true,
      updatedAt: new Date(Date.UTC(2026, 0, 1)),
    });
  });

  it('parses a bounded score qualification threshold value', async () => {
    const db = createQueryable([
      {
        key: 'scoreQualificationThreshold',
        valueJson: '0.65',
        updatedAtMs: Date.UTC(2026, 0, 1),
      },
    ]);

    await expect(getScoreQualificationThresholdSetting(0.4, db)).resolves.toBe(0.65);
  });

  it('falls back when the score qualification threshold value is invalid', async () => {
    const db = createQueryable([
      {
        key: 'scoreQualificationThreshold',
        valueJson: 1.5,
        updatedAtMs: Date.UTC(2026, 0, 1),
      },
    ]);

    await expect(getScoreQualificationThresholdSetting(0.5, db)).resolves.toBe(0.5);
  });
});

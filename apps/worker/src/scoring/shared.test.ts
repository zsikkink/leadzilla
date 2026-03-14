import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    getScoreQualificationThresholdSetting: vi.fn(),
    prisma: {},
    Prisma: {
      JsonNull: null,
      PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
        code: string;

        constructor(code: string) {
          super(code);
          this.code = code;
        }
      },
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  getScoreQualificationThresholdSetting: dbMock.getScoreQualificationThresholdSetting,
  prisma: dbMock.prisma,
  Prisma: dbMock.Prisma,
}));

import { getQualificationThreshold } from './shared.js';

describe('getQualificationThreshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the shared threshold helper value when available', async () => {
    dbMock.getScoreQualificationThresholdSetting.mockResolvedValue(0.72);

    await expect(getQualificationThreshold()).resolves.toBe(0.72);
    expect(dbMock.getScoreQualificationThresholdSetting).toHaveBeenCalledWith(0.4);
  });

  it('falls back to the scoring default when the db helper throws', async () => {
    dbMock.getScoreQualificationThresholdSetting.mockRejectedValue(new Error('db unavailable'));

    await expect(getQualificationThreshold()).resolves.toBe(0.4);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    getScoreQualificationThresholdSetting: vi.fn(),
    prisma: {
      $transaction: vi.fn(),
      trainingRun: {
        create: vi.fn(),
      },
      modelVersion: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    },
    PrismaRuntime: {
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
  PrismaRuntime: dbMock.PrismaRuntime,
}));

import { BASELINE_MODEL_VERSION_TAG, ensureBaselineModelVersion, getQualificationThreshold } from './shared.js';

describe('getQualificationThreshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof dbMock.prisma) => Promise<unknown>) => callback(dbMock.prisma),
    );
    dbMock.prisma.modelVersion.findUnique.mockResolvedValue(null);
    dbMock.prisma.modelVersion.findFirst.mockResolvedValue(null);
    dbMock.prisma.trainingRun.create.mockResolvedValue({
      id: 'training_run_1',
    });
    dbMock.prisma.modelVersion.create.mockResolvedValue({
      id: 'model_1',
    });
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

  it('creates the baseline as ACTIVE when no other active model exists', async () => {
    await expect(ensureBaselineModelVersion()).resolves.toBe('model_1');

    expect(dbMock.prisma.modelVersion.findUnique).toHaveBeenCalledWith({
      where: { versionTag: BASELINE_MODEL_VERSION_TAG },
      select: { id: true },
    });
    expect(dbMock.prisma.modelVersion.findFirst).toHaveBeenCalledWith({
      where: {
        modelType: 'LOGISTIC_REGRESSION',
        stage: 'ACTIVE',
      },
      select: { id: true },
    });
    expect(dbMock.prisma.modelVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versionTag: BASELINE_MODEL_VERSION_TAG,
        modelType: 'LOGISTIC_REGRESSION',
        stage: 'ACTIVE',
        activatedAt: expect.any(Date),
      }),
    });
  });

  it('creates the baseline as ARCHIVED when another active model already exists', async () => {
    dbMock.prisma.modelVersion.findFirst.mockResolvedValue({
      id: 'active_model_1',
    });

    await expect(ensureBaselineModelVersion()).resolves.toBe('model_1');

    expect(dbMock.prisma.modelVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versionTag: BASELINE_MODEL_VERSION_TAG,
        modelType: 'LOGISTIC_REGRESSION',
        stage: 'ARCHIVED',
        retiredAt: expect.any(Date),
      }),
    });
  });
});

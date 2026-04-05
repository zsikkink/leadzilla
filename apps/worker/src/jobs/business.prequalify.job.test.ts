import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, pipelineSettingsMock, trackerMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      jobExecution: {
        findUnique: vi.fn(),
      },
      business: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      discoveryCostEvent: {
        create: vi.fn(),
      },
      discoveryAttributionAssignment: {
        updateMany: vi.fn(),
      },
    },
  },
  pipelineSettingsMock: {
    getMinReviewCount: vi.fn(),
  },
  trackerMock: {
    tryFinalizeDiscoveryRun: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  getMinReviewCount: pipelineSettingsMock.getMinReviewCount,
}));

vi.mock('../utils/discovery-run-tracker.js', () => ({
  tryFinalizeDiscoveryRun: trackerMock.tryFinalizeDiscoveryRun,
}));

import {
  handleBusinessPrequalifyJob,
  type BusinessPrequalifyJobPayload,
} from './business.prequalify.job.js';

function makeJob(data: BusinessPrequalifyJobPayload): Job<BusinessPrequalifyJobPayload> {
  return {
    id: randomUUID(),
    name: 'business.prequalify',
    data,
  } as Job<BusinessPrequalifyJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('handleBusinessPrequalifyJob attribution outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMock.prisma.jobExecution.findUnique.mockResolvedValue(null);
    dbMock.prisma.business.findUnique.mockResolvedValue({
      id: 'business_1',
      websiteDomain: null,
      reviewCount: 42,
    });
    dbMock.prisma.business.update.mockResolvedValue({ id: 'business_1' });
    dbMock.prisma.discoveryCostEvent.create.mockResolvedValue({ id: 'cost_1' });
    dbMock.prisma.discoveryAttributionAssignment.updateMany.mockResolvedValue({ count: 1 });
    trackerMock.tryFinalizeDiscoveryRun.mockResolvedValue(undefined);
    pipelineSettingsMock.getMinReviewCount.mockResolvedValue(15);
  });

  it('writes PREQUALIFY_DISQUALIFIED to the attribution row when prequalification disqualifies directly', async () => {
    await handleBusinessPrequalifyJob(
      logger,
      makeJob({
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        minReviewCount: 15,
      }),
    );

    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        primaryOutcomeCode: null,
      },
      data: {
        primaryOutcomeCode: 'PREQUALIFY_DISQUALIFIED',
        primaryOutcomeAt: expect.any(Date),
      },
    });
  });
});

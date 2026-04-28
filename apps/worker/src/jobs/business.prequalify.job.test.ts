import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, dnsMock, pipelineSettingsMock, trackerMock } = vi.hoisted(() => ({
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
  dnsMock: {
    resolve4: vi.fn(),
    resolve6: vi.fn(),
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

vi.mock('node:dns', () => ({
  promises: {
    resolve4: dnsMock.resolve4,
    resolve6: dnsMock.resolve6,
  },
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
    dnsMock.resolve4.mockResolvedValue(['127.0.0.1']);
    dnsMock.resolve6.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      url: 'https://acme.example',
      text: vi.fn().mockResolvedValue('<html><body>Acme Dental</body></html>'),
    }));
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

  it('preserves existing-business rediscovery in the convert payload after prequalify overwrites the business run id', async () => {
    const enqueueBusinessConvert = vi.fn();
    dbMock.prisma.business.findUnique.mockResolvedValueOnce({
      id: 'business_1',
      websiteDomain: 'acme.example',
      reviewCount: 42,
      discoveryRunId: 'run_old',
    });

    await handleBusinessPrequalifyJob(
      logger,
      makeJob({
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        existingBusinessRediscovery: true,
        minReviewCount: 15,
      }),
      {
        enqueueBusinessConvert,
      },
    );

    expect(dbMock.prisma.business.update).toHaveBeenCalledWith({
      where: { id: 'business_1' },
      data: {
        preQualified: true,
        disqualificationReason: null,
        discoveryRunId: 'run_1',
      },
    });
    expect(enqueueBusinessConvert).toHaveBeenCalledWith({
      businessId: 'business_1',
      discoveryRunId: 'run_1',
      icpProfileId: 'icp_1',
      existingBusinessRediscovery: true,
      includeWebsiteAnalysis: undefined,
      includeSocialMediaAnalysis: undefined,
      correlationId: expect.any(String),
    });
  });
});

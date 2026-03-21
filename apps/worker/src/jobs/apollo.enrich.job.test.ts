import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, pipelineSettingsMock, trackerMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      leadScorePrediction: {
        findUnique: vi.fn(),
      },
      lead: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      business: {
        findUnique: vi.fn(),
      },
      discoveryCostEvent: {
        create: vi.fn(),
      },
    },
  },
  pipelineSettingsMock: {
    getEnrichmentThreshold: vi.fn(),
    isProviderWithinBudget: vi.fn(),
  },
  trackerMock: {
    tryFinalizeDiscoveryRun: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  getEnrichmentThreshold: pipelineSettingsMock.getEnrichmentThreshold,
  isProviderWithinBudget: pipelineSettingsMock.isProviderWithinBudget,
}));

vi.mock('../utils/discovery-run-tracker.js', () => ({
  tryFinalizeDiscoveryRun: trackerMock.tryFinalizeDiscoveryRun,
}));

import {
  handleApolloEnrichJob,
  type ApolloEnrichJobPayload,
} from './apollo.enrich.job.js';

function makeJob(data: ApolloEnrichJobPayload): Job<ApolloEnrichJobPayload> {
  return {
    id: randomUUID(),
    name: 'apollo.enrich',
    data,
  } as Job<ApolloEnrichJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('handleApolloEnrichJob draft policy alignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMock.prisma.leadScorePrediction.findUnique.mockResolvedValue({
      blendedScore: 0.72,
    });
    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      email: null,
      phone: null,
      decisionMakerPhone: null,
      businessId: 'biz_1',
      deletedAt: null,
      status: 'qualified',
    });
    dbMock.prisma.business.findUnique.mockResolvedValue({
      websiteDomain: 'example.com',
    });
    dbMock.prisma.discoveryCostEvent.create.mockResolvedValue({
      id: 'cost_1',
    });
    dbMock.prisma.lead.updateMany.mockResolvedValue({
      count: 1,
    });
    pipelineSettingsMock.getEnrichmentThreshold.mockResolvedValue(0.5);
    pipelineSettingsMock.isProviderWithinBudget.mockResolvedValue(true);
    trackerMock.tryFinalizeDiscoveryRun.mockResolvedValue(undefined);
  });

  it('reveals contact data without auto-enqueueing message.generate', async () => {
    const enqueueMessageGenerate = vi.fn(async () => undefined);
    const searchContactsByDomain = vi.fn(async () => ({
      status: 'success' as const,
      contacts: [
        {
          email: 'ada@example.com',
          phone: null,
          firstName: 'Ada',
          lastName: 'Lovelace',
          title: 'Founder',
          companyName: 'Example Co',
        },
      ],
    }));

    await handleApolloEnrichJob(
      logger,
      makeJob({
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        scorePredictionId: 'score_1',
        runId: 'run_1',
        scoreBand: 'MEDIUM',
        apolloHasEmail: true,
        apolloHasDirectPhone: false,
      }),
      {
        apolloAdapter: {
          searchContactsByDomain,
          isConfigured: true,
        },
        enqueueMessageGenerate,
      },
    );

    expect(searchContactsByDomain).toHaveBeenCalledWith('example.com');
    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead_1',
        deletedAt: null,
        status: 'qualified',
      },
      data: { email: 'ada@example.com' },
    });
    expect(enqueueMessageGenerate).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('skips Apollo side effects for soft-deleted leads', async () => {
    const searchContactsByDomain = vi.fn(async () => ({
      status: 'success' as const,
      contacts: [],
    }));

    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      email: null,
      phone: null,
      decisionMakerPhone: null,
      businessId: 'biz_1',
      deletedAt: new Date('2026-03-20T12:00:00.000Z'),
      status: 'qualified',
    });

    await handleApolloEnrichJob(
      logger,
      makeJob({
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        scorePredictionId: 'score_1',
        runId: 'run_1',
        scoreBand: 'HIGH',
        apolloHasEmail: true,
        apolloHasDirectPhone: true,
      }),
      {
        apolloAdapter: {
          searchContactsByDomain,
          isConfigured: true,
        },
      },
    );

    expect(searchContactsByDomain).not.toHaveBeenCalled();
    expect(dbMock.prisma.discoveryCostEvent.create).not.toHaveBeenCalled();
    expect(dbMock.prisma.lead.updateMany).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('skips Apollo side effects for leads no longer in qualified status', async () => {
    const searchContactsByDomain = vi.fn(async () => ({
      status: 'success' as const,
      contacts: [],
    }));

    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      email: null,
      phone: null,
      decisionMakerPhone: null,
      businessId: 'biz_1',
      deletedAt: null,
      status: 'drafted',
    });

    await handleApolloEnrichJob(
      logger,
      makeJob({
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        scorePredictionId: 'score_1',
        runId: 'run_1',
        scoreBand: 'HIGH',
        apolloHasEmail: true,
        apolloHasDirectPhone: true,
      }),
      {
        apolloAdapter: {
          searchContactsByDomain,
          isConfigured: true,
        },
      },
    );

    expect(searchContactsByDomain).not.toHaveBeenCalled();
    expect(dbMock.prisma.discoveryCostEvent.create).not.toHaveBeenCalled();
    expect(dbMock.prisma.lead.updateMany).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('does not clobber later lead lifecycle state on a stale retry', async () => {
    const searchContactsByDomain = vi.fn(async () => ({
      status: 'success' as const,
      contacts: [
        {
          email: 'ada@example.com',
          phone: '15551234567',
          firstName: 'Ada',
          lastName: 'Lovelace',
          title: 'Founder',
          companyName: 'Example Co',
        },
      ],
    }));

    dbMock.prisma.lead.updateMany.mockResolvedValue({
      count: 0,
    });

    await handleApolloEnrichJob(
      logger,
      makeJob({
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        scorePredictionId: 'score_1',
        runId: 'run_1',
        scoreBand: 'HIGH',
        apolloHasEmail: true,
        apolloHasDirectPhone: true,
      }),
      {
        apolloAdapter: {
          searchContactsByDomain,
          isConfigured: true,
        },
      },
    );

    expect(searchContactsByDomain).toHaveBeenCalledWith('example.com');
    expect(dbMock.prisma.discoveryCostEvent.create).toHaveBeenCalledTimes(1);
    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead_1',
        deletedAt: null,
        status: 'qualified',
      },
      data: {
        email: 'ada@example.com',
        decisionMakerPhone: '15551234567',
        phone: '15551234567',
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead_1',
        revealedEmail: true,
        revealedPhone: true,
      }),
      'Skipped Apollo contact update to preserve downstream lifecycle state',
    );
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });
});

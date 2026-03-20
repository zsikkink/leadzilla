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
        update: vi.fn(),
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
    });
    dbMock.prisma.business.findUnique.mockResolvedValue({
      websiteDomain: 'example.com',
    });
    dbMock.prisma.discoveryCostEvent.create.mockResolvedValue({
      id: 'cost_1',
    });
    dbMock.prisma.lead.update.mockResolvedValue({
      id: 'lead_1',
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
    expect(dbMock.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead_1' },
      data: { email: 'ada@example.com' },
    });
    expect(enqueueMessageGenerate).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });
});

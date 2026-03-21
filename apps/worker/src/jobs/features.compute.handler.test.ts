import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      lead: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      icpProfile: {
        findUnique: vi.fn(),
      },
      leadDiscoveryRecord: {
        findFirst: vi.fn(),
      },
      leadEnrichmentRecord: {
        findFirst: vi.fn(),
      },
      qualificationRule: {
        findMany: vi.fn(),
      },
      business: {
        findUnique: vi.fn(),
      },
      businessConversion: {
        findFirst: vi.fn(),
      },
      leadFeatureSnapshot: {
        upsert: vi.fn(),
        findMany: vi.fn(),
      },
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
  toInputJson: (value: unknown) => value,
}));

import {
  handleFeaturesComputeJob,
  type FeaturesComputeJobPayload,
} from './features.compute.job.js';

function makeJob(data: FeaturesComputeJobPayload): Job<FeaturesComputeJobPayload> {
  return {
    id: randomUUID(),
    name: 'features.compute',
    data,
  } as Job<FeaturesComputeJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('handleFeaturesComputeJob primary business conversion anchoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      email: 'ada@primary.example',
      source: 'GOOGLE_PLACES_DISCOVERY',
      businessId: 'business_primary_1',
      decisionMakerPhone: null,
      deletedAt: null,
      status: 'new',
    });
    dbMock.prisma.lead.update.mockResolvedValue({ id: 'lead_1' });
    dbMock.prisma.icpProfile.findUnique.mockResolvedValue({
      id: 'icp_1',
      targetIndustries: [],
      targetCountries: [],
      metadataJson: {},
    });
    dbMock.prisma.leadDiscoveryRecord.findFirst.mockResolvedValue(null);
    dbMock.prisma.leadEnrichmentRecord.findFirst.mockResolvedValue(null);
    dbMock.prisma.qualificationRule.findMany.mockResolvedValue([]);
    dbMock.prisma.business.findUnique.mockResolvedValue({
      name: 'Primary Business',
      websiteDomain: 'primary.example',
      apifyWebsiteScrapeJson: null,
      apifyInstagramScrapeJson: null,
      websiteScrapedAt: null,
      instagramScrapedAt: null,
      countryCode: 'US',
      reviewCount: 0,
      hasWhatsapp: false,
      hasInstagram: false,
      followerCount: 0,
      physicalAddressPresent: false,
      recentActivity: false,
      category: 'Dental Clinic',
      instagramHandle: null,
    });
    dbMock.prisma.businessConversion.findFirst.mockResolvedValue({
      apolloContactJson: null,
      hunterContactJson: null,
      metadata: null,
      apolloHasDirectPhone: false,
    });
    dbMock.prisma.leadFeatureSnapshot.upsert.mockResolvedValue({ id: 'snapshot_1' });
    dbMock.prisma.leadFeatureSnapshot.findMany.mockResolvedValue([]);
  });

  it('loads BusinessConversion only from the lead primary business context', async () => {
    await handleFeaturesComputeJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        snapshotVersion: 1,
      }),
      {
        boss: {
          send: vi.fn(),
        },
        enqueueScoring: false,
      },
    );

    expect(dbMock.prisma.businessConversion.findFirst).toHaveBeenCalledWith({
      where: {
        leadId: 'lead_1',
        businessId: 'business_primary_1',
      },
      select: {
        apolloContactJson: true,
        hunterContactJson: true,
        metadata: true,
        apolloHasDirectPhone: true,
      },
      orderBy: { convertedAt: 'desc' },
    });
    expect(dbMock.prisma.leadFeatureSnapshot.upsert).toHaveBeenCalledTimes(1);
  });
});

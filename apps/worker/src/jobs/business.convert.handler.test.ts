import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, txMock, pipelineSettingsMock, trackerMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      $transaction: vi.fn(),
      jobExecution: {
        findUnique: vi.fn(),
      },
      business: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      discoveryCostEvent: {
        count: vi.fn(),
      },
      businessEvidence: {
        findFirst: vi.fn(),
      },
      contactRecoveryItem: {
        deleteMany: vi.fn(),
      },
      leadDiscoveryRecord: {
        upsert: vi.fn(),
      },
      leadEnrichmentRecord: {
        upsert: vi.fn(),
      },
    },
  },
  txMock: {
    lead: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    businessConversion: {
      create: vi.fn(),
    },
    businessContact: {
      createMany: vi.fn(),
    },
    discoveryCostEvent: {
      create: vi.fn(),
    },
  },
  pipelineSettingsMock: {
    isProviderWithinBudget: vi.fn(),
  },
  trackerMock: {
    tryFinalizeDiscoveryRun: vi.fn(),
    checkLeadTargetReached: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
  toInputJson: (value: unknown) => value,
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
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  isProviderWithinBudget: pipelineSettingsMock.isProviderWithinBudget,
}));

vi.mock('../utils/discovery-run-tracker.js', () => ({
  tryFinalizeDiscoveryRun: trackerMock.tryFinalizeDiscoveryRun,
  checkLeadTargetReached: trackerMock.checkLeadTargetReached,
}));

vi.mock('../utils/llm-extraction.js', () => ({
  adjudicateDecisionMakerCandidates: vi.fn(),
  extractDecisionMakers: vi.fn(),
}));

import {
  handleBusinessConvertJob,
  type BusinessConvertJobDependencies,
  type BusinessConvertJobPayload,
} from './business.convert.job.js';

function makeJob(data: BusinessConvertJobPayload): Job<BusinessConvertJobPayload> {
  return {
    id: randomUUID(),
    name: 'business.convert',
    data,
  } as Job<BusinessConvertJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeDeps(enqueueFeaturesCompute = vi.fn()): BusinessConvertJobDependencies {
  return {
    apolloAdapter: {
      isConfigured: false,
      searchContactsByDomain: vi.fn(),
    },
    hunterAdapter: {
      isConfigured: true,
      searchDomainContacts: vi.fn(async () => ({
        status: 'success' as const,
        contacts: [
          {
            email: 'ada@acme.example',
            firstName: 'Ada',
            lastName: 'Lovelace',
            position: 'Founder',
            type: 'personal' as const,
            confidence: 91,
            verification: 'valid',
          },
        ],
      })),
    },
    websiteScraperAdapter: {
      isConfigured: true,
      scrapeWebsite: vi.fn(),
    },
    instagramScraperAdapter: {
      isConfigured: false,
      scrapeProfile: vi.fn(),
    },
    smtpVerifier: {
      isConfigured: false,
      verify: vi.fn(),
    },
    enqueueFeaturesCompute,
  };
}

describe('handleBusinessConvertJob reused-lead terminalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMock.prisma.jobExecution.findUnique.mockResolvedValue(null);
    dbMock.prisma.business.findUnique.mockResolvedValue({
      id: 'business_1',
      name: 'Acme Dental',
      websiteDomain: 'acme.example',
      instagramHandle: null,
      phoneE164: null,
      reviewCount: 42,
      address: '123 Main St',
      city: 'New York',
      countryCode: 'US',
      category: 'Dental Clinic',
      apifyWebsiteScrapeJson: {
        paymentWidgets: [],
        hasShopify: false,
        platform: null,
        hasBookingForm: false,
        hasPricingTiers: false,
        hasProductCatalog: false,
        hasWhatsApp: false,
        detectedPlatforms: [],
        decisionMakers: [
          {
            name: 'Ada Lovelace',
            title: 'Founder',
            email: null,
            phone: null,
            linkedinUrl: 'https://linkedin.com/in/ada-lovelace',
            seniority: 'executive',
            positionRank: 1,
            source: 'about_page',
          },
        ],
        contactInfo: {
          emails: [],
          phones: [],
          addresses: [],
        },
        socialLinks: [],
        technologies: {
          analytics: [],
          crm: [],
          liveChat: [],
          emailMarketing: [],
          ecommerce: [],
          payments: [],
          cssFrameworks: [],
          hosting: [],
        },
        businessSignals: {
          estimatedEmployeeCount: 12,
          certifications: [],
          hasClientLogos: false,
          hasTestimonials: false,
          hasCaseStudies: false,
        },
        aboutPageText: 'Ada Lovelace founded Acme Dental and leads operations.',
        pagesCrawled: 2,
        crawlDurationMs: 120,
      },
      apifyInstagramScrapeJson: null,
      websiteScrapedAt: new Date(),
      instagramScrapedAt: null,
      deterministicScore: 0.82,
      scoreBand: 'HIGH',
      preQualified: true,
    });
    dbMock.prisma.discoveryCostEvent.count.mockResolvedValue(0);
    dbMock.prisma.businessEvidence.findFirst.mockResolvedValue({
      id: 'evidence_1',
      sourceType: 'SERPAPI_GOOGLE_PLACES',
      serpapiResultId: 'serp_1',
      rawJson: { title: 'Acme Dental' },
      createdAt: new Date('2026-03-20T12:00:00.000Z'),
      searchTask: {
        id: 'task_1',
        taskType: 'GOOGLE_MAPS_SEARCH',
        queryHash: 'query_hash_1',
        paramsJson: {
          provider: 'SERPAPI',
        },
      },
    });
    dbMock.prisma.contactRecoveryItem.deleteMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.leadDiscoveryRecord.upsert.mockResolvedValue({ id: 'discovery_record_1' });
    dbMock.prisma.leadEnrichmentRecord.upsert.mockResolvedValue({ id: 'enrichment_record_1' });
    dbMock.prisma.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock));

    txMock.lead.findFirst.mockResolvedValue({
      id: 'lead_existing_1',
      deletedAt: null,
    });
    txMock.lead.create.mockResolvedValue({ id: 'lead_new_1' });
    txMock.businessConversion.create.mockResolvedValue({ id: 'conversion_1' });
    txMock.businessContact.createMany.mockResolvedValue({ count: 2 });
    txMock.discoveryCostEvent.create.mockResolvedValue({ id: 'cost_1' });

    pipelineSettingsMock.isProviderWithinBudget.mockResolvedValue(true);
    trackerMock.tryFinalizeDiscoveryRun.mockResolvedValue(undefined);
    trackerMock.checkLeadTargetReached.mockResolvedValue(false);
  });

  it('keeps reused leads terminal by skipping downstream lineage writes', async () => {
    const enqueueFeaturesCompute = vi.fn();

    await handleBusinessConvertJob(
      logger,
      makeJob({
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
      }),
      makeDeps(enqueueFeaturesCompute),
    );

    expect(txMock.businessConversion.create).toHaveBeenCalledTimes(1);
    expect(txMock.businessContact.createMany).toHaveBeenCalledTimes(1);
    expect(dbMock.prisma.contactRecoveryItem.deleteMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business_1',
        icpProfileId: 'icp_1',
      },
    });
    expect(dbMock.prisma.leadDiscoveryRecord.upsert).not.toHaveBeenCalled();
    expect(dbMock.prisma.leadEnrichmentRecord.upsert).not.toHaveBeenCalled();
    expect(enqueueFeaturesCompute).not.toHaveBeenCalled();
    expect(trackerMock.checkLeadTargetReached).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'business_1',
        leadId: 'lead_existing_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
      }),
      'Existing lead reuse remains terminal for automated downstream progression; skipping pipeline lineage records',
    );
  });

  it('treats a soft-deleted same-email lead as an explicit terminal collision', async () => {
    const enqueueFeaturesCompute = vi.fn();
    txMock.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_deleted_1',
      deletedAt: new Date('2026-03-19T10:00:00.000Z'),
    });

    await handleBusinessConvertJob(
      logger,
      makeJob({
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
      }),
      makeDeps(enqueueFeaturesCompute),
    );

    expect(txMock.businessConversion.create).not.toHaveBeenCalled();
    expect(txMock.lead.create).not.toHaveBeenCalled();
    expect(txMock.businessContact.createMany).toHaveBeenCalledTimes(1);
    expect(dbMock.prisma.business.update).toHaveBeenCalledWith({
      where: { id: 'business_1' },
      data: {
        preQualified: false,
        disqualificationReason: 'SOFT_DELETED_LEAD_EMAIL_CONFLICT',
      },
    });
    expect(dbMock.prisma.contactRecoveryItem.deleteMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business_1',
        icpProfileId: 'icp_1',
      },
    });
    expect(dbMock.prisma.leadDiscoveryRecord.upsert).not.toHaveBeenCalled();
    expect(dbMock.prisma.leadEnrichmentRecord.upsert).not.toHaveBeenCalled();
    expect(enqueueFeaturesCompute).not.toHaveBeenCalled();
    expect(trackerMock.checkLeadTargetReached).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'business_1',
        softDeletedLeadId: 'lead_deleted_1',
        email: 'ada@acme.example',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
      }),
      'Lead with this email is soft-deleted — treating convert as terminal',
    );
  });
});

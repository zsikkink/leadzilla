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
      lead: {
        findFirst: vi.fn(),
      },
      businessConversion: {
        findFirst: vi.fn(),
      },
      discoveryAttributionAssignment: {
        updateMany: vi.fn(),
      },
      contactRecoveryItem: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
      leadDiscoveryRecord: {
        upsert: vi.fn(),
      },
      leadEnrichmentRecord: {
        upsert: vi.fn(),
      },
      messageDraft: {
        findFirst: vi.fn(),
      },
      leadScorePrediction: {
        findFirst: vi.fn(),
      },
    },
  },
  txMock: {
    jobExecution: {
      create: vi.fn(),
    },
    outboxEvent: {
      create: vi.fn(),
    },
    lead: {
      findMany: vi.fn(),
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
    getScoreQualificationThreshold: vi.fn(),
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
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  isProviderWithinBudget: pipelineSettingsMock.isProviderWithinBudget,
  getScoreQualificationThreshold: pipelineSettingsMock.getScoreQualificationThreshold,
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

describe('handleBusinessConvertJob features handoff behavior', () => {
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
      discoveryRunId: 'run_old',
      preQualified: true,
    });
    // F4: Cross-run domain dedup — no prior lead by default (allow processing)
    dbMock.prisma.lead.findFirst.mockResolvedValue(null);
    // F2: Cross-run Apollo cache — no cached conversion by default
    dbMock.prisma.businessConversion.findFirst.mockResolvedValue(null);
    // F1: Pre-score threshold default
    pipelineSettingsMock.getScoreQualificationThreshold.mockResolvedValue(0.4);
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
    dbMock.prisma.discoveryAttributionAssignment.updateMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.contactRecoveryItem.findUnique.mockResolvedValue(null);
    dbMock.prisma.contactRecoveryItem.upsert.mockResolvedValue({ id: 'recovery_1' });
    dbMock.prisma.contactRecoveryItem.deleteMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.leadEnrichmentRecord.upsert.mockResolvedValue({ id: 'enrichment_record_1' });
    dbMock.prisma.messageDraft.findFirst.mockResolvedValue(null);
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue(null);
    dbMock.prisma.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock));

    txMock.lead.findMany.mockResolvedValue([
      {
        id: 'lead_existing_1',
        businessId: 'business_1',
      },
    ]);
    txMock.lead.findFirst.mockResolvedValue({
      id: 'lead_existing_1',
      deletedAt: null,
      businessId: 'business_1',
    });
    txMock.lead.create.mockResolvedValue({ id: 'lead_new_1', businessId: 'business_1' });
    txMock.jobExecution.create.mockResolvedValue({ id: 'features_run_1' });
    txMock.outboxEvent.create.mockResolvedValue({ id: 'outbox_1' });
    txMock.businessConversion.create.mockResolvedValue({ id: 'conversion_1' });
    txMock.businessContact.createMany.mockResolvedValue({ count: 2 });
    txMock.discoveryCostEvent.create.mockResolvedValue({ id: 'cost_1' });

    pipelineSettingsMock.isProviderWithinBudget.mockResolvedValue(true);
    trackerMock.tryFinalizeDiscoveryRun.mockResolvedValue(undefined);
    trackerMock.checkLeadTargetReached.mockResolvedValue(false);
  });

  it('persists a durable features.compute handoff inside the new-lead transaction', async () => {
    const enqueueFeaturesCompute = vi.fn();
    txMock.lead.findFirst.mockResolvedValueOnce(null);

    await handleBusinessConvertJob(
      logger,
      makeJob({
        businessId: 'business_1',
        discoveryRunId: 'run_old',
        icpProfileId: 'icp_1',
        correlationId: 'corr_1',
      }),
      makeDeps(enqueueFeaturesCompute),
    );

    expect(txMock.lead.create).toHaveBeenCalledTimes(1);
    expect(txMock.jobExecution.create).toHaveBeenCalledWith({
      data: {
        type: 'features.compute',
        status: 'queued',
        payload: {
          leadId: 'lead_new_1',
          icpProfileId: 'icp_1',
          snapshotVersion: 1,
          correlationId: 'corr_1',
        },
        leadId: 'lead_new_1',
      },
      select: { id: true },
    });
    expect(txMock.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        type: 'features.compute',
        payload: {
          leadId: 'lead_new_1',
          icpProfileId: 'icp_1',
          snapshotVersion: 1,
          runId: 'features_run_1',
          correlationId: 'corr_1',
        },
        status: 'pending',
      },
      select: { id: true },
    });
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business_1',
        discoveryRunId: 'run_old',
        icpProfileId: 'icp_1',
        primaryOutcomeCode: null,
      },
      data: {
        primaryOutcomeCode: 'LEAD_CREATED',
        primaryOutcomeAt: expect.any(Date),
      },
    });
    expect(enqueueFeaturesCompute).not.toHaveBeenCalled();
    expect(trackerMock.checkLeadTargetReached).toHaveBeenCalledWith('run_old', logger);
    expect(trackerMock.tryFinalizeDiscoveryRun).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'business_1',
        leadId: 'lead_new_1',
        discoveryRunId: 'run_old',
        icpProfileId: 'icp_1',
        featuresComputeRunId: 'features_run_1',
        outboxEventId: 'outbox_1',
      }),
      'Persisted durable features.compute handoff for newly created lead',
    );
  });

  it('does not create a second durable handoff when business.convert replays the same new-lead outcome', async () => {
    const enqueueFeaturesCompute = vi.fn();
    dbMock.prisma.discoveryAttributionAssignment.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    txMock.lead.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'lead_new_1',
        deletedAt: null,
        businessId: 'business_1',
      });

    const replayPayload = {
      businessId: 'business_1',
      discoveryRunId: 'run_old',
      icpProfileId: 'icp_1',
      correlationId: 'corr_1',
    } satisfies BusinessConvertJobPayload;

    await handleBusinessConvertJob(logger, makeJob(replayPayload), makeDeps(enqueueFeaturesCompute));
    await handleBusinessConvertJob(logger, makeJob(replayPayload), makeDeps(enqueueFeaturesCompute));

    expect(txMock.jobExecution.create).toHaveBeenCalledTimes(1);
    expect(txMock.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).toHaveBeenCalledTimes(2);
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        businessId: 'business_1',
        discoveryRunId: 'run_old',
        icpProfileId: 'icp_1',
        primaryOutcomeCode: null,
      },
      data: {
        primaryOutcomeCode: 'LEAD_CREATED',
        primaryOutcomeAt: expect.any(Date),
      },
    });
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        businessId: 'business_1',
        discoveryRunId: 'run_old',
        icpProfileId: 'icp_1',
        primaryOutcomeCode: null,
      },
      data: {
        primaryOutcomeCode: 'LEAD_CREATED',
        primaryOutcomeAt: expect.any(Date),
      },
    });
    expect(enqueueFeaturesCompute).toHaveBeenCalledTimes(1);
    expect(enqueueFeaturesCompute).toHaveBeenCalledWith({
      runId: 'run_old',
      leadId: 'lead_new_1',
      icpProfileId: 'icp_1',
      snapshotVersion: 1,
      correlationId: 'corr_1',
    });
  });

  it('writes RECOVERY_OPENED to the attribution row when convert opens contact recovery', async () => {
    dbMock.prisma.business.findUnique.mockResolvedValueOnce({
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
        decisionMakers: [],
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
        aboutPageText: 'Acme Dental serves New York.',
        pagesCrawled: 2,
        crawlDurationMs: 120,
      },
      apifyInstagramScrapeJson: null,
      websiteScrapedAt: new Date(),
      instagramScrapedAt: null,
      deterministicScore: 0.82,
      scoreBand: 'HIGH',
      discoveryRunId: 'run_old',
      preQualified: true,
    });

    await handleBusinessConvertJob(
      logger,
      makeJob({
        businessId: 'business_1',
        discoveryRunId: 'run_old',
        icpProfileId: 'icp_1',
      }),
      {
        ...makeDeps(),
        hunterAdapter: {
          isConfigured: false,
          searchDomainContacts: vi.fn(),
        },
      },
    );

    expect(dbMock.prisma.contactRecoveryItem.upsert).toHaveBeenCalledTimes(1);
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business_1',
        discoveryRunId: 'run_old',
        icpProfileId: 'icp_1',
        primaryOutcomeCode: null,
      },
      data: {
        primaryOutcomeCode: 'RECOVERY_OPENED',
        primaryOutcomeAt: expect.any(Date),
      },
    });
    expect(txMock.lead.create).not.toHaveBeenCalled();
  });

  it('restores current ICP lineage and re-enters features when a reused lead lacks a current ICP score', async () => {
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
    expect(dbMock.prisma.messageDraft.findFirst).toHaveBeenCalledWith({
      where: { leadId: 'lead_existing_1', icpProfileId: 'icp_1' },
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(dbMock.prisma.leadScorePrediction.findFirst).toHaveBeenCalledWith({
      where: { leadId: 'lead_existing_1', icpProfileId: 'icp_1' },
      select: { id: true },
      orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
    });
    expect(dbMock.prisma.leadDiscoveryRecord.upsert).not.toHaveBeenCalled();
    expect(dbMock.prisma.leadEnrichmentRecord.upsert).not.toHaveBeenCalled();
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        primaryOutcomeCode: null,
      },
      data: {
        primaryOutcomeCode: 'EXISTING_SAME_BUSINESS_LEAD_REUSED',
        primaryOutcomeAt: expect.any(Date),
      },
    });
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).not.toHaveBeenCalledWith({
      where: {
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        primaryOutcomeCode: null,
      },
      data: {
        primaryOutcomeCode: 'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
        primaryOutcomeAt: expect.any(Date),
      },
    });
    expect(enqueueFeaturesCompute).toHaveBeenCalledWith({
      runId: 'run_1',
      leadId: 'lead_existing_1',
      icpProfileId: 'icp_1',
      snapshotVersion: 1,
      correlationId: expect.any(String),
    });
    expect(trackerMock.checkLeadTargetReached).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'business_1',
        leadId: 'lead_existing_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
      }),
      'Existing business rediscovery re-entered shared features.compute for the single active same-business lead',
    );
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith(
      'run_1',
      logger,
      expect.objectContaining({ excludeActiveJobId: expect.any(String) }),
    );
  });

  it('treats same-ICP rediscovery as an explicit already-known no-op when a score already exists', async () => {
    const enqueueFeaturesCompute = vi.fn();
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValueOnce({
      id: 'score_existing_1',
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

    expect(dbMock.prisma.leadDiscoveryRecord.upsert).not.toHaveBeenCalled();
    expect(enqueueFeaturesCompute).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'business_1',
        leadId: 'lead_existing_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        scorePredictionId: 'score_existing_1',
        messageDraftId: null,
      }),
      'Existing business rediscovery already has current ICP downstream state; treating it as an explicit already-known no-op',
    );
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith(
      'run_1',
      logger,
      expect.objectContaining({ excludeActiveJobId: expect.any(String) }),
    );
  });

  it('writes the no-unique-same-business outcome when existing-business rediscovery finds zero active same-business leads', async () => {
    const enqueueFeaturesCompute = vi.fn();
    txMock.lead.findMany.mockResolvedValueOnce([]);

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
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        primaryOutcomeCode: null,
      },
      data: {
        primaryOutcomeCode: 'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
        primaryOutcomeAt: expect.any(Date),
      },
    });
    expect(enqueueFeaturesCompute).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        sameBusinessLeadCount: 0,
      }),
      'Existing business rediscovery is terminal because it does not map to exactly one active same-business lead',
    );
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith(
      'run_1',
      logger,
      expect.objectContaining({ excludeActiveJobId: expect.any(String) }),
    );
  });

  it('writes the no-unique-same-business outcome when existing-business rediscovery finds multiple active same-business leads', async () => {
    const enqueueFeaturesCompute = vi.fn();
    txMock.lead.findMany.mockResolvedValueOnce([
      { id: 'lead_existing_1', businessId: 'business_1' },
      { id: 'lead_existing_2', businessId: 'business_1' },
    ]);

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
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        primaryOutcomeCode: null,
      },
      data: {
        primaryOutcomeCode: 'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
        primaryOutcomeAt: expect.any(Date),
      },
    });
    expect(enqueueFeaturesCompute).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'business_1',
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        sameBusinessLeadCount: 2,
      }),
      'Existing business rediscovery is terminal because it does not map to exactly one active same-business lead',
    );
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith(
      'run_1',
      logger,
      expect.objectContaining({ excludeActiveJobId: expect.any(String) }),
    );
  });

  it('treats a soft-deleted same-email lead as an explicit terminal collision', async () => {
    const enqueueFeaturesCompute = vi.fn();
    dbMock.prisma.business.findUnique.mockResolvedValueOnce({
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
        decisionMakers: [],
        contactInfo: { emails: [], phones: [], addresses: [] },
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
      discoveryRunId: 'run_1',
      preQualified: true,
    });
    txMock.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_deleted_1',
      deletedAt: new Date('2026-03-19T10:00:00.000Z'),
      businessId: 'business_1',
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
    expect(dbMock.prisma.discoveryAttributionAssignment.updateMany).not.toHaveBeenCalled();
    expect(dbMock.prisma.leadDiscoveryRecord.upsert).not.toHaveBeenCalled();
    expect(dbMock.prisma.leadEnrichmentRecord.upsert).not.toHaveBeenCalled();
    expect(enqueueFeaturesCompute).not.toHaveBeenCalled();
    expect(trackerMock.checkLeadTargetReached).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith(
      'run_1',
      logger,
      expect.objectContaining({ excludeActiveJobId: expect.any(String) }),
    );
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

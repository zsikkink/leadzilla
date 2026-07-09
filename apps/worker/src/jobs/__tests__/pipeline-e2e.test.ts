/**
 * Full-lifecycle pipeline integration test
 *
 * Runs the durable Leadzilla demo pipeline stages in sequence against a real
 * PostgreSQL database with mocked OpenAI calls.
 *
 * Pipeline under test:
 *   features → scoring → message.generate
 *   → outbound delivery remains disabled → analytics rollup
 */
import { randomUUID } from 'node:crypto';

import { type Prisma, prisma } from '@lead-flood/db';
import { OpenAiAdapter } from '@lead-flood/providers';
import type { Job } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFeaturesComputeJob, type FeaturesComputeJobPayload, type FeaturesComputeDependencies } from '../features.compute.job.js';
import { handleScoringComputeJob, type ScoringComputeJobPayload, type ScoringComputeJobDependencies } from '../scoring.compute.job.js';
import { handleMessageGenerateJob, type MessageGenerateJobPayload, type MessageGenerateJobDependencies } from '../message.generate.job.js';
import { handleAnalyticsRollupJob, type AnalyticsRollupJobPayload } from '../analytics.rollup.job.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PREFIX = `e2e-pipeline-${Date.now()}`;

function makeJob<T>(data: T, name = 'test'): Job<T> {
  return {
    id: randomUUID(),
    name,
    data,
    priority: 0,
    state: 'active',
    retrylimit: 0,
    retrycount: 0,
    retrydelay: 0,
    retrybackoff: false,
    startafter: new Date(),
    startedon: new Date(),
    singletonkey: null,
    singletonon: null,
    expirein: { hours: 1 },
    createdon: new Date(),
    completedon: null,
    keepuntil: new Date(Date.now() + 86_400_000),
    on_complete: false,
    output: null,
    deadletter: null,
  } as unknown as Job<T>;
}

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const bossSendSpy = vi.fn().mockResolvedValue(undefined);
const mockBoss = { send: bossSendSpy };

// ---------------------------------------------------------------------------
// Mock fetch factories
// ---------------------------------------------------------------------------

function makeOpenAiGenerateFetch(): typeof fetch {
  // Return a fresh Response per call to avoid "Body has already been read" errors
  // when message validation triggers a retry with stricter prompt.
  // Bodies must be >= 100 chars to pass EMAIL channel minimum length validation.
  const bodyA = [
    'Hi Pipeline,',
    '',
    'I’m reaching out from Leadzilla. We help businesses turn customer messages into paid, trackable orders. When a customer asks about a product, your team can send a cart, collect payment, and track the sale from the same conversation.',
    '',
    'For Leadzilla Test Corp, that can make customer follow-up and payment status easier to manage from one place. Would it be useful to compare this with how your team handles customer conversations today?',
    '',
    'Best,',
    'Leadzilla Team',
  ].join('\n');
  const ctaA = 'Would it be useful to compare this with how your team handles customer conversations today?';
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  message: {
                    subject: 'Test Email Subject A',
                    bodyText: bodyA,
                    bodyHtml: `<p>${bodyA}</p>`,
                    ctaText: ctaA,
                  },
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  ) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Adapter factories
// ---------------------------------------------------------------------------

function makeOpenAiGenerateAdapter(): OpenAiAdapter {
  return new OpenAiAdapter({
    apiKey: 'test-openai-key',
    fetchImpl: makeOpenAiGenerateFetch(),
  });
}

// ---------------------------------------------------------------------------
// Seed data IDs
// ---------------------------------------------------------------------------

const LEAD_EMAIL = `${TEST_PREFIX}@leadzilla.test`;
const ICP_ID = randomUUID();
const LEAD_ID = randomUUID();
const DISCOVERY_RECORD_ID = randomUUID();
const RUN_ID = `pipeline-e2e-${randomUUID()}`;
const TODAY = new Date().toISOString().slice(0, 10);

// Feature list for ICP — used to verify draft positioning.
const ICP_FEATURES = ['Payment Links', 'WhatsApp Commerce', 'Order Management', 'Custom Storefronts'];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('pipeline full lifecycle', () => {
  beforeAll(async () => {
    // Seed IcpProfile with feature list
    await prisma.icpProfile.create({
      data: {
        id: ICP_ID,
        name: `${TEST_PREFIX} ICP`,
        qualificationLogic: 'WEIGHTED',
        targetIndustries: ['Financial Services', 'Technology'],
        targetCountries: ['AE', 'SA'],
        isActive: true,
        featureList: JSON.parse(JSON.stringify(ICP_FEATURES)) as Prisma.InputJsonValue,
      },
    });

    // Seed Lead (pre-populated with phone that business.convert provides in new pipeline)
    await prisma.lead.create({
      data: {
        id: LEAD_ID,
        firstName: 'Pipeline',
        lastName: 'Tester',
        email: LEAD_EMAIL,
        phone: '+971501234567',
        source: 'e2e-test',
        status: 'new',
      },
    });

    // Seed auto-approve pipeline settings (ON, score range 0-1)
    await prisma.pipelineSetting.upsert({
      where: { key: 'auto_approve_enabled' },
      create: { key: 'auto_approve_enabled', valueJson: true },
      update: { valueJson: true },
    });
    await prisma.pipelineSetting.upsert({
      where: { key: 'auto_approve_score_min' },
      create: { key: 'auto_approve_score_min', valueJson: 0 },
      update: { valueJson: 0 },
    });
    await prisma.pipelineSetting.upsert({
      where: { key: 'auto_approve_score_max' },
      create: { key: 'auto_approve_score_max', valueJson: 1 },
      update: { valueJson: 1 },
    });
    await prisma.pipelineSetting.upsert({
      where: { key: 'scoreQualificationThreshold' },
      create: { key: 'scoreQualificationThreshold', valueJson: 0.4 },
      update: { valueJson: 0.4 },
    });

    // Seed LeadDiscoveryRecord (simulates discovery pipeline output)
    await prisma.leadDiscoveryRecord.create({
      data: {
        id: DISCOVERY_RECORD_ID,
        leadId: LEAD_ID,
        icpProfileId: ICP_ID,
        provider: 'APOLLO',
        providerRecordId: `apollo-e2e-${TEST_PREFIX}`,
        queryHash: `e2e-${TEST_PREFIX}`,
        status: 'DISCOVERED',
        rawPayload: {
          source: 'e2e-test',
          companyName: 'Leadzilla Test Corp',
          industry: 'Financial Services',
          country: 'AE',
        },
        discoveredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    await prisma.analyticsDailyRollup.deleteMany({
      where: { icpProfileId: ICP_ID },
    });
    await prisma.feedbackEvent.deleteMany({
      where: { leadId: LEAD_ID },
    });
    await prisma.messageSend.deleteMany({
      where: { leadId: LEAD_ID },
    });
    await prisma.messageVariant.deleteMany({
      where: { messageDraft: { leadId: LEAD_ID } },
    });
    await prisma.messageDraft.deleteMany({
      where: { leadId: LEAD_ID },
    });
    await prisma.trainingLabel.deleteMany({
      where: { leadId: LEAD_ID },
    });
    await prisma.leadScorePrediction.deleteMany({
      where: { leadId: LEAD_ID },
    });
    await prisma.leadFeatureSnapshot.deleteMany({
      where: { leadId: LEAD_ID },
    });
    await prisma.leadEnrichmentRecord.deleteMany({
      where: { leadId: LEAD_ID },
    });
    await prisma.jobExecution.deleteMany({
      where: { leadId: LEAD_ID },
    });
    await prisma.leadDiscoveryRecord.deleteMany({
      where: { leadId: LEAD_ID },
    });
    await prisma.lead.deleteMany({
      where: { id: LEAD_ID },
    });
    await prisma.icpProfile.deleteMany({
      where: { id: ICP_ID },
    });
    await prisma.pipelineSetting.deleteMany({
      where: { key: { in: ['auto_approve_enabled', 'auto_approve_score_min', 'auto_approve_score_max'] } },
    });
  });

  // -----------------------------------------------------------------------
  // Stage 1: Feature extraction (directly from pre-seeded lead)
  // -----------------------------------------------------------------------
  it('stage 1: features.compute extracts feature vector', async () => {
    bossSendSpy.mockClear();

    const payload: FeaturesComputeJobPayload = {
      runId: RUN_ID,
      leadId: LEAD_ID,
      icpProfileId: ICP_ID,
      snapshotVersion: 1,
      sourceVersion: 'features_v1',
      correlationId: `corr-${RUN_ID}`,
    };

    const deps: FeaturesComputeDependencies = {
      boss: mockBoss,
      enqueueScoring: false,
    };

    await handleFeaturesComputeJob(noopLogger, makeJob(payload, 'features.compute'), deps);

    const snapshot = await prisma.leadFeatureSnapshot.findFirst({
      where: { leadId: LEAD_ID, icpProfileId: ICP_ID },
    });
    expect(snapshot).toBeTruthy();
    expect(snapshot!.featuresJson).toBeTruthy();

    const features = snapshot!.featuresJson as Record<string, unknown>;
    expect(features.has_email).toBe(true);
    expect(features.has_company_name).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Stage 3: Scoring
  // -----------------------------------------------------------------------
  it('stage 2: scoring.compute produces a score prediction', async () => {
    bossSendSpy.mockClear();

    const payload: ScoringComputeJobPayload = {
      runId: `scoring-${RUN_ID}`,
      mode: 'BY_LEAD_IDS',
      icpProfileId: ICP_ID,
      leadIds: [LEAD_ID],
      correlationId: `corr-${RUN_ID}`,
    };

    const deps: ScoringComputeJobDependencies = {
      deterministicWeight: 1.0,
      aiWeight: 0.0,
    };

    await handleScoringComputeJob(noopLogger, makeJob(payload, 'scoring.compute'), deps);

    const prediction = await prisma.leadScorePrediction.findFirst({
      where: { leadId: LEAD_ID, icpProfileId: ICP_ID },
    });
    expect(prediction).toBeTruthy();
    expect(prediction!.blendedScore).toBeGreaterThanOrEqual(0);
    expect(prediction!.blendedScore).toBeLessThanOrEqual(100);
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(prediction!.scoreBand);
  });

  // -----------------------------------------------------------------------
  // Stage 4: Message generation (initial outreach)
  // -----------------------------------------------------------------------
  it('stage 3: message.generate creates initial draft + auto-approved variants', async () => {
    bossSendSpy.mockClear();

    const payload: MessageGenerateJobPayload = {
      runId: `msggen-${RUN_ID}`,
      leadId: LEAD_ID,
      icpProfileId: ICP_ID,
      knowledgeEntryIds: [],
      promptVersion: 'v1',
      channel: 'EMAIL',
      correlationId: `corr-${RUN_ID}`,
    };

    const deps: MessageGenerateJobDependencies = {
      openAiAdapter: makeOpenAiGenerateAdapter(),
      boss: mockBoss,
    };

    await handleMessageGenerateJob(noopLogger, makeJob(payload, 'message.generate'), deps);

    const draft = await prisma.messageDraft.findFirst({
      where: { leadId: LEAD_ID, icpProfileId: ICP_ID, followUpNumber: 0 },
      include: { variants: true },
    });
    expect(draft).toBeTruthy();
    expect(draft!.approvalStatus).toBe('AUTO_APPROVED');
    expect(draft!.variants.length).toBe(1);
    expect(draft!.pitchedFeature).toBe(ICP_FEATURES[0]); // 'Payment Links'

    // Auto-approved drafts are retained for review in the Leadzilla demo, but
    // outbound delivery is disabled and no MessageSend is created or enqueued.
    const send = await prisma.messageSend.findFirst({
      where: { leadId: LEAD_ID, messageDraftId: draft!.id },
    });
    expect(send).toBeNull();

    const sendCall = bossSendSpy.mock.calls.find(
      (c: unknown[]) => c[0] === 'message.send',
    );
    expect(sendCall).toBeUndefined();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: LEAD_ID } });
    expect(lead.status).toBe('drafted');
  });

  // -----------------------------------------------------------------------
  // Stage 4: Demo outbound safety boundary
  // -----------------------------------------------------------------------
  it('stage 4: does not create sends, follow-ups, replies, or notifications while outbound is disabled', async () => {
    const sends = await prisma.messageSend.findMany({
      where: { leadId: LEAD_ID },
    });
    expect(sends.length).toBe(0);

    const feedback = await prisma.feedbackEvent.findMany({
      where: { leadId: LEAD_ID },
    });
    expect(feedback.length).toBe(0);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: LEAD_ID } });
    expect(lead.status).toBe('drafted');

    const sendCalls = bossSendSpy.mock.calls.filter((c: unknown[]) => c[0] === 'message.send');
    const followUpCalls = bossSendSpy.mock.calls.filter((c: unknown[]) => c[0] === 'followup.check');
    const notifyCalls = bossSendSpy.mock.calls.filter((c: unknown[]) => c[0] === 'notify.sales');
    expect(sendCalls.length).toBe(0);
    expect(followUpCalls.length).toBe(0);
    expect(notifyCalls.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Stage 5: Analytics rollup
  // -----------------------------------------------------------------------
  it('stage 5: analytics.rollup aggregates daily metrics', async () => {
    const payload: AnalyticsRollupJobPayload = {
      runId: `analytics-${RUN_ID}`,
      day: TODAY,
      icpProfileId: ICP_ID,
      fullRecompute: false,
      correlationId: `corr-${RUN_ID}`,
    };

    await handleAnalyticsRollupJob(noopLogger, makeJob(payload, 'analytics.rollup'));

    const rollup = await prisma.analyticsDailyRollup.findFirst({
      where: { icpProfileId: ICP_ID },
    });
    expect(rollup).toBeTruthy();
    expect(rollup!.discoveredCount).toBeGreaterThanOrEqual(1);
    // enrichedCount is 0 in new pipeline (enrichment.run removed)
    expect(rollup!.scoredCount).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Final: complete lifecycle verification
  // -----------------------------------------------------------------------
  it('final: durable demo artifacts exist without delivery side effects', async () => {
    // Lead should remain drafted because delivery is disabled.
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: LEAD_ID } });
    expect(lead.status).toBe('drafted');

    // Discovery record
    const discovery = await prisma.leadDiscoveryRecord.findMany({ where: { leadId: LEAD_ID } });
    expect(discovery.length).toBeGreaterThanOrEqual(1);

    // Feature snapshot
    const features = await prisma.leadFeatureSnapshot.findMany({
      where: { leadId: LEAD_ID, icpProfileId: ICP_ID },
    });
    expect(features.length).toBeGreaterThanOrEqual(1);

    // Score prediction
    const scores = await prisma.leadScorePrediction.findMany({
      where: { leadId: LEAD_ID, icpProfileId: ICP_ID },
    });
    expect(scores.length).toBeGreaterThanOrEqual(1);

    // 1 message draft: initial auto-approved draft retained for review.
    const drafts = await prisma.messageDraft.findMany({
      where: { leadId: LEAD_ID },
      orderBy: { followUpNumber: 'asc' },
    });
    expect(drafts.length).toBe(1);
    expect(drafts.map((d) => d.followUpNumber)).toEqual([0]);
    expect(drafts[0]!.approvalStatus).toBe('AUTO_APPROVED');

    // Verify feature positioning on the initial draft.
    const pitchedFeatures = drafts.map((d) => d.pitchedFeature);
    expect(pitchedFeatures[0]).toBe('Payment Links');

    // No MessageSend rows are created while outbound delivery is disabled.
    const sends = await prisma.messageSend.findMany({
      where: { leadId: LEAD_ID },
      orderBy: { followUpNumber: 'asc' },
    });
    expect(sends.length).toBe(0);

    // No pending follow-ups
    const pendingFollowups = await prisma.messageSend.findMany({
      where: { leadId: LEAD_ID, nextFollowUpAfter: { not: null } },
    });
    expect(pendingFollowups.length).toBe(0);

    // No reply feedback is produced because no provider delivery occurs.
    const feedback = await prisma.feedbackEvent.findMany({
      where: { leadId: LEAD_ID },
    });
    expect(feedback.length).toBe(0);

    // Analytics rollup
    const rollup = await prisma.analyticsDailyRollup.findFirst({
      where: { icpProfileId: ICP_ID },
    });
    expect(rollup).toBeTruthy();
  });
});

/**
 * Full pipeline chain E2E integration test
 *
 * Tests the pipeline chain from features.compute through message.send against a real
 * PostgreSQL database with ALL external adapters mocked at the fetch level.
 *
 * Pipeline under test:
 *   [pre-seeded lead] → features.compute → scoring.compute
 *   → message.generate (PENDING approval) → manual approval
 *   → message.send (Resend for email, Trengo for WhatsApp)
 */
import { randomUUID } from 'node:crypto';

import { type Prisma, prisma } from '@lead-flood/db';
import {
  OpenAiAdapter,
  ResendAdapter,
  TrengoAdapter,
} from '@lead-flood/providers';
import type { Job } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  handleFeaturesComputeJob,
  type FeaturesComputeJobPayload,
  type FeaturesComputeDependencies,
} from '../features.compute.job.js';
import {
  handleScoringComputeJob,
  type ScoringComputeJobPayload,
  type ScoringComputeJobDependencies,
} from '../scoring.compute.job.js';
import {
  handleMessageGenerateJob,
  type MessageGenerateJobPayload,
  type MessageGenerateJobDependencies,
} from '../message.generate.job.js';
import {
  handleMessageSendJob,
  type MessageSendJobPayload,
  type MessageSendJobDependencies,
} from '../message.send.job.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PREFIX = `e2e-full-chain-${Date.now()}`;

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
// Mock fetch factories — realistic responses for each provider
// ---------------------------------------------------------------------------

const APOLLO_PERSON_ID = `apollo-${randomUUID()}`;
const DISCOVERED_EMAIL = `${TEST_PREFIX}@zbooni-fullchain.test`;
const DISCOVERED_FIRST_NAME = 'Khalid';
const DISCOVERED_LAST_NAME = 'Al-Rashidi';

function makeOpenAiScoringFetch(): typeof fetch {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-scoring',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  score: 0.85,
                  reasoning: [
                    'Strong industry match: Financial Services in UAE',
                    'Company size (200) within target range',
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  ) as unknown as typeof fetch;
}

function makeOpenAiGenerateFetch(): typeof fetch {
  const emailBodyA =
    'Thank you for your interest in our payment solutions. We help businesses like yours streamline transactions and boost conversion rates across the UAE market.';

  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-generate',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  message: {
                    subject: 'Partnership Opportunity — Zbooni',
                    bodyText: emailBodyA,
                    bodyHtml: `<p>${emailBodyA}</p>`,
                    ctaText: 'Book a Demo',
                  },
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 60, total_tokens: 210 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  ) as unknown as typeof fetch;
}

function makeResendFetch(): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ id: `resend-msg-${randomUUID()}` }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
}

function makeTrengoFetch(): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ id: 789012, message_id: `trengo-msg-${randomUUID()}` }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Adapter factories
// ---------------------------------------------------------------------------

function makeOpenAiScoringAdapter(): OpenAiAdapter {
  return new OpenAiAdapter({
    apiKey: 'test-openai-key',
    fetchImpl: makeOpenAiScoringFetch(),
  });
}

function makeOpenAiGenerateAdapter(): OpenAiAdapter {
  return new OpenAiAdapter({
    apiKey: 'test-openai-key',
    fetchImpl: makeOpenAiGenerateFetch(),
  });
}

function makeResendAdapter(): ResendAdapter {
  return new ResendAdapter({
    apiKey: 'test-resend-key',
    fromEmail: 'noreply@leadflood.test',
    fetchImpl: makeResendFetch(),
  });
}

function makeTrengoAdapter(): TrengoAdapter {
  return new TrengoAdapter({
    apiKey: 'test-trengo-key',
    channelId: 'test-channel-789',
    templateId: 'test-template-012',
    fetchImpl: makeTrengoFetch(),
  });
}

// ---------------------------------------------------------------------------
// Seed data IDs
// ---------------------------------------------------------------------------

const ICP_ID = randomUUID();
const RUN_ID = `full-chain-${randomUUID()}`;
const ICP_FEATURES = ['Payment Links', 'WhatsApp Commerce', 'Order Management', 'Custom Storefronts'];

// Cross-stage state — populated during test execution
let discoveredLeadId: string;

// ---------------------------------------------------------------------------
// Helper: extract boss.send payload for a specific queue
// ---------------------------------------------------------------------------

function extractBossPayload<T>(queueName: string): T {
  const call = bossSendSpy.mock.calls.find(
    (c: unknown[]) => c[0] === queueName,
  );
  if (!call) {
    throw new Error(`No boss.send call found for queue '${queueName}'`);
  }
  return call[1] as T;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('pipeline full chain: features.compute → message.send', () => {
  beforeAll(async () => {
    // Seed IcpProfile
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

    // Seed lead + discovery record (replaces legacy discovery.run stage)
    // In the new pipeline, business.convert pre-populates lead with phone data
    const lead = await prisma.lead.create({
      data: {
        firstName: DISCOVERED_FIRST_NAME,
        lastName: DISCOVERED_LAST_NAME,
        email: DISCOVERED_EMAIL,
        phone: '+971509876543',
        source: 'apollo',
        status: 'new',
      },
    });
    discoveredLeadId = lead.id;

    await prisma.leadDiscoveryRecord.create({
      data: {
        leadId: discoveredLeadId,
        icpProfileId: ICP_ID,
        provider: 'APOLLO',
        providerRecordId: APOLLO_PERSON_ID,
        queryHash: `test-hash-${RUN_ID}`,
        status: 'DISCOVERED',
        rawPayload: {
          first_name: DISCOVERED_FIRST_NAME,
          last_name: DISCOVERED_LAST_NAME,
          email: DISCOVERED_EMAIL,
          companyName: 'FullChain Test Corp',
          industry: 'Financial Services',
          country: 'AE',
          organization: { name: 'FullChain Test Corp', primary_domain: 'fullchain-test.com' },
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.jobExecution.create({
      data: {
        id: RUN_ID,
        type: 'discovery.run',
        status: 'completed',
        attempts: 1,
        payload: { icpProfileId: ICP_ID } as Prisma.InputJsonValue,
        result: { totalItems: 1, processedItems: 1, failedItems: 0 } as Prisma.InputJsonValue,
      },
    });
  });

  afterAll(async () => {
    // Clean up in reverse dependency order — use leadId captured after discovery
    if (discoveredLeadId) {
      await prisma.messageSend.deleteMany({ where: { leadId: discoveredLeadId } });
      await prisma.messageVariant.deleteMany({
        where: { messageDraft: { leadId: discoveredLeadId } },
      });
      await prisma.messageDraft.deleteMany({ where: { leadId: discoveredLeadId } });
      await prisma.leadScorePrediction.deleteMany({ where: { leadId: discoveredLeadId } });
      await prisma.leadFeatureSnapshot.deleteMany({ where: { leadId: discoveredLeadId } });
      await prisma.leadEnrichmentRecord.deleteMany({ where: { leadId: discoveredLeadId } });
      await prisma.jobExecution.deleteMany({ where: { leadId: discoveredLeadId } });
      await prisma.leadDiscoveryRecord.deleteMany({ where: { leadId: discoveredLeadId } });
      await prisma.lead.deleteMany({ where: { id: discoveredLeadId } });
    }
    // Clean up job executions without leadId (the run-level ones)
    await prisma.jobExecution.deleteMany({ where: { id: RUN_ID } });
    // NOTE: Do NOT delete modelVersion 'deterministic-baseline-v1' here — it's
    // shared across test files and CASCADE-deleting it removes LeadScorePrediction
    // rows from other tests running in parallel.
    await prisma.icpProfile.deleteMany({ where: { id: ICP_ID } });
  });

  // -----------------------------------------------------------------------
  // Stage 2: Feature extraction (directly from pre-seeded lead)
  // -----------------------------------------------------------------------
  it('stage 2: features.compute extracts feature vector and enqueues scoring', async () => {
    const featuresPayload: FeaturesComputeJobPayload = {
      runId: RUN_ID,
      leadId: discoveredLeadId,
      icpProfileId: ICP_ID,
      snapshotVersion: 1,
      correlationId: `corr-${RUN_ID}`,
    };

    const deps: FeaturesComputeDependencies = {
      boss: mockBoss,
      // enqueueScoring defaults to true — will chain to scoring.compute
    };

    bossSendSpy.mockClear();
    await handleFeaturesComputeJob(noopLogger, makeJob(featuresPayload, 'features.compute'), deps);

    // Verify feature snapshot was created
    const snapshot = await prisma.leadFeatureSnapshot.findFirst({
      where: { leadId: discoveredLeadId, icpProfileId: ICP_ID },
    });
    expect(snapshot).toBeTruthy();
    expect(snapshot!.featuresJson).toBeTruthy();

    const features = snapshot!.featuresJson as Record<string, unknown>;
    expect(features.has_email).toBe(true);
    expect(features.has_company_name).toBe(true);

    // Verify scoring.compute was enqueued
    const scoringPayload = extractBossPayload<ScoringComputeJobPayload>('scoring.compute');
    expect(scoringPayload.leadIds).toEqual([discoveredLeadId]);
    expect(scoringPayload.icpProfileId).toBe(ICP_ID);
  });

  // -----------------------------------------------------------------------
  // Stage 4: Scoring — produces predictions with blendedScore >= 0.5
  // -----------------------------------------------------------------------
  it('stage 3: scoring.compute produces a prediction with blendedScore >= 0.5', async () => {
    // Extract scoring payload from features stage's boss.send
    const scoringPayload = extractBossPayload<ScoringComputeJobPayload>('scoring.compute');

    const enqueueMessageGenerate = vi.fn().mockResolvedValue(undefined);

    const deps: ScoringComputeJobDependencies = {
      openAiAdapter: makeOpenAiScoringAdapter(),
      deterministicWeight: 0.6,
      aiWeight: 0.4,
      enqueueMessageGenerate,
    };

    bossSendSpy.mockClear();
    await handleScoringComputeJob(noopLogger, makeJob(scoringPayload, 'scoring.compute'), deps);

    // Verify score prediction was created
    const prediction = await prisma.leadScorePrediction.findFirst({
      where: { leadId: discoveredLeadId, icpProfileId: ICP_ID },
    });
    expect(prediction).toBeTruthy();
    expect(prediction!.blendedScore).toBeGreaterThanOrEqual(0.5);
    expect(['MEDIUM', 'HIGH']).toContain(prediction!.scoreBand);

    // Qualified leads now wait for manual draft generation instead of auto-enqueueing message.generate.
    expect(enqueueMessageGenerate).not.toHaveBeenCalled();
    const qualifiedLead = await prisma.lead.findUnique({
      where: { id: discoveredLeadId },
      select: { status: true },
    });
    expect(qualifiedLead?.status).toBe('qualified');
  });

  // -----------------------------------------------------------------------
  // Stage 5: Message generation — creates PENDING drafts under current settings
  // -----------------------------------------------------------------------
  it('stage 4: message.generate creates drafts with PENDING approval', async () => {
    bossSendSpy.mockClear();

    const prediction = await prisma.leadScorePrediction.findFirst({
      where: { leadId: discoveredLeadId, icpProfileId: ICP_ID },
    });

    const payload: MessageGenerateJobPayload = {
      runId: `msggen-${RUN_ID}`,
      leadId: discoveredLeadId,
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

    // Verify draft was created with PENDING status
    const draft = await prisma.messageDraft.findFirst({
      where: { leadId: discoveredLeadId, icpProfileId: ICP_ID },
      include: { variants: true },
    });
    expect(draft).toBeTruthy();
    expect(draft!.approvalStatus).toBe('PENDING');
    expect(draft!.variants.length).toBe(1);
    expect(draft!.followUpNumber).toBe(0);
    expect(draft!.pitchedFeature).toBe(ICP_FEATURES[0]); // 'Payment Links'

    // Verify variants exist with realistic content
    const variantA = draft!.variants.find((v) => v.variantKey === 'variant_a');
    expect(variantA).toBeTruthy();
    expect(variantA!.channel).toBe('EMAIL');
    expect(variantA!.bodyText).toBeTruthy();

    // No MessageSend should be created because the draft remains pending
    const sends = await prisma.messageSend.findMany({
      where: { leadId: discoveredLeadId },
    });
    expect(sends.length).toBe(0);

    // No message.send should have been enqueued
    const sendCall = bossSendSpy.mock.calls.find(
      (c: unknown[]) => c[0] === 'message.send',
    );
    expect(sendCall).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Stage 6: Manual approval + email send via Resend
  // -----------------------------------------------------------------------
  it('stage 5: after manual approval, message.send delivers email via Resend', async () => {
    bossSendSpy.mockClear();

    // Simulate manual approval: select variant_a and create MessageSend
    const draft = await prisma.messageDraft.findFirst({
      where: { leadId: discoveredLeadId, icpProfileId: ICP_ID },
      include: { variants: true },
    });
    expect(draft).toBeTruthy();

    const selectedVariant = draft!.variants.find((v) => v.variantKey === 'variant_a')!;

    // Mark variant as selected and draft as approved
    await prisma.messageVariant.update({
      where: { id: selectedVariant.id },
      data: { isSelected: true },
    });
    await prisma.messageDraft.update({
      where: { id: draft!.id },
      data: { approvalStatus: 'APPROVED' },
    });

    // Create MessageSend (what the API approval endpoint would do)
    const idempotencyKey = `manual-approve:${discoveredLeadId}:${draft!.id}:${selectedVariant.id}`;
    const messageSend = await prisma.messageSend.create({
      data: {
        leadId: discoveredLeadId,
        messageDraftId: draft!.id,
        messageVariantId: selectedVariant.id,
        channel: 'EMAIL',
        provider: 'RESEND',
        status: 'QUEUED',
        idempotencyKey,
        followUpNumber: 0,
      },
    });

    // Now send via the worker job
    const payload: MessageSendJobPayload = {
      runId: `msgsend-email-${RUN_ID}`,
      sendId: messageSend.id,
      messageDraftId: draft!.id,
      messageVariantId: selectedVariant.id,
      idempotencyKey,
      channel: 'EMAIL',
      followUpNumber: 0,
      correlationId: `corr-${RUN_ID}`,
    };

    const deps: MessageSendJobDependencies = {
      resendAdapter: makeResendAdapter(),
      trengoAdapter: makeTrengoAdapter(),
    };

    await handleMessageSendJob(noopLogger, makeJob(payload, 'message.send'), deps);

    // Verify send was marked SENT
    const updatedSend = await prisma.messageSend.findUniqueOrThrow({
      where: { id: messageSend.id },
    });
    expect(updatedSend.status).toBe('SENT');
    expect(updatedSend.providerMessageId).toBeTruthy();
    expect(updatedSend.sentAt).toBeTruthy();
    expect(updatedSend.followUpNumber).toBe(0);
    // nextFollowUpAfter is set (~72h from now) since followUpNumber < 3
    expect(updatedSend.nextFollowUpAfter).toBeTruthy();

    // Lead status should be 'messaged'
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: discoveredLeadId } });
    expect(lead.status).toBe('messaged');
  });

  // -----------------------------------------------------------------------
  // Stage 7: WhatsApp send via Trengo (auto-approved follow-up)
  // -----------------------------------------------------------------------
  it('stage 6: message.generate (WhatsApp) + message.send delivers via Trengo', async () => {
    bossSendSpy.mockClear();

    // Generate a WhatsApp follow-up message (auto-approved)
    const prediction = await prisma.leadScorePrediction.findFirst({
      where: { leadId: discoveredLeadId, icpProfileId: ICP_ID },
    });

    const emailSend = await prisma.messageSend.findFirst({
      where: { leadId: discoveredLeadId, followUpNumber: 0, status: 'SENT' },
    });
    expect(emailSend).toBeTruthy();

    const genPayload: MessageGenerateJobPayload = {
      runId: `followup:${emailSend!.id}:1`,
      leadId: discoveredLeadId,
      icpProfileId: ICP_ID,
      followUpNumber: 1,
      parentMessageSendId: emailSend!.id,
      previouslyPitchedFeatures: [ICP_FEATURES[0]!],
      channel: 'WHATSAPP',
      knowledgeEntryIds: [],
      promptVersion: 'v1-followup',
      correlationId: `corr-${RUN_ID}`,
    };

    const genDeps: MessageGenerateJobDependencies = {
      openAiAdapter: makeOpenAiGenerateAdapter(),
      boss: mockBoss,
    };

    await handleMessageGenerateJob(noopLogger, makeJob(genPayload, 'message.generate'), genDeps);

    // Verify WhatsApp draft was created and auto-approved
    const waDraft = await prisma.messageDraft.findFirst({
      where: { leadId: discoveredLeadId, followUpNumber: 1 },
      include: { variants: true },
    });
    expect(waDraft).toBeTruthy();
    expect(waDraft!.approvalStatus).toBe('AUTO_APPROVED');
    expect(waDraft!.variants[0]!.channel).toBe('WHATSAPP');

    // Auto-approve should have created a QUEUED MessageSend
    const waSend = await prisma.messageSend.findFirst({
      where: { leadId: discoveredLeadId, followUpNumber: 1, status: 'QUEUED' },
    });
    expect(waSend).toBeTruthy();
    expect(waSend!.channel).toBe('WHATSAPP');

    // Send via Trengo
    bossSendSpy.mockClear();
    const sendPayload: MessageSendJobPayload = {
      runId: `msgsend-wa-${RUN_ID}`,
      sendId: waSend!.id,
      messageDraftId: waSend!.messageDraftId,
      messageVariantId: waSend!.messageVariantId,
      idempotencyKey: waSend!.idempotencyKey,
      channel: 'WHATSAPP',
      followUpNumber: 1,
      correlationId: `corr-${RUN_ID}`,
    };

    const sendDeps: MessageSendJobDependencies = {
      resendAdapter: makeResendAdapter(),
      trengoAdapter: makeTrengoAdapter(),
    };

    await handleMessageSendJob(noopLogger, makeJob(sendPayload, 'message.send'), sendDeps);

    // Verify WhatsApp send was marked SENT
    const updatedWaSend = await prisma.messageSend.findUniqueOrThrow({
      where: { id: waSend!.id },
    });
    expect(updatedWaSend.status).toBe('SENT');
    expect(updatedWaSend.providerMessageId).toBeTruthy();
    expect(updatedWaSend.providerConversationId).toBeTruthy();
    expect(updatedWaSend.followUpNumber).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Final: complete chain verification
  // -----------------------------------------------------------------------
  it('final: all pipeline artifacts exist across the full chain', async () => {
    // Lead should be in 'messaged' state
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: discoveredLeadId } });
    expect(lead.status).toBe('messaged');
    expect(lead.email).toBe(DISCOVERED_EMAIL);

    // Discovery record — pre-seeded
    const discovery = await prisma.leadDiscoveryRecord.findMany({
      where: { leadId: discoveredLeadId },
    });
    expect(discovery.length).toBeGreaterThanOrEqual(1);
    expect(discovery[0]!.provider).toBe('APOLLO');

    // Feature snapshot — created by features.compute
    const features = await prisma.leadFeatureSnapshot.findMany({
      where: { leadId: discoveredLeadId, icpProfileId: ICP_ID },
    });
    expect(features.length).toBeGreaterThanOrEqual(1);
    const featuresJson = features[0]!.featuresJson as Record<string, unknown>;
    expect(featuresJson.has_email).toBe(true);

    // Score prediction — created by scoring.compute
    const scores = await prisma.leadScorePrediction.findMany({
      where: { leadId: discoveredLeadId, icpProfileId: ICP_ID },
    });
    expect(scores.length).toBeGreaterThanOrEqual(1);
    expect(scores[0]!.blendedScore).toBeGreaterThanOrEqual(0.5);

    // Message drafts: initial email (APPROVED) + follow-up WhatsApp (AUTO_APPROVED)
    const drafts = await prisma.messageDraft.findMany({
      where: { leadId: discoveredLeadId },
      orderBy: { followUpNumber: 'asc' },
    });
    expect(drafts.length).toBe(2);
    expect(drafts[0]!.followUpNumber).toBe(0);
    expect(drafts[0]!.approvalStatus).toBe('APPROVED');
    expect(drafts[1]!.followUpNumber).toBe(1);
    expect(drafts[1]!.approvalStatus).toBe('AUTO_APPROVED');

    // Feature rotation: initial=Payment Links, follow-up=Order Management
    expect(drafts[0]!.pitchedFeature).toBe('Payment Links');
    // Follow-up: available = ['WhatsApp Commerce', 'Order Management', 'Custom Storefronts']
    // followUpNumber=1, 1 % 3 = 1 → 'Order Management'
    expect(drafts[1]!.pitchedFeature).toBe('Order Management');

    // Message sends: 1 email + 1 WhatsApp, both SENT
    const sends = await prisma.messageSend.findMany({
      where: { leadId: discoveredLeadId, status: 'SENT' },
      orderBy: { followUpNumber: 'asc' },
    });
    expect(sends.length).toBe(2);
    expect(sends[0]!.channel).toBe('EMAIL');
    expect(sends[0]!.followUpNumber).toBe(0);
    expect(sends[1]!.channel).toBe('WHATSAPP');
    expect(sends[1]!.followUpNumber).toBe(1);
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { routeMocks } = vi.hoisted(() => ({
  routeMocks: {
    buildMessagingService: vi.fn(),
    PrismaMessagingRepository: vi.fn(() => ({})),
    service: {
      generateMessageDraft: vi.fn(),
      listMessageDrafts: vi.fn(),
      getMessageDraft: vi.fn(),
      createManualMessageDraft: vi.fn(),
      approveMessageDraft: vi.fn(),
      rejectMessageDraft: vi.fn(),
      sendMessage: vi.fn(),
      listMessageSends: vi.fn(),
      getMessageSend: vi.fn(),
      getConversation: vi.fn(),
    },
  },
}));

vi.mock('./messaging.service.js', () => ({
  buildMessagingService: routeMocks.buildMessagingService,
}));

vi.mock('./messaging.repository.js', () => ({
  PrismaMessagingRepository: routeMocks.PrismaMessagingRepository,
}));

import {
  MessagingDraftGenerationIneligibleError,
  MessagingDraftGenerationUnavailableError,
  MessagingNotFoundError,
  MessagingOutboundDisabledError,
  MessagingSendIneligibleError,
} from './messaging.errors.js';
import { registerMessagingRoutes } from './messaging.routes.js';

function buildDraftResponse(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'draft_1',
    leadId: 'lead_1',
    icpProfileId: 'icp_1',
    scorePredictionId: 'score_1',
    promptVersion: 'v2',
    generatedByModel: 'stub',
    groundingKnowledgeIds: [],
    groundingContextJson: null,
    approvalStatus: 'APPROVED',
    approvedByUserId: 'user_auth',
    approvedAt: '2026-03-20T00:00:00.000Z',
    rejectedReason: null,
    followUpNumber: 0,
    variants: [
      {
        id: 'variant_1',
        messageDraftId: 'draft_1',
        variantKey: 'variant_a',
        channel: 'EMAIL',
        subject: 'Subject',
        bodyText: 'Hello',
        bodyHtml: null,
        ctaText: null,
        qualityScore: null,
        isSelected: true,
        createdAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-20T00:00:00.000Z',
      },
    ],
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('messaging.routes generate draft rejection handling', () => {
  let app: FastifyInstance;
  let currentUserId: string | null;

  beforeEach(async () => {
    vi.clearAllMocks();
    routeMocks.buildMessagingService.mockReturnValue(routeMocks.service);
    currentUserId = 'user_auth';
    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      request.user = currentUserId
        ? {
            sub: currentUserId,
            email: null,
            firstName: null,
            lastName: null,
          }
        : null;
    });
    registerMessagingRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 422 when the lead is below the configured threshold', async () => {
    routeMocks.service.generateMessageDraft.mockRejectedValue(
      new MessagingDraftGenerationIneligibleError(
        'Lead is not eligible for draft generation because its score is below the configured qualification threshold.',
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/generate',
      payload: {
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error:
        'Lead is not eligible for draft generation because its score is below the configured qualification threshold.',
      requestId: expect.any(String),
    });
  });

  it('returns 503 when the score qualification threshold cannot be verified', async () => {
    routeMocks.service.generateMessageDraft.mockRejectedValue(
      new MessagingDraftGenerationUnavailableError(
        'Draft generation is temporarily unavailable because the score qualification threshold setting is missing or invalid.',
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/generate',
      payload: {
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error:
        'Draft generation is temporarily unavailable because the score qualification threshold setting is missing or invalid.',
      requestId: expect.any(String),
    });
  });

  it('returns 404 when the requested lead does not exist', async () => {
    routeMocks.service.generateMessageDraft.mockRejectedValue(
      new MessagingNotFoundError('Lead not found'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/generate',
      payload: {
        leadId: 'missing_lead',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'Lead not found',
      requestId: expect.any(String),
    });
  });

  it('returns an honest queued response when draft generation is enqueued', async () => {
    routeMocks.service.generateMessageDraft.mockResolvedValue({
      status: 'QUEUED',
      draftId: null,
      variantIds: [],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/generate',
      payload: {
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
        forceRegenerate: true,
        redraftFeedback: 'Make the subject clearer and less feature-focused.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'QUEUED',
      draftId: null,
      variantIds: [],
    });
    expect(routeMocks.service.generateMessageDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRegenerate: true,
        redraftFeedback: 'Make the subject clearer and less feature-focused.',
      }),
    );
  });

  it('returns an honest existing-draft response without pretending a new draft was created', async () => {
    routeMocks.service.generateMessageDraft.mockResolvedValue({
      status: 'EXISTS',
      draftId: 'draft_1',
      variantIds: ['variant_1'],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/generate',
      payload: {
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'EXISTS',
      draftId: 'draft_1',
      variantIds: ['variant_1'],
    });
  });

  it('passes the followUpOnly filter through the existing drafts endpoint', async () => {
    routeMocks.service.listMessageDrafts.mockResolvedValue({
      items: [buildDraftResponse({ followUpNumber: 1 })],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/messaging/drafts?followUpOnly=true',
    });

    expect(response.statusCode).toBe(200);
    expect(routeMocks.service.listMessageDrafts).toHaveBeenCalledWith({
      followUpOnly: true,
      page: 1,
      pageSize: 20,
    });
    expect(response.json()).toEqual({
      items: [buildDraftResponse({ followUpNumber: 1 })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  it('creates a manual draft using the authenticated operator', async () => {
    routeMocks.service.createManualMessageDraft.mockResolvedValue(
      buildDraftResponse({
        generatedByModel: 'operator_manual',
        promptVersion: 'operator_manual',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/manual',
      payload: {
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        channel: 'EMAIL',
        subject: 'Re: Follow up',
        bodyText: 'Thanks for the reply.',
        parentMessageSendId: 'send_1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(routeMocks.service.createManualMessageDraft).toHaveBeenCalledWith({
      leadId: 'lead_1',
      icpProfileId: 'icp_1',
      channel: 'EMAIL',
      subject: 'Re: Follow up',
      bodyText: 'Thanks for the reply.',
      parentMessageSendId: 'send_1',
      approvedByUserId: 'user_auth',
    });
    expect(response.json()).toMatchObject({
      generatedByModel: 'operator_manual',
      promptVersion: 'operator_manual',
    });
  });

  it('uses the authenticated user for approval attribution even when the client supplies another id', async () => {
    routeMocks.service.approveMessageDraft.mockResolvedValue(buildDraftResponse());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/draft_1/approve',
      payload: {
        approvedByUserId: 'spoofed_user',
        selectedVariantId: 'variant_1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(routeMocks.service.approveMessageDraft).toHaveBeenCalledWith('draft_1', {
      approvedByUserId: 'user_auth',
      selectedVariantId: 'variant_1',
    });
  });

  it('uses the authenticated user for rejection attribution even when the client supplies another id', async () => {
    routeMocks.service.rejectMessageDraft.mockResolvedValue(
      buildDraftResponse({
        approvalStatus: 'REJECTED',
        approvedByUserId: null,
        approvedAt: null,
        rejectedReason: 'Not a fit',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/draft_1/reject',
      payload: {
        rejectedByUserId: 'spoofed_user',
        rejectedReason: 'Not a fit',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(routeMocks.service.rejectMessageDraft).toHaveBeenCalledWith('draft_1', {
      rejectedByUserId: 'user_auth',
      rejectedReason: 'Not a fit',
    });
  });

  it('returns 401 for approval when no authenticated user is present', async () => {
    currentUserId = null;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/draft_1/approve',
      payload: {
        approvedByUserId: 'spoofed_user',
        selectedVariantId: 'variant_1',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'Authentication required',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.approveMessageDraft).not.toHaveBeenCalled();
  });

  it('returns 422 when the selected variant does not belong to the approved draft', async () => {
    routeMocks.service.approveMessageDraft.mockRejectedValue(
      new MessagingSendIneligibleError('Selected message variant does not belong to the requested draft.'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/drafts/draft_1/approve',
      payload: {
        approvedByUserId: 'user_1',
        selectedVariantId: 'variant_other_draft',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'Selected message variant does not belong to the requested draft.',
      requestId: expect.any(String),
    });
  });

  it('returns 403 when direct sending is disabled for the demo', async () => {
    routeMocks.service.sendMessage.mockRejectedValue(
      new MessagingOutboundDisabledError(),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/sends',
      payload: {
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_1',
        idempotencyKey: 'ui:draft_1:variant_1:blocked',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error:
        'Outbound sending is disabled for the Leadzilla demo. Drafts can be reviewed and approved, but email and WhatsApp delivery are blocked.',
      requestId: expect.any(String),
    });
  });

  it('returns 422 when the selected variant does not belong to the requested draft', async () => {
    routeMocks.service.sendMessage.mockRejectedValue(
      new MessagingSendIneligibleError('Selected message variant does not belong to the requested draft.'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messaging/sends',
      payload: {
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_other_draft',
        idempotencyKey: 'ui:draft_1:variant_other_draft:mismatch',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'Selected message variant does not belong to the requested draft.',
      requestId: expect.any(String),
    });
  });
});

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
  MessagingSendIneligibleError,
} from './messaging.errors.js';
import { registerMessagingRoutes } from './messaging.routes.js';

describe('messaging.routes generate draft rejection handling', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    routeMocks.buildMessagingService.mockReturnValue(routeMocks.service);
    app = Fastify();
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
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'QUEUED',
      draftId: null,
      variantIds: [],
    });
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

  it('returns 422 when an initial draft is not approved for sending', async () => {
    routeMocks.service.sendMessage.mockRejectedValue(
      new MessagingSendIneligibleError('Initial draft must be approved before it can be sent.'),
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

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'Initial draft must be approved before it can be sent.',
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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    getPipelineSetting: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  getPipelineSetting: dbMock.getPipelineSetting,
}));

import type { MessagingRepository } from './messaging.repository.js';
import {
  MessagingDraftGenerationIneligibleError,
  MessagingDraftGenerationUnavailableError,
  MessagingNotFoundError,
  MessagingSendIneligibleError,
} from './messaging.errors.js';
import { buildMessagingService } from './messaging.service.js';

function buildDraftResponse() {
  return {
    id: 'draft_1',
    leadId: 'lead_1',
    icpProfileId: 'icp_1',
    scorePredictionId: 'score_1',
    promptVersion: 'v2',
    generatedByModel: 'stub',
    groundingKnowledgeIds: [],
    groundingContextJson: null,
    approvalStatus: 'APPROVED' as const,
    approvedByUserId: 'user_1',
    approvedAt: '2026-03-20T00:00:00.000Z',
    rejectedReason: null,
    followUpNumber: 0,
    variants: [
      {
        id: 'variant_1',
        messageDraftId: 'draft_1',
        variantKey: 'variant_a',
        channel: 'EMAIL' as const,
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
  };
}

function buildRepositoryMock(): MessagingRepository {
  return {
    generateMessageDraft: vi.fn(async () => ({
      status: 'CREATED' as const,
      draftId: 'draft_1',
      variantIds: ['variant_1'],
    })),
    getDraftGenerationEligibilityContext: vi.fn(async () => ({
      leadId: 'lead_1',
      leadStatus: 'qualified',
      blendedScore: 0.78,
    })),
    markLeadDraftedIfQualified: vi.fn(async () => undefined),
    getExistingInitialDraft: vi.fn(async () => null),
    getExistingInitialSendForDraft: vi.fn(async () => null),
    listMessageDrafts: vi.fn(),
    getMessageDraft: vi.fn(async () => buildDraftResponse()),
    approveMessageDraft: vi.fn(async () => buildDraftResponse()),
    rejectMessageDraft: vi.fn(),
    sendMessage: vi.fn(),
    listMessageSends: vi.fn(),
    getMessageSend: vi.fn(),
    getConversation: vi.fn(),
    createMessageSendForApproval: vi.fn(async () => ({
      id: 'send_1',
      leadId: 'lead_1',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_1',
      channel: 'EMAIL' as const,
      provider: 'RESEND' as const,
      providerMessageId: null,
      status: 'QUEUED' as const,
      idempotencyKey: 'approve:draft_1:variant_1',
      scheduledAt: null,
      sentAt: null,
      deliveredAt: null,
      repliedAt: null,
      followUpNumber: 0,
      nextFollowUpAfter: null,
      providerConversationId: null,
      failureCode: null,
      failureReason: null,
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
    })),
  };
}

describe('buildMessagingService generateMessageDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.getPipelineSetting.mockResolvedValue({
      key: 'scoreQualificationThreshold',
      valueJson: 0.7,
      updatedAt: new Date('2026-03-14T00:00:00.000Z'),
    });
  });

  it('rejects when the lead does not exist', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.getDraftGenerationEligibilityContext).mockResolvedValue(null);
    const service = buildMessagingService(repository, {
      enqueueMessageSend: vi.fn(async () => undefined),
    });

    await expect(
      service.generateMessageDraft({
        leadId: 'missing_lead',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
        knowledgeEntryIds: [],
        channel: 'EMAIL',
      }),
    ).rejects.toThrow(MessagingNotFoundError);

    expect(dbMock.getPipelineSetting).not.toHaveBeenCalled();
  });

  it('rejects when no score is available for the requested ICP profile', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.getDraftGenerationEligibilityContext).mockResolvedValue({
      leadId: 'lead_1',
      leadStatus: 'qualified',
      blendedScore: null,
    });
    const service = buildMessagingService(repository, {
      enqueueMessageSend: vi.fn(async () => undefined),
    });

    await expect(
      service.generateMessageDraft({
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
        knowledgeEntryIds: [],
        channel: 'EMAIL',
      }),
    ).rejects.toThrow(MessagingDraftGenerationIneligibleError);

    expect(dbMock.getPipelineSetting).not.toHaveBeenCalled();
  });

  it('rejects when the lead score is below the configured threshold', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.getDraftGenerationEligibilityContext).mockResolvedValue({
      leadId: 'lead_1',
      leadStatus: 'qualified',
      blendedScore: 0.61,
    });
    const enqueueMessageGenerate = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend: vi.fn(async () => undefined),
      enqueueMessageGenerate,
    });

    await expect(
      service.generateMessageDraft({
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
        knowledgeEntryIds: [],
        channel: 'EMAIL',
      }),
    ).rejects.toThrow(MessagingDraftGenerationIneligibleError);

    expect(enqueueMessageGenerate).not.toHaveBeenCalled();
    expect(repository.generateMessageDraft).not.toHaveBeenCalled();
  });

  it('rejects when the persisted threshold setting cannot be verified', async () => {
    const repository = buildRepositoryMock();
    dbMock.getPipelineSetting.mockResolvedValue(null);
    const service = buildMessagingService(repository, {
      enqueueMessageSend: vi.fn(async () => undefined),
      enqueueMessageGenerate: vi.fn(async () => undefined),
    });

    await expect(
      service.generateMessageDraft({
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
        knowledgeEntryIds: [],
        channel: 'EMAIL',
      }),
    ).rejects.toThrow(MessagingDraftGenerationUnavailableError);
  });

  it('enqueues draft generation only after the server verifies eligibility', async () => {
    const repository = buildRepositoryMock();
    const enqueueMessageGenerate = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend: vi.fn(async () => undefined),
      enqueueMessageGenerate,
    });

    const result = await service.generateMessageDraft({
      leadId: 'lead_1',
      icpProfileId: 'icp_1',
      scorePredictionId: 'score_1',
      promptVersion: 'v2',
      knowledgeEntryIds: ['knowledge_1'],
      channel: 'EMAIL',
    });

    expect(result.status).toBe('QUEUED');
    expect(result.variantIds).toEqual([]);
    expect(result.draftId).toBeNull();
    expect(repository.getDraftGenerationEligibilityContext).toHaveBeenCalledWith({
      leadId: 'lead_1',
      icpProfileId: 'icp_1',
    });
    expect(enqueueMessageGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        promptVersion: 'v2',
      }),
    );
    expect(enqueueMessageGenerate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        scorePredictionId: expect.anything(),
      }),
    );
    expect(repository.generateMessageDraft).not.toHaveBeenCalled();
  });

  it('returns an existing initial draft without enqueueing duplicate work', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.getExistingInitialDraft).mockResolvedValue({
      draftId: 'draft_existing',
      variantIds: ['variant_existing'],
    });
    const enqueueMessageGenerate = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend: vi.fn(async () => undefined),
      enqueueMessageGenerate,
    });

    const result = await service.generateMessageDraft({
      leadId: 'lead_1',
      icpProfileId: 'icp_1',
      scorePredictionId: 'score_1',
      promptVersion: 'v2',
      knowledgeEntryIds: ['knowledge_1'],
      channel: 'EMAIL',
    });

    expect(result).toEqual({
      status: 'EXISTS',
      draftId: 'draft_existing',
      variantIds: ['variant_existing'],
    });
    expect(repository.getExistingInitialDraft).toHaveBeenCalledWith({
      leadId: 'lead_1',
      icpProfileId: 'icp_1',
    });
    expect(repository.markLeadDraftedIfQualified).toHaveBeenCalledWith('lead_1');
    expect(enqueueMessageGenerate).not.toHaveBeenCalled();
    expect(repository.generateMessageDraft).not.toHaveBeenCalled();
    expect(dbMock.getPipelineSetting).not.toHaveBeenCalled();
  });

  it('preserves the requested scorePredictionId when using direct repository generation', async () => {
    const repository = buildRepositoryMock();
    const service = buildMessagingService(repository, {
      enqueueMessageSend: vi.fn(async () => undefined),
    });

    await service.generateMessageDraft({
      leadId: 'lead_1',
      icpProfileId: 'icp_1',
      scorePredictionId: 'score_1',
      promptVersion: 'v2',
      knowledgeEntryIds: ['knowledge_1'],
      channel: 'EMAIL',
    });

    expect(repository.generateMessageDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        scorePredictionId: 'score_1',
      }),
    );
  });
});

describe('buildMessagingService approveMessageDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects mismatched draft and selected variant pairs without enqueueing approval send work', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.approveMessageDraft).mockRejectedValue(
      new MessagingSendIneligibleError('Selected message variant does not belong to the requested draft.'),
    );
    const enqueueMessageSend = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend,
    });

    await expect(
      service.approveMessageDraft('draft_1', {
        approvedByUserId: 'user_1',
        selectedVariantId: 'variant_other_draft',
      }),
    ).rejects.toThrow(MessagingSendIneligibleError);

    expect(repository.getExistingInitialSendForDraft).toHaveBeenCalledWith('draft_1');
    expect(repository.createMessageSendForApproval).not.toHaveBeenCalled();
    expect(enqueueMessageSend).not.toHaveBeenCalled();
  });

  it('does not create a duplicate initial send when one already exists for the draft', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.getExistingInitialSendForDraft).mockResolvedValue({
      id: 'send_existing',
      leadId: 'lead_1',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_1',
      channel: 'EMAIL',
      provider: 'RESEND',
      providerMessageId: null,
      status: 'QUEUED',
      idempotencyKey: 'approve:draft_1:variant_1',
      scheduledAt: null,
      sentAt: null,
      deliveredAt: null,
      repliedAt: null,
      followUpNumber: 0,
      nextFollowUpAfter: null,
      providerConversationId: null,
      failureCode: null,
      failureReason: null,
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
    });
    const enqueueMessageSend = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend,
    });

    const result = await service.approveMessageDraft('draft_1', {
      approvedByUserId: 'user_1',
      selectedVariantId: 'variant_2',
    });

    expect(result).toEqual(buildDraftResponse());
    expect(repository.getExistingInitialSendForDraft).toHaveBeenCalledWith('draft_1');
    expect(repository.approveMessageDraft).not.toHaveBeenCalled();
    expect(repository.createMessageSendForApproval).not.toHaveBeenCalled();
    expect(enqueueMessageSend).toHaveBeenCalledWith({
      runId: 'message.send:send_existing',
      sendId: 'send_existing',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_1',
      idempotencyKey: 'approve:draft_1:variant_1',
      channel: 'EMAIL',
      scheduledAt: undefined,
    });
  });

  it('does not retarget an already-approved initial draft when approval is retried with a different variant', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.approveMessageDraft).mockResolvedValue({
      ...buildDraftResponse(),
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
        {
          id: 'variant_2',
          messageDraftId: 'draft_1',
          variantKey: 'variant_b',
          channel: 'EMAIL',
          subject: 'Alt Subject',
          bodyText: 'Alt Hello',
          bodyHtml: null,
          ctaText: null,
          qualityScore: null,
          isSelected: false,
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
    });
    const enqueueMessageSend = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend,
    });

    await service.approveMessageDraft('draft_1', {
      approvedByUserId: 'user_2',
      selectedVariantId: 'variant_2',
    });

    expect(repository.createMessageSendForApproval).toHaveBeenCalledWith({
      leadId: 'lead_1',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_1',
      channel: 'EMAIL',
      idempotencyKey: 'approve:draft_1:variant_1',
      followUpNumber: 0,
    });
    expect(enqueueMessageSend).toHaveBeenCalledWith({
      runId: 'message.send:send_1',
      sendId: 'send_1',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_1',
      idempotencyKey: 'approve:draft_1:variant_1',
      channel: 'EMAIL',
    });
  });
});

describe('buildMessagingService sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unapproved initial drafts without enqueueing a send', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.sendMessage).mockRejectedValue(
      new MessagingSendIneligibleError('Initial draft must be approved before it can be sent.'),
    );
    const enqueueMessageSend = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend,
    });

    await expect(
      service.sendMessage({
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_1',
        idempotencyKey: 'ui:draft_1:variant_1:blocked',
      }),
    ).rejects.toThrow(MessagingSendIneligibleError);

    expect(enqueueMessageSend).not.toHaveBeenCalled();
  });

  it('rejects mismatched draft and variant pairs without enqueueing a send', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.sendMessage).mockRejectedValue(
      new MessagingSendIneligibleError('Selected message variant does not belong to the requested draft.'),
    );
    const enqueueMessageSend = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend,
    });

    await expect(
      service.sendMessage({
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_other_draft',
        idempotencyKey: 'ui:draft_1:variant_other_draft:mismatch',
      }),
    ).rejects.toThrow(MessagingSendIneligibleError);

    expect(enqueueMessageSend).not.toHaveBeenCalled();
  });

  it('does not enqueue again when an initial send already exists in a sent state', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.sendMessage).mockResolvedValue({
      id: 'send_existing',
      leadId: 'lead_1',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_existing',
      channel: 'EMAIL',
      provider: 'RESEND',
      providerMessageId: 'provider_1',
      status: 'SENT',
      idempotencyKey: 'approve:draft_1:variant_existing',
      scheduledAt: null,
      sentAt: '2026-03-20T00:05:00.000Z',
      deliveredAt: null,
      repliedAt: null,
      followUpNumber: 0,
      nextFollowUpAfter: '2026-03-23T00:05:00.000Z',
      providerConversationId: null,
      failureCode: null,
      failureReason: null,
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:05:00.000Z',
    });
    const enqueueMessageSend = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend,
    });

    const result = await service.sendMessage({
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_new',
      idempotencyKey: 'ui:draft_1:variant_new:123',
    });

    expect(result.id).toBe('send_existing');
    expect(result.status).toBe('SENT');
    expect(repository.sendMessage).toHaveBeenCalledWith({
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_new',
      idempotencyKey: 'ui:draft_1:variant_new:123',
    });
    expect(enqueueMessageSend).not.toHaveBeenCalled();
  });

  it('re-enqueues the same queued initial send instead of minting a new send attempt', async () => {
    const repository = buildRepositoryMock();
    vi.mocked(repository.sendMessage).mockResolvedValue({
      id: 'send_existing',
      leadId: 'lead_1',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_existing',
      channel: 'EMAIL',
      provider: 'RESEND',
      providerMessageId: null,
      status: 'QUEUED',
      idempotencyKey: 'approve:draft_1:variant_existing',
      scheduledAt: null,
      sentAt: null,
      deliveredAt: null,
      repliedAt: null,
      followUpNumber: 0,
      nextFollowUpAfter: null,
      providerConversationId: null,
      failureCode: null,
      failureReason: null,
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
    });
    const enqueueMessageSend = vi.fn(async () => undefined);
    const service = buildMessagingService(repository, {
      enqueueMessageSend,
    });

    const result = await service.sendMessage({
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_new',
      idempotencyKey: 'ui:draft_1:variant_new:456',
    });

    expect(result.id).toBe('send_existing');
    expect(result.status).toBe('QUEUED');
    expect(enqueueMessageSend).toHaveBeenCalledWith({
      runId: 'send_existing',
      sendId: 'send_existing',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_existing',
      idempotencyKey: 'approve:draft_1:variant_existing',
      channel: 'EMAIL',
      scheduledAt: undefined,
    });
  });
});

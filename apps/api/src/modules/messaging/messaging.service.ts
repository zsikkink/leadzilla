import type {
  ApproveMessageDraftRequest,
  ConversationResponse,
  GenerateMessageDraftRequest,
  GenerateMessageDraftResponse,
  ListMessageDraftsQuery,
  ListMessageDraftsResponse,
  ListMessageSendsQuery,
  ListMessageSendsResponse,
  MessageDraftResponse,
  MessageSendResponse,
  MessageVariantResponse,
  RejectMessageDraftRequest,
  SendMessageRequest,
  UpdateMessageVariantRequest,
} from '@lead-flood/contracts';
import { getPipelineSetting } from '@lead-flood/db';

import type { MessagingRepository } from './messaging.repository.js';
import {
  MessagingDraftGenerationIneligibleError,
  MessagingDraftGenerationUnavailableError,
  MessagingNotFoundError,
} from './messaging.errors.js';

export interface MessagingSendJobPayload {
  runId: string;
  sendId: string;
  messageDraftId: string;
  messageVariantId: string;
  idempotencyKey: string;
  channel: 'EMAIL' | 'WHATSAPP';
  outboxEventId?: string | undefined;
  scheduledAt?: string | undefined;
  correlationId?: string | undefined;
}

// Worker execution reloads the current score, so queue publishers do not
// forward client/request scorePredictionId into message.generate jobs.
export interface MessageGenerateJobPayload {
  runId: string;
  leadId: string;
  icpProfileId: string;
  knowledgeEntryIds?: string[] | undefined;
  channel?: string | undefined;
  promptVersion?: string | undefined;
  forceRegenerate?: boolean | undefined;
  correlationId?: string | undefined;
}

export interface MessagingServiceLogger {
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface MessagingServiceDependencies {
  enqueueMessageSend: (payload: MessagingSendJobPayload) => Promise<void>;
  enqueueMessageGenerate?: ((payload: MessageGenerateJobPayload) => Promise<void>) | undefined;
  logger?: MessagingServiceLogger | undefined;
}

export interface MessagingService {
  generateMessageDraft(input: GenerateMessageDraftRequest): Promise<GenerateMessageDraftResponse>;
  listMessageDrafts(query: ListMessageDraftsQuery): Promise<ListMessageDraftsResponse>;
  getMessageDraft(draftId: string): Promise<MessageDraftResponse>;
  approveMessageDraft(draftId: string, input: ApproveMessageDraftRequest): Promise<MessageDraftResponse>;
  rejectMessageDraft(draftId: string, input: RejectMessageDraftRequest): Promise<MessageDraftResponse>;
  sendMessage(input: SendMessageRequest): Promise<MessageSendResponse>;
  listMessageSends(query: ListMessageSendsQuery): Promise<ListMessageSendsResponse>;
  getMessageSend(sendId: string): Promise<MessageSendResponse>;
  getConversation(leadId: string): Promise<ConversationResponse>;
  updateMessageVariant(variantId: string, input: UpdateMessageVariantRequest): Promise<MessageVariantResponse>;
}

const SCORE_QUALIFICATION_THRESHOLD_KEY = 'scoreQualificationThreshold';

function parseQualificationThresholdValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return null;
  }
  return parsed;
}

async function loadVerifiedQualificationThreshold(): Promise<number> {
  let setting: Awaited<ReturnType<typeof getPipelineSetting>>;
  try {
    setting = await getPipelineSetting(SCORE_QUALIFICATION_THRESHOLD_KEY);
  } catch {
    throw new MessagingDraftGenerationUnavailableError(
      'Draft generation is temporarily unavailable because the score qualification threshold could not be loaded.',
    );
  }

  const threshold = parseQualificationThresholdValue(setting?.valueJson);
  if (threshold === null) {
    throw new MessagingDraftGenerationUnavailableError(
      'Draft generation is temporarily unavailable because the score qualification threshold setting is missing or invalid.',
    );
  }

  return threshold;
}

function buildMessageSendJobPayload(
  input: {
    id: string;
    messageDraftId: string;
    messageVariantId: string;
    idempotencyKey: string;
    channel: 'EMAIL' | 'WHATSAPP';
    scheduledAt: string | null;
  },
  runId: string,
  outboxEventId?: string,
): MessagingSendJobPayload {
  return {
    runId,
    sendId: input.id,
    messageDraftId: input.messageDraftId,
    messageVariantId: input.messageVariantId,
    idempotencyKey: input.idempotencyKey,
    channel: input.channel,
    scheduledAt: input.scheduledAt ?? undefined,
    ...(outboxEventId ? { outboxEventId } : {}),
  };
}

export function buildMessagingService(
  repository: MessagingRepository,
  dependencies: MessagingServiceDependencies,
): MessagingService {
  return {
    async generateMessageDraft(input) {
      const eligibilityContext = await repository.getDraftGenerationEligibilityContext({
        leadId: input.leadId,
        icpProfileId: input.icpProfileId,
      });

      if (!eligibilityContext) {
        throw new MessagingNotFoundError('Lead not found');
      }

      const existingDraft = await repository.getExistingInitialDraft({
        leadId: input.leadId,
        icpProfileId: input.icpProfileId,
      });

      if (existingDraft) {
        if (input.forceRegenerate) {
          const existingInitialSend = await repository.getExistingInitialSendForDraft(existingDraft.draftId);
          if (existingInitialSend) {
            throw new MessagingDraftGenerationIneligibleError(
              'Draft cannot be regenerated because the initial message has already been queued or sent. Review it in Message Queue instead.',
            );
          }
        } else {
          if (eligibilityContext.leadStatus === 'qualified') {
            await repository.markLeadDraftedIfQualified(input.leadId);
          }

          return {
            status: 'EXISTS',
            draftId: existingDraft.draftId,
            variantIds: existingDraft.variantIds,
          };
        }
      }

      if (eligibilityContext.blendedScore === null) {
        throw new MessagingDraftGenerationIneligibleError(
          'Lead is not eligible for draft generation because no score is available for the requested ICP profile.',
        );
      }

      const qualificationThreshold = await loadVerifiedQualificationThreshold();
      if (eligibilityContext.blendedScore < qualificationThreshold) {
        throw new MessagingDraftGenerationIneligibleError(
          'Lead is not eligible for draft generation because its score is below the configured qualification threshold.',
        );
      }

      await repository.clearLeadDraftGenerationError(input.leadId);

      if (dependencies.enqueueMessageGenerate) {
        const runId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await dependencies.enqueueMessageGenerate({
          runId,
          leadId: input.leadId,
          icpProfileId: input.icpProfileId,
          knowledgeEntryIds: input.knowledgeEntryIds,
          channel: input.channel,
          promptVersion: input.promptVersion,
          forceRegenerate: input.forceRegenerate,
        });
        return {
          status: 'QUEUED',
          draftId: null,
          variantIds: [],
        };
      }
      return repository.generateMessageDraft(input);
    },
    async listMessageDrafts(query) {
      return repository.listMessageDrafts(query);
    },
    async getMessageDraft(draftId) {
      return repository.getMessageDraft(draftId);
    },
    async approveMessageDraft(draftId, input) {
      const existingInitialSend = await repository.getExistingInitialSendForDraft(draftId);
      if (existingInitialSend) {
        if (existingInitialSend.status === 'QUEUED') {
          await dependencies.enqueueMessageSend(
            buildMessageSendJobPayload(existingInitialSend, `message.send:${existingInitialSend.id}`),
          );
        }

        return repository.getMessageDraft(draftId);
      }

      const approval = await repository.approveMessageDraft(draftId, input);

      if (approval.initialSend?.send.status === 'QUEUED') {
        await dependencies.enqueueMessageSend(
          buildMessageSendJobPayload(
            approval.initialSend.send,
            `message.send:${approval.initialSend.send.id}`,
            approval.initialSend.outboxEventId,
          ),
        );
      }

      return approval.draft;
    },
    async rejectMessageDraft(draftId, input) {
      return repository.rejectMessageDraft(draftId, input);
    },
    async sendMessage(input) {
      const result = await repository.sendMessage(input);

      if (result.send.status === 'QUEUED') {
        await dependencies.enqueueMessageSend(
          buildMessageSendJobPayload(result.send, result.send.id, result.outboxEventId),
        );
      }

      return result.send;
    },
    async listMessageSends(query) {
      return repository.listMessageSends(query);
    },
    async getMessageSend(sendId) {
      return repository.getMessageSend(sendId);
    },
    async getConversation(leadId) {
      return repository.getConversation(leadId);
    },
    async updateMessageVariant(variantId, input) {
      return repository.updateMessageVariant(variantId, input);
    },
  };
}

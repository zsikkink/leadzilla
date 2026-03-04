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
  RejectMessageDraftRequest,
  SendMessageRequest,
} from '@lead-flood/contracts';

import type { MessagingRepository } from './messaging.repository.js';

export interface MessagingSendJobPayload {
  runId: string;
  sendId: string;
  messageDraftId: string;
  messageVariantId: string;
  idempotencyKey: string;
  channel: 'EMAIL' | 'WHATSAPP';
  scheduledAt?: string | undefined;
  correlationId?: string | undefined;
}

export interface MessageGenerateJobPayload {
  runId: string;
  leadId: string;
  icpProfileId: string;
  scorePredictionId?: string | undefined;
  knowledgeEntryIds?: string[] | undefined;
  channel?: string | undefined;
  promptVersion?: string | undefined;
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
}

export function buildMessagingService(
  repository: MessagingRepository,
  dependencies: MessagingServiceDependencies,
): MessagingService {
  return {
    async generateMessageDraft(input) {
      if (dependencies.enqueueMessageGenerate) {
        const runId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await dependencies.enqueueMessageGenerate({
          runId,
          leadId: input.leadId,
          icpProfileId: input.icpProfileId,
          scorePredictionId: input.scorePredictionId,
          knowledgeEntryIds: input.knowledgeEntryIds,
          channel: input.channel,
          promptVersion: input.promptVersion,
        });
        // Return a placeholder response; the worker will create the actual draft
        return { draftId: runId, variantIds: [] };
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
      const draft = await repository.approveMessageDraft(draftId, input);

      // B4 fix: After approval, select A/B variant, create MessageSend, enqueue message.send
      if (draft.approvalStatus === 'APPROVED' && draft.variants.length > 0) {
        // Pick selected variant (user may have chosen one, or use first available)
        const selectedVariant =
          (input.selectedVariantId
            ? draft.variants.find((v) => v.id === input.selectedVariantId)
            : undefined) ??
          draft.variants.find((v) => v.isSelected) ??
          draft.variants[0];

        if (selectedVariant) {
          const idempotencyKey = `approve:${draftId}:${selectedVariant.id}`;
          try {
            const send = await repository.createMessageSendForApproval({
              leadId: draft.leadId,
              messageDraftId: draft.id,
              messageVariantId: selectedVariant.id,
              channel: selectedVariant.channel,
              idempotencyKey,
              followUpNumber: 0,
            });

            await dependencies.enqueueMessageSend({
              runId: `message.send:${send.id}`,
              sendId: send.id,
              messageDraftId: draft.id,
              messageVariantId: selectedVariant.id,
              idempotencyKey,
              channel: selectedVariant.channel as 'EMAIL' | 'WHATSAPP',
            });
          } catch (error: unknown) {
            // Idempotency: if MessageSend already exists (unique constraint on idempotencyKey),
            // or enqueue fails, the send record is already QUEUED and pg-boss retry will handle it
            dependencies.logger?.error({ err: error, draftId }, 'Failed to create/enqueue send after approval');
          }
        }
      }

      return draft;
    },
    async rejectMessageDraft(draftId, input) {
      return repository.rejectMessageDraft(draftId, input);
    },
    async sendMessage(input) {
      const send = await repository.sendMessage(input);

      try {
        await dependencies.enqueueMessageSend({
          runId: send.id,
          sendId: send.id,
          messageDraftId: input.messageDraftId,
          messageVariantId: input.messageVariantId,
          idempotencyKey: input.idempotencyKey,
          channel: send.channel,
          scheduledAt: input.scheduledAt,
        });
      } catch (error: unknown) {
        // Send record already created with QUEUED status — pg-boss retry will handle it
        dependencies.logger?.error({ err: error, sendId: send.id }, 'Failed to enqueue message send');
      }

      return send;
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
  };
}

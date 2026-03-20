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
        if (eligibilityContext.leadStatus === 'qualified') {
          await repository.markLeadDraftedIfQualified(input.leadId);
        }

        return {
          status: 'EXISTS',
          draftId: existingDraft.draftId,
          variantIds: existingDraft.variantIds,
        };
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

      if (dependencies.enqueueMessageGenerate) {
        const runId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await dependencies.enqueueMessageGenerate({
          runId,
          leadId: input.leadId,
          icpProfileId: input.icpProfileId,
          knowledgeEntryIds: input.knowledgeEntryIds,
          channel: input.channel,
          promptVersion: input.promptVersion,
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
          await dependencies.enqueueMessageSend({
            runId: `message.send:${existingInitialSend.id}`,
            sendId: existingInitialSend.id,
            messageDraftId: existingInitialSend.messageDraftId,
            messageVariantId: existingInitialSend.messageVariantId,
            idempotencyKey: existingInitialSend.idempotencyKey,
            channel: existingInitialSend.channel,
            scheduledAt: existingInitialSend.scheduledAt ?? undefined,
          });
        }

        return repository.getMessageDraft(draftId);
      }

      const draft = await repository.approveMessageDraft(draftId, input);

      // B4 fix: After approval, select A/B variant, create MessageSend, enqueue message.send
      if (draft.approvalStatus === 'APPROVED' && draft.variants.length > 0) {
        // Approval persistence is authoritative for variant selection. Once a
        // draft is already approved, later approval calls must not redirect the
        // initial send to a newly supplied variant id.
        const selectedVariant = draft.variants.find((v) => v.isSelected) ?? draft.variants[0];

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

            if (send.status === 'QUEUED') {
              await dependencies.enqueueMessageSend({
                runId: `message.send:${send.id}`,
                sendId: send.id,
                messageDraftId: send.messageDraftId,
                messageVariantId: send.messageVariantId,
                idempotencyKey: send.idempotencyKey,
                channel: send.channel,
              });
            }
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

      if (send.status === 'QUEUED') {
        try {
          await dependencies.enqueueMessageSend({
            runId: send.id,
            sendId: send.id,
            messageDraftId: send.messageDraftId,
            messageVariantId: send.messageVariantId,
            idempotencyKey: send.idempotencyKey,
            channel: send.channel,
            scheduledAt: send.scheduledAt ?? undefined,
          });
        } catch (error: unknown) {
          // Send record already created with QUEUED status — pg-boss retry will handle it
          dependencies.logger?.error({ err: error, sendId: send.id }, 'Failed to enqueue message send');
        }
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

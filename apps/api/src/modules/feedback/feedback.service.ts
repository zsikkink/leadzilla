import type {
  FeedbackSummaryQuery,
  FeedbackSummaryResponse,
  IngestFeedbackEventRequest,
  IngestFeedbackEventResponse,
  ListFeedbackEventsQuery,
  ListFeedbackEventsResponse,
} from '@lead-flood/contracts';

import type { FeedbackRepository } from './feedback.repository.js';

export class FeedbackLeadNotFoundError extends Error {
  constructor(leadId: string) {
    super(`Lead not found: ${leadId}`);
    this.name = 'FeedbackLeadNotFoundError';
  }
}

export interface FeedbackService {
  ingestFeedbackEvent(input: IngestFeedbackEventRequest): Promise<IngestFeedbackEventResponse>;
  listFeedbackEvents(query: ListFeedbackEventsQuery): Promise<ListFeedbackEventsResponse>;
  getFeedbackSummary(query: FeedbackSummaryQuery): Promise<FeedbackSummaryResponse>;
  deleteFeedbackEvent(id: string): Promise<void>;
}

export function buildFeedbackService(repository: FeedbackRepository): FeedbackService {
  return {
    async ingestFeedbackEvent(input) {
      const leadExists = await repository.leadExists(input.leadId);
      if (!leadExists) {
        throw new FeedbackLeadNotFoundError(input.leadId);
      }
      return repository.ingestFeedbackEvent(input);
    },
    async listFeedbackEvents(query) {
      // TODO: include optional grouping in response.
      return repository.listFeedbackEvents(query);
    },
    async getFeedbackSummary(query) {
      // TODO: join summary with messaging funnel context.
      return repository.getFeedbackSummary(query);
    },
    async deleteFeedbackEvent(id) {
      return repository.deleteFeedbackEvent(id);
    },
  };
}

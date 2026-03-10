import type {
  EnrichmentRunStatusResponse,
  ListEnrichmentRecordsQuery,
  ListEnrichmentRecordsResponse,
} from '@lead-flood/contracts';

import type { EnrichmentRepository } from './enrichment.repository.js';

export interface EnrichmentService {
  getEnrichmentRunStatus(runId: string): Promise<EnrichmentRunStatusResponse>;
  listEnrichmentRecords(query: ListEnrichmentRecordsQuery): Promise<ListEnrichmentRecordsResponse>;
}

export function buildEnrichmentService(
  repository: EnrichmentRepository,
): EnrichmentService {
  return {
    async getEnrichmentRunStatus(runId) {
      return repository.getEnrichmentRunStatus(runId);
    },
    async listEnrichmentRecords(query) {
      return repository.listEnrichmentRecords(query);
    },
  };
}

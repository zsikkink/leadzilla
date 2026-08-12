import type {
  AvgScoreQuery,
  AvgScoreResponse,
  CancelDiscoveryRunResponse,
  DailyQualityTrendsQuery,
  DailyQualityTrendsResponse,
  DashboardSummaryQuery,
  DashboardSummaryResponse,
  ContactRecoveryDetailResponse,
  ConversationResponse,
  CreateDiscoveryRunRequest,
  CreateDiscoveryRunResponse,
  CreateIcpProfileRequest,
  CreateLeadRequest,
  CreateLeadResponse,
  CreateManualMessageDraftRequest,
  DiscoveryRunStatusResponse,
  FeedbackSummaryResponse,
  FunnelQuery,
  FunnelResponse,
  GenerateMessageDraftResponse,
  EnrichLeadResponse,
  GetLeadResponse,
  IcpPerformanceQuery,
  IcpPerformanceResponse,
  IcpProfileResponse,
  LatestLeadDeterministicScoreResponse,
  LatestLeadFeatureSnapshotResponse,
  LatestLeadScoreQuery,
  LatestLeadScoreResponse,
  ListContactRecoveryItemsQuery,
  ListContactRecoveryItemsResponse,
  ListDiscoveryRecordsQuery,
  ListDiscoveryRecordsResponse,
  ListDiscoveryRunsQuery,
  ListDiscoveryRunsResponse,
  ListFeedbackEventsResponse,
  ListIcpProfilesQuery,
  ListIcpProfilesResponse,
  ListLeadsQuery,
  ListLeadsResponse,
  ListMessageDraftsQuery,
  ListMessageDraftsResponse,
  ListMessageSendsQuery,
  ListMessageSendsResponse,
  ListRejectedLeadsQuery,
  ListRejectedLeadsResponse,
  MessageDraftEventPayload,
  MessageDraftEventsQuery,
  MessageDraftResponse,
  MessageVariantResponse,
  ModelMetricsResponse,
  PipelineStatsResponse,
  QualificationRuleResponse,
  RetrainStatusResponse,
  ScoreDistributionResponse,
  StoredRecommendation,
  StoredRecommendationsQuery,
  StoredRecommendationsResponse,
  UpdateIcpProfileRequest,
} from '@lead-flood/contracts';

import type {
  DemoAnalyticsDashboardSnapshot,
  DemoOperationsDashboardSnapshot,
} from './demo-dashboard-types.js';
import {
  DEMO_ANALYTICS_DASHBOARD_SNAPSHOT,
  DEMO_OPERATIONS_DASHBOARD_SNAPSHOT,
} from './demo-dashboard-snapshots.js';
import {
  LIVE_ACCESS_ENDED_MESSAGE,
  LIVE_DATA_REFRESH_MESSAGE,
  toSafeApiErrorMessage,
  toSafeDisplayErrorMessage,
} from './error-messages.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId?: string | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DISCOVERY_RUN_REQUEST_TIMEOUT_MS = 120000;
const GET_RETRY_DELAY_MS = 150;
const RETRYABLE_READ_STATUSES = new Set([502, 503, 504]);

function toSearchParams(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

function isAbortError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError';
}

function isRetryableTransportError(error: unknown): boolean {
  return isAbortError(error) || error instanceof TypeError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  private async request<T>(
    path: string,
    options?: RequestInit,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const token = this.getToken();
    const hasBody = options?.body !== undefined && options?.body !== null;
    const method = options?.method?.toUpperCase() ?? 'GET';
    const maxAttempts = method === 'GET' ? 2 : 1;
    const headers: Record<string, string> = {
      // Only set content-type for requests that have a body — Fastify rejects
      // empty bodies when content-type is application/json.
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          ...options,
          signal: controller.signal,
          headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
        });
      } catch (error: unknown) {
        if (attempt < maxAttempts && isRetryableTransportError(error)) {
          clearTimeout(timeoutHandle);
          await delay(GET_RETRY_DELAY_MS);
          continue;
        }

        if (isAbortError(error)) {
          throw new ApiError(504, LIVE_DATA_REFRESH_MESSAGE);
        }
        throw new ApiError(503, LIVE_DATA_REFRESH_MESSAGE);
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (response.status === 401) {
        throw new ApiError(401, LIVE_ACCESS_ENDED_MESSAGE);
      }

      if (!response.ok) {
        if (attempt < maxAttempts && RETRYABLE_READ_STATUSES.has(response.status)) {
          await delay(GET_RETRY_DELAY_MS);
          continue;
        }

        const body = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new ApiError(
          response.status,
          toSafeApiErrorMessage(response.status, (body as { error?: string }).error),
          (body as { requestId?: string }).requestId,
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json() as Promise<T>;
    }

    throw new ApiError(503, LIVE_DATA_REFRESH_MESSAGE);
  }

  subscribeMessageDraftEvents(
    query: MessageDraftEventsQuery,
    handlers: {
      onDraftCreated: (event: MessageDraftEventPayload) => void;
      onTimeout?: (() => void) | undefined;
      onError?: ((error: Error) => void) | undefined;
    },
  ): () => void {
    const token = this.getToken();
    const controller = new AbortController();

    if (!token) {
      queueMicrotask(() => {
        handlers.onError?.(new ApiError(401, LIVE_ACCESS_ENDED_MESSAGE));
      });
      return () => controller.abort();
    }

    const parseEventBlock = (block: string) => {
      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) {
          continue;
        }
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
      }

      if (dataLines.length === 0) {
        return;
      }

      const rawData = dataLines.join('\n');
      if (eventName === 'message-draft') {
        handlers.onDraftCreated(JSON.parse(rawData) as MessageDraftEventPayload);
      } else if (eventName === 'timeout') {
        handlers.onTimeout?.();
      } else if (eventName === 'error') {
        const parsed = JSON.parse(rawData) as { error?: string };
        handlers.onError?.(
          new Error(
            toSafeDisplayErrorMessage(
              parsed.error,
              'Message draft notifications are unavailable.',
            ),
          ),
        );
      }
    };

    const qs = toSearchParams(query as Record<string, unknown>);
    void fetch(`${this.baseUrl}/v1/messaging/drafts/events?${qs}`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new ApiError(response.status, 'Message draft notifications are unavailable.');
        }
        if (!response.body) {
          throw new ApiError(503, 'Message draft notifications are unavailable.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          let separatorIndex = buffer.indexOf('\n\n');
          while (separatorIndex >= 0) {
            const block = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            parseEventBlock(block);
            separatorIndex = buffer.indexOf('\n\n');
          }
        }

        if (buffer.trim().length > 0) {
          parseEventBlock(buffer);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        handlers.onError?.(
          new Error(
            toSafeDisplayErrorMessage(
              error,
              'Message draft notifications are unavailable.',
            ),
          ),
        );
      });

    return () => controller.abort();
  }

  // ── Leads ─────────────────────────────────────────
  listLeads(query: ListLeadsQuery): Promise<ListLeadsResponse> {
    return this.request(`/v1/leads?${toSearchParams(query as Record<string, unknown>)}`);
  }

  getLead(id: string): Promise<GetLeadResponse> {
    return this.request(`/v1/leads/${id}`);
  }

  listRejectedLeads(query?: ListRejectedLeadsQuery): Promise<ListRejectedLeadsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/leads/rejected${qs}`);
  }

  listContactRecoveryItems(query: ListContactRecoveryItemsQuery): Promise<ListContactRecoveryItemsResponse> {
    return this.request(`/v1/leads/recovery?${toSearchParams(query as Record<string, unknown>)}`);
  }

  getContactRecoveryItem(id: string): Promise<ContactRecoveryDetailResponse> {
    return this.request(`/v1/leads/recovery/${id}`);
  }

  rejectContactRecoveryItem(
    id: string,
    data?: { reason?: string | undefined },
  ): Promise<ContactRecoveryDetailResponse> {
    return this.request(`/v1/leads/recovery/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify(data ?? {}),
    });
  }

  createLead(data: CreateLeadRequest): Promise<CreateLeadResponse> {
    return this.request('/v1/leads', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  createBackupLead(sourceLeadId: string, data: CreateLeadRequest): Promise<CreateLeadResponse> {
    return this.request(`/v1/leads/${sourceLeadId}/backup-contact`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ── ICPs ──────────────────────────────────────────
  listIcps(query?: ListIcpProfilesQuery): Promise<ListIcpProfilesResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/icps${qs}`);
  }

  getIcp(icpId: string): Promise<IcpProfileResponse> {
    return this.request(`/v1/icps/${icpId}`);
  }

  getIcpRules(icpId: string): Promise<{ items: QualificationRuleResponse[] }> {
    return this.request(`/v1/icps/${icpId}/rules`);
  }

  replaceIcpRules(
    icpId: string,
    data: { rules: Array<{
      name: string;
      fieldKey: string;
      operator: string;
      valueJson: unknown;
      isRequired?: boolean | undefined;
      weight?: number | null | undefined;
      orderIndex: number;
      priority?: number | undefined;
      ruleType?: 'WEIGHTED' | 'HARD_FILTER' | undefined;
      isActive?: boolean | undefined;
    }> },
  ): Promise<{ items: QualificationRuleResponse[] }> {
    return this.request(`/v1/icps/${icpId}/rules`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  createIcp(data: CreateIcpProfileRequest): Promise<IcpProfileResponse> {
    return this.request('/v1/icps', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateIcp(icpId: string, data: UpdateIcpProfileRequest): Promise<IcpProfileResponse> {
    return this.request(`/v1/icps/${icpId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  deleteIcp(icpId: string): Promise<void> {
    return this.request(`/v1/icps/${icpId}`, {
      method: 'DELETE',
    });
  }

  // ── Scoring ───────────────────────────────────────
  getLatestLeadScore(
    leadId: string,
    query?: LatestLeadScoreQuery,
  ): Promise<LatestLeadScoreResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/scoring/leads/${leadId}/latest${qs}`);
  }

  getLatestLeadFeatureSnapshot(
    leadId: string,
    query?: LatestLeadScoreQuery,
  ): Promise<LatestLeadFeatureSnapshotResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/scoring/leads/${leadId}/latest-feature-snapshot${qs}`);
  }

  getLatestLeadDeterministicScore(
    leadId: string,
    query?: LatestLeadScoreQuery,
  ): Promise<LatestLeadDeterministicScoreResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/scoring/leads/${leadId}/latest-deterministic${qs}`);
  }

  // ── Messaging ─────────────────────────────────────
  listDrafts(query?: ListMessageDraftsQuery): Promise<ListMessageDraftsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/messaging/drafts${qs}`);
  }

  getDraft(draftId: string): Promise<MessageDraftResponse> {
    return this.request(`/v1/messaging/drafts/${draftId}`);
  }

  approveDraft(draftId: string, data: { approvedByUserId: string; selectedVariantId?: string | undefined }): Promise<MessageDraftResponse> {
    return this.request(`/v1/messaging/drafts/${draftId}/approve`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  rejectDraft(draftId: string, data: { rejectedByUserId: string; rejectedReason: string }): Promise<MessageDraftResponse> {
    return this.request(`/v1/messaging/drafts/${draftId}/reject`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  generateDraft(data: {
    leadId: string;
    icpProfileId: string;
    scorePredictionId?: string | undefined;
    channel?: string | undefined;
    promptVersion: string;
    forceRegenerate?: boolean | undefined;
    redraftFeedback?: string | undefined;
  }): Promise<GenerateMessageDraftResponse> {
    return this.request('/v1/messaging/drafts/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  enrichLead(leadId: string): Promise<EnrichLeadResponse> {
    return this.request(`/v1/leads/${leadId}/enrich`, {
      method: 'POST',
    });
  }

  createManualDraft(data: CreateManualMessageDraftRequest): Promise<MessageDraftResponse> {
    return this.request('/v1/messaging/drafts/manual', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateVariant(variantId: string, data: { bodyText: string; subject?: string | undefined }): Promise<MessageVariantResponse> {
    return this.request(`/v1/messaging/variants/${variantId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  sendMessage(data: { messageDraftId: string; messageVariantId: string; idempotencyKey: string }): Promise<unknown> {
    return this.request('/v1/messaging/sends', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  listSends(query?: ListMessageSendsQuery): Promise<ListMessageSendsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/messaging/sends${qs}`);
  }

  getConversation(leadId: string): Promise<ConversationResponse> {
    return this.request(`/v1/messaging/conversations/${leadId}`);
  }

  // ── Analytics ─────────────────────────────────────
  getDashboardSummary(query?: DashboardSummaryQuery): Promise<DashboardSummaryResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/dashboard-summary${qs}`);
  }

  getDemoOperationsDashboard(): Promise<DemoOperationsDashboardSnapshot> {
    return Promise.resolve(DEMO_OPERATIONS_DASHBOARD_SNAPSHOT);
  }

  getDemoAnalyticsDashboard(): Promise<DemoAnalyticsDashboardSnapshot> {
    return Promise.resolve(DEMO_ANALYTICS_DASHBOARD_SNAPSHOT);
  }

  getFunnel(query?: FunnelQuery): Promise<FunnelResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/funnel${qs}`);
  }

  getScoreDistribution(query?: Record<string, unknown>): Promise<ScoreDistributionResponse> {
    const qs = query ? `?${toSearchParams(query)}` : '';
    return this.request(`/v1/analytics/score-distribution${qs}`);
  }

  getDailyQualityTrends(query?: DailyQualityTrendsQuery): Promise<DailyQualityTrendsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/daily-quality-trends${qs}`);
  }

  getAvgScore(query?: AvgScoreQuery): Promise<AvgScoreResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/avg-score${qs}`);
  }

  getIcpPerformance(query?: IcpPerformanceQuery): Promise<IcpPerformanceResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/icp-performance${qs}`);
  }

  getModelMetrics(query?: Record<string, unknown>): Promise<ModelMetricsResponse> {
    const qs = query ? `?${toSearchParams(query)}` : '';
    return this.request(`/v1/analytics/model-metrics${qs}`);
  }

  getRetrainStatus(): Promise<RetrainStatusResponse> {
    return this.request('/v1/analytics/retrain-status');
  }

  getStoredRecommendations(query?: StoredRecommendationsQuery): Promise<StoredRecommendationsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/recommendations${qs}`);
  }

  updateRecommendationStatus(id: string, status: StoredRecommendation['status']): Promise<StoredRecommendation> {
    return this.request(`/v1/analytics/recommendations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  // ── Feedback ──────────────────────────────────────
  getFeedbackSummary(query?: Record<string, unknown>): Promise<FeedbackSummaryResponse> {
    const qs = query ? `?${toSearchParams(query)}` : '';
    return this.request(`/v1/feedback/summary${qs}`);
  }

  listFeedbackEvents(query?: Record<string, unknown>): Promise<ListFeedbackEventsResponse> {
    const qs = query ? `?${toSearchParams(query)}` : '';
    return this.request(`/v1/feedback/events${qs}`);
  }

  deleteFeedbackEvent(eventId: string): Promise<void> {
    return this.request(`/v1/feedback/events/${eventId}`, {
      method: 'DELETE',
    });
  }

  // ── Discovery ───────────────────────────────────
  createDiscoveryRun(data: CreateDiscoveryRunRequest): Promise<CreateDiscoveryRunResponse> {
    return this.request(
      '/v1/discovery/runs',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      DISCOVERY_RUN_REQUEST_TIMEOUT_MS,
    );
  }

  getDiscoveryRunStatus(runId: string): Promise<DiscoveryRunStatusResponse> {
    return this.request(`/v1/discovery/runs/${runId}`);
  }

  cancelDiscoveryRun(runId: string): Promise<CancelDiscoveryRunResponse> {
    return this.request(`/v1/discovery/runs/${runId}/cancel`, {
      method: 'POST',
    });
  }

  listDiscoveryRecords(query?: ListDiscoveryRecordsQuery): Promise<ListDiscoveryRecordsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/discovery/records${qs}`);
  }

  listDiscoveryRuns(query?: ListDiscoveryRunsQuery): Promise<ListDiscoveryRunsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/discovery/runs${qs}`);
  }

  getDiscoveryRunDetails(runId: string): Promise<{
    run: Record<string, unknown>;
    searchTasks: Array<{ id: string; queryText: string; countryCode: string; city: string | null; status: string; resultsCount: number; provider: string; error: string | null }>;
    businesses: Array<{
      id: string;
      name: string;
      websiteDomain: string | null;
      deterministicScore: number | null;
      scoreBand: string | null;
      preQualified: boolean;
      disqualificationReason: string | null;
      searchTaskId: string | null;
      recoveryItem: {
        status: string;
        reason: string;
        evidenceScore: number | null;
        candidateCount: number | null;
        updatedAt: string;
        telemetry: Record<string, unknown> | null;
      } | null;
    }>;
    leads: Array<{
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      businessEmail: string | null;
      source: string;
      blendedScore: number | null;
      scoreBand: string | null;
      status: string;
      businessId: string;
      businessName: string;
      businessDeterministicScore: number | null;
      businessScoreBand: string | null;
    }>;
    costEvents: Array<{ id: string; provider: string; action: string; creditCost: number; createdAt: string }>;
  }> {
    return this.request(`/v1/discovery/runs/${runId}/details`);
  }

  previewCategories(industries: string[]): Promise<{
    mappings: Array<{
      industry: string;
      categories: string[];
      source: 'mapped' | 'fuzzy' | 'direct';
    }>;
  }> {
    return this.request('/v1/discovery/preview-categories', {
      method: 'POST',
      body: JSON.stringify({ industries }),
    });
  }

  getPipelineStats(): Promise<PipelineStatsResponse> {
    return this.request('/v1/stats/pipeline');
  }

  // ── Business Contacts ───────────────────────────
  createBusinessContact(data: {
    businessId: string;
    name: string;
    title?: string | undefined;
    email?: string | undefined;
    phone?: string | undefined;
    linkedinUrl?: string | undefined;
  }): Promise<unknown> {
    return this.request('/v1/business-contacts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateBusinessContact(
    id: string,
    data: { name?: string; title?: string | null; email?: string | null; phone?: string | null },
  ): Promise<{
    id: string;
    businessId: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    positionRank: number;
    seniority: string;
    source: string;
    updatedAt: string;
  }> {
    return this.request(`/v1/business-contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  deleteBusinessContact(id: string): Promise<void> {
    return this.request(`/v1/business-contacts/${id}`, {
      method: 'DELETE',
    });
  }

  setBusinessContactPrimary(id: string, businessId: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/business-contacts/${id}/primary`, {
      method: 'PATCH',
      body: JSON.stringify({ businessId }),
    });
  }


  // ── Settings ───────────────────────────────────
  listPipelineSettings(): Promise<{ items: { key: string; value: unknown; updatedAt: string }[] }> {
    return this.request('/v1/settings/pipeline');
  }

  getPipelineSetting(key: string): Promise<{ key: string; value: unknown; updatedAt: string }> {
    return this.request(`/v1/settings/pipeline/${key}`);
  }

  updatePipelineSetting(key: string, value: unknown): Promise<{ key: string; value: unknown; updatedAt: string }> {
    return this.request(`/v1/settings/pipeline/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }
}

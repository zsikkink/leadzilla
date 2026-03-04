import type {
  ConversationResponse,
  CreateDiscoveryRunRequest,
  CreateDiscoveryRunResponse,
  CreateIcpProfileRequest,
  CreateLeadRequest,
  CreateLeadResponse,
  DiscoveryRunStatusResponse,
  FeedbackSummaryResponse,
  ListFeedbackEventsResponse,
  FunnelQuery,
  FunnelResponse,
  GetLeadResponse,
  IcpProfileResponse,
  ListDiscoveryRecordsQuery,
  ListDiscoveryRecordsResponse,
  ListDiscoveryRunsQuery,
  ListDiscoveryRunsResponse,
  ListIcpProfilesQuery,
  ListIcpProfilesResponse,
  ListLeadsQuery,
  ListLeadsResponse,
  ListMessageDraftsQuery,
  ListMessageDraftsResponse,
  ListMessageSendsQuery,
  ListMessageSendsResponse,
  ManagerRecommendationsQuery,
  ManagerRecommendationsResponse,
  MessageDraftResponse,
  ModelMetricsResponse,
  PipelineStatsResponse,
  QualificationRuleResponse,
  RetrainStatusResponse,
  ScoreDistributionResponse,
  UpdateIcpProfileRequest,
} from '@lead-flood/contracts';

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

function toSearchParams(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
    private readonly requestTimeoutMs = 10000,
  ) {}

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(504, `API request timed out after ${this.requestTimeoutMs}ms`);
      }
      throw new ApiError(503, 'Unable to reach API. Check NEXT_PUBLIC_API_BASE_URL and API health.');
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (response.status === 401) {
      throw new ApiError(401, 'Session expired — please log in again');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new ApiError(
        response.status,
        (body as { error?: string }).error ?? 'Request failed',
        (body as { requestId?: string }).requestId,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // ── Leads ─────────────────────────────────────────
  listLeads(query: ListLeadsQuery): Promise<ListLeadsResponse> {
    return this.request(`/v1/leads?${toSearchParams(query as Record<string, unknown>)}`);
  }

  getLead(id: string): Promise<GetLeadResponse> {
    return this.request(`/v1/leads/${id}`);
  }

  createLead(data: CreateLeadRequest): Promise<CreateLeadResponse> {
    return this.request('/v1/leads', {
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
  getFunnel(query?: FunnelQuery): Promise<FunnelResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/funnel${qs}`);
  }

  getScoreDistribution(query?: Record<string, unknown>): Promise<ScoreDistributionResponse> {
    const qs = query ? `?${toSearchParams(query)}` : '';
    return this.request(`/v1/analytics/score-distribution${qs}`);
  }

  getModelMetrics(query?: Record<string, unknown>): Promise<ModelMetricsResponse> {
    const qs = query ? `?${toSearchParams(query)}` : '';
    return this.request(`/v1/analytics/model-metrics${qs}`);
  }

  getRetrainStatus(): Promise<RetrainStatusResponse> {
    return this.request('/v1/analytics/retrain-status');
  }

  getManagerRecommendations(query?: ManagerRecommendationsQuery): Promise<ManagerRecommendationsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/manager-recommendations${qs}`);
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

  // ── Discovery ───────────────────────────────────
  createDiscoveryRun(data: CreateDiscoveryRunRequest): Promise<CreateDiscoveryRunResponse> {
    return this.request('/v1/discovery/runs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getDiscoveryRunStatus(runId: string): Promise<DiscoveryRunStatusResponse> {
    return this.request(`/v1/discovery/runs/${runId}`);
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
    searchTasks: Array<{ id: string; queryText: string; countryCode: string; city: string | null; status: string; resultsCount: number; provider: string }>;
    businesses: Array<{ id: string; name: string; websiteDomain: string | null; deterministicScore: number | null; scoreBand: string | null; preQualified: boolean; disqualificationReason: string | null }>;
    leads: Array<Record<string, unknown>>;
    costEvents: Array<{ id: string; provider: string; action: string; creditCost: number; createdAt: string }>;
  }> {
    return this.request(`/v1/discovery/runs/${runId}/details`);
  }

  getPipelineStats(): Promise<PipelineStatsResponse> {
    return this.request('/v1/stats/pipeline');
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

import type {
  AvgScoreResponse,
  DailyQualityTrendsQuery,
  DailyQualityTrendsResponse,
  ContactRecoveryDetailResponse,
  ConversationResponse,
  CreateDiscoveryRunRequest,
  CreateDiscoveryRunResponse,
  CreateIcpProfileRequest,
  CreateLeadRequest,
  CreateLeadResponse,
  DiscoveryRunStatusResponse,
  FeedbackSummaryResponse,
  FunnelQuery,
  FunnelResponse,
  GenerateMessageDraftResponse,
  GetLeadResponse,
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
  MessageDraftResponse,
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
  }): Promise<GenerateMessageDraftResponse> {
    return this.request('/v1/messaging/drafts/generate', {
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

  getDailyQualityTrends(query?: DailyQualityTrendsQuery): Promise<DailyQualityTrendsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/daily-quality-trends${qs}`);
  }

  getAvgScore(): Promise<AvgScoreResponse> {
    return this.request('/v1/analytics/avg-score');
  }

  getIcpPerformance(): Promise<IcpPerformanceResponse> {
    return this.request('/v1/analytics/icp-performance');
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
    leads: Array<Record<string, unknown>>;
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

import {
  AdminBusinessDetailResponseSchema,
  AdminListBusinessesQuerySchema,
  AdminListBusinessesResponseSchema,
  AdminLeadDetailResponseSchema,
  AdminListLeadsQuerySchema,
  AdminListLeadsResponseSchema,
  AdminListSearchTasksQuerySchema,
  AdminListSearchTasksResponseSchema,
  AdminSearchTaskDetailResponseSchema,
  JobRequestListQuerySchema,
  JobRequestListResponseSchema,
  JobRunDetailResponseSchema,
  JobRunListQuerySchema,
  ListJobRunsResponseSchema,
  RunDiscoverySeedRequestSchema,
  RunDiscoveryTasksRequestSchema,
  TriggerJobRunResponseSchema,
  type AdminLeadDetailResponse,
  type AdminBusinessDetailResponse,
  type AdminListBusinessesQuery,
  type AdminListBusinessesResponse,
  type AdminListLeadsQuery,
  type AdminListLeadsResponse,
  type AdminListSearchTasksQuery,
  type AdminListSearchTasksResponse,
  type AdminSearchTaskDetailResponse,
  type JobRequestListQuery,
  type JobRequestListResponse,
  type JobRunDetailResponse,
  type JobRunListQuery,
  type ListJobRunsResponse,
  type RunDiscoverySeedRequest,
  type RunDiscoveryTasksRequest,
  type TriggerJobRunResponse,
} from '@lead-flood/contracts';

import { getWebEnv } from './env.js';
import { toSafeApiErrorMessage } from './error-messages.js';
import { withAppBasePath } from './app-path.js';

export type { JobRequestListQuery, JobRequestListResponse } from '@lead-flood/contracts';

const AUTH_TOKEN_STORAGE_KEY = 'lf_access_token';

export class AdminProxyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdminProxyError';
  }
}

function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded.length > 0 ? `?${encoded}` : '';
}

function parseQueryString(query: string): Record<string, string> {
  const search = query.startsWith('?') ? query.slice(1) : query;
  return Object.fromEntries(new URLSearchParams(search));
}

function readStoredAccessToken(): string | null {
  if (typeof globalThis.localStorage === 'undefined') {
    return null;
  }

  const token = globalThis.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
}

async function getAdminProxyAccessToken(): Promise<string | null> {
  const storedToken = readStoredAccessToken();
  if (storedToken) {
    return storedToken;
  }

  const env = getWebEnv();
  if (
    process.env.NODE_ENV !== 'production' &&
    env.NEXT_PUBLIC_SUPABASE_URL === 'https://example.supabase.co'
  ) {
    return null;
  }

  throw new Error('Not authenticated');
}

async function requestAdminProxy<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  init?: RequestInit,
): Promise<T> {
  const accessToken = await getAdminProxyAccessToken();
  const headers = new Headers(init?.headers);
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(withAppBasePath(`/api/admin/${path}`), {
      ...init,
      headers,
    });
  } catch {
    throw new Error('Unable to reach admin API');
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AdminProxyError(
      response.status,
      toSafeApiErrorMessage(
        response.status,
        (body as { error?: string } | null)?.error,
      ),
    );
  }

  return schema.parse(body);
}

export function queryFromLeadFilters(query: AdminListLeadsQuery): string {
  return toQuery({
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    scoreMin: query.scoreMin,
    scoreMax: query.scoreMax,
    countries: query.countries?.join(','),
    city: query.city,
    industries: query.industries?.join(','),
    hasWhatsapp: query.hasWhatsapp,
    hasInstagram: query.hasInstagram,
    acceptsOnlinePayments: query.acceptsOnlinePayments,
    recentlyActive: query.recentlyActive,
    minReviewCount: query.minReviewCount,
    minFollowerCount: query.minFollowerCount,
    from: query.from,
    to: query.to,
  });
}

export function queryFromBusinessFilters(query: AdminListBusinessesQuery): string {
  return toQuery({
    page: query.page,
    pageSize: query.pageSize,
    q: query.q,
  });
}

export function queryFromSearchTaskFilters(query: AdminListSearchTasksQuery): string {
  return toQuery({
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    status: query.status,
    taskType: query.taskType,
    countryCode: query.countryCode,
    timeBucket: query.timeBucket,
  });
}

export function queryFromJobRunFilters(query: JobRunListQuery): string {
  return toQuery({
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    jobName: query.jobName,
  });
}

export function queryFromJobRequestFilters(query: JobRequestListQuery): string {
  return toQuery({
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    requestType: query.requestType,
  });
}

export async function checkDiscoveryAdminAccess(): Promise<void> {
  await requestAdminProxy(
    `search-tasks${queryFromSearchTaskFilters({
      page: 1,
      pageSize: 1,
      sortBy: 'updated_desc',
    })}`,
    AdminListSearchTasksResponseSchema,
  );
}

export async function fetchAdminLeads(query: string): Promise<AdminListLeadsResponse> {
  const parsed = AdminListLeadsQuerySchema.parse(parseQueryString(query));
  return requestAdminProxy(
    `leads${queryFromLeadFilters(parsed)}`,
    AdminListLeadsResponseSchema,
  );
}

export async function fetchAdminLeadDetail(id: string): Promise<AdminLeadDetailResponse> {
  const leadId = id.trim();
  if (!leadId) {
    throw new Error('Lead not found');
  }
  return requestAdminProxy(
    `leads/${encodeURIComponent(leadId)}`,
    AdminLeadDetailResponseSchema,
  );
}

export async function fetchAdminBusinesses(query: string): Promise<AdminListBusinessesResponse> {
  const parsed = AdminListBusinessesQuerySchema.parse(parseQueryString(query));
  return requestAdminProxy(
    `businesses${queryFromBusinessFilters(parsed)}`,
    AdminListBusinessesResponseSchema,
  );
}

export async function fetchAdminBusinessDetail(id: string): Promise<AdminBusinessDetailResponse> {
  const businessId = id.trim();
  if (!businessId) {
    throw new Error('Business not found');
  }
  return requestAdminProxy(
    `businesses/${encodeURIComponent(businessId)}`,
    AdminBusinessDetailResponseSchema,
  );
}

export async function fetchAdminSearchTasks(query: string): Promise<AdminListSearchTasksResponse> {
  const parsed = AdminListSearchTasksQuerySchema.parse(parseQueryString(query));
  return requestAdminProxy(
    `search-tasks${queryFromSearchTaskFilters(parsed)}`,
    AdminListSearchTasksResponseSchema,
  );
}

export async function fetchAdminSearchTaskDetail(id: string): Promise<AdminSearchTaskDetailResponse> {
  const taskId = id.trim();
  if (!taskId) {
    throw new Error('Search task not found');
  }
  return requestAdminProxy(
    `search-tasks/${encodeURIComponent(taskId)}`,
    AdminSearchTaskDetailResponseSchema,
  );
}

export async function fetchJobRuns(query: string): Promise<ListJobRunsResponse> {
  const parsed = JobRunListQuerySchema.parse(parseQueryString(query));
  return requestAdminProxy(
    `jobs/runs${queryFromJobRunFilters(parsed)}`,
    ListJobRunsResponseSchema,
  );
}

export async function fetchJobRunDetail(id: string): Promise<JobRunDetailResponse> {
  const runId = id.trim();
  if (!runId) {
    throw new Error('Job run not found');
  }
  return requestAdminProxy(`jobs/runs/${encodeURIComponent(runId)}`, JobRunDetailResponseSchema);
}

export async function fetchJobRequests(query: string): Promise<JobRequestListResponse> {
  const parsed = JobRequestListQuerySchema.parse(parseQueryString(query));
  return requestAdminProxy(
    `jobs/requests${queryFromJobRequestFilters(parsed)}`,
    {
      parse: (value: unknown): JobRequestListResponse =>
        JobRequestListResponseSchema.parse(value) as JobRequestListResponse,
    },
  );
}

export async function triggerDiscoverySeed(
  payload: RunDiscoverySeedRequest,
): Promise<TriggerJobRunResponse> {
  const parsed = RunDiscoverySeedRequestSchema.parse(payload);
  return requestAdminProxy('jobs/discovery/seed', TriggerJobRunResponseSchema, {
    method: 'POST',
    body: JSON.stringify(parsed),
  });
}

export async function triggerDiscoveryRun(
  payload: RunDiscoveryTasksRequest,
): Promise<TriggerJobRunResponse> {
  const parsed = RunDiscoveryTasksRequestSchema.parse(payload);
  return requestAdminProxy('jobs/discovery/run', TriggerJobRunResponseSchema, {
    method: 'POST',
    body: JSON.stringify(parsed),
  });
}

// ── Scoring Rules ─────────────────────────────────────────────────────────

export interface CreateScoringRulePayload {
  icpProfileId: string;
  name: string;
  fieldKey: string;
  ruleType: 'WEIGHTED' | 'HARD_FILTER';
  operator: string;
  valueJson: unknown;
  weight: number;
}

/**
 * Known field keys accepted by POST /v1/scoring/rules.
 * Source: apps/api/src/modules/scoring/scoring.routes.ts → KNOWN_FIELD_KEYS
 */
export const KNOWN_SCORING_FIELD_KEYS = [
  'industry_supported', 'has_whatsapp', 'has_instagram', 'accepts_online_payments',
  'review_count', 'follower_count', 'physical_address_present', 'recent_activity',
  'custom_order_signals', 'pure_self_serve_ecom', 'shopify_detected', 'multi_staff_detected',
  'follower_growth_signal', 'high_engagement_signal', 'has_booking_or_contact_form',
  'variable_pricing_detected', 'industry_match', 'geo_match', 'high_ticket_signals',
  'deposit_milestone_signals', 'subscription_billing_detected', 'international_customer_signals',
  'icp_segment_priority', 'review_count_tier', 'follower_count_tier', 'bank_transfer_reliance',
  'upsell_signals', 'apify_payment_widget_count', 'apify_has_shopify', 'apify_has_booking_form',
  'apify_has_pricing_tiers', 'apify_has_product_catalog', 'instagram_follower_count',
  'instagram_engagement_rate', 'instagram_is_business_account', 'instagram_days_since_last_post',
  'instagram_has_bio_link', 'has_decision_maker_phone', 'decision_maker_count',
  'apollo_has_direct_phone', 'website_email_count', 'website_phone_count', 'social_link_count',
  'has_linkedin', 'tech_stack_size', 'has_crm', 'has_live_chat', 'has_analytics',
  'estimated_employees', 'certification_count', 'instagram_has_business_email',
  'data_alignment_score',
] as const;

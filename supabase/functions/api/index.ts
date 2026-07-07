import {
  ENRICHED_LEAD_STATUSES,
  MESSAGED_LEAD_STATUSES,
  QUALIFIED_LEAD_STATUSES,
  SCORED_LEAD_STATUSES,
  SENT_MESSAGE_STATUSES,
} from '../../../packages/contracts/src/metrics.contract.ts';

type JsonObject = Record<string, unknown>;
type Row = Record<string, unknown>;

const DEFAULT_CORS_ORIGINS: string[] = [];
const DEMO_DISABLED_MESSAGE =
  'This demo API is read-only. Discovery, enrichment, messaging, outbound sends, and other worker-backed actions are disabled.';
const MAX_DEMO_ROWS = 1000;
const STATS_PAGE_SIZE = 1000;
const STATS_IN_FILTER_CHUNK_SIZE = 200;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly expose = true,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface AuthContext {
  userId: string;
  email: string | null;
}

interface RestResult<T> {
  data: T;
  total: number | null;
}

function readEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new HttpError(500, `${name} is not configured`, false);
  }
  return value.replace(/\/+$/, '');
}

function supabaseUrl(): string {
  return readEnv('SUPABASE_URL');
}

function anonKey(): string {
  return readEnv('SUPABASE_ANON_KEY');
}

function serviceRoleKey(): string {
  // This Edge Function is a read-only demo adapter. It uses the service role
  // only for PostgREST reads; worker-backed and mutating routes return 403.
  return readEnv('SUPABASE_SERVICE_ROLE_KEY');
}

function corsOrigins(): string[] {
  const configured = Deno.env.get('LEADZILLA_CORS_ORIGINS');
  if (!configured) {
    return DEFAULT_CORS_ORIGINS;
  }

  return configured
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function buildCorsHeaders(request: Request): Headers {
  const headers = new Headers({
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-admin-key',
    'access-control-max-age': '86400',
    vary: 'Origin',
  });

  const origin = request.headers.get('origin');
  if (origin && corsOrigins().includes(origin)) {
    headers.set('access-control-allow-origin', origin);
  }

  return headers;
}

function withCors(response: Response, corsHeaders: Headers): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders.entries()) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      { error: error.expose ? error.message : 'Internal server error' },
      error.status,
    );
  }

  console.error('[demo-edge-api] unhandled error', error);
  return jsonResponse({ error: 'Internal server error' }, 500);
}

function parseContentRange(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function appendParams(url: URL, params: Record<string, string | number | boolean | undefined | null>): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

async function restRequest<T>(
  table: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
  init: RequestInit = {},
): Promise<RestResult<T>> {
  const key = serviceRoleKey();
  const url = new URL(`${supabaseUrl()}/rest/v1/${encodeURIComponent(table)}`);
  appendParams(url, params);

  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  headers.set('authorization', `Bearer ${key}`);
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (!headers.has('prefer')) {
    headers.set('prefer', 'count=exact');
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[demo-edge-api] rest request failed', {
      table,
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new HttpError(502, 'Database query failed', false);
  }

  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as T) : (undefined as T);
  return {
    data,
    total: parseContentRange(response.headers.get('content-range')),
  };
}

async function listRows(
  table: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<RestResult<Row[]>> {
  return restRequest<Row[]>(table, params);
}

async function singleRow(
  table: string,
  params: Record<string, string | number | boolean | undefined | null>,
): Promise<Row | null> {
  const result = await listRows(table, { ...params, limit: 1 });
  return result.data[0] ?? null;
}

async function countRows(
  table: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<number> {
  const result = await listRows(table, { ...params, select: 'id', limit: 1 });
  return result.total ?? 0;
}

async function listAllRows(
  table: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<Row[]> {
  const rows: Row[] = [];
  let offset = 0;

  while (true) {
    const result = await listRows(table, {
      ...params,
      offset,
      limit: STATS_PAGE_SIZE,
    });
    rows.push(...result.data);

    if (result.data.length < STATS_PAGE_SIZE) {
      break;
    }
    if (result.total !== null && rows.length >= result.total) {
      break;
    }

    offset += STATS_PAGE_SIZE;
  }

  return rows;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function countRowsWithOptionalInChunks(
  table: string,
  params: Record<string, string | number | boolean | undefined | null>,
  column: string,
  values: string[] | null,
): Promise<number> {
  if (values === null) {
    return countRows(table, params);
  }
  if (values.length === 0) {
    return 0;
  }

  const counts = await Promise.all(
    chunks(values, STATS_IN_FILTER_CHUNK_SIZE).map((chunk) =>
      countRows(table, { ...params, [column]: pgIn(chunk) }),
    ),
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

async function listRowsWithOptionalInChunks(
  table: string,
  params: Record<string, string | number | boolean | undefined | null>,
  column: string,
  values: string[] | null,
): Promise<Row[]> {
  if (values === null) {
    return listAllRows(table, params);
  }
  if (values.length === 0) {
    return [];
  }

  const rows = await Promise.all(
    chunks(values, STATS_IN_FILTER_CHUNK_SIZE).map((chunk) =>
      listAllRows(table, { ...params, [column]: pgIn(chunk) }),
    ),
  );
  return rows.flat();
}

function extractRoutePath(pathname: string): string {
  if (pathname === '/api') {
    return '/';
  }
  if (pathname.startsWith('/v1/') || pathname === '/v1' || pathname === '/health' || pathname === '/ready') {
    return pathname;
  }
  const marker = '/api/';
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex >= 0) {
    return `/${pathname.slice(markerIndex + marker.length)}`;
  }
  return pathname;
}

function pathParts(routePath: string): string[] {
  return routePath.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function parseBoolean(value: string | null, fallback = false): boolean {
  if (value === null) {
    return fallback;
  }
  return value === 'true' || value === '1';
}

function csv(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function pgIn(values: readonly string[]): string {
  return `in.(${values.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')})`;
}

function applyDateRange(
  params: Record<string, string | number>,
  column: string,
  from: string | null,
  to: string | null,
): void {
  if (from && to) {
    params.and = `(${column}.gte.${from},${column}.lte.${to})`;
    return;
  }

  if (from) {
    params[column] = `gte.${from}`;
    return;
  }

  if (to) {
    params[column] = `lte.${to}`;
  }
}

function ilikePattern(value: string): string {
  return `*${value.replace(/[*(),]/g, ' ').trim()}*`;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function firstValue(row: Row | null | undefined, ...keys: string[]): unknown {
  if (!row) {
    return undefined;
  }
  for (const key of keys) {
    if (row[key] !== undefined) {
      return row[key];
    }
  }
  return undefined;
}

function normalizeBusinessRow(row: Row | null | undefined): Row | undefined {
  if (!row) {
    return undefined;
  }
  return {
    ...row,
    countryCode: firstValue(row, 'countryCode', 'country_code'),
    phoneE164: firstValue(row, 'phoneE164', 'phone_e164'),
    websiteDomain: firstValue(row, 'websiteDomain', 'website_domain'),
    instagramHandle: firstValue(row, 'instagramHandle', 'instagram_handle'),
    reviewCount: firstValue(row, 'reviewCount', 'review_count'),
    deterministicScore: firstValue(row, 'deterministicScore', 'deterministic_score'),
    scoreBand: firstValue(row, 'scoreBand', 'score_band'),
    hasWhatsapp: firstValue(row, 'hasWhatsapp', 'has_whatsapp'),
    hasInstagram: firstValue(row, 'hasInstagram', 'has_instagram'),
    acceptsOnlinePayments: firstValue(row, 'acceptsOnlinePayments', 'accepts_online_payments'),
    followerCount: firstValue(row, 'followerCount', 'follower_count'),
    physicalAddressPresent: firstValue(row, 'physicalAddressPresent', 'physical_address_present'),
    recentActivity: firstValue(row, 'recentActivity', 'recent_activity'),
    apifyWebsiteScrapeJson: firstValue(row, 'apifyWebsiteScrapeJson', 'apify_website_scrape_json'),
    apifyInstagramScrapeJson: firstValue(row, 'apifyInstagramScrapeJson', 'apify_instagram_scrape_json'),
    websiteScrapedAt: firstValue(row, 'websiteScrapedAt', 'website_scraped_at'),
    instagramScrapedAt: firstValue(row, 'instagramScrapedAt', 'instagram_scraped_at'),
    discoveryRunId: firstValue(row, 'discoveryRunId', 'discovery_run_id'),
    preQualified: firstValue(row, 'preQualified', 'pre_qualified'),
    disqualificationReason: firstValue(row, 'disqualificationReason', 'disqualification_reason'),
    createdAt: firstValue(row, 'createdAt', 'created_at'),
    updatedAt: firstValue(row, 'updatedAt', 'updated_at'),
  };
}

function normalizeJobRunRow(row: Row): Row {
  return {
    ...row,
    jobName: firstValue(row, 'jobName', 'job_name'),
    startedAt: firstValue(row, 'startedAt', 'started_at'),
    finishedAt: firstValue(row, 'finishedAt', 'finished_at'),
    durationMs: firstValue(row, 'durationMs', 'duration_ms'),
    paramsJson: firstValue(row, 'paramsJson', 'params_json'),
    countersJson: firstValue(row, 'countersJson', 'counters_json'),
    resourceJson: firstValue(row, 'resourceJson', 'resource_json'),
    errorText: firstValue(row, 'errorText', 'error_text'),
    createdAt: firstValue(row, 'createdAt', 'created_at'),
    updatedAt: firstValue(row, 'updatedAt', 'updated_at'),
  };
}

function iso(value: unknown): string {
  if (typeof value === 'string' || value instanceof Date) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date(0).toISOString();
}

function nullableIso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return iso(value);
}

function scoreTier(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 0.67) {
    return 'HIGH';
  }
  if (score >= 0.34) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function mapJobStatus(status: string, failedItems = 0): 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'CANCELLED' {
  if (status === 'queued') return 'QUEUED';
  if (status === 'running') return 'RUNNING';
  if (status === 'failed') return 'FAILED';
  if (status === 'cancelled') return 'CANCELLED';
  return failedItems > 0 ? 'PARTIAL' : 'SUCCEEDED';
}

function readRunProgress(result: unknown): { totalItems: number; processedItems: number; failedItems: number } {
  const payload = asObject(result) ?? {};
  const newFound = asNumber(payload.newFound, 0);
  const newBusinesses = asNumber(payload.newBusinesses, 0);
  const totalItems = newFound > 0 ? newFound : newBusinesses > 0 ? newBusinesses : asNumber(payload.totalItems, 0);
  const explicitLeadFailures = asNumber(payload.leadFailedItems, 0);
  const failedItems =
    explicitLeadFailures > 0
      ? explicitLeadFailures
      : Math.max(0, asNumber(payload.failedItems, 0) - asNumber(payload.disqualified, 0));

  return {
    totalItems,
    processedItems: asNumber(payload.processedItems, 0),
    failedItems,
  };
}

function currentStage(result: unknown, status: string): string | null {
  const payload = asObject(result) ?? {};
  if (status !== 'running') {
    return null;
  }
  return payload.searchTasksComplete === true ? 'processing' : 'searching';
}

async function authenticate(request: Request): Promise<AuthContext> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid Authorization header');
  }

  const token = authHeader.slice('Bearer '.length);
  const userResponse = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: anonKey(),
      authorization: `Bearer ${token}`,
    },
  });

  if (!userResponse.ok) {
    throw new HttpError(401, 'Invalid token');
  }

  const user = (await userResponse.json()) as { id?: string; email?: string | null };
  if (!user.id) {
    throw new HttpError(401, 'Invalid token');
  }

  const admin = await singleRow('app_admins', {
    select: 'user_id',
    user_id: `eq.${user.id}`,
  });

  if (!admin) {
    throw new HttpError(403, 'Forbidden');
  }

  return {
    userId: user.id,
    email: user.email ?? null,
  };
}

async function leadIdsForIcp(icpProfileId: string): Promise<Set<string>> {
  const [discovery, scores, conversions] = await Promise.all([
    listAllRows('LeadDiscoveryRecord', {
      select: 'leadId',
      icpProfileId: `eq.${icpProfileId}`,
    }),
    listAllRows('LeadScorePrediction', {
      select: 'leadId',
      icpProfileId: `eq.${icpProfileId}`,
    }),
    listAllRows('business_conversions', {
      select: 'leadId',
      icpProfileId: `eq.${icpProfileId}`,
    }),
  ]);
  return new Set(
    [...discovery, ...scores, ...conversions]
      .map((row) => asNullableString(row.leadId))
      .filter((id): id is string => id !== null),
  );
}

async function messageDraftIdsForIcp(icpProfileId: string): Promise<string[]> {
  const rows = await listAllRows('MessageDraft', {
    select: 'id',
    icpProfileId: `eq.${icpProfileId}`,
  });
  return rows
    .map((row) => asNullableString(row.id))
    .filter((id): id is string => id !== null);
}

async function latestScoresByLeadId(leadIds: string[]): Promise<Map<string, Row>> {
  if (leadIds.length === 0) {
    return new Map();
  }

  const result = await listRows('LeadScorePrediction', {
    select: 'id,leadId,icpProfileId,deterministicScore,logisticScore,blendedScore,scoreBand,reasonsJson,ruleEvaluationJson,predictedAt,createdAt',
    leadId: pgIn(leadIds),
    order: 'predictedAt.desc,createdAt.desc,id.desc',
    limit: MAX_DEMO_ROWS,
  });
  const scores = new Map<string, Row>();
  for (const row of result.data) {
    const leadId = asNullableString(row.leadId);
    if (leadId && !scores.has(leadId)) {
      scores.set(leadId, row);
    }
  }
  return scores;
}

async function latestDiscoveryByLeadId(leadIds: string[]): Promise<Map<string, Row>> {
  if (leadIds.length === 0) {
    return new Map();
  }

  const result = await listRows('LeadDiscoveryRecord', {
    select: 'id,leadId,icpProfileId,rawPayload,provider,status,discoveredAt,createdAt',
    leadId: pgIn(leadIds),
    order: 'discoveredAt.desc,createdAt.desc,id.desc',
    limit: MAX_DEMO_ROWS,
  });
  const records = new Map<string, Row>();
  for (const row of result.data) {
    const leadId = asNullableString(row.leadId);
    if (leadId && !records.has(leadId)) {
      records.set(leadId, row);
    }
  }
  return records;
}

async function businessesById(businessIds: string[]): Promise<Map<string, Row>> {
  if (businessIds.length === 0) {
    return new Map();
  }

  const result = await listRows('businesses', {
    select: '*',
    id: pgIn(businessIds),
    limit: businessIds.length,
  });
  return new Map(result.data.map((row) => [asString(row.id), normalizeBusinessRow(row) as Row]));
}

async function icpNamesById(icpIds: string[]): Promise<Map<string, string>> {
  if (icpIds.length === 0) {
    return new Map();
  }

  const result = await listRows('IcpProfile', {
    select: 'id,name',
    id: pgIn(icpIds),
    limit: icpIds.length,
  });
  return new Map(result.data.map((row) => [asString(row.id), asString(row.name)]));
}

async function businessContactsByBusinessId(businessIds: string[]): Promise<Map<string, Row[]>> {
  if (businessIds.length === 0) {
    return new Map();
  }

  const result = await listRows('business_contacts', {
    select: '*',
    businessId: pgIn(businessIds),
    order: 'positionRank.asc,name.asc',
    limit: MAX_DEMO_ROWS,
  });
  const grouped = new Map<string, Row[]>();
  for (const row of result.data) {
    const businessId = asNullableString(row.businessId);
    if (!businessId) continue;
    grouped.set(businessId, [...(grouped.get(businessId) ?? []), row]);
  }
  return grouped;
}

function mapIcp(row: Row, rules?: Row[]): JsonObject {
  const response: JsonObject = {
    id: asString(row.id),
    name: asString(row.name),
    description: asNullableString(row.description),
    qualificationLogic: asString(row.qualificationLogic, 'WEIGHTED'),
    metadataJson: asObject(row.metadataJson),
    targetIndustries: asArray<string>(row.targetIndustries),
    targetCountries: asArray<string>(row.targetCountries),
    minCompanySize: asNullableNumber(row.minCompanySize),
    maxCompanySize: asNullableNumber(row.maxCompanySize),
    requiredTechnologies: asArray<string>(row.requiredTechnologies),
    excludedDomains: asArray<string>(row.excludedDomains),
    featureList: row.featureList ?? null,
    isActive: asBoolean(row.isActive, true),
    createdByUserId: asNullableString(row.createdByUserId),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
  if (rules) {
    response.qualificationRules = rules.map(mapRule);
  }
  return response;
}

function mapRule(row: Row): JsonObject {
  return {
    id: asString(row.id),
    icpProfileId: asString(row.icpProfileId),
    name: asString(row.name),
    ruleType: asString(row.ruleType, 'WEIGHTED'),
    isRequired: asBoolean(row.isRequired),
    fieldKey: asString(row.fieldKey),
    operator: asString(row.operator),
    valueJson: row.valueJson ?? null,
    weight: asNullableNumber(row.weight),
    orderIndex: asNumber(row.orderIndex, 100),
    isActive: asBoolean(row.isActive, true),
    priority: asNumber(row.priority, 100),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapLeadListRow(lead: Row, score: Row | undefined, discovery: Row | undefined, business: Row | undefined): JsonObject {
  const biz = normalizeBusinessRow(business);
  const businessScore = biz ? asNullableNumber(biz.deterministicScore) : null;
  const scoreValue = asNullableNumber(score?.blendedScore);
  const scoreBandValue = asNullableString(score?.scoreBand) ?? asNullableString(biz?.scoreBand);
  const latestIcpProfileId = asNullableString(score?.icpProfileId) ?? asNullableString(discovery?.icpProfileId);

  return {
    id: asString(lead.id),
    firstName: asString(lead.firstName),
    lastName: asString(lead.lastName),
    email: asString(lead.email, 'unknown@example.invalid'),
    source: asString(lead.source, 'demo'),
    status: asString(lead.status, 'new'),
    error: asNullableString(lead.error),
    createdAt: iso(lead.createdAt),
    updatedAt: iso(lead.updatedAt),
    latestIcpProfileId,
    latestScoreBand: scoreBandValue,
    latestBlendedScore: scoreValue,
    latestScorePredictionId: asNullableString(score?.id),
    displayScore: scoreValue ?? businessScore,
    displayScoreBand: scoreBandValue,
    displayScoreSource: scoreValue !== null ? 'AI_SCORE' : businessScore !== null ? 'BUSINESS_SCORE' : 'NONE',
    latestDiscoveryRawPayload: discovery?.rawPayload ?? null,
    latestEnrichmentNormalizedPayload: null,
    latestEnrichmentRawPayload: null,
    businessCountryCode: asNullableString(biz?.countryCode),
    businessCountry: asNullableString(biz?.country),
    businessCity: asNullableString(biz?.city),
    businessCategory: asNullableString(biz?.category),
    businessDeterministicScore: businessScore,
    businessScoreBand: asNullableString(biz?.scoreBand),
    businessName: asNullableString(biz?.name),
    decisionMakerTitle: asNullableString(lead.decisionMakerTitle),
    hunterEnrichmentUsed: false,
  };
}

function mapBusinessContact(row: Row): JsonObject {
  return {
    id: asString(row.id),
    name: asString(row.name),
    title: asNullableString(row.title),
    email: asNullableString(row.email),
    phone: asNullableString(row.phone),
    linkedinUrl: asNullableString(row.linkedinUrl),
    seniority: asString(row.seniority, 'other'),
    positionRank: asNumber(row.positionRank, 99),
    source: asString(row.source, 'website_scrape'),
  };
}

function mapLeadDetail(
  lead: Row,
  business: Row | null,
  contacts: Row[],
  latestIcpProfileId: string | null,
  icpProfileName: string | null,
  conversion: Row | null,
): JsonObject {
  const biz = normalizeBusinessRow(business);
  return {
    id: asString(lead.id),
    firstName: asString(lead.firstName),
    lastName: asString(lead.lastName),
    email: asString(lead.email, 'unknown@example.invalid'),
    source: asString(lead.source, 'demo'),
    status: asString(lead.status, 'new'),
    enrichmentData: lead.enrichmentData ?? null,
    error: asNullableString(lead.error),
    createdAt: iso(lead.createdAt),
    updatedAt: iso(lead.updatedAt),
    businessCountryCode: asNullableString(biz?.countryCode),
    businessCountry: asNullableString(biz?.country),
    businessCity: asNullableString(biz?.city),
    businessCategory: asNullableString(biz?.category),
    businessDeterministicScore: asNullableNumber(biz?.deterministicScore),
    businessScoreBand: asNullableString(biz?.scoreBand),
    latestIcpProfileId,
    phoneSource: asNullableString(lead.phoneSource),
    businessEmail: asNullableString(lead.businessEmail),
    contactDiscovery: null,
    businessId: asNullableString(biz?.id) ?? asNullableString(lead.businessId),
    websiteDomain: asNullableString(biz?.websiteDomain),
    icpProfileName,
    businessContacts: contacts.map(mapBusinessContact),
    businessProfileRaw: biz ?? null,
    conversionContext: {
      businessInsights: asNullableString(conversion?.businessInsights),
      metadata: conversion?.metadata ?? null,
    },
  };
}

function mapDraft(row: Row, variants: Row[]): JsonObject {
  return {
    id: asString(row.id),
    leadId: asString(row.leadId),
    icpProfileId: asString(row.icpProfileId),
    scorePredictionId: asNullableString(row.scorePredictionId),
    promptVersion: asString(row.promptVersion, 'demo'),
    generatedByModel: asString(row.generatedByModel, 'demo'),
    groundingKnowledgeIds: asArray<string>(row.groundingKnowledgeIds),
    groundingContextJson: row.groundingContextJson ?? null,
    approvalStatus: asString(row.approvalStatus, 'PENDING'),
    approvedByUserId: asNullableString(row.approvedByUserId),
    approvedAt: nullableIso(row.approvedAt),
    rejectedReason: asNullableString(row.rejectedReason),
    followUpNumber: asNumber(row.followUpNumber),
    variants: variants.map(mapVariant),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapVariant(row: Row): JsonObject {
  return {
    id: asString(row.id),
    messageDraftId: asString(row.messageDraftId),
    variantKey: asString(row.variantKey),
    channel: asString(row.channel, 'EMAIL'),
    subject: asNullableString(row.subject),
    bodyText: asString(row.bodyText),
    bodyHtml: asNullableString(row.bodyHtml),
    ctaText: asNullableString(row.ctaText),
    qualityScore: asNullableNumber(row.qualityScore),
    isSelected: asBoolean(row.isSelected),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapSend(row: Row): JsonObject {
  return {
    id: asString(row.id),
    leadId: asString(row.leadId),
    messageDraftId: asString(row.messageDraftId),
    messageVariantId: asString(row.messageVariantId),
    channel: asString(row.channel, 'EMAIL'),
    provider: asString(row.provider, 'RESEND'),
    providerMessageId: asNullableString(row.providerMessageId),
    status: asString(row.status, 'QUEUED'),
    idempotencyKey: asString(row.idempotencyKey),
    scheduledAt: nullableIso(row.scheduledAt),
    sentAt: nullableIso(row.sentAt),
    deliveredAt: nullableIso(row.deliveredAt),
    repliedAt: nullableIso(row.repliedAt),
    followUpNumber: asNullableNumber(row.followUpNumber),
    nextFollowUpAfter: nullableIso(row.nextFollowUpAfter),
    providerConversationId: asNullableString(row.providerConversationId),
    failureCode: asNullableString(row.failureCode),
    failureReason: asNullableString(row.failureReason),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapFeedbackEvent(row: Row): JsonObject {
  const eventType = asString(row.eventType);
  return {
    id: asString(row.id),
    leadId: asString(row.leadId),
    messageSendId: asNullableString(row.messageSendId),
    eventType: eventType === 'UNSUBSCRIBED' ? 'NOT_INTERESTED' : eventType,
    source: asString(row.source, 'MANUAL'),
    providerEventId: asNullableString(row.providerEventId),
    dedupeKey: asString(row.dedupeKey),
    payloadJson: row.payloadJson ?? null,
    replyText: asNullableString(row.replyText),
    replyClassification: asNullableString(row.replyClassification),
    occurredAt: iso(row.occurredAt),
    createdAt: iso(row.createdAt),
  };
}

function mapDiscoveryRun(row: Row): JsonObject {
  const progress = readRunProgress(row.result);
  const payload = asObject(row.payload) ?? {};
  const result = asObject(row.result) ?? {};
  const status = mapJobStatus(asString(row.status), progress.failedItems);
  const icpProfileId = asNullableString(payload.icpProfileId);
  const icpProfileIds = asArray<string>(payload.icpProfileIds);
  return {
    runId: asString(row.id),
    status,
    totalItems: progress.totalItems,
    processedItems: progress.processedItems,
    failedItems: progress.failedItems,
    createdAt: iso(row.createdAt),
    startedAt: nullableIso(row.startedAt),
    finishedAt: nullableIso(row.finishedAt),
    icpProfileId,
    icpProfileIds: icpProfileIds.length > 0 ? icpProfileIds : icpProfileId ? [icpProfileId] : [],
    countries: asArray<string>(payload.countries),
    limit: asNumber(payload.limit),
    converted: typeof result.converted === 'number' ? result.converted : undefined,
    errorMessage: asNullableString(row.error),
    currentStage: currentStage(row.result, asString(row.status)),
  };
}

function mapDiscoveryRunStatus(row: Row): JsonObject {
  const progress = readRunProgress(row.result);
  return {
    runId: asString(row.id),
    runType: 'DISCOVERY',
    status: mapJobStatus(asString(row.status), progress.failedItems),
    totalItems: progress.totalItems,
    processedItems: progress.processedItems,
    failedItems: progress.failedItems,
    startedAt: nullableIso(row.startedAt),
    endedAt: nullableIso(row.finishedAt),
    errorMessage: asNullableString(row.error),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    currentStage: currentStage(row.result, asString(row.status)),
  };
}

function mapJobRun(row: Row): JsonObject {
  const normalized = normalizeJobRunRow(row);
  return {
    id: asString(normalized.id),
    jobName: asString(normalized.jobName),
    startedAt: iso(normalized.startedAt),
    finishedAt: nullableIso(normalized.finishedAt),
    durationMs: asNullableNumber(normalized.durationMs),
    status: asString(normalized.status, 'RUNNING'),
    paramsJson: normalized.paramsJson ?? {},
    countersJson: normalized.countersJson ?? null,
    resourceJson: normalized.resourceJson ?? null,
    errorText: asNullableString(normalized.errorText),
    createdAt: iso(normalized.createdAt),
    updatedAt: iso(normalized.updatedAt),
  };
}

function mapJobRequest(row: Row): JsonObject {
  return {
    id: asNumber(row.id),
    requestType: asString(row.request_type),
    status: asString(row.status),
    paramsJson: row.params_json ?? {},
    requestedBy: asString(row.requested_by),
    claimedBy: asNullableString(row.claimed_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    claimedAt: nullableIso(row.claimed_at),
    startedAt: nullableIso(row.started_at),
    finishedAt: nullableIso(row.finished_at),
    errorText: asNullableString(row.error_text),
    jobRunId: asNullableString(row.job_run_id),
    idempotencyKey: asNullableString(row.idempotency_key),
  };
}

function mapAdminBusiness(row: Row, leadId: string | null = null, leadBlendedScore: number | null = null, recovery: Row | null = null): JsonObject {
  const normalized = normalizeBusinessRow(row) as Row;
  const deterministicScore = asNumber(normalized.deterministicScore);
  return {
    id: asString(normalized.id),
    name: asString(normalized.name),
    countryCode: asString(normalized.countryCode),
    country: asNullableString(normalized.country),
    city: asNullableString(normalized.city),
    category: asNullableString(normalized.category),
    rating: asNullableNumber(normalized.rating),
    reviewCount: asNullableNumber(normalized.reviewCount),
    followerCount: asNullableNumber(normalized.followerCount),
    deterministicScore,
    scoreBand: asNullableString(normalized.scoreBand) ?? scoreTier(deterministicScore),
    hasWhatsapp: asBoolean(normalized.hasWhatsapp),
    hasInstagram: asBoolean(normalized.hasInstagram),
    acceptsOnlinePayments: asBoolean(normalized.acceptsOnlinePayments),
    recentActivity: asBoolean(normalized.recentActivity),
    websiteDomain: asNullableString(normalized.websiteDomain),
    phoneE164: asNullableString(normalized.phoneE164),
    instagramHandle: asNullableString(normalized.instagramHandle),
    preQualified: typeof normalized.preQualified === 'boolean' ? normalized.preQualified : null,
    disqualificationReason: asNullableString(normalized.disqualificationReason),
    apifyWebsiteScrapeJson: normalized.apifyWebsiteScrapeJson ?? null,
    apifyInstagramScrapeJson: normalized.apifyInstagramScrapeJson ?? null,
    websiteScrapedAt: nullableIso(normalized.websiteScrapedAt),
    instagramScrapedAt: nullableIso(normalized.instagramScrapedAt),
    manualReviewStatus: asNullableString(recovery?.status),
    manualReviewReason: asNullableString(recovery?.reason),
    manualReviewUpdatedAt: nullableIso(firstValue(recovery, 'updatedAt', 'updated_at')),
    leadBlendedScore,
    leadId,
    createdAt: iso(normalized.createdAt),
    updatedAt: iso(normalized.updatedAt),
  };
}

function mapAdminLead(row: Row): JsonObject {
  const normalized = normalizeBusinessRow(row) as Row;
  const deterministicScore = asNumber(normalized.deterministicScore);
  return {
    id: asString(normalized.id),
    name: asString(normalized.name),
    countryCode: asString(normalized.countryCode),
    city: asNullableString(normalized.city),
    category: asNullableString(normalized.category),
    score: deterministicScore,
    scoreTier: asNullableString(normalized.scoreBand) ?? scoreTier(deterministicScore),
    hasWhatsapp: asBoolean(normalized.hasWhatsapp),
    hasInstagram: asBoolean(normalized.hasInstagram),
    acceptsOnlinePayments: asBoolean(normalized.acceptsOnlinePayments),
    reviewCount: asNullableNumber(normalized.reviewCount),
    followerCount: asNullableNumber(normalized.followerCount),
    physicalAddressPresent: asBoolean(normalized.physicalAddressPresent),
    recentActivity: asBoolean(normalized.recentActivity),
    websiteDomain: asNullableString(normalized.websiteDomain),
    phoneE164: asNullableString(normalized.phoneE164),
    instagramHandle: asNullableString(normalized.instagramHandle),
    createdAt: iso(normalized.createdAt),
    updatedAt: iso(normalized.updatedAt),
  };
}

function defaultRecoverySnapshot(row: Row, business: Row | undefined): JsonObject {
  return {
    businessId: asString(firstValue(row, 'businessId', 'business_id')),
    domain: asNullableString(business?.websiteDomain),
    locality: asNullableString(business?.city),
    generatedAt: iso(firstValue(row, 'createdAt', 'created_at')),
    businessInsights: null,
    genericBusinessEmail: null,
    telemetry: {
      cseVerifyAttempted: false,
      cseVerifySucceeded: false,
      cseDiscoverAttempted: false,
      cseDiscoverSucceeded: false,
      cseRawResults: 0,
      cseValidProfiles: 0,
      cseCandidatesAdded: 0,
      cseCandidatesValidated: 0,
      cseEmailsInferred: 0,
      topSourceFamily: 'unknown',
      finalOutcome: 'recovery_opened',
      verificationVerdict: 'skipped',
      supportingUrls: [],
      diagnostics: [],
      topQueryFamily: null,
    },
    attempts: [],
    topCandidates: [],
    websiteIntelligence: null,
    instagramIntelligence: null,
  };
}

function mapContactRecoveryItem(row: Row, business: Row | undefined, icpName: string | null): JsonObject {
  const normalizedBusiness = normalizeBusinessRow(business);
  const snapshot = asObject(firstValue(row, 'recoverySnapshot', 'recovery_snapshot'))
    ?? defaultRecoverySnapshot(row, normalizedBusiness);
  return {
    id: asString(row.id),
    businessId: asString(firstValue(row, 'businessId', 'business_id')),
    icpProfileId: asString(firstValue(row, 'icpProfileId', 'icp_profile_id')),
    icpProfileName: icpName,
    discoveryRunId: asString(firstValue(row, 'discoveryRunId', 'discovery_run_id')),
    status: asString(row.status, 'OPEN'),
    reason: asString(row.reason, 'NO_CONTACTS_FOUND'),
    evidenceScore: asNumber(firstValue(row, 'evidenceScore', 'evidence_score')),
    candidateCount: asNumber(firstValue(row, 'candidateCount', 'candidate_count')),
    rejectedBy: asNullableString(firstValue(row, 'rejectedBy', 'rejected_by')),
    rejectedAt: nullableIso(firstValue(row, 'rejectedAt', 'rejected_at')),
    createdAt: iso(firstValue(row, 'createdAt', 'created_at')),
    updatedAt: iso(firstValue(row, 'updatedAt', 'updated_at')),
    business: {
      id: asString(normalizedBusiness?.id),
      name: asString(normalizedBusiness?.name),
      city: asNullableString(normalizedBusiness?.city),
      country: asNullableString(normalizedBusiness?.country),
      countryCode: asNullableString(normalizedBusiness?.countryCode),
      websiteDomain: asNullableString(normalizedBusiness?.websiteDomain),
      instagramHandle: asNullableString(normalizedBusiness?.instagramHandle),
      category: asNullableString(normalizedBusiness?.category),
      deterministicScore: asNullableNumber(normalizedBusiness?.deterministicScore),
      scoreBand: asNullableString(normalizedBusiness?.scoreBand),
      preQualified: typeof normalizedBusiness?.preQualified === 'boolean' ? normalizedBusiness.preQualified : null,
      disqualificationReason: asNullableString(normalizedBusiness?.disqualificationReason),
    },
    snapshot,
  };
}

function mapSearchTask(row: Row): JsonObject {
  return {
    id: asString(row.id),
    taskType: asString(row.task_type),
    status: asString(row.status),
    countryCode: asString(row.country_code),
    city: asNullableString(row.city),
    language: asString(row.language),
    queryText: asString(row.query_text),
    timeBucket: asString(row.time_bucket),
    attempts: asNumber(row.attempts),
    runAfter: iso(row.run_after),
    lastResultHash: asNullableString(row.last_result_hash),
    error: asNullableString(row.error),
    updatedAt: iso(row.updated_at),
    createdAt: iso(row.created_at),
  };
}

async function handleListIcps(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'name.asc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const isActive = url.searchParams.get('isActive');
  if (isActive !== null) params.isActive = `eq.${isActive === 'true'}`;
  const q = url.searchParams.get('q');
  if (q) params.name = `ilike.${ilikePattern(q)}`;

  const result = await listRows('IcpProfile', params);
  return jsonResponse({
    items: result.data.map((row) => mapIcp(row)),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleGetIcp(icpId: string): Promise<Response> {
  const [icp, rules] = await Promise.all([
    singleRow('IcpProfile', { select: '*', id: `eq.${icpId}` }),
    listRows('QualificationRule', {
      select: '*',
      icpProfileId: `eq.${icpId}`,
      order: 'orderIndex.asc,priority.asc,createdAt.asc',
      limit: 500,
    }),
  ]);
  if (!icp) throw new HttpError(404, 'ICP profile not found');
  return jsonResponse(mapIcp(icp, rules.data));
}

async function handleGetIcpRules(icpId: string): Promise<Response> {
  const rules = await listRows('QualificationRule', {
    select: '*',
    icpProfileId: `eq.${icpId}`,
    order: 'orderIndex.asc,priority.asc,createdAt.asc',
    limit: 500,
  });
  return jsonResponse({ items: rules.data.map(mapRule) });
}

async function handleListLeads(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const includeRejected = parseBoolean(url.searchParams.get('includeRejected'), false);
  const sortBy = url.searchParams.get('sortBy') ?? 'created_desc';
  const scoreSort = sortBy === 'score_desc' || sortBy === 'score_asc';
  const icpProfileId = url.searchParams.get('icpProfileId');

  let leadIdFilter: Set<string> | null = null;
  if (icpProfileId) {
    leadIdFilter = await leadIdsForIcp(icpProfileId);
    if (leadIdFilter.size === 0) {
      return jsonResponse({ items: [], qualityMetrics: null, page, pageSize, total: 0 });
    }
  }

  const params: Record<string, string | number> = {
    select: '*',
    deletedAt: 'is.null',
    limit: scoreSort ? MAX_DEMO_ROWS : pageSize,
    offset: scoreSort ? 0 : (page - 1) * pageSize,
  };

  if (!includeRejected) params.status = 'neq.rejected';
  const status = url.searchParams.get('status');
  if (status) params.status = `eq.${status}`;
  const from = url.searchParams.get('from');
  if (from) params.createdAt = `gte.${from}`;
  const to = url.searchParams.get('to');
  if (to) params.createdAt = `lte.${to}`;
  const search = url.searchParams.get('search');
  if (search) {
    const pattern = ilikePattern(search);
    params.or = `(firstName.ilike.${pattern},lastName.ilike.${pattern},email.ilike.${pattern})`;
  }
  if (leadIdFilter) {
    params.id = pgIn([...leadIdFilter]);
  }
  if (!scoreSort) {
    params.order = 'createdAt.desc,id.desc';
  }

  let result = await listRows('Lead', params);
  let leads = result.data;
  const scoreBand = url.searchParams.get('scoreBand');
  const minBlendedScore = url.searchParams.get('minBlendedScore');

  if (scoreBand || minBlendedScore || scoreSort) {
    const candidateIds = leads.map((lead) => asString(lead.id)).filter(Boolean);
    const scores = await latestScoresByLeadId(candidateIds);
    const businessIds = leads
      .map((lead) => asNullableString(lead.businessId))
      .filter((id): id is string => id !== null);
    const businesses = await businessesById(businessIds);

    leads = leads.filter((lead) => {
      const score = scores.get(asString(lead.id));
      const business = businesses.get(asString(lead.businessId));
      const resolvedScore = asNullableNumber(score?.blendedScore) ?? asNullableNumber(business?.deterministicScore);
      const resolvedBand = asNullableString(score?.scoreBand) ?? asNullableString(business?.scoreBand);
      if (scoreBand && resolvedBand !== scoreBand) return false;
      if (minBlendedScore && (resolvedScore === null || resolvedScore < Number(minBlendedScore))) return false;
      return true;
    });

    if (scoreSort) {
      leads.sort((a, b) => {
        const scoreA = asNullableNumber(scores.get(asString(a.id))?.blendedScore)
          ?? asNullableNumber(businesses.get(asString(a.businessId))?.deterministicScore)
          ?? -1;
        const scoreB = asNullableNumber(scores.get(asString(b.id))?.blendedScore)
          ?? asNullableNumber(businesses.get(asString(b.businessId))?.deterministicScore)
          ?? -1;
        return sortBy === 'score_asc' ? scoreA - scoreB : scoreB - scoreA;
      });
    }

    result = { data: leads.slice((page - 1) * pageSize, page * pageSize), total: leads.length };
  }

  const pageRows = result.data;
  const leadIds = pageRows.map((lead) => asString(lead.id)).filter(Boolean);
  const businessIds = pageRows
    .map((lead) => asNullableString(lead.businessId))
    .filter((id): id is string => id !== null);
  const [scores, discoveryRecords, businesses] = await Promise.all([
    latestScoresByLeadId(leadIds),
    latestDiscoveryByLeadId(leadIds),
    businessesById(businessIds),
  ]);

  return jsonResponse({
    items: pageRows.map((lead) =>
      mapLeadListRow(
        lead,
        scores.get(asString(lead.id)),
        discoveryRecords.get(asString(lead.id)),
        businesses.get(asString(lead.businessId)),
      ),
    ),
    qualityMetrics: null,
    page,
    pageSize,
    total: result.total ?? pageRows.length,
  });
}

async function handleGetLead(id: string): Promise<Response> {
  const lead = await singleRow('Lead', {
    select: '*',
    id: `eq.${id}`,
    deletedAt: 'is.null',
  });
  if (!lead) throw new HttpError(404, 'Lead not found');

  const businessId = asNullableString(lead.businessId);
  const [business, contactsResult, scores, discovery, conversions] = await Promise.all([
    businessId ? singleRow('businesses', { select: '*', id: `eq.${businessId}` }) : Promise.resolve(null),
    businessId
      ? listRows('business_contacts', {
          select: '*',
          businessId: `eq.${businessId}`,
          order: 'positionRank.asc,name.asc',
          limit: 100,
        })
      : Promise.resolve({ data: [], total: 0 } satisfies RestResult<Row[]>),
    latestScoresByLeadId([id]),
    latestDiscoveryByLeadId([id]),
    listRows('business_conversions', {
      select: '*',
      leadId: `eq.${id}`,
      order: 'convertedAt.desc,createdAt.desc,id.desc',
      limit: 1,
    }),
  ]);
  const latestScore = scores.get(id);
  const latestDiscovery = discovery.get(id);
  const latestIcpProfileId =
    asNullableString(latestDiscovery?.icpProfileId)
    ?? asNullableString(latestScore?.icpProfileId)
    ?? asNullableString(conversions.data[0]?.icpProfileId);
  const icpNames = latestIcpProfileId ? await icpNamesById([latestIcpProfileId]) : new Map<string, string>();

  return jsonResponse(
    mapLeadDetail(
      lead,
      business,
      contactsResult.data,
      latestIcpProfileId,
      latestIcpProfileId ? icpNames.get(latestIcpProfileId) ?? null : null,
      conversions.data[0] ?? null,
    ),
  );
}

async function handleListRejectedLeads(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'rejectedAt.desc,createdAt.desc,id.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const reason = url.searchParams.get('reason');
  if (reason) params.reason = `eq.${reason}`;
  const result = await listRows('lead_rejections', params);
  const leadIds = result.data.map((row) => asString(row.leadId)).filter(Boolean);
  const leads = leadIds.length
    ? await listRows('Lead', { select: '*', id: pgIn(leadIds), limit: leadIds.length })
    : { data: [], total: 0 };
  const leadById = new Map(leads.data.map((row) => [asString(row.id), row]));
  const businessIds = result.data
    .map((row) => asNullableString(row.businessId) ?? asNullableString(leadById.get(asString(row.leadId))?.businessId))
    .filter((id): id is string => id !== null);
  const [businesses, icpNames] = await Promise.all([
    businessesById(businessIds),
    icpNamesById(result.data.map((row) => asNullableString(row.icpProfileId)).filter((id): id is string => id !== null)),
  ]);

  return jsonResponse({
    items: result.data.map((row) => {
      const lead = leadById.get(asString(row.leadId));
      const business = businesses.get(asString(row.businessId)) ?? businesses.get(asString(lead?.businessId));
      const metadata = asObject(row.metadata);
      return {
        id: asString(row.id),
        leadId: asString(row.leadId),
        firstName: asString(lead?.firstName),
        lastName: asString(lead?.lastName),
        email: asString(lead?.email, 'unknown@example.invalid'),
        companyName: asNullableString(business?.name),
        businessName: asNullableString(business?.name),
        websiteDomain: asNullableString(business?.websiteDomain),
        category: asNullableString(business?.category),
        city: asNullableString(business?.city),
        country: asNullableString(business?.countryCode),
        icpProfileId: asNullableString(row.icpProfileId),
        icpProfileName: asNullableString(row.icpProfileId) ? icpNames.get(asString(row.icpProfileId)) ?? null : null,
        reason: asString(row.reason),
        reasonDetails: asArray<string>(metadata?.failedHardFilters),
        score: asNullableNumber(row.score),
        rejectedAt: iso(row.rejectedAt),
      };
    }),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleListContactRecovery(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'updated_at.desc,id.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const status = url.searchParams.get('status');
  if (status) params.status = `eq.${status}`;
  const icpProfileId = url.searchParams.get('icpProfileId');
  if (icpProfileId) params.icp_profile_id = `eq.${icpProfileId}`;
  const from = url.searchParams.get('from');
  if (from) params.created_at = `gte.${from}`;
  const to = url.searchParams.get('to');
  if (to) params.created_at = `lte.${to}`;

  const q = url.searchParams.get('q');
  if (q) {
    const pattern = ilikePattern(q);
    const businessMatches = await listRows('businesses', {
      select: 'id',
      or: `(name.ilike.${pattern},website_domain.ilike.${pattern},category.ilike.${pattern},city.ilike.${pattern})`,
      limit: MAX_DEMO_ROWS,
    });
    const businessIds = businessMatches.data.map((row) => asString(row.id)).filter(Boolean);
    if (businessIds.length === 0) {
      return jsonResponse({ items: [], page, pageSize, total: 0 });
    }
    params.business_id = pgIn(businessIds);
  }

  const result = await listRows('contact_recovery_items', params);
  const businessIds = result.data
    .map((row) => asString(firstValue(row, 'businessId', 'business_id')))
    .filter(Boolean);
  const icpIds = result.data
    .map((row) => asString(firstValue(row, 'icpProfileId', 'icp_profile_id')))
    .filter(Boolean);
  const [businesses, icpNames] = await Promise.all([
    businessesById(businessIds),
    icpNamesById(icpIds),
  ]);

  return jsonResponse({
    items: result.data.map((row) => {
      const businessId = asString(firstValue(row, 'businessId', 'business_id'));
      const rowIcpId = asString(firstValue(row, 'icpProfileId', 'icp_profile_id'));
      return mapContactRecoveryItem(row, businesses.get(businessId), icpNames.get(rowIcpId) ?? null);
    }),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleGetContactRecovery(id: string): Promise<Response> {
  const row = await singleRow('contact_recovery_items', {
    select: '*',
    id: `eq.${id}`,
  });
  if (!row) throw new HttpError(404, 'Contact recovery item not found');

  const businessId = asString(firstValue(row, 'businessId', 'business_id'));
  const icpProfileId = asString(firstValue(row, 'icpProfileId', 'icp_profile_id'));
  const [businesses, icpNames] = await Promise.all([
    businessesById([businessId]),
    icpNamesById([icpProfileId]),
  ]);
  return jsonResponse(mapContactRecoveryItem(row, businesses.get(businessId), icpNames.get(icpProfileId) ?? null));
}

async function handleListDrafts(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'createdAt.desc,id.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (const key of ['leadId', 'icpProfileId', 'approvalStatus']) {
    const value = url.searchParams.get(key);
    if (value) params[key] = `eq.${value}`;
  }
  if (parseBoolean(url.searchParams.get('followUpOnly'), false)) {
    params.followUpNumber = 'gt.0';
  }

  const result = await listRows('MessageDraft', params);
  const draftIds = result.data.map((row) => asString(row.id)).filter(Boolean);
  const variants = draftIds.length
    ? await listRows('MessageVariant', {
        select: '*',
        messageDraftId: pgIn(draftIds),
        order: 'variantKey.asc,createdAt.asc',
        limit: MAX_DEMO_ROWS,
      })
    : { data: [], total: 0 };
  const variantsByDraft = new Map<string, Row[]>();
  for (const row of variants.data) {
    const draftId = asString(row.messageDraftId);
    variantsByDraft.set(draftId, [...(variantsByDraft.get(draftId) ?? []), row]);
  }

  return jsonResponse({
    items: result.data.map((row) => mapDraft(row, variantsByDraft.get(asString(row.id)) ?? [])),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleGetDraft(id: string): Promise<Response> {
  const draft = await singleRow('MessageDraft', { select: '*', id: `eq.${id}` });
  if (!draft) throw new HttpError(404, 'Message draft not found');
  const variants = await listRows('MessageVariant', {
    select: '*',
    messageDraftId: `eq.${id}`,
    order: 'variantKey.asc,createdAt.asc',
    limit: 50,
  });
  return jsonResponse(mapDraft(draft, variants.data));
}

async function handleListSends(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'createdAt.desc,id.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (const key of ['leadId', 'status', 'channel', 'provider']) {
    const value = url.searchParams.get(key);
    if (value) params[key] = `eq.${value}`;
  }
  const from = url.searchParams.get('from');
  if (from) params.createdAt = `gte.${from}`;
  const result = await listRows('MessageSend', params);
  return jsonResponse({
    items: result.data.map(mapSend),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleConversation(leadId: string): Promise<Response> {
  const [sends, feedback] = await Promise.all([
    listRows('MessageSend', {
      select: '*',
      leadId: `eq.${leadId}`,
      order: 'createdAt.asc',
      limit: 200,
    }),
    listRows('FeedbackEvent', {
      select: '*',
      leadId: `eq.${leadId}`,
      order: 'occurredAt.asc,createdAt.asc',
      limit: 200,
    }),
  ]);
  const variantIds = sends.data.map((row) => asString(row.messageVariantId)).filter(Boolean);
  const variants = variantIds.length
    ? await listRows('MessageVariant', { select: '*', id: pgIn(variantIds), limit: variantIds.length })
    : { data: [], total: 0 };
  const variantsById = new Map(variants.data.map((row) => [asString(row.id), row]));

  const entries = [
    ...sends.data.map((send) => {
      const variant = variantsById.get(asString(send.messageVariantId));
      return {
        id: asString(send.id),
        type: 'sent',
        timestamp: iso(send.sentAt ?? send.createdAt),
        channel: asString(send.channel, 'EMAIL'),
        bodyText: asString(variant?.bodyText),
        bodyHtml: asNullableString(variant?.bodyHtml),
        subject: asNullableString(variant?.subject),
        replyClassification: null,
        status: asString(send.status, 'QUEUED'),
        followUpNumber: asNullableNumber(send.followUpNumber),
      };
    }),
    ...feedback.data.map((event) => ({
      id: asString(event.id),
      type: 'reply',
      timestamp: iso(event.occurredAt),
      channel: 'EMAIL',
      bodyText: asNullableString(event.replyText) ?? asString(event.eventType),
      bodyHtml: null,
      subject: null,
      replyClassification: asNullableString(event.replyClassification),
      status: null,
      followUpNumber: null,
    })),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return jsonResponse({ leadId, entries });
}

async function handleFeedbackSummary(url: URL): Promise<Response> {
  const params: Record<string, string | number> = {};
  const from = url.searchParams.get('from');
  if (from) params.occurredAt = `gte.${from}`;
  const to = url.searchParams.get('to');
  if (to) params.occurredAt = `lte.${to}`;
  const icpProfileId = url.searchParams.get('icpProfileId');
  let leadIds: string[] | null = null;
  if (icpProfileId) {
    const ids = await leadIdsForIcp(icpProfileId);
    if (ids.size === 0) {
      return jsonResponse(emptyFeedbackSummary(from, to));
    }
    leadIds = [...ids];
  }
  const [
    totalEvents,
    repliedCount,
    meetingBookedCount,
    dealWonCount,
    dealLostCount,
    bouncedCount,
    notInterestedCount,
    unsubscribedCount,
  ] = await Promise.all([
    countRowsWithOptionalInChunks('FeedbackEvent', params, 'leadId', leadIds),
    countRowsWithOptionalInChunks('FeedbackEvent', { ...params, eventType: 'eq.REPLIED' }, 'leadId', leadIds),
    countRowsWithOptionalInChunks('FeedbackEvent', { ...params, eventType: 'eq.MEETING_BOOKED' }, 'leadId', leadIds),
    countRowsWithOptionalInChunks('FeedbackEvent', { ...params, eventType: 'eq.DEAL_WON' }, 'leadId', leadIds),
    countRowsWithOptionalInChunks('FeedbackEvent', { ...params, eventType: 'eq.DEAL_LOST' }, 'leadId', leadIds),
    countRowsWithOptionalInChunks('FeedbackEvent', { ...params, eventType: 'eq.BOUNCED' }, 'leadId', leadIds),
    countRowsWithOptionalInChunks('FeedbackEvent', { ...params, eventType: 'eq.NOT_INTERESTED' }, 'leadId', leadIds),
    countRowsWithOptionalInChunks('FeedbackEvent', { ...params, eventType: 'eq.UNSUBSCRIBED' }, 'leadId', leadIds),
  ]);
  return jsonResponse({
    from,
    to,
    totalEvents,
    repliedCount,
    meetingBookedCount,
    dealWonCount,
    dealLostCount,
    bouncedCount,
    notInterestedCount: notInterestedCount + unsubscribedCount,
  });
}

function emptyFeedbackSummary(from: string | null, to: string | null): JsonObject {
  return {
    from,
    to,
    totalEvents: 0,
    repliedCount: 0,
    meetingBookedCount: 0,
    dealWonCount: 0,
    dealLostCount: 0,
    bouncedCount: 0,
    notInterestedCount: 0,
  };
}

async function handleListFeedbackEvents(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'occurredAt.desc,createdAt.desc,id.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (const key of ['leadId', 'messageSendId', 'eventType', 'source']) {
    const value = url.searchParams.get(key);
    if (value) params[key] = `eq.${value}`;
  }
  const result = await listRows('FeedbackEvent', params);
  return jsonResponse({
    items: result.data.map(mapFeedbackEvent),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleFunnel(url: URL): Promise<Response> {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const icpProfileId = url.searchParams.get('icpProfileId');
  let leadIds: string[] | null = null;
  let messageDraftIds: string[] | null = null;
  if (icpProfileId) {
    const [ids, draftIds] = await Promise.all([
      leadIdsForIcp(icpProfileId),
      messageDraftIdsForIcp(icpProfileId),
    ]);
    if (ids.size === 0) {
      return jsonResponse(emptyFunnel(from, to, icpProfileId));
    }
    leadIds = [...ids];
    messageDraftIds = draftIds;
  }
  const leadFilter: Record<string, string | number> = {
    deletedAt: 'is.null',
  };
  applyDateRange(leadFilter, 'createdAt', from, to);

  const draftFilter: Record<string, string | number> = {};
  applyDateRange(draftFilter, 'createdAt', from, to);

  const sendFilter: Record<string, string | number> = {
    status: pgIn(SENT_MESSAGE_STATUSES),
  };
  applyDateRange(sendFilter, 'sentAt', from, to);

  const repliedFilter: Record<string, string | number> = { eventType: 'eq.REPLIED' };
  applyDateRange(repliedFilter, 'occurredAt', from, to);

  const meetingFilter: Record<string, string | number> = { eventType: 'eq.MEETING_BOOKED' };
  applyDateRange(meetingFilter, 'occurredAt', from, to);

  const wonFilter: Record<string, string | number> = { eventType: 'eq.DEAL_WON' };
  applyDateRange(wonFilter, 'occurredAt', from, to);

  const [
    discoveredCount,
    qualifiedCount,
    enrichedCount,
    scoredCount,
    leadCostRows,
    messagesGeneratedCount,
    messagesSentCount,
    repliesCount,
    meetingsCount,
    dealsWonCount,
  ] = await Promise.all([
    countRowsWithOptionalInChunks('Lead', leadFilter, 'id', leadIds),
    countRowsWithOptionalInChunks('Lead', { ...leadFilter, status: pgIn(QUALIFIED_LEAD_STATUSES) }, 'id', leadIds),
    countRowsWithOptionalInChunks('Lead', { ...leadFilter, status: pgIn(ENRICHED_LEAD_STATUSES) }, 'id', leadIds),
    countRowsWithOptionalInChunks('Lead', { ...leadFilter, status: pgIn(SCORED_LEAD_STATUSES) }, 'id', leadIds),
    listRowsWithOptionalInChunks('Lead', { ...leadFilter, select: 'costCents' }, 'id', leadIds),
    countRowsWithOptionalInChunks('MessageDraft', draftFilter, 'id', messageDraftIds),
    countRowsWithOptionalInChunks('MessageSend', sendFilter, 'messageDraftId', messageDraftIds),
    countRowsWithOptionalInChunks('FeedbackEvent', repliedFilter, 'leadId', leadIds),
    countRowsWithOptionalInChunks('FeedbackEvent', meetingFilter, 'leadId', leadIds),
    countRowsWithOptionalInChunks('FeedbackEvent', wonFilter, 'leadId', leadIds),
  ]);
  const totalCostCents = leadCostRows.reduce((sum, row) => sum + asNumber(row.costCents), 0);
  return jsonResponse({
    from,
    to,
    icpProfileId,
    discoveredCount,
    qualifiedCount,
    enrichedCount,
    scoredCount,
    messagesGeneratedCount,
    messagesSentCount,
    repliesCount,
    meetingsCount,
    dealsWonCount,
    totalCostCents,
    costPerLead: discoveredCount > 0 ? Math.round((totalCostCents / discoveredCount) * 100) / 100 : 0,
  });
}

function emptyFunnel(from: string | null, to: string | null, icpProfileId: string | null): JsonObject {
  return {
    from,
    to,
    icpProfileId,
    discoveredCount: 0,
    qualifiedCount: 0,
    enrichedCount: 0,
    scoredCount: 0,
    messagesGeneratedCount: 0,
    messagesSentCount: 0,
    repliesCount: 0,
    meetingsCount: 0,
    dealsWonCount: 0,
    totalCostCents: 0,
    costPerLead: 0,
  };
}

async function handleScoreDistribution(url: URL): Promise<Response> {
  const params: Record<string, string | number> = {};
  const icpProfileId = url.searchParams.get('icpProfileId');
  if (icpProfileId) params.icpProfileId = `eq.${icpProfileId}`;
  const scoreBands = ['LOW', 'MEDIUM', 'HIGH'];
  const bands = await Promise.all(
    scoreBands.map(async (scoreBand) => ({
      scoreBand,
      count: await countRows('LeadScorePrediction', { ...params, scoreBand: `eq.${scoreBand}` }),
    })),
  );
  return jsonResponse({
    bands,
  });
}

async function handleDailyQualityTrends(url: URL): Promise<Response> {
  const params: Record<string, string | number> = {
    select: 'day,discoveredCount,validEmailCount,validDomainCount,industryMatchRate,geoMatchRate',
    order: 'day.asc',
  };
  const from = url.searchParams.get('from');
  if (from) params.day = `gte.${from}`;
  const rows = await listAllRows('AnalyticsDailyRollup', params);
  return jsonResponse({
    items: rows.map((row) => ({
      day: iso(row.day).slice(0, 10),
      avgScore: asNumber(row.industryMatchRate),
      totalCreated: asNumber(row.discoveredCount),
      rejectedCount: 0,
    })),
  });
}

async function handleAvgScore(): Promise<Response> {
  const rows = await listAllRows('LeadScorePrediction', {
    select: 'blendedScore',
  });
  const scores = rows.map((row) => asNullableNumber(row.blendedScore)).filter((value): value is number => value !== null);
  return jsonResponse({
    avgScore: scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
  });
}

async function handleIcpPerformance(): Promise<Response> {
  const rows = await listAllRows('LeadScorePrediction', {
    select: 'icpProfileId,blendedScore,scoreBand',
  });
  const grouped = new Map<string, { count: number; scoreTotal: number; qualified: number; rejected: number }>();
  for (const row of rows) {
    const icpProfileId = asNullableString(row.icpProfileId);
    const score = asNullableNumber(row.blendedScore);
    if (!icpProfileId || score === null) continue;
    const group = grouped.get(icpProfileId) ?? { count: 0, scoreTotal: 0, qualified: 0, rejected: 0 };
    group.count += 1;
    group.scoreTotal += score;
    if (score >= 0.5) group.qualified += 1;
    grouped.set(icpProfileId, group);
  }
  return jsonResponse({
    items: [...grouped.entries()].map(([icpProfileId, group]) => ({
      icpProfileId,
      leadCount: group.count,
      avgScore: group.count > 0 ? group.scoreTotal / group.count : null,
      qualifiedCount: group.qualified,
      rejectedCount: group.rejected,
    })),
  });
}

async function handleModelMetrics(): Promise<Response> {
  const rows = await listAllRows('ModelEvaluation', {
    select: '*,ModelVersion(versionTag)',
    order: 'evaluatedAt.desc',
  });
  return jsonResponse({
    items: rows.map((row) => {
      const modelVersion = asObject(row.ModelVersion);
      return {
        modelVersionId: asString(row.modelVersionId),
        versionTag: asString(modelVersion?.versionTag, asString(row.modelVersionId)),
        split: asString(row.split, 'VALIDATION'),
        evaluatedAt: iso(row.evaluatedAt),
        auc: asNumber(row.auc),
        prAuc: asNumber(row.prAuc),
        precision: asNumber(row.precision),
        recall: asNumber(row.recall),
        f1: asNumber(row.f1),
        brierScore: asNumber(row.brierScore),
      };
    }),
  });
}

async function handleRetrainStatus(): Promise<Response> {
  const [activeModel, currentRun, lastRun] = await Promise.all([
    singleRow('ModelVersion', {
      select: 'id',
      stage: 'eq.ACTIVE',
      order: 'activatedAt.desc,createdAt.desc',
    }),
    singleRow('TrainingRun', {
      select: '*',
      status: 'in.(QUEUED,RUNNING)',
      order: 'createdAt.desc',
    }),
    singleRow('TrainingRun', {
      select: '*',
      status: 'eq.SUCCEEDED',
      order: 'endedAt.desc,createdAt.desc',
    }),
  ]);
  return jsonResponse({
    activeModelVersionId: asNullableString(activeModel?.id),
    currentRun: currentRun
      ? {
          trainingRunId: asString(currentRun.id),
          status: asString(currentRun.status),
          startedAt: nullableIso(currentRun.startedAt),
          endedAt: nullableIso(currentRun.endedAt),
        }
      : null,
    lastSuccessfulRun: lastRun
      ? {
          trainingRunId: asString(lastRun.id),
          endedAt: iso(lastRun.endedAt),
        }
      : null,
    nextScheduledAt: null,
  });
}

async function handleRecommendations(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const result = await listRows('manager_recommendation_records', {
    select: '*',
    order: 'priority.asc,createdAt.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });
  return jsonResponse({
    items: result.data.map((row) => ({
      id: asString(row.id),
      type: asString(row.type),
      title: asString(row.title),
      description: asString(row.description),
      icpProfileId: asNullableString(row.icpProfileId),
      icpName: asNullableString(row.icpName),
      field: asNullableString(row.field),
      currentValue: asNullableNumber(row.currentValue),
      recommendedValue: asNullableNumber(row.recommendedValue),
      confidence: asNumber(row.confidence),
      priority: asNumber(row.priority),
      status: asString(row.status, 'active'),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleDiscoveryRuns(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 50);
  const result = await listRows('JobExecution', {
    select: '*',
    type: 'eq.discovery.run',
    order: 'createdAt.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });
  return jsonResponse({
    runs: result.data.map(mapDiscoveryRun),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleDiscoveryRunStatus(runId: string): Promise<Response> {
  const row = await singleRow('JobExecution', {
    select: '*',
    id: `eq.${runId}`,
    type: 'eq.discovery.run',
  });
  if (!row) throw new HttpError(404, 'Discovery run not found');
  return jsonResponse(mapDiscoveryRunStatus(row));
}

async function handleDiscoveryRunDetails(runId: string): Promise<Response> {
  const run = await singleRow('JobExecution', {
    select: '*',
    id: `eq.${runId}`,
    type: 'eq.discovery.run',
  });
  if (!run) throw new HttpError(404, 'Discovery run not found');

  const [tasks, businesses, leads, costs] = await Promise.all([
    listRows('search_tasks', {
      select: '*',
      discovery_run_id: `eq.${runId}`,
      order: 'updated_at.desc',
      limit: 200,
    }),
    listRows('businesses', {
      select: '*',
      discoveryRunId: `eq.${runId}`,
      order: 'deterministic_score.desc,updated_at.desc',
      limit: 200,
    }),
    listRows('Lead', {
      select: '*',
      deletedAt: 'is.null',
      limit: 200,
    }),
    listRows('discovery_cost_events', {
      select: '*',
      discoveryRunId: `eq.${runId}`,
      order: 'createdAt.desc',
      limit: 200,
    }),
  ]);
  const normalizedBusinesses = businesses.data.map((row) => normalizeBusinessRow(row) as Row);
  const businessById = new Map(normalizedBusinesses.map((row) => [asString(row.id), row]));

  return jsonResponse({
    run: mapDiscoveryRunStatus(run),
    searchTasks: tasks.data.map((row) => ({
      id: asString(row.id),
      queryText: asString(row.query_text),
      countryCode: asString(row.country_code),
      city: asNullableString(row.city),
      status: asString(row.status),
      resultsCount: 0,
      provider: asString(row.task_type),
      error: asNullableString(row.error),
    })),
    businesses: normalizedBusinesses.map((row) => ({
      id: asString(row.id),
      name: asString(row.name),
      websiteDomain: asNullableString(row.websiteDomain),
      deterministicScore: asNullableNumber(row.deterministicScore),
      scoreBand: asNullableString(row.scoreBand),
      preQualified: asBoolean(row.preQualified),
      disqualificationReason: asNullableString(row.disqualificationReason),
      searchTaskId: null,
      recoveryItem: null,
    })),
    leads: leads.data
      .filter((row) => businessById.has(asString(row.businessId)))
      .map((row) => {
        const business = businessById.get(asString(row.businessId));
        return {
          id: asString(row.id),
          firstName: asString(row.firstName),
          lastName: asString(row.lastName),
          email: asString(row.email, 'unknown@example.invalid'),
          businessEmail: asNullableString(row.businessEmail),
          source: asString(row.source, 'demo'),
          blendedScore: null,
          scoreBand: null,
          status: asString(row.status),
          businessId: asString(row.businessId),
          businessName: asString(business?.name),
          businessDeterministicScore: asNullableNumber(business?.deterministicScore),
          businessScoreBand: asNullableString(business?.scoreBand),
        };
      }),
    costEvents: costs.data.map((row) => ({
      id: asString(row.id),
      provider: asString(row.provider),
      action: asString(row.apiCallType),
      creditCost: asNumber(row.costCents),
      createdAt: iso(row.createdAt),
    })),
  });
}

async function handleDiscoveryRecords(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'discoveredAt.desc,createdAt.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (const key of ['leadId', 'icpProfileId', 'provider', 'status']) {
    const value = url.searchParams.get(key);
    if (value) params[key] = `eq.${value}`;
  }
  const result = await listRows('LeadDiscoveryRecord', params);
  return jsonResponse({
    items: result.data.map((row) => ({
      id: asString(row.id),
      leadId: asString(row.leadId),
      icpProfileId: asString(row.icpProfileId),
      provider: asString(row.provider),
      providerSource: asNullableString(row.providerSource),
      providerConfidence: asNullableNumber(row.providerConfidence),
      providerRecordId: asString(row.providerRecordId),
      providerCursor: asNullableString(row.providerCursor),
      queryHash: asString(row.queryHash),
      status: asString(row.status, 'DISCOVERED'),
      rawPayload: row.rawPayload ?? {},
      provenanceJson: row.provenanceJson ?? null,
      errorMessage: asNullableString(row.errorMessage),
      discoveredAt: iso(row.discoveredAt),
      createdAt: iso(row.createdAt),
    })),
    qualityMetrics: null,
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handlePipelineStats(): Promise<Response> {
  const [discovered, enriched, scored, messaged, draftCount] = await Promise.all([
    countRows('Lead', { deletedAt: 'is.null' }),
    countRows('Lead', { deletedAt: 'is.null', status: pgIn(ENRICHED_LEAD_STATUSES) }),
    countRows('Lead', { deletedAt: 'is.null', status: pgIn(SCORED_LEAD_STATUSES) }),
    countRows('Lead', { deletedAt: 'is.null', status: pgIn(MESSAGED_LEAD_STATUSES) }),
    countRows('MessageDraft', { approvalStatus: 'eq.PENDING' }),
  ]);
  return jsonResponse({
    leadDistribution: {
      discovered,
      enriched,
      scored,
      messaged,
    },
    pendingApprovals: draftCount,
  });
}

async function handleSettings(): Promise<Response> {
  const result = await listRows('pipeline_settings', {
    select: '*',
    order: 'key.asc',
    limit: 200,
  });
  return jsonResponse({
    items: result.data.map((row) => ({
      key: asString(row.key),
      value: row.valueJson ?? null,
      updatedAt: iso(row.updatedAt),
    })),
  });
}

async function handleSetting(key: string): Promise<Response> {
  const row = await singleRow('pipeline_settings', {
    select: '*',
    key: `eq.${key}`,
  });
  if (!row) throw new HttpError(404, 'Pipeline setting not found');
  return jsonResponse({
    key: asString(row.key),
    value: row.valueJson ?? null,
    updatedAt: iso(row.updatedAt),
  });
}

async function handleAdminLeads(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    offset: (page - 1) * pageSize,
    limit: pageSize,
    order: adminBusinessOrder(url.searchParams.get('sortBy')),
  };
  const countries = csv(url.searchParams.get('countries')).map((country) => country.toUpperCase());
  if (countries.length > 0) params.country_code = pgIn(countries);
  const city = url.searchParams.get('city');
  if (city) params.city = `ilike.${ilikePattern(city)}`;
  const scoreMin = url.searchParams.get('scoreMin');
  if (scoreMin) params.deterministic_score = `gte.${scoreMin}`;
  const hasWhatsapp = url.searchParams.get('hasWhatsapp');
  if (hasWhatsapp !== null) params.has_whatsapp = `eq.${hasWhatsapp === 'true'}`;
  const result = await listRows('businesses', params);
  return jsonResponse({
    items: result.data.map(mapAdminLead),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

function adminBusinessOrder(sortBy: string | null): string {
  if (sortBy === 'recent') return 'updated_at.desc,id.desc';
  if (sortBy === 'review_count') return 'review_count.desc,deterministic_score.desc,id.desc';
  if (sortBy === 'score_desc') return 'deterministic_score.desc,updated_at.desc,id.desc';
  return 'created_at.desc,id.desc';
}

async function handleAdminLeadDetail(id: string): Promise<Response> {
  const business = await singleRow('businesses', { select: '*', id: `eq.${id}` });
  if (!business) throw new HttpError(404, 'Lead not found');
  const normalizedBusiness = normalizeBusinessRow(business) as Row;
  const evidence = await listRows('business_evidence', {
    select: '*',
    business_id: `eq.${id}`,
    order: 'created_at.desc',
    limit: 100,
  });
  const score = asNumber(normalizedBusiness.deterministicScore);
  return jsonResponse({
    lead: mapAdminLead(normalizedBusiness),
    scoreBreakdown: {
      total: score,
      tier: asNullableString(normalizedBusiness.scoreBand) ?? scoreTier(score),
      contributions: [],
    },
    evidenceTimeline: evidence.data.map((row) => ({
      id: asString(row.id),
      sourceType: asString(row.source_type),
      sourceUrl: asString(row.source_url),
      serpapiResultId: asNullableString(row.serpapi_result_id),
      rawJson: row.raw_json ?? {},
      createdAt: iso(row.created_at),
      searchTask: null,
    })),
    dedupeKeys: {
      websiteDomain: asNullableString(normalizedBusiness.websiteDomain),
      phoneE164: asNullableString(normalizedBusiness.phoneE164),
      instagramHandle: asNullableString(normalizedBusiness.instagramHandle),
    },
  });
}

async function handleAdminBusinesses(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 30, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'updated_at.desc,id.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const q = url.searchParams.get('q');
  if (q) {
    const pattern = ilikePattern(q);
    params.or = `(name.ilike.${pattern},category.ilike.${pattern},website_domain.ilike.${pattern},city.ilike.${pattern},instagram_handle.ilike.${pattern})`;
  }
  const result = await listRows('businesses', params);
  const businessIds = result.data.map((row) => asString(row.id)).filter(Boolean);
  const [leadRows, scores, recoveries] = await Promise.all([
    listRows('Lead', { select: 'id,businessId', businessId: pgIn(businessIds), limit: MAX_DEMO_ROWS }),
    listRows('LeadScorePrediction', { select: 'leadId,blendedScore', limit: MAX_DEMO_ROWS }),
    listRows('contact_recovery_items', { select: '*', business_id: pgIn(businessIds), limit: MAX_DEMO_ROWS }),
  ]);
  const leadByBusiness = new Map(leadRows.data.map((row) => [asString(row.businessId), row]));
  const scoreByLead = new Map(scores.data.map((row) => [asString(row.leadId), asNullableNumber(row.blendedScore)]));
  const recoveryByBusiness = new Map(recoveries.data.map((row) => [asString(row.business_id), row]));
  return jsonResponse({
    items: result.data.map((row) => {
      const lead = leadByBusiness.get(asString(row.id));
      return mapAdminBusiness(
        row,
        asNullableString(lead?.id),
        lead ? scoreByLead.get(asString(lead.id)) ?? null : null,
        recoveryByBusiness.get(asString(row.id)) ?? null,
      );
    }),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleAdminBusinessDetail(id: string): Promise<Response> {
  const business = await singleRow('businesses', { select: '*', id: `eq.${id}` });
  if (!business) throw new HttpError(404, 'Business not found');
  const contacts = await listRows('business_contacts', {
    select: '*',
    businessId: `eq.${id}`,
    order: 'positionRank.asc,name.asc',
    limit: 100,
  });
  return jsonResponse({
    business: mapAdminBusiness(business),
    selectedContacts: contacts.data.map(mapBusinessContact),
  });
}

async function handleSearchTasks(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: url.searchParams.get('sortBy') === 'attempts_desc'
      ? 'attempts.desc,updated_at.desc'
      : url.searchParams.get('sortBy') === 'run_after_asc'
        ? 'run_after.asc,updated_at.desc'
        : 'updated_at.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (const [queryKey, column] of [
    ['status', 'status'],
    ['taskType', 'task_type'],
    ['countryCode', 'country_code'],
    ['timeBucket', 'time_bucket'],
  ] as const) {
    const value = url.searchParams.get(queryKey);
    if (value) params[column] = `eq.${value}`;
  }
  const result = await listRows('search_tasks', params);
  return jsonResponse({
    items: result.data.map(mapSearchTask),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleSearchTaskDetail(id: string): Promise<Response> {
  const task = await singleRow('search_tasks', { select: '*', id: `eq.${id}` });
  if (!task) throw new HttpError(404, 'Search task not found');
  return jsonResponse({
    task: {
      ...mapSearchTask(task),
      paramsJson: task.params_json ?? {},
      page: asNumber(task.page, 1),
      derivedParams: {
        engine: null,
        q: asNullableString(task.query_text),
        location: asNullableString(task.city),
        gl: asNullableString(task.country_code),
        hl: asNullableString(task.language),
        z: null,
        m: null,
        start: null,
      },
    },
    linkedLeads: [],
  });
}

async function handleJobRuns(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'started_at.desc,id.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const status = url.searchParams.get('status');
  if (status) params.status = `eq.${status}`;
  const jobName = url.searchParams.get('jobName');
  if (jobName) params.job_name = `eq.${jobName}`;
  const result = await listRows('job_runs', params);
  return jsonResponse({
    items: result.data.map(mapJobRun),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleJobRunDetail(id: string): Promise<Response> {
  const row = await singleRow('job_runs', { select: '*', id: `eq.${id}` });
  if (!row) throw new HttpError(404, 'Job run not found');
  return jsonResponse({ run: mapJobRun(row) });
}

async function handleJobRequests(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 100);
  const params: Record<string, string | number> = {
    select: '*',
    order: 'created_at.desc,id.desc',
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const status = url.searchParams.get('status');
  if (status) params.status = `eq.${status}`;
  const requestType = url.searchParams.get('requestType');
  if (requestType) params.request_type = `eq.${requestType}`;
  const result = await listRows('job_requests', params);
  return jsonResponse({
    items: result.data.map(mapJobRequest),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

function disabled(): Response {
  return jsonResponse({ error: DEMO_DISABLED_MESSAGE }, 403);
}

async function routeRequest(request: Request, _auth: AuthContext): Promise<Response> {
  const url = new URL(request.url);
  const routePath = extractRoutePath(url.pathname);
  const parts = pathParts(routePath);
  const method = request.method.toUpperCase();

  if (method !== 'GET') {
    return disabled();
  }

  if (routePath === '/health' || routePath === '/ready') {
    return jsonResponse({ ok: true, service: 'demo-edge-api' });
  }

  if (parts[0] !== 'v1') {
    throw new HttpError(404, 'Not found');
  }

  if (parts[1] === 'icps' && parts.length === 2) return handleListIcps(url);
  if (parts[1] === 'icps' && parts[2] && parts.length === 3) return handleGetIcp(parts[2]);
  if (parts[1] === 'icps' && parts[2] && parts[3] === 'rules') return handleGetIcpRules(parts[2]);

  if (parts[1] === 'leads' && parts[2] === 'rejected') return handleListRejectedLeads(url);
  if (parts[1] === 'leads' && parts[2] === 'recovery' && parts[3]) return handleGetContactRecovery(parts[3]);
  if (parts[1] === 'leads' && parts[2] === 'recovery') return handleListContactRecovery(url);
  if (parts[1] === 'leads' && parts.length === 2) return handleListLeads(url);
  if (parts[1] === 'leads' && parts[2]) return handleGetLead(parts[2]);

  if (parts[1] === 'messaging' && parts[2] === 'drafts' && parts.length === 3) return handleListDrafts(url);
  if (parts[1] === 'messaging' && parts[2] === 'drafts' && parts[3] === 'events') {
    return new Response('event: timeout\ndata: {}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  }
  if (parts[1] === 'messaging' && parts[2] === 'drafts' && parts[3]) return handleGetDraft(parts[3]);
  if (parts[1] === 'messaging' && parts[2] === 'sends') return handleListSends(url);
  if (parts[1] === 'messaging' && parts[2] === 'conversations' && parts[3]) return handleConversation(parts[3]);

  if (parts[1] === 'analytics' && parts[2] === 'funnel') return handleFunnel(url);
  if (parts[1] === 'analytics' && parts[2] === 'score-distribution') return handleScoreDistribution(url);
  if (parts[1] === 'analytics' && parts[2] === 'daily-quality-trends') return handleDailyQualityTrends(url);
  if (parts[1] === 'analytics' && parts[2] === 'avg-score') return handleAvgScore();
  if (parts[1] === 'analytics' && parts[2] === 'icp-performance') return handleIcpPerformance();
  if (parts[1] === 'analytics' && parts[2] === 'model-metrics') return handleModelMetrics();
  if (parts[1] === 'analytics' && parts[2] === 'retrain-status') return handleRetrainStatus();
  if (parts[1] === 'analytics' && parts[2] === 'recommendations') return handleRecommendations(url);

  if (parts[1] === 'feedback' && parts[2] === 'summary') return handleFeedbackSummary(url);
  if (parts[1] === 'feedback' && parts[2] === 'events') return handleListFeedbackEvents(url);

  if (parts[1] === 'discovery' && parts[2] === 'runs' && parts[3] && parts[4] === 'details') {
    return handleDiscoveryRunDetails(parts[3]);
  }
  if (parts[1] === 'discovery' && parts[2] === 'runs' && parts[3]) return handleDiscoveryRunStatus(parts[3]);
  if (parts[1] === 'discovery' && parts[2] === 'runs') return handleDiscoveryRuns(url);
  if (parts[1] === 'discovery' && parts[2] === 'records') return handleDiscoveryRecords(url);

  if (parts[1] === 'stats' && parts[2] === 'pipeline') return handlePipelineStats();
  if (parts[1] === 'settings' && parts[2] === 'pipeline' && parts[3]) return handleSetting(parts[3]);
  if (parts[1] === 'settings' && parts[2] === 'pipeline') return handleSettings();

  if (parts[1] === 'admin' && parts[2] === 'leads' && parts[3]) return handleAdminLeadDetail(parts[3]);
  if (parts[1] === 'admin' && parts[2] === 'leads') return handleAdminLeads(url);
  if (parts[1] === 'admin' && parts[2] === 'businesses' && parts[3]) return handleAdminBusinessDetail(parts[3]);
  if (parts[1] === 'admin' && parts[2] === 'businesses') return handleAdminBusinesses(url);
  if (parts[1] === 'admin' && parts[2] === 'search-tasks' && parts[3]) return handleSearchTaskDetail(parts[3]);
  if (parts[1] === 'admin' && parts[2] === 'search-tasks') return handleSearchTasks(url);
  if (parts[1] === 'admin' && parts[2] === 'jobs' && parts[3] === 'runs' && parts[4]) return handleJobRunDetail(parts[4]);
  if (parts[1] === 'admin' && parts[2] === 'jobs' && parts[3] === 'runs') return handleJobRuns(url);
  if (parts[1] === 'admin' && parts[2] === 'jobs' && parts[3] === 'requests') return handleJobRequests(url);

  if (parts[1] === 'discovery-admin' && parts[2] === 'runs' && parts[3]) return handleDiscoveryRunDetails(parts[3]);

  throw new HttpError(404, 'Not found');
}

Deno.serve(async (request) => {
  const corsHeaders = buildCorsHeaders(request);
  if (request.method.toUpperCase() === 'OPTIONS') {
    return withCors(emptyResponse(), corsHeaders);
  }

  try {
    const auth = await authenticate(request);
    const response = await routeRequest(request, auth);
    return withCors(response, corsHeaders);
  } catch (error) {
    return withCors(errorResponse(error), corsHeaders);
  }
});

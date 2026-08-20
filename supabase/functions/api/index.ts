import {
  ENRICHED_LEAD_STATUSES,
  MESSAGED_LEAD_STATUSES,
  QUALIFIED_LEAD_STATUSES,
  SCORED_LEAD_STATUSES,
  SENT_MESSAGE_STATUSES,
} from "../../../packages/contracts/src/metrics.contract.ts";
import {
  canCreateEdgeSearchTask,
  canInspectEdgeDiscoveryResult,
  distributeEdgeDiscoveryTaskBudget,
  EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS,
  EDGE_DISCOVERY_MAX_RESULTS,
  EDGE_DISCOVERY_MAX_SEARCH_TASKS,
  EDGE_PUBLIC_DEMO_US_CITIES,
  edgeDiscoveryTaskResultAllowance,
  type EdgePublicDemoQuotaOutcome,
  isEdgeDiscoverySearchTaskLimit,
  planEdgeDiscoveryTaskTargets,
  resolveDiscoveryProgressTotal,
  resolveEdgeDiscoveryTerminalStatus,
  resolveWorkerDiscoveryBusinessCounts,
} from "./discovery-limits.ts";
import {
  type EdgeHunterContact,
  HunterDomainSearchError,
  normalizeHunterDomain,
  resolveHunterQuotaLimit,
  searchHunterDomainContacts,
  utcMonthStart,
} from "./hunter-domain-search.ts";
import {
  isPublicPipelineSettingKey,
  sanitizePublicOperationalJson,
  toPublicDeliveryFailureCode,
  toPublicOperationalError,
} from "./public-error-message.ts";
import {
  getPublicDemoIcpPresentation,
  PUBLIC_DEMO_ICP_PRESENTATIONS,
} from "./public-demo-icps.ts";
import {
  applyRestCountPreference,
  type RestCountPreference,
} from "./rest-count-preference.ts";

type JsonObject = Record<string, unknown>;
type Row = Record<string, unknown>;

const DEFAULT_CORS_ORIGINS: string[] = [];
const DEMO_DISABLED_MESSAGE =
  "This demo API allows small discovery, enrichment, scoring, and OpenAI draft-generation jobs. Outbound sends and other worker-backed actions are disabled.";
const MAX_DEMO_ROWS = 1000;
const STATS_PAGE_SIZE = 1000;
const STATS_IN_FILTER_CHUNK_SIZE = 200;
const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_DRAFT_MODEL = "gpt-5.5";
const OPENAI_DRAFT_TIMEOUT_MS = 30_000;
const DEFAULT_EDGE_HUNTER_DAILY_LIMIT = 2;
const DEFAULT_EDGE_HUNTER_MONTHLY_LIMIT = 40;
const SLOW_REST_REQUEST_LOG_MS = 1_000;
const DASHBOARD_SUMMARY_CACHE_TTL_MS = 15_000;
const DEMO_READINESS_CACHE_TTL_MS = 30_000;
const PUBLIC_DEMO_SESSION_HEADER = "x-leadzilla-demo-session";
const PUBLIC_DEMO_GATEWAY_HEADER = "x-leadzilla-demo-gateway";
const PUBLIC_DEMO_IDEMPOTENCY_HEADER = "idempotency-key";
const PUBLIC_DEMO_PROVIDER_TIMEOUT_MS = 20_000;
const PUBLIC_DEMO_STALE_RUN_MS = 2 * 60 * 60_000;
const PUBLIC_DEMO_COUNTRIES = new Set(["US", "AE", "SA", "JO", "EG"]);

const dashboardSummaryCache = new Map<
  string,
  { expiresAt: number; payload: JsonObject }
>();
let demoReadinessCacheExpiresAt = 0;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly expose = true,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface AuthContext {
  userId: string;
  email: string | null;
}

interface PublicDemoContext {
  sessionHash: string;
  idempotencyKey: string | null;
}

interface PublicDemoAdmission extends Row {
  admitted: boolean;
  resolved_run_id: string;
  reason: EdgePublicDemoQuotaOutcome | "duplicate" | "repaired";
}

interface EdgeDiscoveryRequest {
  icpProfileId?: string | undefined;
  icpProfileIds?: string[] | undefined;
  countries: string[];
  cities?: string[] | undefined;
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
  limit?: number | undefined;
  advancedSettings?: {
    searchCategories?: string[] | undefined;
    minReviewCount?: number | undefined;
  } | undefined;
}

interface EdgeIcpProfile {
  id: string;
  name: string;
  targetIndustries: string[];
  targetCountries: string[];
  metadataJson: JsonObject | null;
}

interface EdgeGenerateDraftRequest {
  leadId: string;
  icpProfileId: string;
  scorePredictionId?: string | undefined;
  knowledgeEntryIds: string[];
  channel: "EMAIL" | "WHATSAPP";
  promptVersion: string;
  forceRegenerate?: boolean | undefined;
  redraftFeedback?: string | undefined;
}

interface OpenAiDraftContent {
  subject: string | null;
  bodyText: string;
  bodyHtml: string | null;
  ctaText: string | null;
  qualityScore: number | null;
}

interface EdgeHunterCandidate {
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  title: string | null;
  seniority: "executive" | "director" | "manager" | "other";
  positionRank: number;
}

interface EdgeLocalBusiness {
  providerRecordId: string;
  name: string;
  url: string | null;
  websiteUrl: string | null;
  address: string | null;
  phone: string | null;
  city: string | null;
  countryCode: string;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  instagramHandle: string | null;
  raw: unknown;
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
  return value.replace(/\/+$/, "");
}

function supabaseUrl(): string {
  return readEnv("SUPABASE_URL");
}

function anonKey(): string {
  return readEnv("SUPABASE_ANON_KEY");
}

function serviceRoleKey(): string {
  // This Edge Function uses the service role for demo-scoped reads/writes.
  // Worker-backed delivery and outbound send routes remain blocked.
  return readEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function corsOrigins(): string[] {
  const configured = Deno.env.get("LEADZILLA_CORS_ORIGINS");
  if (!configured) {
    return DEFAULT_CORS_ORIGINS;
  }

  return configured
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function buildCorsHeaders(request: Request): Headers {
  const headers = new Headers({
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,idempotency-key,x-admin-key,x-leadzilla-demo-gateway,x-leadzilla-demo-session",
    "access-control-max-age": "86400",
    vary: "Origin",
  });

  const origin = request.headers.get("origin");
  if (origin && corsOrigins().includes(origin)) {
    headers.set("access-control-allow-origin", origin);
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

async function responseJson<T extends JsonObject>(
  response: Response,
): Promise<T> {
  return await response.json() as T;
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      return jsonResponse(
        { error: "Live service is temporarily unavailable" },
        error.status,
      );
    }
    const response = jsonResponse(
      { error: error.expose ? error.message : "Internal server error" },
      error.status,
    );
    if (error.status === 429) {
      response.headers.set("retry-after", "60");
    }
    return response;
  }

  console.error("[demo-edge-api] unhandled error", error);
  return jsonResponse(
    { error: "Live service is temporarily unavailable" },
    500,
  );
}

function normalizeErrorFragment(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function compactRepeatedErrorMessage(message: string): string {
  const fragments = message
    .split(/\s*;\s*/)
    .map(normalizeErrorFragment)
    .filter((fragment) => fragment.length > 0);
  if (fragments.length === 0) {
    return "Unknown error";
  }

  const seen = new Set<string>();
  const uniqueFragments: string[] = [];
  for (const fragment of fragments) {
    const key = fragment.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueFragments.push(fragment);
  }

  return uniqueFragments.join("; ");
}

function uniqueErrorMessages(messages: readonly string[]): string[] {
  const seen = new Set<string>();
  const uniqueMessages: string[] = [];
  for (const message of messages) {
    const compacted = compactRepeatedErrorMessage(message);
    const key = compacted.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueMessages.push(compacted);
  }
  return uniqueMessages;
}

function readRestErrorDetail(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonObject;
    const message = normalizeOptionalString(parsed.message);
    const details = normalizeOptionalString(parsed.details);
    const hint = normalizeOptionalString(parsed.hint);
    const code = normalizeOptionalString(parsed.code);
    const parts = uniqueErrorMessages([
      ...(message ? [message] : []),
      ...(details ? [details] : []),
      ...(hint ? [`Hint: ${hint}`] : []),
      ...(code ? [`Code: ${code}`] : []),
    ]);
    return parts.length > 0 ? parts.join(" ") : null;
  } catch {
    return compactRepeatedErrorMessage(trimmed).slice(0, 300);
  }
}

function formatRestRequestError(
  table: string,
  status: number,
  body: string,
): string {
  const detail = readRestErrorDetail(body);
  const base = `Database query failed for ${table} (${status})`;
  return detail ? `${base}: ${detail}` : base;
}

function parseContentRange(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function appendParams(
  url: URL,
  params: Record<string, string | number | boolean | undefined | null>,
): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

async function restRequest<T>(
  table: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
  init: RequestInit = {},
  countPreference: RestCountPreference = "exact",
): Promise<RestResult<T>> {
  const startedAt = Date.now();
  const key = serviceRoleKey();
  const url = new URL(`${supabaseUrl()}/rest/v1/${encodeURIComponent(table)}`);
  appendParams(url, params);

  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("authorization", `Bearer ${key}`);
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  applyRestCountPreference(headers, countPreference);

  const response = await fetch(url, {
    ...init,
    headers,
  });
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[demo-edge-api] rest request failed", {
      table,
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new HttpError(
      502,
      formatRestRequestError(table, response.status, body),
      false,
    );
  }

  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as T) : (undefined as T);
  if (durationMs >= SLOW_REST_REQUEST_LOG_MS) {
    console.warn("[demo-edge-api] slow rest request", {
      table,
      method: init.method ?? "GET",
      durationMs,
      status: response.status,
      rowCount: Array.isArray(data) ? data.length : undefined,
    });
  }
  return {
    data,
    total: parseContentRange(response.headers.get("content-range")),
  };
}

async function rpcRequest<T extends Row>(
  name: string,
  body: JsonObject,
): Promise<T[]> {
  const key = serviceRoleKey();
  const response = await fetch(
    `${supabaseUrl()}/rest/v1/rpc/${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    console.error("[demo-edge-api] database RPC failed", {
      name,
      status: response.status,
      detail: readRestErrorDetail(responseBody),
    });
    throw new HttpError(502, `Database RPC failed for ${name}`, false);
  }

  return await response.json() as T[];
}

async function insertRows<T extends Row>(
  table: string,
  rows: Row[],
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<T[]> {
  if (rows.length === 0) {
    return [];
  }

  const result = await restRequest<T[]>(table, { select: "*", ...params }, {
    method: "POST",
    headers: {
      prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  return result.data;
}

async function insertRow<T extends Row>(
  table: string,
  row: Row,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<T> {
  const [created] = await insertRows<T>(table, [row], params);
  if (!created) {
    throw new HttpError(502, "Database insert failed", false);
  }
  return created;
}

async function updateRows<T extends Row>(
  table: string,
  params: Record<string, string | number | boolean | undefined | null>,
  patch: Row,
): Promise<T[]> {
  const result = await restRequest<T[]>(table, { select: "*", ...params }, {
    method: "PATCH",
    headers: {
      prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  return result.data;
}

async function listRows(
  table: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
  countPreference: RestCountPreference = "exact",
): Promise<RestResult<Row[]>> {
  return restRequest<Row[]>(table, params, {}, countPreference);
}

async function singleRow(
  table: string,
  params: Record<string, string | number | boolean | undefined | null>,
): Promise<Row | null> {
  const result = await listRows(table, { ...params, limit: 1 }, "none");
  return result.data[0] ?? null;
}

async function countRows(
  table: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<number> {
  const result = await restRequest<undefined>(table, {
    ...params,
    select: "id",
    limit: 1,
  }, { method: "HEAD" });
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
    }, "none");
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
      countRows(table, { ...params, [column]: pgIn(chunk) })
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
      listAllRows(table, { ...params, [column]: pgIn(chunk) })
    ),
  );
  return rows.flat();
}

function extractRoutePath(pathname: string): string {
  if (pathname === "/api") {
    return "/";
  }
  if (
    pathname.startsWith("/v1/") || pathname === "/v1" ||
    pathname === "/health" || pathname === "/ready"
  ) {
    return pathname;
  }
  const marker = "/api/";
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex >= 0) {
    return `/${pathname.slice(markerIndex + marker.length)}`;
  }
  return pathname;
}

function pathParts(routePath: string): string[] {
  return routePath.split("/").filter(Boolean).map((part) =>
    decodeURIComponent(part)
  );
}

function isUuid(value: string | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value),
  );
}

async function sha256(
  value: string,
): Promise<{ bytes: Uint8Array; hex: string }> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return {
    bytes: digest,
    hex: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ),
  };
}

async function readPublicDemoContext(
  request: Request,
): Promise<PublicDemoContext> {
  const configuredSecret = Deno.env.get("LEADZILLA_DEMO_GATEWAY_SECRET");
  const suppliedSecret = request.headers.get(PUBLIC_DEMO_GATEWAY_HEADER);
  if (!configuredSecret || !suppliedSecret) {
    throw new HttpError(401, "Unauthorized");
  }

  const [expectedHash, suppliedHash] = await Promise.all([
    sha256(configuredSecret),
    sha256(suppliedSecret),
  ]);
  let mismatch = expectedHash.bytes.length ^ suppliedHash.bytes.length;
  for (let index = 0; index < expectedHash.bytes.length; index += 1) {
    mismatch |= expectedHash.bytes[index]! ^ (suppliedHash.bytes[index] ?? 0);
  }
  if (mismatch !== 0) {
    throw new HttpError(401, "Unauthorized");
  }

  const sessionId = request.headers.get(PUBLIC_DEMO_SESSION_HEADER);
  if (!isUuid(sessionId)) {
    throw new HttpError(400, "Invalid demo session");
  }

  const idempotencyKey = request.headers.get(PUBLIC_DEMO_IDEMPOTENCY_HEADER);
  return {
    sessionHash: (await sha256(sessionId)).hex,
    idempotencyKey: isUuid(idempotencyKey) ? idempotencyKey : null,
  };
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
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
  return value === "true" || value === "1";
}

function csv(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function pgIn(values: readonly string[]): string {
  return `in.(${
    values.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")
  })`;
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
  return `*${value.replace(/[*(),]/g, " ").trim()}*`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
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
    countryCode: firstValue(row, "countryCode", "country_code"),
    phoneE164: firstValue(row, "phoneE164", "phone_e164"),
    websiteDomain: firstValue(row, "websiteDomain", "website_domain"),
    instagramHandle: firstValue(row, "instagramHandle", "instagram_handle"),
    reviewCount: firstValue(row, "reviewCount", "review_count"),
    deterministicScore: firstValue(
      row,
      "deterministicScore",
      "deterministic_score",
    ),
    scoreBand: firstValue(row, "scoreBand", "score_band"),
    hasWhatsapp: firstValue(row, "hasWhatsapp", "has_whatsapp"),
    hasInstagram: firstValue(row, "hasInstagram", "has_instagram"),
    acceptsOnlinePayments: firstValue(
      row,
      "acceptsOnlinePayments",
      "accepts_online_payments",
    ),
    followerCount: firstValue(row, "followerCount", "follower_count"),
    physicalAddressPresent: firstValue(
      row,
      "physicalAddressPresent",
      "physical_address_present",
    ),
    recentActivity: firstValue(row, "recentActivity", "recent_activity"),
    apifyWebsiteScrapeJson: firstValue(
      row,
      "apifyWebsiteScrapeJson",
      "apify_website_scrape_json",
    ),
    apifyInstagramScrapeJson: firstValue(
      row,
      "apifyInstagramScrapeJson",
      "apify_instagram_scrape_json",
    ),
    websiteScrapedAt: firstValue(row, "websiteScrapedAt", "website_scraped_at"),
    instagramScrapedAt: firstValue(
      row,
      "instagramScrapedAt",
      "instagram_scraped_at",
    ),
    discoveryRunId: firstValue(row, "discoveryRunId", "discovery_run_id"),
    preQualified: firstValue(row, "preQualified", "pre_qualified"),
    disqualificationReason: firstValue(
      row,
      "disqualificationReason",
      "disqualification_reason",
    ),
    createdAt: firstValue(row, "createdAt", "created_at"),
    updatedAt: firstValue(row, "updatedAt", "updated_at"),
  };
}

function normalizeJobRunRow(row: Row): Row {
  return {
    ...row,
    jobName: firstValue(row, "jobName", "job_name"),
    startedAt: firstValue(row, "startedAt", "started_at"),
    finishedAt: firstValue(row, "finishedAt", "finished_at"),
    durationMs: firstValue(row, "durationMs", "duration_ms"),
    paramsJson: firstValue(row, "paramsJson", "params_json"),
    countersJson: firstValue(row, "countersJson", "counters_json"),
    resourceJson: firstValue(row, "resourceJson", "resource_json"),
    errorText: firstValue(row, "errorText", "error_text"),
    createdAt: firstValue(row, "createdAt", "created_at"),
    updatedAt: firstValue(row, "updatedAt", "updated_at"),
  };
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function edgeHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseEdgeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeOptionalString(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  );
}

function parseGenerateDraftBody(value: unknown): EdgeGenerateDraftRequest {
  const body = asObject(value);
  if (!body) {
    throw new HttpError(400, "Invalid generate message payload");
  }

  const leadId = normalizeOptionalString(body.leadId);
  const icpProfileId = normalizeOptionalString(body.icpProfileId);
  const scorePredictionId = normalizeOptionalString(body.scorePredictionId) ??
    undefined;
  const promptVersion = normalizeOptionalString(body.promptVersion) ?? "v2";
  const channelValue = normalizeOptionalString(body.channel) ?? "EMAIL";
  const redraftFeedback = normalizeOptionalString(body.redraftFeedback) ??
    undefined;

  if (!leadId || !icpProfileId) {
    throw new HttpError(400, "leadId and icpProfileId are required");
  }
  if (channelValue !== "EMAIL" && channelValue !== "WHATSAPP") {
    throw new HttpError(400, "channel must be EMAIL or WHATSAPP");
  }

  return {
    leadId,
    icpProfileId,
    ...(scorePredictionId ? { scorePredictionId } : {}),
    knowledgeEntryIds: parseEdgeStringArray(body.knowledgeEntryIds),
    channel: channelValue,
    promptVersion,
    ...(body.forceRegenerate === true ? { forceRegenerate: true } : {}),
    ...(redraftFeedback ? { redraftFeedback } : {}),
  };
}

function clampDraftQualityScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeNullableDraftString(
  value: unknown,
  maxLength: number,
): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function parseOpenAiDraftContent(value: unknown): OpenAiDraftContent {
  const payload = asObject(value);
  if (!payload) {
    throw new HttpError(502, "OpenAI draft response was not valid JSON");
  }

  const bodyText = normalizeOptionalString(payload.bodyText);
  if (!bodyText) {
    throw new HttpError(502, "OpenAI draft response was missing bodyText");
  }

  return {
    subject: normalizeNullableDraftString(payload.subject, 500),
    bodyText: bodyText.slice(0, 10_000),
    bodyHtml: normalizeNullableDraftString(payload.bodyHtml, 10_000),
    ctaText: normalizeNullableDraftString(payload.ctaText, 500),
    qualityScore: clampDraftQualityScore(payload.qualityScore),
  };
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function firstParsedOpenAiOutput(payload: JsonObject): JsonObject | null {
  const directParsed = asObject(payload.output_parsed);
  if (directParsed) {
    return directParsed;
  }

  for (const item of asArray(payload.output)) {
    const itemObject = asObject(item);
    for (const content of asArray(itemObject?.content)) {
      const contentObject = asObject(content);
      const parsed = asObject(contentObject?.parsed);
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function firstOpenAiOutputText(payload: JsonObject): string | null {
  const direct = normalizeOptionalString(payload.output_text);
  if (direct) {
    return direct;
  }

  for (const item of asArray(payload.output)) {
    const itemObject = asObject(item);
    for (const content of asArray(itemObject?.content)) {
      const contentObject = asObject(content);
      const text = normalizeOptionalString(contentObject?.text);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function parseOpenAiDraftResponse(payload: JsonObject): OpenAiDraftContent {
  const parsed = firstParsedOpenAiOutput(payload);
  if (parsed) {
    return parseOpenAiDraftContent(parsed);
  }

  const outputText = firstOpenAiOutputText(payload);
  if (!outputText) {
    throw new HttpError(502, "OpenAI draft response was missing output text");
  }

  try {
    return parseOpenAiDraftContent(JSON.parse(stripMarkdownFences(outputText)));
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(502, "OpenAI draft response could not be parsed");
  }
}

function compactJson(value: unknown, maxLength = 1800): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    const text = JSON.stringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return null;
  }
}

function settingString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function pipelineSettingValue(key: string): Promise<unknown | null> {
  const row = await singleRow("pipeline_settings", {
    select: "valueJson",
    key: `eq.${key}`,
  });
  return row?.valueJson ?? null;
}

async function loadScoreQualificationThreshold(): Promise<number> {
  const value = await pipelineSettingValue("scoreQualificationThreshold");
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new HttpError(
      503,
      "Draft generation is unavailable because the score qualification threshold is missing or invalid.",
    );
  }
  return parsed;
}

async function loadMessagingTextSetting(key: string): Promise<string | null> {
  return settingString(await pipelineSettingValue(key));
}

function openAiDraftModel(settingModel: string | null): string {
  return (
    normalizeOptionalString(Deno.env.get("OPENAI_DRAFT_MODEL")) ??
      normalizeOptionalString(Deno.env.get("OPENAI_GENERATION_MODEL")) ??
      settingModel ??
      DEFAULT_OPENAI_DRAFT_MODEL
  );
}

function parseCreateDiscoveryRunBody(
  value: unknown,
  publicDemo = false,
): EdgeDiscoveryRequest {
  const body = asObject(value);
  if (!body) {
    throw new HttpError(400, "Invalid discovery run payload");
  }

  const icpProfileIds = parseEdgeStringArray(body.icpProfileIds);
  const icpProfileId = normalizeOptionalString(body.icpProfileId) ?? undefined;
  const countries = parseEdgeStringArray(body.countries).map((country) =>
    country.toUpperCase()
  );
  const cities = parseEdgeStringArray(body.cities);
  const advancedSettings = asObject(body.advancedSettings);
  const limitValue = body.limit === undefined
    ? EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS
    : Number(body.limit);

  if (icpProfileIds.length === 0 && !icpProfileId) {
    throw new HttpError(
      400,
      "Either icpProfileIds or icpProfileId is required",
    );
  }
  if (countries.length === 0) {
    throw new HttpError(
      400,
      "Select at least one country for the discovery run",
    );
  }
  if (!Number.isInteger(limitValue) || limitValue < 1) {
    throw new HttpError(400, "Discovery run limit must be a positive integer");
  }
  if (!isEdgeDiscoverySearchTaskLimit(limitValue)) {
    throw new HttpError(
      400,
      `Public demo discovery runs use a fixed budget of ${EDGE_DISCOVERY_MAX_SEARCH_TASKS} search tasks.`,
    );
  }
  const searchCategories = parseEdgeStringArray(
    advancedSettings?.searchCategories,
  );
  if (
    publicDemo && (
      icpProfileIds.length > PUBLIC_DEMO_ICP_PRESENTATIONS.length ||
      countries.length > 8 ||
      cities.length > 20 ||
      searchCategories.length > 0 ||
      [...icpProfileIds, ...(icpProfileId ? [icpProfileId] : [])].some((
        entry,
      ) => entry.length > 100) ||
      countries.some((entry) => !/^[A-Z]{2}$/.test(entry)) ||
      countries.some((entry) => !PUBLIC_DEMO_COUNTRIES.has(entry)) ||
      cities.some((entry) => entry.length > 80) ||
      searchCategories.some((entry) => entry.length > 80)
    )
  ) {
    throw new HttpError(
      400,
      "Public demo discovery targeting is outside the supported bounds.",
    );
  }

  return {
    ...(icpProfileId ? { icpProfileId } : {}),
    ...(icpProfileIds.length > 0 ? { icpProfileIds } : {}),
    countries,
    ...(cities.length > 0 ? { cities } : {}),
    includeWebsiteAnalysis: body.includeWebsiteAnalysis !== false,
    includeSocialMediaAnalysis: body.includeSocialMediaAnalysis !== false,
    limit: limitValue,
    ...(advancedSettings
      ? {
        advancedSettings: {
          searchCategories,
          minReviewCount: Math.max(
            0,
            Math.floor(asNumber(advancedSettings.minReviewCount, 0)),
          ),
        },
      }
      : {}),
  };
}

function resolveRequestedIcpIds(input: EdgeDiscoveryRequest): string[] {
  if (input.icpProfileIds && input.icpProfileIds.length > 0) {
    return input.icpProfileIds;
  }
  return input.icpProfileId ? [input.icpProfileId] : [];
}

async function validatePublicDemoCities(
  input: EdgeDiscoveryRequest,
): Promise<void> {
  if (!input.cities || input.cities.length === 0) {
    return;
  }
  const configured = asObject(await pipelineSettingValue("countryCities")) ??
    {};
  const allowedCities = new Set(
    input.countries.flatMap((country) => [
      ...asStringArray(configured[country]),
      ...(country === "US" ? EDGE_PUBLIC_DEMO_US_CITIES : []),
    ]),
  );
  if (input.cities.some((city) => !allowedCities.has(city))) {
    throw new HttpError(
      400,
      "Choose cities from the curated public demo targeting options.",
    );
  }
}

async function validatePublicDemoIcpIds(icpIds: string[]): Promise<void> {
  const result = await listRows("IcpProfile", {
    select: "id",
    isActive: "eq.true",
    order: "name.asc",
    limit: PUBLIC_DEMO_ICP_PRESENTATIONS.length,
  });
  const publicIcpIds = new Set(result.data.map((row) => asString(row.id)));
  if (icpIds.some((id) => !publicIcpIds.has(id))) {
    throw new HttpError(
      400,
      "Choose ICPs from the curated public demo options.",
    );
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeIcpProfile(row: Row): EdgeIcpProfile {
  return {
    id: asString(row.id),
    name: asString(row.name, "ICP"),
    targetIndustries: asStringArray(row.targetIndustries),
    targetCountries: asStringArray(row.targetCountries),
    metadataJson: asObject(row.metadataJson),
  };
}

function resolveSearchCategory(
  icp: EdgeIcpProfile,
  input: EdgeDiscoveryRequest,
): string {
  const requested = input.advancedSettings?.searchCategories?.[0];
  if (requested) {
    return requested;
  }
  return icp.targetIndustries[0] ?? icp.name;
}

function safeUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return null;
  }
}

function rootDomainFromUrl(value: string | null): string | null {
  const url = safeUrl(value);
  return url?.hostname.toLowerCase().replace(/^www\./, "") ?? null;
}

function isNonBusinessDomain(domain: string | null): boolean {
  if (!domain) {
    return false;
  }
  return [
    "facebook.com",
    "fb.com",
    "instagram.com",
    "tiktok.com",
    "wa.me",
    "whatsapp.com",
    "google.com",
    "goo.gl",
    "maps.google.com",
  ].some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function businessDomainFromUrl(value: string | null): string | null {
  const domain = rootDomainFromUrl(value);
  return isNonBusinessDomain(domain) ? null : domain;
}

function collectLinkCandidates(value: unknown): string[] {
  const candidates: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const row = asObject(item);
      for (const key of ["website", "link", "url", "instagram", "profile"]) {
        const candidate = normalizeOptionalString(row?.[key]);
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }
  } else {
    const row = asObject(value);
    if (row) {
      for (const key of ["website", "link", "url", "instagram", "profile"]) {
        const candidate = normalizeOptionalString(row[key]);
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }
  }
  return candidates;
}

function pickBusinessWebsite(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const value = normalizeOptionalString(candidate);
    if (!value) {
      continue;
    }
    if (businessDomainFromUrl(value)) {
      return safeUrl(value)?.toString() ?? value;
    }
  }
  return null;
}

function parseInstagramHandle(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const value = normalizeOptionalString(candidate);
    if (!value) {
      continue;
    }
    const match = value.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
    if (match?.[1]) {
      return match[1].replace(/^@/, "");
    }
  }
  return null;
}

function normalizeSerpApiLocalBusinesses(
  payload: JsonObject,
  countryCode: string,
): EdgeLocalBusiness[] {
  const collections: unknown[] = [];
  const localResults = payload.local_results;
  if (Array.isArray(localResults)) {
    collections.push(...localResults);
  } else {
    const localResultsObject = asObject(localResults);
    if (Array.isArray(localResultsObject?.places)) {
      collections.push(...localResultsObject.places);
    }
  }

  const localMap = asObject(payload.local_map);
  if (Array.isArray(localMap?.places)) {
    collections.push(...localMap.places);
  }
  if (Array.isArray(localMap?.results)) {
    collections.push(...localMap.results);
  }
  if (Array.isArray(payload.places_results)) {
    collections.push(...payload.places_results);
  }

  return collections.flatMap((raw, index): EdgeLocalBusiness[] => {
    const row = asObject(raw);
    const name = normalizeOptionalString(row?.title) ??
      normalizeOptionalString(row?.name);
    if (!row || !name) {
      return [];
    }

    const links = collectLinkCandidates(row.links);
    const websiteUrl = pickBusinessWebsite([
      row.website,
      row.link,
      row.domain,
      ...links,
    ]);
    const resultUrl = normalizeOptionalString(row.place_link) ??
      normalizeOptionalString(row.link) ??
      websiteUrl;
    const gps = asObject(row.gps_coordinates);
    const reviewCount = normalizeOptionalNumber(row.reviews) ??
      normalizeOptionalNumber(row.reviews_original) ??
      normalizeOptionalNumber(row.rating_count);
    const address = normalizeOptionalString(row.address);
    const city = address
      ? address.split(",").map((part) => part.trim()).filter(Boolean).at(-2) ??
        null
      : null;
    const providerRecordId = normalizeOptionalString(row.data_id) ??
      normalizeOptionalString(row.data_cid) ??
      normalizeOptionalString(row.place_id) ??
      resultUrl ??
      `${name}:${index}`;

    return [{
      providerRecordId,
      name,
      url: resultUrl,
      websiteUrl,
      address,
      phone: normalizeOptionalString(row.phone),
      city,
      countryCode,
      category: normalizeOptionalString(row.type) ??
        normalizeOptionalString(row.category),
      rating: normalizeOptionalNumber(row.rating),
      reviewCount: reviewCount !== null ? Math.floor(reviewCount) : null,
      latitude: normalizeOptionalNumber(gps?.latitude),
      longitude: normalizeOptionalNumber(gps?.longitude),
      instagramHandle: parseInstagramHandle([
        row.instagram,
        row.website,
        row.link,
        row.domain,
        ...links,
      ]),
      raw,
    }];
  });
}

function edgeScoreBand(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score >= 0.67) return "HIGH";
  if (score >= 0.34) return "MEDIUM";
  return "LOW";
}

function businessSignals(local: EdgeLocalBusiness): {
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  acceptsOnlinePayments: boolean;
  physicalAddressPresent: boolean;
  recentActivity: boolean;
  deterministicScore: number;
  scoreBand: "LOW" | "MEDIUM" | "HIGH";
} {
  const rawText = JSON.stringify(local.raw ?? {}).toLowerCase();
  const hasWhatsapp = rawText.includes("whatsapp") || rawText.includes("wa.me");
  const hasInstagram = Boolean(local.instagramHandle) ||
    rawText.includes("instagram");
  const acceptsOnlinePayments = rawText.includes("pay now") ||
    rawText.includes("payment link") ||
    rawText.includes("order online") ||
    Boolean(local.websiteUrl?.toLowerCase().includes("shop"));
  const physicalAddressPresent = Boolean(local.address);
  const recentActivity = (local.reviewCount ?? 0) > 0 ||
    rawText.includes("open now");
  const deterministicScore = Number(
    Math.min(
      1,
      (hasWhatsapp ? 0.2 : 0) +
        (hasInstagram ? 0.1 : 0) +
        (acceptsOnlinePayments ? 0.15 : 0) +
        Math.min((local.reviewCount ?? 0) / 200, 1) * 0.2 +
        (physicalAddressPresent ? 0.1 : 0) +
        (recentActivity ? 0.15 : 0),
    ).toFixed(6),
  );
  return {
    hasWhatsapp,
    hasInstagram,
    acceptsOnlinePayments,
    physicalAddressPresent,
    recentActivity,
    deterministicScore,
    scoreBand: edgeScoreBand(deterministicScore),
  };
}

function boolScore(value: boolean, weight: number): number {
  return value ? weight : 0;
}

function scoreLeadBusinessSignals(lead: Row, business: Row | null): {
  deterministicScore: number;
  scoreBand: "LOW" | "MEDIUM" | "HIGH";
  features: JsonObject;
  reasonCodes: string[];
  ruleEvaluation: JsonObject[];
} {
  const normalizedBusiness = normalizeBusinessRow(business);
  const businessScore = asNullableNumber(
    normalizedBusiness?.deterministicScore,
  );
  const hasBusinessEmail = Boolean(asNullableString(lead.businessEmail));
  const hasLeadEmail = Boolean(asNullableString(lead.email));
  const hasPhone = Boolean(
    asNullableString(lead.phone) ??
      asNullableString(normalizedBusiness?.phoneE164),
  );
  const hasWebsite = Boolean(
    asNullableString(normalizedBusiness?.websiteDomain),
  );
  const hasInstagram = asBoolean(normalizedBusiness?.hasInstagram);
  const hasWhatsapp = asBoolean(normalizedBusiness?.hasWhatsapp);
  const acceptsOnlinePayments = asBoolean(
    normalizedBusiness?.acceptsOnlinePayments,
  );
  const physicalAddressPresent = asBoolean(
    normalizedBusiness?.physicalAddressPresent,
  );
  const recentActivity = asBoolean(normalizedBusiness?.recentActivity);
  const reviewCount = asNumber(normalizedBusiness?.reviewCount);

  const fallbackScore = Number(
    Math.min(
      1,
      0.2 +
        boolScore(hasBusinessEmail || hasLeadEmail, 0.12) +
        boolScore(hasPhone, 0.08) +
        boolScore(hasWebsite, 0.1) +
        boolScore(hasInstagram, 0.08) +
        boolScore(hasWhatsapp, 0.08) +
        boolScore(acceptsOnlinePayments, 0.1) +
        boolScore(physicalAddressPresent, 0.08) +
        boolScore(recentActivity, 0.08) +
        Math.min(reviewCount / 200, 1) * 0.08,
    ).toFixed(6),
  );
  const deterministicScore = businessScore ?? fallbackScore;
  const features: JsonObject = {
    has_business_email: hasBusinessEmail,
    has_lead_email: hasLeadEmail,
    has_phone: hasPhone,
    has_website: hasWebsite,
    has_instagram: hasInstagram,
    has_whatsapp: hasWhatsapp,
    accepts_online_payments: acceptsOnlinePayments,
    physical_address_present: physicalAddressPresent,
    recent_activity: recentActivity,
    review_count: reviewCount,
    business_score_available: businessScore !== null,
  };
  const reasonCodes = Object.entries(features)
    .filter(([, value]) => value === true)
    .map(([key]) => key.toUpperCase());
  if (reviewCount > 0) {
    reasonCodes.push("HAS_REVIEWS");
  }
  if (reasonCodes.length === 0) {
    reasonCodes.push("LIMITED_PUBLIC_SIGNALS");
  }

  return {
    deterministicScore,
    scoreBand: scoreTier(deterministicScore),
    features,
    reasonCodes,
    ruleEvaluation: Object.entries(features).map(([fieldKey, value]) => ({
      fieldKey,
      matched: value === true || (typeof value === "number" && value > 0),
      value,
    })),
  };
}

const HUNTER_EXECUTIVE_KEYWORDS = [
  "owner",
  "founder",
  "ceo",
  "chief",
  "president",
  "managing director",
] as const;
const HUNTER_DIRECTOR_KEYWORDS = [
  "director",
  "head",
  "vp",
  "vice president",
  "principal",
  "partner",
] as const;
const HUNTER_MANAGER_KEYWORDS = ["manager", "lead", "supervisor"] as const;
const GENERIC_LEAD_EMAIL_LOCAL_PARTS = new Set([
  "admin",
  "contact",
  "hello",
  "hi",
  "info",
  "mail",
  "office",
  "sales",
  "support",
  "team",
]);

function edgeHunterDailyLimit(): number {
  return resolveHunterQuotaLimit(
    Deno.env.get("LEADZILLA_HUNTER_DAILY_LIMIT"),
    DEFAULT_EDGE_HUNTER_DAILY_LIMIT,
    10,
  );
}

function edgeHunterMonthlyLimit(): number {
  return resolveHunterQuotaLimit(
    Deno.env.get("LEADZILLA_HUNTER_MONTHLY_LIMIT"),
    DEFAULT_EDGE_HUNTER_MONTHLY_LIMIT,
    50,
  );
}

function hunterSeniority(
  title: string | null,
): EdgeHunterCandidate["seniority"] {
  if (!title) return "other";
  const normalized = title.toLowerCase();
  if (
    HUNTER_EXECUTIVE_KEYWORDS.some((keyword) => normalized.includes(keyword))
  ) return "executive";
  if (
    HUNTER_DIRECTOR_KEYWORDS.some((keyword) => normalized.includes(keyword))
  ) return "director";
  if (HUNTER_MANAGER_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "manager";
  }
  return "other";
}

function hunterPositionRank(title: string | null): number {
  const seniority = hunterSeniority(title);
  if (seniority === "executive") return 0;
  if (seniority === "director") return 1;
  if (seniority === "manager") return 2;
  return 99;
}

function toEdgeHunterCandidate(
  contact: EdgeHunterContact,
): EdgeHunterCandidate | null {
  if (contact.type === "generic") return null;
  const firstName = contact.firstName?.trim() ?? "";
  const lastName = contact.lastName?.trim() ?? "";
  if (!firstName || !lastName) return null;
  return {
    email: contact.email.trim().toLowerCase(),
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    title: contact.position,
    seniority: hunterSeniority(contact.position),
    positionRank: hunterPositionRank(contact.position),
  };
}

function isGenericLeadEmail(email: string | null | undefined): boolean {
  if (!email || !email.includes("@")) return true;
  const normalized = email.trim().toLowerCase();
  const [localPart, domain] = normalized.split("@");
  return (
    domain === "lead-flood.invalid" ||
    domain === "leadzilla.demo" ||
    domain === "placeholder.local" ||
    localPart?.startsWith("no-email") === true ||
    localPart?.startsWith("unknown") === true ||
    localPart?.startsWith("hello+") === true ||
    (localPart ? GENERIC_LEAD_EMAIL_LOCAL_PARTS.has(localPart) : false)
  );
}

function shouldReplaceLeadContact(lead: Row): boolean {
  const name = `${asString(lead.firstName)} ${asString(lead.lastName)}`.trim()
    .toLowerCase();
  return (
    isGenericLeadEmail(asNullableString(lead.email)) ||
    name === "" ||
    name === "unknown contact" ||
    name === "generic contact"
  );
}

async function persistEdgeHunterContacts(
  businessId: string,
  leadId: string,
  contacts: EdgeHunterContact[],
  now: string,
): Promise<EdgeHunterCandidate[]> {
  const candidates = contacts
    .map(toEdgeHunterCandidate)
    .filter((candidate): candidate is EdgeHunterCandidate =>
      candidate !== null
    );
  if (candidates.length === 0) {
    await updateRows<Row>("business_conversions", {
      businessId: `eq.${businessId}`,
      leadId: `eq.${leadId}`,
    }, { hunterContactJson: contacts });
    return candidates;
  }

  const existing = await listRows("business_contacts", {
    select: "email",
    businessId: `eq.${businessId}`,
    limit: 500,
  }, "none");
  const existingEmails = new Set(
    existing.data
      .map((row) => asNullableString(row.email)?.toLowerCase() ?? null)
      .filter((email): email is string => email !== null),
  );
  const newCandidates = candidates.filter((candidate) =>
    !existingEmails.has(candidate.email)
  );

  if (newCandidates.length > 0) {
    await insertRows<Row>(
      "business_contacts",
      newCandidates.map((candidate) => ({
        id: crypto.randomUUID(),
        businessId,
        name: candidate.name,
        title: candidate.title,
        email: candidate.email,
        phone: null,
        linkedinUrl: null,
        seniority: candidate.seniority,
        positionRank: candidate.positionRank,
        source: "hunter",
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  await updateRows<Row>("business_conversions", {
    businessId: `eq.${businessId}`,
    leadId: `eq.${leadId}`,
  }, { hunterContactJson: contacts });
  return candidates;
}

function buildEdgeEnrichmentPayload(input: {
  lead: Row;
  business: Row | null;
  icpProfileId: string;
  scoring: ReturnType<typeof scoreLeadBusinessSignals>;
  hunter?: {
    domain: string;
    contacts: EdgeHunterContact[];
  } | undefined;
}): JsonObject {
  const normalizedBusiness = normalizeBusinessRow(input.business);
  const businessName = asNullableString(normalizedBusiness?.name);
  const websiteDomain = asNullableString(normalizedBusiness?.websiteDomain);
  const phone = asNullableString(input.lead.phone) ??
    asNullableString(normalizedBusiness?.phoneE164);
  return {
    edgeEnrichment: true,
    provider: input.hunter ? "HUNTER" : "EDGE_DEMO",
    source: input.hunter ? "manual_lead_enrich" : "edge_demo_enrichment",
    contacts: input.hunter?.contacts ?? [],
    hunterDomain: input.hunter?.domain ?? null,
    companyName: businessName,
    businessName,
    industry: asNullableString(normalizedBusiness?.category),
    country: asNullableString(normalizedBusiness?.countryCode) ??
      asNullableString(normalizedBusiness?.country),
    city: asNullableString(normalizedBusiness?.city),
    phone,
    phone_number: phone,
    websiteDomain,
    websiteUrl: websiteDomain ? `https://${websiteDomain}` : null,
    instagramHandle: asNullableString(normalizedBusiness?.instagramHandle),
    rating: asNullableNumber(normalizedBusiness?.rating),
    reviewCount: asNullableNumber(normalizedBusiness?.reviewCount),
    jobTitle: asNullableString(input.lead.decisionMakerTitle) ??
      "Owner / Operator",
    title: asNullableString(input.lead.decisionMakerTitle) ??
      "Owner / Operator",
    icpProfileId: input.icpProfileId,
    data_alignment_score: input.scoring.deterministicScore,
    _scoreInfo: {
      deterministicScore: input.scoring.deterministicScore,
      blendedScore: input.scoring.deterministicScore,
      scoreBand: input.scoring.scoreBand,
      scoreSource: "EDGE_DETERMINISTIC",
      reasonCodes: input.scoring.reasonCodes,
    },
  };
}

async function activeModelVersionId(): Promise<string> {
  const active = await singleRow("ModelVersion", {
    select: "id",
    modelType: "eq.LOGISTIC_REGRESSION",
    stage: "eq.ACTIVE",
    order: "activatedAt.desc,createdAt.desc",
  });
  if (active) {
    return asString(active.id);
  }

  const latest = await singleRow("ModelVersion", {
    select: "id",
    modelType: "eq.LOGISTIC_REGRESSION",
    order: "createdAt.desc",
  });
  if (!latest) {
    throw new HttpError(502, "Scoring model is not configured", false);
  }
  return asString(latest.id);
}

async function resolveLeadIcpProfileId(leadId: string): Promise<string> {
  const [discovery, score, conversion, activeIcp] = await Promise.all([
    singleRow("LeadDiscoveryRecord", {
      select: "icpProfileId",
      leadId: `eq.${leadId}`,
      order: "discoveredAt.desc,createdAt.desc",
    }),
    singleRow("LeadScorePrediction", {
      select: "icpProfileId",
      leadId: `eq.${leadId}`,
      order: "predictedAt.desc,createdAt.desc",
    }),
    singleRow("business_conversions", {
      select: "icpProfileId",
      leadId: `eq.${leadId}`,
      order: "convertedAt.desc,createdAt.desc",
    }),
    singleRow("IcpProfile", {
      select: "id",
      isActive: "eq.true",
      order: "createdAt.asc",
    }),
  ]);
  const icpProfileId = asNullableString(discovery?.icpProfileId) ??
    asNullableString(score?.icpProfileId) ??
    asNullableString(conversion?.icpProfileId) ??
    asNullableString(activeIcp?.id);
  if (!icpProfileId) {
    throw new HttpError(
      400,
      "Create an active ICP before enriching and scoring leads",
    );
  }
  return icpProfileId;
}

function nextLeadStatus(currentStatus: string, score: number): string {
  if (
    ["drafted", "messaged", "replied", "cold", "rejected"].includes(
      currentStatus,
    )
  ) {
    return currentStatus;
  }
  return score >= 0.5 ? "qualified" : "scored";
}

function mapScorePrediction(row: Row): JsonObject {
  return {
    id: asString(row.id),
    leadId: asString(row.leadId),
    icpProfileId: asString(row.icpProfileId),
    featureSnapshotId: asString(row.featureSnapshotId),
    modelVersionId: asString(row.modelVersionId),
    deterministicScore: asNumber(row.deterministicScore),
    logisticScore: asNumber(row.logisticScore),
    blendedScore: asNumber(row.blendedScore),
    scoreBand: asString(row.scoreBand, "LOW"),
    reasonsJson: sanitizePublicOperationalJson(row.reasonsJson ?? {}),
    predictedAt: iso(row.predictedAt),
    createdAt: iso(row.createdAt),
  };
}

function mapFeatureSnapshot(row: Row): JsonObject {
  return {
    id: asString(row.id),
    leadId: asString(row.leadId),
    icpProfileId: asString(row.icpProfileId),
    discoveryRecordId: asNullableString(row.discoveryRecordId),
    enrichmentRecordId: asNullableString(row.enrichmentRecordId),
    snapshotVersion: asNumber(row.snapshotVersion, 1),
    sourceVersion: asString(row.sourceVersion, "edge-demo-v1"),
    featureVectorHash: asString(row.featureVectorHash),
    featuresJson: sanitizePublicOperationalJson(row.featuresJson ?? {}),
    ruleMatchCount: asNumber(row.ruleMatchCount),
    hardFilterPassed: asBoolean(row.hardFilterPassed),
    computedAt: iso(row.computedAt),
    createdAt: iso(row.createdAt),
  };
}

async function createEdgeEnrichmentAndScore(input: {
  lead: Row;
  business: Row | null;
  icpProfileId: string;
  discoveryRecordId?: string | null | undefined;
  now?: string | undefined;
  hunter?: {
    domain: string;
    contacts: EdgeHunterContact[];
  } | undefined;
}): Promise<{ enrichment: Row; snapshot: Row; prediction: Row }> {
  const now = input.now ?? new Date().toISOString();
  const leadId = asString(input.lead.id);
  const scoring = scoreLeadBusinessSignals(input.lead, input.business);
  const normalizedPayload = buildEdgeEnrichmentPayload({
    lead: input.lead,
    business: input.business,
    icpProfileId: input.icpProfileId,
    scoring,
    hunter: input.hunter,
  });
  const hunterRequestKey = input.hunter ? `hunter:edge:${leadId}` : null;
  const enrichment = await insertRow<Row>("LeadEnrichmentRecord", {
    id: newId("enrich"),
    leadId,
    provider: "HUNTER",
    status: "COMPLETED",
    attempt: 1,
    providerRecordId: input.hunter
      ? `hunter-domain-${edgeHash(input.hunter.domain)}`
      : `edge-${edgeHash(`${leadId}:${now}`)}`,
    normalizedPayload,
    rawPayload: input.hunter
      ? {
        source: "hunter_domain_search",
        domain: input.hunter.domain,
        contacts: input.hunter.contacts,
      }
      : {
        edgeDemo: true,
        lead: {
          id: leadId,
          email: asNullableString(input.lead.email),
          businessEmail: asNullableString(input.lead.businessEmail),
        },
        business: normalizeBusinessRow(input.business),
      },
    errorCode: null,
    errorMessage: null,
    enrichedAt: now,
    requestKey: hunterRequestKey ?? `edge:${leadId}:${edgeHash(now)}`,
    createdAt: now,
    updatedAt: now,
  });

  const featureVectorHash = edgeHash(JSON.stringify({
    leadId,
    icpProfileId: input.icpProfileId,
    features: scoring.features,
    now,
  }));
  const snapshot = await insertRow<Row>("LeadFeatureSnapshot", {
    id: newId("snapshot"),
    leadId,
    icpProfileId: input.icpProfileId,
    discoveryRecordId: input.discoveryRecordId ?? null,
    enrichmentRecordId: asString(enrichment.id),
    snapshotVersion: Math.max(1, Math.floor(Date.now() / 1000)),
    sourceVersion: "edge-demo-v1",
    featureVectorHash,
    featuresJson: scoring.features,
    ruleMatchCount: scoring.reasonCodes.length,
    hardFilterPassed: scoring.deterministicScore >= 0.34,
    computedAt: now,
    createdAt: now,
  });

  const modelVersionId = await activeModelVersionId();
  const prediction = await insertRow<Row>("LeadScorePrediction", {
    id: newId("score"),
    leadId,
    icpProfileId: input.icpProfileId,
    featureSnapshotId: asString(snapshot.id),
    modelVersionId,
    deterministicScore: scoring.deterministicScore,
    logisticScore: scoring.deterministicScore,
    blendedScore: scoring.deterministicScore,
    scoreBand: scoring.scoreBand,
    reasonsJson: {
      scoreSource: "EDGE_DETERMINISTIC",
      reasonCodes: scoring.reasonCodes,
      explanation:
        "Supabase Edge demo scoring uses public discovery and enrichment signals.",
    },
    ruleEvaluationJson: scoring.ruleEvaluation,
    predictedAt: now,
    createdAt: now,
  });

  const normalizedBusiness = normalizeBusinessRow(input.business);
  const businessId = asNullableString(input.lead.businessId);
  const hunterCandidates = input.hunter && businessId
    ? await persistEdgeHunterContacts(
      businessId,
      leadId,
      input.hunter.contacts,
      now,
    )
    : [];
  const topHunterCandidate = hunterCandidates[0] ?? null;
  const replaceLeadContact = topHunterCandidate !== null &&
    shouldReplaceLeadContact(input.lead);
  const existingLeadWithHunterEmail = replaceLeadContact && topHunterCandidate
    ? await singleRow("Lead", {
      select: "id",
      email: `eq.${topHunterCandidate.email}`,
      deletedAt: "is.null",
    })
    : null;
  const fallbackPhone = asNullableString(input.lead.phone) ??
    asNullableString(normalizedBusiness?.phoneE164);

  await updateRows<Row>("Lead", { id: `eq.${leadId}` }, {
    status: nextLeadStatus(
      asString(input.lead.status, "new"),
      scoring.deterministicScore,
    ),
    enrichmentData: normalizedPayload,
    decisionMakerTitle: replaceLeadContact
      ? topHunterCandidate?.title
      : asNullableString(input.lead.decisionMakerTitle) ??
        (input.hunter ? null : "Owner / Operator"),
    ...(replaceLeadContact && topHunterCandidate
      ? {
        firstName: topHunterCandidate.firstName,
        lastName: topHunterCandidate.lastName,
        ...(existingLeadWithHunterEmail
          ? {}
          : { email: topHunterCandidate.email }),
      }
      : {}),
    ...(fallbackPhone
      ? {
        phone: fallbackPhone,
        phoneSource: asNullableString(input.lead.phoneSource) ??
          "EDGE_ENRICHMENT",
      }
      : {}),
    updatedAt: now,
  });

  return { enrichment, snapshot, prediction };
}

function normalizePhone(
  value: string | null,
  countryCode: string,
): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  if (value.trim().startsWith("+")) {
    return `+${digits}`;
  }
  const countryPrefix: Record<string, string> = {
    AE: "971",
    SA: "966",
    JO: "962",
    EG: "20",
    QA: "974",
    KW: "965",
    BH: "973",
    OM: "968",
    US: "1",
  };
  const prefix = countryPrefix[countryCode];
  return prefix
    ? `+${digits.startsWith("0") ? `${prefix}${digits.slice(1)}` : digits}`
    : null;
}

function leadEmailForBusiness(local: EdgeLocalBusiness, runId: string): string {
  const domain = businessDomainFromUrl(local.websiteUrl);
  const suffix = edgeHash(`${runId}:${local.providerRecordId}`).slice(0, 8);
  return domain ? `hello+${suffix}@${domain}` : `lead-${suffix}@leadzilla.demo`;
}

async function fetchSerpApiMapsResults(input: {
  query: string;
  countryCode: string;
  city: string | null;
}): Promise<JsonObject> {
  const url = new URL(Deno.env.get("SERPAPI_BASE_URL") ?? SERPAPI_SEARCH_URL);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("q", input.query);
  url.searchParams.set("gl", input.countryCode.toLowerCase());
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", readEnv("SERPAPI_API_KEY"));

  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(PUBLIC_DEMO_PROVIDER_TIMEOUT_MS),
  });
  const body = asObject(await response.json().catch(() => ({}))) ?? {};
  const providerError = normalizeOptionalString(body.error);
  if (!response.ok) {
    console.error("[demo-edge-api] SerpAPI request failed", {
      status: response.status,
      error: providerError,
    });
    throw new HttpError(
      502,
      providerError
        ? `SerpAPI request failed with status ${response.status}: ${providerError}`
        : `SerpAPI request failed with status ${response.status}`,
      false,
    );
  }
  if (providerError) {
    console.error("[demo-edge-api] SerpAPI returned an error", {
      status: response.status,
      error: providerError,
    });
    throw new HttpError(502, `SerpAPI request failed: ${providerError}`, false);
  }
  return body;
}

type EdgeDiscoveryPersistResult =
  | {
    status: "created";
    businessId: string;
    leadId: string;
    deterministicScore: number;
    scoreBand: "LOW" | "MEDIUM" | "HIGH";
    websiteDomain: string | null;
  }
  | {
    status: "already_known";
    businessId: string;
    deterministicScore: number;
    scoreBand: "LOW" | "MEDIUM" | "HIGH";
    websiteDomain: string | null;
  };

async function findExistingEdgeBusiness(
  phoneE164: string | null,
  websiteDomain: string | null,
): Promise<Row | null> {
  if (phoneE164) {
    const byPhone = await singleRow("businesses", {
      select: "id,deterministic_score,score_band,website_domain",
      phone_e164: `eq.${phoneE164}`,
    });
    if (byPhone) {
      return normalizeBusinessRow(byPhone) as Row;
    }
  }

  if (websiteDomain) {
    const byDomain = await singleRow("businesses", {
      select: "id,deterministic_score,score_band,website_domain",
      website_domain: `eq.${websiteDomain}`,
    });
    if (byDomain) {
      return normalizeBusinessRow(byDomain) as Row;
    }
  }

  return null;
}

async function persistEdgeDiscoveryBusiness(input: {
  runId: string;
  taskId: string;
  icpProfileId: string;
  queryHash: string;
  local: EdgeLocalBusiness;
  now: string;
}): Promise<EdgeDiscoveryPersistResult> {
  const signals = businessSignals(input.local);
  const websiteDomain = businessDomainFromUrl(input.local.websiteUrl);
  const phoneE164 = normalizePhone(input.local.phone, input.local.countryCode);
  const existingBusiness = await findExistingEdgeBusiness(
    phoneE164,
    websiteDomain,
  );
  if (existingBusiness) {
    return {
      status: "already_known",
      businessId: asString(existingBusiness.id),
      deterministicScore: signals.deterministicScore,
      scoreBand: signals.scoreBand,
      websiteDomain: asNullableString(existingBusiness.websiteDomain),
    };
  }

  const business = await insertRow<Row>("businesses", {
    id: newId("biz"),
    name: input.local.name,
    country_code: input.local.countryCode,
    country: input.local.countryCode,
    city: input.local.city,
    address: input.local.address,
    phone_e164: phoneE164,
    website_domain: websiteDomain,
    instagram_handle: input.local.instagramHandle,
    category: input.local.category,
    rating: input.local.rating,
    review_count: input.local.reviewCount,
    lat: input.local.latitude,
    lng: input.local.longitude,
    confidence: 0.8,
    deterministic_score: signals.deterministicScore,
    score_band: signals.scoreBand,
    has_whatsapp: signals.hasWhatsapp,
    has_instagram: signals.hasInstagram,
    accepts_online_payments: signals.acceptsOnlinePayments,
    follower_count: null,
    physical_address_present: signals.physicalAddressPresent,
    recent_activity: signals.recentActivity,
    discovery_run_id: input.runId,
    pre_qualified: signals.deterministicScore >= 0.34,
    disqualification_reason: signals.deterministicScore >= 0.34
      ? null
      : "LOW_DISCOVERY_SCORE",
    created_at: input.now,
    updated_at: input.now,
  });

  const businessId = asString(business.id);
  const email = leadEmailForBusiness(input.local, input.runId);
  const lead = await insertRow<Row>("Lead", {
    id: newId("lead"),
    firstName: input.local.name.slice(0, 80),
    lastName: "Team",
    email,
    businessEmail: websiteDomain ? `hello@${websiteDomain}` : null,
    phone: phoneE164,
    source: "SERPAPI_DISCOVERY",
    status: signals.deterministicScore >= 0.34 ? "qualified" : "new",
    enrichmentData: {
      edgeDiscovery: true,
      businessName: input.local.name,
      providerRecordId: input.local.providerRecordId,
      websiteUrl: input.local.websiteUrl,
      scoreInfo: {
        deterministicScore: signals.deterministicScore,
        scoreBand: signals.scoreBand,
      },
    },
    costCents: 0,
    businessId,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const leadId = asString(lead.id);

  const discovery = await insertRow<Row>("LeadDiscoveryRecord", {
    id: newId("disc"),
    leadId,
    icpProfileId: input.icpProfileId,
    provider: "SERPAPI",
    providerSource: "EDGE_SERPAPI_MAPS",
    providerConfidence: signals.deterministicScore,
    providerRecordId: input.local.providerRecordId,
    providerCursor: null,
    queryHash: input.queryHash,
    status: "DISCOVERED",
    rawPayload: {
      edgeDiscovery: true,
      searchTaskId: input.taskId,
      businessId,
      result: input.local.raw,
    },
    provenanceJson: {
      runId: input.runId,
      searchTaskId: input.taskId,
      source: "supabase-edge-serpapi",
    },
    errorMessage: null,
    discoveredAt: input.now,
    createdAt: input.now,
  });

  await insertRow<Row>("business_evidence", {
    id: newId("evidence"),
    business_id: businessId,
    search_task_id: input.taskId,
    source_url: input.local.url ?? input.local.websiteUrl ??
      `serpapi://${input.local.providerRecordId}`,
    source_type: "maps_local",
    serpapi_result_id: input.local.providerRecordId,
    raw_json: input.local.raw ?? {},
    created_at: input.now,
  });

  await createEdgeEnrichmentAndScore({
    lead,
    business,
    icpProfileId: input.icpProfileId,
    discoveryRecordId: asString(discovery.id),
    now: input.now,
  });

  return {
    status: "created",
    businessId,
    leadId,
    deterministicScore: signals.deterministicScore,
    scoreBand: signals.scoreBand,
    websiteDomain,
  };
}

function iso(value: unknown): string {
  if (typeof value === "string" || value instanceof Date) {
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

function scoreTier(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score >= 0.67) {
    return "HIGH";
  }
  if (score >= 0.34) {
    return "MEDIUM";
  }
  return "LOW";
}

function mapJobStatus(
  status: string,
  failedItems = 0,
): "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL" | "CANCELLED" {
  if (status === "queued") return "QUEUED";
  if (status === "running") return "RUNNING";
  if (status === "failed") return "FAILED";
  if (status === "cancelled") return "CANCELLED";
  return failedItems > 0 ? "PARTIAL" : "SUCCEEDED";
}

function readRunProgress(
  result: unknown,
): { totalItems: number; processedItems: number; failedItems: number } {
  const payload = asObject(result) ?? {};
  const newFound = asNumber(payload.newFound, 0);
  const newBusinesses = asNumber(payload.newBusinesses, 0);
  const processedItems = asNumber(payload.processedItems, 0);
  const totalItems = resolveDiscoveryProgressTotal({
    edgeMode: payload.edgeMode === true,
    totalItems: asNumber(payload.totalItems, 0),
    newFound,
    newBusinesses,
    processedItems,
  });
  const explicitLeadFailures = asNumber(payload.leadFailedItems, 0);
  const failedItems = explicitLeadFailures > 0
    ? explicitLeadFailures
    : Math.max(
      0,
      asNumber(payload.failedItems, 0) - asNumber(payload.disqualified, 0),
    );

  return {
    totalItems,
    processedItems,
    failedItems,
  };
}

function currentStage(result: unknown, status: string): string | null {
  const payload = asObject(result) ?? {};
  if (status !== "running") {
    return null;
  }
  return payload.searchTasksComplete === true ? "processing" : "searching";
}

async function authenticate(request: Request): Promise<AuthContext> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }

  const token = authHeader.slice("Bearer ".length);
  const userResponse = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: anonKey(),
      authorization: `Bearer ${token}`,
    },
  });

  if (!userResponse.ok) {
    throw new HttpError(401, "Invalid token");
  }

  const user = (await userResponse.json()) as {
    id?: string;
    email?: string | null;
  };
  if (!user.id) {
    throw new HttpError(401, "Invalid token");
  }

  const admin = await singleRow("app_admins", {
    select: "user_id",
    user_id: `eq.${user.id}`,
  });

  if (!admin) {
    throw new HttpError(403, "Forbidden");
  }

  return {
    userId: user.id,
    email: user.email ?? null,
  };
}

async function leadIdsForIcp(icpProfileId: string): Promise<Set<string>> {
  const [discovery, scores, conversions] = await Promise.all([
    listAllRows("LeadDiscoveryRecord", {
      select: "leadId",
      icpProfileId: `eq.${icpProfileId}`,
    }),
    listAllRows("LeadScorePrediction", {
      select: "leadId",
      icpProfileId: `eq.${icpProfileId}`,
    }),
    listAllRows("business_conversions", {
      select: "leadId",
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
  const rows = await listAllRows("MessageDraft", {
    select: "id",
    icpProfileId: `eq.${icpProfileId}`,
  });
  return rows
    .map((row) => asNullableString(row.id))
    .filter((id): id is string => id !== null);
}

async function latestScoresByLeadId(
  leadIds: string[],
): Promise<Map<string, Row>> {
  const uniqueLeadIds = Array.from(new Set(leadIds.filter(Boolean)));
  if (uniqueLeadIds.length === 0) {
    return new Map();
  }

  const scores = new Map<string, Row>();
  for (const chunk of chunks(uniqueLeadIds, STATS_IN_FILTER_CHUNK_SIZE)) {
    const result = await listRows("LeadScorePrediction", {
      select:
        "id,leadId,icpProfileId,deterministicScore,logisticScore,blendedScore,scoreBand,reasonsJson,ruleEvaluationJson,predictedAt,createdAt",
      leadId: pgIn(chunk),
      order: "predictedAt.desc,createdAt.desc,id.desc",
      limit: MAX_DEMO_ROWS,
    }, "none");
    for (const row of result.data) {
      const leadId = asNullableString(row.leadId);
      if (leadId && !scores.has(leadId)) {
        scores.set(leadId, row);
      }
    }
  }
  return scores;
}

async function latestDiscoveryByLeadId(
  leadIds: string[],
): Promise<Map<string, Row>> {
  if (leadIds.length === 0) {
    return new Map();
  }

  const result = await listRows("LeadDiscoveryRecord", {
    select:
      "id,leadId,icpProfileId,rawPayload,provider,status,discoveredAt,createdAt",
    leadId: pgIn(leadIds),
    order: "discoveredAt.desc,createdAt.desc,id.desc",
    limit: MAX_DEMO_ROWS,
  }, "none");
  const records = new Map<string, Row>();
  for (const row of result.data) {
    const leadId = asNullableString(row.leadId);
    if (leadId && !records.has(leadId)) {
      records.set(leadId, row);
    }
  }
  return records;
}

async function latestEnrichmentByLeadId(
  leadIds: string[],
): Promise<Map<string, Row>> {
  if (leadIds.length === 0) {
    return new Map();
  }

  const result = await listRows("LeadEnrichmentRecord", {
    select:
      "id,leadId,provider,status,normalizedPayload,rawPayload,enrichedAt,createdAt,updatedAt",
    leadId: pgIn(leadIds),
    order: "enrichedAt.desc,createdAt.desc,id.desc",
    limit: MAX_DEMO_ROWS,
  }, "none");
  const records = new Map<string, Row>();
  for (const row of result.data) {
    const leadId = asNullableString(row.leadId);
    if (leadId && !records.has(leadId)) {
      records.set(leadId, row);
    }
  }
  return records;
}

async function businessesById(
  businessIds: string[],
): Promise<Map<string, Row>> {
  const uniqueBusinessIds = Array.from(new Set(businessIds.filter(Boolean)));
  if (uniqueBusinessIds.length === 0) {
    return new Map();
  }

  const rows: Row[] = [];
  for (const chunk of chunks(uniqueBusinessIds, STATS_IN_FILTER_CHUNK_SIZE)) {
    const result = await listRows("businesses", {
      select: "*",
      id: pgIn(chunk),
      limit: chunk.length,
    }, "none");
    rows.push(...result.data);
  }
  return new Map(
    rows.map((row) => [asString(row.id), normalizeBusinessRow(row) as Row]),
  );
}

async function icpNamesById(icpIds: string[]): Promise<Map<string, string>> {
  if (icpIds.length === 0) {
    return new Map();
  }

  const result = await listRows("IcpProfile", {
    select: "id,name",
    id: pgIn(icpIds),
    limit: icpIds.length,
  }, "none");
  return new Map(
    result.data.map((row) => [asString(row.id), asString(row.name)]),
  );
}

async function businessContactsByBusinessId(
  businessIds: string[],
): Promise<Map<string, Row[]>> {
  if (businessIds.length === 0) {
    return new Map();
  }

  const result = await listRows("business_contacts", {
    select: "*",
    businessId: pgIn(businessIds),
    order: "positionRank.asc,name.asc",
    limit: MAX_DEMO_ROWS,
  }, "none");
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
    qualificationLogic: asString(row.qualificationLogic, "WEIGHTED"),
    metadataJson: sanitizePublicOperationalJson(asObject(row.metadataJson)),
    targetIndustries: asArray<string>(row.targetIndustries),
    targetCountries: asArray<string>(row.targetCountries),
    minCompanySize: asNullableNumber(row.minCompanySize),
    maxCompanySize: asNullableNumber(row.maxCompanySize),
    requiredTechnologies: asArray<string>(row.requiredTechnologies),
    excludedDomains: asArray<string>(row.excludedDomains),
    featureList: sanitizePublicOperationalJson(row.featureList ?? null),
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
    ruleType: asString(row.ruleType, "WEIGHTED"),
    isRequired: asBoolean(row.isRequired),
    fieldKey: asString(row.fieldKey),
    operator: asString(row.operator),
    valueJson: sanitizePublicOperationalJson(row.valueJson ?? null),
    weight: asNullableNumber(row.weight),
    orderIndex: asNumber(row.orderIndex, 100),
    isActive: asBoolean(row.isActive, true),
    priority: asNumber(row.priority, 100),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapLeadListRow(
  lead: Row,
  score: Row | undefined,
  discovery: Row | undefined,
  enrichment: Row | undefined,
  business: Row | undefined,
): JsonObject {
  const biz = normalizeBusinessRow(business);
  const businessScore = biz ? asNullableNumber(biz.deterministicScore) : null;
  const scoreValue = asNullableNumber(score?.blendedScore);
  const scoreBandValue = asNullableString(score?.scoreBand) ??
    asNullableString(biz?.scoreBand);
  const latestIcpProfileId = asNullableString(score?.icpProfileId) ??
    asNullableString(discovery?.icpProfileId);

  return {
    id: asString(lead.id),
    firstName: asString(lead.firstName),
    lastName: asString(lead.lastName),
    email: asString(lead.email, "unknown@example.invalid"),
    source: asString(lead.source, "demo"),
    status: asString(lead.status, "new"),
    error: toPublicOperationalError(asNullableString(lead.error), "lead"),
    createdAt: iso(lead.createdAt),
    updatedAt: iso(lead.updatedAt),
    latestIcpProfileId,
    latestScoreBand: scoreBandValue,
    latestBlendedScore: scoreValue,
    latestScorePredictionId: asNullableString(score?.id),
    displayScore: scoreValue ?? businessScore,
    displayScoreBand: scoreBandValue,
    displayScoreSource: scoreValue !== null
      ? "AI_SCORE"
      : businessScore !== null
      ? "BUSINESS_SCORE"
      : "NONE",
    latestDiscoveryRawPayload: sanitizePublicOperationalJson(
      discovery?.rawPayload ?? null,
    ),
    latestEnrichmentNormalizedPayload: sanitizePublicOperationalJson(
      enrichment?.normalizedPayload ?? lead.enrichmentData ?? null,
    ),
    latestEnrichmentRawPayload: sanitizePublicOperationalJson(
      enrichment?.rawPayload ?? null,
    ),
    businessCountryCode: asNullableString(biz?.countryCode),
    businessCountry: asNullableString(biz?.country),
    businessCity: asNullableString(biz?.city),
    businessCategory: asNullableString(biz?.category),
    businessDeterministicScore: businessScore,
    businessScoreBand: asNullableString(biz?.scoreBand),
    businessName: asNullableString(biz?.name),
    decisionMakerTitle: asNullableString(lead.decisionMakerTitle),
    hunterEnrichmentUsed: asString(enrichment?.provider) === "HUNTER" &&
      asObject(enrichment?.rawPayload)?.edgeDemo !== true,
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
    seniority: asString(row.seniority, "other"),
    positionRank: asNumber(row.positionRank, 99),
    source: asString(row.source, "website_scrape"),
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
    email: asString(lead.email, "unknown@example.invalid"),
    source: asString(lead.source, "demo"),
    status: asString(lead.status, "new"),
    enrichmentData: sanitizePublicOperationalJson(lead.enrichmentData ?? null),
    error: toPublicOperationalError(asNullableString(lead.error), "lead"),
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
    businessProfileRaw: sanitizePublicOperationalJson(biz ?? null),
    conversionContext: {
      businessInsights: asNullableString(conversion?.businessInsights),
      metadata: sanitizePublicOperationalJson(conversion?.metadata ?? null),
    },
  };
}

function mapDraft(row: Row, variants: Row[]): JsonObject {
  return {
    id: asString(row.id),
    leadId: asString(row.leadId),
    icpProfileId: asString(row.icpProfileId),
    scorePredictionId: asNullableString(row.scorePredictionId),
    promptVersion: asString(row.promptVersion, "demo"),
    generatedByModel: asString(row.generatedByModel, "demo"),
    groundingKnowledgeIds: asArray<string>(row.groundingKnowledgeIds),
    groundingContextJson: sanitizePublicOperationalJson(
      row.groundingContextJson ?? null,
    ),
    approvalStatus: asString(row.approvalStatus, "PENDING"),
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
    channel: asString(row.channel, "EMAIL"),
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

async function latestScoreForDraft(
  input: EdgeGenerateDraftRequest,
): Promise<Row | null> {
  const params: Record<string, string | number> = {
    select: "*",
    leadId: `eq.${input.leadId}`,
    icpProfileId: `eq.${input.icpProfileId}`,
    order: "predictedAt.desc,createdAt.desc,id.desc",
  };
  if (input.scorePredictionId) {
    params.id = `eq.${input.scorePredictionId}`;
  }
  return singleRow("LeadScorePrediction", params);
}

async function latestFeatureSnapshotForDraft(
  score: Row | null,
  input: EdgeGenerateDraftRequest,
): Promise<Row | null> {
  const featureSnapshotId = asNullableString(score?.featureSnapshotId);
  if (featureSnapshotId) {
    return singleRow("LeadFeatureSnapshot", {
      select: "*",
      id: `eq.${featureSnapshotId}`,
    });
  }
  return singleRow("LeadFeatureSnapshot", {
    select: "*",
    leadId: `eq.${input.leadId}`,
    icpProfileId: `eq.${input.icpProfileId}`,
    order: "computedAt.desc,createdAt.desc,id.desc",
  });
}

async function activeInitialDraft(
  input: Pick<EdgeGenerateDraftRequest, "leadId" | "icpProfileId">,
): Promise<Row | null> {
  return singleRow("MessageDraft", {
    select: "*",
    leadId: `eq.${input.leadId}`,
    icpProfileId: `eq.${input.icpProfileId}`,
    followUpNumber: "eq.0",
    approvalStatus: pgIn(["PENDING", "APPROVED", "AUTO_APPROVED"]),
    order: "createdAt.desc,id.desc",
  });
}

async function variantIdsForDraft(draftId: string): Promise<string[]> {
  const variants = await listRows("MessageVariant", {
    select: "id",
    messageDraftId: `eq.${draftId}`,
    order: "variantKey.asc,createdAt.asc",
    limit: 20,
  });
  return variants.data.map((variant) => asString(variant.id)).filter(Boolean);
}

async function existingInitialSendForDraft(
  draftId: string,
): Promise<Row | null> {
  return singleRow("MessageSend", {
    select: "id",
    messageDraftId: `eq.${draftId}`,
    followUpNumber: "eq.0",
    order: "createdAt.desc,id.desc",
  });
}

function genericEmailAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return ["hello", "info", "contact", "sales", "team", "admin", "support"]
    .includes(local);
}

function leadDisplayName(lead: Row): string {
  const first = asString(lead.firstName).trim();
  const last = asString(lead.lastName).trim();
  return [first, last].filter(Boolean).join(" ").trim() || "Unknown contact";
}

function businessNameFromContext(
  lead: Row,
  business: Row | null,
  enrichment: Row | null,
): string | null {
  const payload = asObject(enrichment?.normalizedPayload);
  return (
    asNullableString(payload?.companyName) ??
      asNullableString(payload?.company_name) ??
      asNullableString(normalizeBusinessRow(business)?.name)
  );
}

function featureListLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      const label = asObject(entry)?.label ?? asObject(entry)?.name ??
        asObject(entry)?.title;
      return typeof label === "string" ? label.trim() : null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function icpMetadataStrings(icp: Row): {
  hook: string | null;
  angle: string | null;
  messagingInstructions: string | null;
} {
  const metadata = asObject(icp.metadataJson);
  const angleValue = metadata?.angle;
  const angle = Array.isArray(angleValue)
    ? angleValue.filter((entry): entry is string => typeof entry === "string")
      .join(", ")
    : settingString(angleValue);
  return {
    hook: settingString(metadata?.salesHook) ?? settingString(metadata?.hook),
    angle,
    messagingInstructions: settingString(metadata?.messagingInstructions),
  };
}

function firstSentence(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.split(/[.!?]/)[0]?.trim() ?? value.trim();
}

function buildBusinessIntelligence(input: {
  business: Row | null;
  conversion: Row | null;
  discovery: Row | null;
  enrichment: Row | null;
  evidence: Row[];
}): string | null {
  const business = normalizeBusinessRow(input.business);
  const parts: string[] = [];
  const conversionInsight = asNullableString(
    input.conversion?.businessInsights,
  );
  if (conversionInsight) {
    parts.push(`Pre-computed business insight: ${conversionInsight}`);
  }
  if (business) {
    const location = [
      asNullableString(business.city),
      asNullableString(business.countryCode),
    ]
      .filter(Boolean)
      .join(", ");
    parts.push(
      [
        `Business: ${asString(business.name, "Unknown business")}`,
        asNullableString(business.category)
          ? `category ${asNullableString(business.category)}`
          : null,
        location ? `location ${location}` : null,
        asNullableString(business.websiteDomain)
          ? `website ${asNullableString(business.websiteDomain)}`
          : null,
        asNullableString(business.instagramHandle)
          ? `Instagram ${asNullableString(business.instagramHandle)}`
          : null,
        asNullableNumber(business.rating) !== null
          ? `rating ${asNullableNumber(business.rating)}`
          : null,
        asNullableNumber(business.reviewCount) !== null
          ? `${asNullableNumber(business.reviewCount)} reviews`
          : null,
        asBoolean(business.acceptsOnlinePayments)
          ? "accepts online payments"
          : null,
        asBoolean(business.hasWhatsapp) ? "has direct messaging contact" : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
  const enrichmentSnippet = compactJson(
    input.enrichment?.normalizedPayload,
    1200,
  );
  if (enrichmentSnippet) {
    parts.push(`Enrichment: ${enrichmentSnippet}`);
  }
  const discoverySnippet = compactJson(input.discovery?.rawPayload, 1200);
  if (discoverySnippet) {
    parts.push(`Discovery evidence: ${discoverySnippet}`);
  }
  const evidenceSnippets = input.evidence
    .slice(0, 3)
    .map((row) => {
      const sourceType = asString(
        firstValue(row, "source_type", "sourceType"),
        "source",
      );
      const sourceUrl = asString(firstValue(row, "source_url", "sourceUrl"));
      const raw = compactJson(firstValue(row, "raw_json", "rawJson"), 500);
      return [sourceType, sourceUrl, raw].filter(Boolean).join(" | ");
    })
    .filter(Boolean);
  if (evidenceSnippets.length > 0) {
    parts.push(`Supporting evidence:\n${evidenceSnippets.join("\n")}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function openAiDraftDeveloperPrompt(input: {
  channel: "EMAIL" | "WHATSAPP";
  behaviorPrompt: string | null;
  rolePrompt: string | null;
  systemPrompt: string | null;
}): string {
  const channelInstruction = input.channel === "WHATSAPP"
    ? "The API channel is WHATSAPP, but this public demo uses American recruiter-friendly terminology. Write it as an SMS-style direct message."
    : "Write a polished first-touch email.";

  return [
    "You are Leadzilla's senior outbound strategist writing one recruiter-demo-quality B2B outreach draft.",
    "Leadzilla helps businesses turn SMS, social, and direct customer conversations into paid, structured, trackable workflows.",
    channelInstruction,
    "Use only the provided lead, ICP, score, enrichment, discovery, and business evidence. Never fabricate facts.",
    "The message should feel like a thoughtful operator actually reviewed the business, not like a mail merge.",
    "Reference one concrete observed detail when evidence supports it. If the evidence is thin, keep the claim conservative.",
    "Pitch exactly one relevant Leadzilla capability and connect it to the prospect's likely workflow.",
    "First-touch CTAs must be low-friction. Do not ask for a call unless operator re-draft feedback explicitly asks for that.",
    "Tone: professional, concise, warm, specific, calm, no emojis, no exclamation points, no hype, no buzzwords.",
    'Avoid phrases like "hope this finds you well", "I wanted to reach out", "game-changer", "unlock", and "revolutionize".',
    'Email bodies should be 70-140 words. SMS-style bodies should be 50-110 words. Body text must end exactly with "Best,\\nLeadzilla Team".',
    "For email, write a calm 2-6 word buyer-readable question as the subject. For SMS-style direct messages, subject must be null.",
    "Return only the requested JSON shape.",
    input.behaviorPrompt
      ? `Configured behavior guidance:\n${input.behaviorPrompt}`
      : null,
    input.rolePrompt ? `Configured role guidance:\n${input.rolePrompt}` : null,
    input.systemPrompt
      ? `Configured system guidance:\n${input.systemPrompt}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function openAiDraftUserPrompt(input: {
  request: EdgeGenerateDraftRequest;
  lead: Row;
  icp: Row;
  score: Row;
  snapshot: Row | null;
  business: Row | null;
  enrichment: Row | null;
  discovery: Row | null;
  conversion: Row | null;
  evidence: Row[];
  globalMessagingInstructions: string | null;
  previousVariant: Row | null;
}): { prompt: string; groundingContext: JsonObject } {
  const business = normalizeBusinessRow(input.business);
  const companyName = businessNameFromContext(
    input.lead,
    input.business,
    input.enrichment,
  );
  const email = asString(input.lead.email, "unknown@example.invalid");
  const recipientType = genericEmailAddress(email)
    ? "GENERIC_CONTACT"
    : "DECISION_MAKER";
  const icpDescription = asNullableString(input.icp.description) ??
    "No ICP description available";
  const icpMetadata = icpMetadataStrings(input.icp);
  const icpHook = icpMetadata.hook ??
    icpMetadata.angle ??
    (firstSentence(icpDescription)
      ? `Hook: ${firstSentence(icpDescription)}`
      : null);
  const featuresToPitch = featureListLines(input.icp.featureList);
  const businessIntelligence = buildBusinessIntelligence({
    business: input.business,
    conversion: input.conversion,
    discovery: input.discovery,
    enrichment: input.enrichment,
    evidence: input.evidence,
  });
  const featuresJson = asObject(input.snapshot?.featuresJson) ?? {};
  const promptParts = [
    `Channel: ${input.request.channel}`,
    `Lead: ${leadDisplayName(input.lead)} <${email}>`,
    `Recipient type: ${recipientType}`,
    `Recipient title: ${
      asNullableString(input.lead.decisionMakerTitle) ?? "not verified"
    }`,
    companyName ? `Company: ${companyName}` : null,
    asNullableString(business?.category)
      ? `Business category: ${asNullableString(business?.category)}`
      : null,
    [asNullableString(business?.city), asNullableString(business?.countryCode)]
        .filter(Boolean).length > 0
      ? `Location: ${
        [
          asNullableString(business?.city),
          asNullableString(business?.countryCode),
        ].filter(Boolean).join(", ")
      }`
      : null,
    `ICP segment: ${asString(input.icp.name, "ICP")}`,
    `ICP description: ${icpDescription}`,
    icpHook ? `Required sales hook: ${icpHook}` : null,
    icpMetadata.angle ? `ICP angle: ${icpMetadata.angle}` : null,
    featuresToPitch.length > 0
      ? `Possible Leadzilla features to pitch:\n${
        featuresToPitch.map((feature, index) => `${index + 1}. ${feature}`)
          .join("\n")
      }`
      : null,
    `Score: ${asNumber(input.score.blendedScore).toFixed(2)} (${
      asString(input.score.scoreBand, "MEDIUM")
    })`,
    input.globalMessagingInstructions
      ? `Global messaging instructions:\n${input.globalMessagingInstructions}`
      : null,
    icpMetadata.messagingInstructions
      ? `ICP messaging instructions:\n${icpMetadata.messagingInstructions}`
      : null,
    input.request.redraftFeedback
      ? `Operator re-draft feedback:\n${input.request.redraftFeedback}`
      : null,
    input.previousVariant
      ? `Previous draft subject: ${
        asNullableString(input.previousVariant.subject) ?? "(none)"
      }`
      : null,
    input.previousVariant
      ? `Previous draft body:\n${asString(input.previousVariant.bodyText)}`
      : null,
    businessIntelligence
      ? `Business intelligence:\n${businessIntelligence}`
      : null,
    compactJson(featuresJson, 1400)
      ? `Feature snapshot:\n${compactJson(featuresJson, 1400)}`
      : null,
  ];

  const groundingContext: JsonObject = {
    leadName: leadDisplayName(input.lead),
    leadEmail: email,
    recipientType,
    companyName,
    businessCategory: asNullableString(business?.category),
    businessCity: asNullableString(business?.city),
    businessCountryCode: asNullableString(business?.countryCode),
    scoreBand: asString(input.score.scoreBand, "MEDIUM"),
    blendedScore: asNumber(input.score.blendedScore),
    icpName: asString(input.icp.name, "ICP"),
    icpDescription,
    icpHook,
    icpAngle: icpMetadata.angle,
    featuresToPitch,
    businessIntelligence,
    promptVersion: input.request.promptVersion,
    channel: input.request.channel,
    generatedBy: "supabase-edge-openai",
  };

  return {
    prompt: promptParts.filter(Boolean).join("\n"),
    groundingContext,
  };
}

function assertUsableDraftContent(content: OpenAiDraftContent): void {
  const body = content.bodyText.trim();
  if (
    /^\{[\s\S]*\}$/.test(body) ||
    body.includes('{"message"') ||
    body.includes('{"insights"') ||
    /```json/i.test(body)
  ) {
    throw new HttpError(
      502,
      "OpenAI returned invalid structured output instead of a usable message.",
    );
  }
}

async function generateOpenAiDraft(input: {
  request: EdgeGenerateDraftRequest;
  lead: Row;
  icp: Row;
  score: Row;
  snapshot: Row | null;
  business: Row | null;
  enrichment: Row | null;
  discovery: Row | null;
  conversion: Row | null;
  evidence: Row[];
  previousVariant: Row | null;
}): Promise<
  { model: string; content: OpenAiDraftContent; groundingContext: JsonObject }
> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new HttpError(
      503,
      "OpenAI draft generation is not configured. Add OPENAI_API_KEY to Supabase Edge Function secrets.",
    );
  }

  const [
    behaviorPrompt,
    rolePrompt,
    systemPrompt,
    globalMessagingInstructions,
    settingModel,
  ] = await Promise.all([
    loadMessagingTextSetting("messagingBehaviorPrompt"),
    loadMessagingTextSetting("messagingRole"),
    loadMessagingTextSetting("messagingSystemPrompt"),
    loadMessagingTextSetting("messagingInstructions"),
    loadMessagingTextSetting("messagingModel"),
  ]);
  const model = openAiDraftModel(settingModel);
  const { prompt, groundingContext } = openAiDraftUserPrompt({
    ...input,
    globalMessagingInstructions,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_DRAFT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      Deno.env.get("OPENAI_BASE_URL") ?? OPENAI_RESPONSES_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: "low" },
          input: [
            {
              role: "developer",
              content: openAiDraftDeveloperPrompt({
                channel: input.request.channel,
                behaviorPrompt,
                rolePrompt,
                systemPrompt,
              }),
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "lead_message_draft",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  subject: { type: ["string", "null"] },
                  bodyText: { type: "string" },
                  bodyHtml: { type: ["string", "null"] },
                  ctaText: { type: ["string", "null"] },
                  qualityScore: { type: ["number", "null"] },
                },
                required: [
                  "subject",
                  "bodyText",
                  "bodyHtml",
                  "ctaText",
                  "qualityScore",
                ],
                additionalProperties: false,
              },
            },
          },
          max_output_tokens: 900,
        }),
        signal: controller.signal,
      },
    );
  } catch (error: unknown) {
    throw new HttpError(
      503,
      error instanceof DOMException && error.name === "AbortError"
        ? "OpenAI draft generation timed out. Please try again."
        : "OpenAI draft generation is temporarily unavailable.",
    );
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text();
  if (!response.ok) {
    console.error("[demo-edge-api] openai draft generation failed", {
      status: response.status,
      body: rawText.slice(0, 500),
    });
    throw new HttpError(
      response.status === 429 || response.status >= 500 ? 503 : 502,
      "OpenAI draft generation failed. Check OPENAI_API_KEY and OPENAI_DRAFT_MODEL.",
    );
  }

  let payload: JsonObject | null;
  try {
    payload = asObject(JSON.parse(rawText));
  } catch {
    throw new HttpError(502, "OpenAI draft response was invalid JSON");
  }
  if (!payload) {
    throw new HttpError(502, "OpenAI draft response was invalid");
  }
  const content = parseOpenAiDraftResponse(payload);
  assertUsableDraftContent(content);
  return {
    model,
    content: {
      ...content,
      subject: input.request.channel === "EMAIL" ? content.subject : null,
      bodyHtml: null,
    },
    groundingContext,
  };
}

async function handleGenerateDraft(request: Request): Promise<Response> {
  const input = parseGenerateDraftBody(await request.json().catch(() => null));
  const [lead, icp, existingDraft] = await Promise.all([
    singleRow("Lead", {
      select: "*",
      id: `eq.${input.leadId}`,
      deletedAt: "is.null",
    }),
    singleRow("IcpProfile", {
      select: "*",
      id: `eq.${input.icpProfileId}`,
    }),
    activeInitialDraft(input),
  ]);

  if (!lead) {
    throw new HttpError(404, "Lead not found");
  }
  if (!icp) {
    throw new HttpError(404, "ICP profile not found");
  }

  if (existingDraft && !input.forceRegenerate) {
    if (asString(lead.status) === "qualified") {
      await updateRows<Row>("Lead", {
        id: `eq.${input.leadId}`,
        status: "eq.qualified",
      }, {
        status: "drafted",
        updatedAt: new Date().toISOString(),
      });
    }
    return jsonResponse({
      status: "EXISTS",
      draftId: asString(existingDraft.id),
      variantIds: await variantIdsForDraft(asString(existingDraft.id)),
    });
  }

  if (existingDraft && input.forceRegenerate) {
    const blockingSend = await existingInitialSendForDraft(
      asString(existingDraft.id),
    );
    if (blockingSend) {
      throw new HttpError(
        422,
        "Draft cannot be regenerated because the initial message has already been queued or sent. Review it in Message Queue instead.",
      );
    }
  }

  const [score, threshold] = await Promise.all([
    latestScoreForDraft(input),
    loadScoreQualificationThreshold(),
  ]);
  if (!score) {
    throw new HttpError(
      422,
      "Lead is not eligible for draft generation because no score is available for the requested ICP profile.",
    );
  }
  if (asNumber(score.blendedScore, -1) < threshold) {
    throw new HttpError(
      422,
      "Lead is not eligible for draft generation because its score is below the configured qualification threshold.",
    );
  }

  const businessId = asNullableString(lead.businessId);
  const [
    snapshot,
    business,
    enrichment,
    discovery,
    conversion,
    evidenceResult,
    previousVariant,
  ] = await Promise.all([
    latestFeatureSnapshotForDraft(score, input),
    businessId
      ? singleRow("businesses", { select: "*", id: `eq.${businessId}` })
      : Promise.resolve(null),
    singleRow("LeadEnrichmentRecord", {
      select: "*",
      leadId: `eq.${input.leadId}`,
      order: "enrichedAt.desc,createdAt.desc,id.desc",
    }),
    singleRow("LeadDiscoveryRecord", {
      select: "*",
      leadId: `eq.${input.leadId}`,
      icpProfileId: `eq.${input.icpProfileId}`,
      order: "discoveredAt.desc,createdAt.desc,id.desc",
    }),
    businessId
      ? singleRow("business_conversions", {
        select: "*",
        leadId: `eq.${input.leadId}`,
        businessId: `eq.${businessId}`,
        order: "createdAt.desc,id.desc",
      })
      : Promise.resolve(null),
    businessId
      ? listRows("business_evidence", {
        select: "*",
        business_id: `eq.${businessId}`,
        order: "created_at.desc,id.desc",
        limit: 5,
      })
      : Promise.resolve({ data: [], total: 0 }),
    existingDraft
      ? singleRow("MessageVariant", {
        select: "*",
        messageDraftId: `eq.${asString(existingDraft.id)}`,
        order: "variantKey.asc,createdAt.asc",
      })
      : Promise.resolve(null),
  ]);

  await updateRows<Row>("Lead", { id: `eq.${input.leadId}` }, {
    error: null,
    updatedAt: new Date().toISOString(),
  });

  const generation = await generateOpenAiDraft({
    request: input,
    lead,
    icp,
    score,
    snapshot,
    business,
    enrichment,
    discovery,
    conversion,
    evidence: evidenceResult.data,
    previousVariant,
  });

  const now = new Date().toISOString();
  if (existingDraft && input.forceRegenerate) {
    await updateRows<Row>("MessageDraft", {
      id: `eq.${asString(existingDraft.id)}`,
    }, {
      approvalStatus: "REJECTED",
      rejectedReason: "Superseded by regenerated draft",
      approvedByUserId: null,
      approvedAt: null,
      updatedAt: now,
    });
  }

  const draft = await insertRow<Row>("MessageDraft", {
    id: newId("draft"),
    leadId: input.leadId,
    icpProfileId: input.icpProfileId,
    scorePredictionId: asString(score.id),
    promptVersion: input.promptVersion,
    generatedByModel: generation.model,
    groundingKnowledgeIds: input.knowledgeEntryIds,
    groundingContextJson: generation.groundingContext,
    approvalStatus: "PENDING",
    followUpNumber: 0,
    createdAt: now,
    updatedAt: now,
  });
  const variant = await insertRow<Row>("MessageVariant", {
    id: newId("variant"),
    messageDraftId: asString(draft.id),
    variantKey: "openai_primary",
    channel: input.channel,
    subject: generation.content.subject,
    bodyText: generation.content.bodyText,
    bodyHtml: generation.content.bodyHtml,
    ctaText: generation.content.ctaText,
    qualityScore: generation.content.qualityScore,
    isSelected: true,
    createdAt: now,
    updatedAt: now,
  });

  if (asString(lead.status) === "qualified") {
    await updateRows<Row>("Lead", {
      id: `eq.${input.leadId}`,
      status: "eq.qualified",
    }, {
      status: "drafted",
      updatedAt: now,
    });
  }

  return jsonResponse({
    status: "CREATED",
    draftId: asString(draft.id),
    variantIds: [asString(variant.id)],
  });
}

function mapSend(row: Row): JsonObject {
  const storedFailureCode = asNullableString(row.failureCode);
  const failureCode = toPublicDeliveryFailureCode(storedFailureCode);
  const failureReason = failureCode === "OUTBOUND_DISABLED"
    ? DEMO_DISABLED_MESSAGE
    : toPublicOperationalError(asNullableString(row.failureReason), "delivery");

  return {
    id: asString(row.id),
    leadId: asString(row.leadId),
    messageDraftId: asString(row.messageDraftId),
    messageVariantId: asString(row.messageVariantId),
    channel: asString(row.channel, "EMAIL"),
    provider: asString(row.provider, "RESEND"),
    providerMessageId: asNullableString(row.providerMessageId),
    status: asString(row.status, "QUEUED"),
    idempotencyKey: asString(row.idempotencyKey),
    scheduledAt: nullableIso(row.scheduledAt),
    sentAt: nullableIso(row.sentAt),
    deliveredAt: nullableIso(row.deliveredAt),
    repliedAt: nullableIso(row.repliedAt),
    followUpNumber: asNullableNumber(row.followUpNumber),
    nextFollowUpAfter: nullableIso(row.nextFollowUpAfter),
    providerConversationId: asNullableString(row.providerConversationId),
    failureCode,
    failureReason,
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
    eventType: eventType === "UNSUBSCRIBED" ? "NOT_INTERESTED" : eventType,
    source: asString(row.source, "MANUAL"),
    providerEventId: asNullableString(row.providerEventId),
    dedupeKey: asString(row.dedupeKey),
    payloadJson: sanitizePublicOperationalJson(row.payloadJson ?? null),
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
  const processedItems = status === "SUCCEEDED"
    ? progress.totalItems
    : progress.processedItems;
  const icpProfileId = asNullableString(payload.icpProfileId);
  const icpProfileIds = asArray<string>(payload.icpProfileIds);
  return {
    runId: asString(row.id),
    status,
    totalItems: progress.totalItems,
    processedItems,
    failedItems: progress.failedItems,
    createdAt: iso(row.createdAt),
    startedAt: nullableIso(row.startedAt),
    finishedAt: nullableIso(row.finishedAt),
    icpProfileId,
    icpProfileIds: icpProfileIds.length > 0
      ? icpProfileIds
      : icpProfileId
      ? [icpProfileId]
      : [],
    countries: asArray<string>(payload.countries),
    limit: asNumber(payload.limit),
    converted: typeof result.converted === "number"
      ? result.converted
      : undefined,
    errorMessage: toPublicOperationalError(
      asNullableString(row.error),
      "discovery_run",
    ),
    currentStage: currentStage(row.result, asString(row.status)),
  };
}

function mapDiscoveryRunStatus(row: Row): JsonObject {
  const progress = readRunProgress(row.result);
  const status = mapJobStatus(asString(row.status), progress.failedItems);
  return {
    runId: asString(row.id),
    runType: "DISCOVERY",
    status,
    totalItems: progress.totalItems,
    processedItems: status === "SUCCEEDED"
      ? progress.totalItems
      : progress.processedItems,
    failedItems: progress.failedItems,
    startedAt: nullableIso(row.startedAt),
    endedAt: nullableIso(row.finishedAt),
    errorMessage: toPublicOperationalError(
      asNullableString(row.error),
      "discovery_run",
    ),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    currentStage: currentStage(row.result, asString(row.status)),
  };
}

function mapDiscoveryRunDetailStatus(row: Row): JsonObject {
  const result = asObject(row.result) ?? {};
  const outcome = asObject(result.outcome);
  const mapped: JsonObject = {
    ...mapDiscoveryRunStatus(row),
  };
  for (
    const key of [
      "totalFound",
      "alreadyKnown",
      "newFound",
      "newBusinesses",
      "disqualified",
      "converted",
    ]
  ) {
    if (typeof result[key] === "number") {
      mapped[key] = result[key];
    }
  }
  if (outcome) {
    mapped.outcome = sanitizePublicOperationalJson(outcome);
  }
  return mapped;
}

function mapJobRun(row: Row): JsonObject {
  const normalized = normalizeJobRunRow(row);
  return {
    id: asString(normalized.id),
    jobName: asString(normalized.jobName),
    startedAt: iso(normalized.startedAt),
    finishedAt: nullableIso(normalized.finishedAt),
    durationMs: asNullableNumber(normalized.durationMs),
    status: asString(normalized.status, "RUNNING"),
    paramsJson: sanitizePublicOperationalJson(normalized.paramsJson ?? {}),
    countersJson: sanitizePublicOperationalJson(
      normalized.countersJson ?? null,
    ),
    resourceJson: sanitizePublicOperationalJson(
      normalized.resourceJson ?? null,
    ),
    errorText: toPublicOperationalError(
      asNullableString(normalized.errorText),
      "job",
    ),
    createdAt: iso(normalized.createdAt),
    updatedAt: iso(normalized.updatedAt),
  };
}

function mapJobRequest(row: Row): JsonObject {
  return {
    id: asNumber(row.id),
    requestType: asString(row.request_type),
    status: asString(row.status),
    paramsJson: sanitizePublicOperationalJson(row.params_json ?? {}),
    requestedBy: asString(row.requested_by),
    claimedBy: asNullableString(row.claimed_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    claimedAt: nullableIso(row.claimed_at),
    startedAt: nullableIso(row.started_at),
    finishedAt: nullableIso(row.finished_at),
    errorText: toPublicOperationalError(
      asNullableString(row.error_text),
      "job",
    ),
    jobRunId: asNullableString(row.job_run_id),
    idempotencyKey: asNullableString(row.idempotency_key),
  };
}

function mapAdminBusiness(
  row: Row,
  leadId: string | null = null,
  leadBlendedScore: number | null = null,
  recovery: Row | null = null,
): JsonObject {
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
    scoreBand: asNullableString(normalized.scoreBand) ??
      scoreTier(deterministicScore),
    hasWhatsapp: asBoolean(normalized.hasWhatsapp),
    hasInstagram: asBoolean(normalized.hasInstagram),
    acceptsOnlinePayments: asBoolean(normalized.acceptsOnlinePayments),
    recentActivity: asBoolean(normalized.recentActivity),
    websiteDomain: asNullableString(normalized.websiteDomain),
    phoneE164: asNullableString(normalized.phoneE164),
    instagramHandle: asNullableString(normalized.instagramHandle),
    preQualified: typeof normalized.preQualified === "boolean"
      ? normalized.preQualified
      : null,
    disqualificationReason: asNullableString(normalized.disqualificationReason),
    apifyWebsiteScrapeJson: sanitizePublicOperationalJson(
      normalized.apifyWebsiteScrapeJson ?? null,
    ),
    apifyInstagramScrapeJson: sanitizePublicOperationalJson(
      normalized.apifyInstagramScrapeJson ?? null,
    ),
    websiteScrapedAt: nullableIso(normalized.websiteScrapedAt),
    instagramScrapedAt: nullableIso(normalized.instagramScrapedAt),
    manualReviewStatus: asNullableString(recovery?.status),
    manualReviewReason: asNullableString(recovery?.reason),
    manualReviewUpdatedAt: nullableIso(
      firstValue(recovery, "updatedAt", "updated_at"),
    ),
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
    scoreTier: asNullableString(normalized.scoreBand) ??
      scoreTier(deterministicScore),
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

function defaultRecoverySnapshot(
  row: Row,
  business: Row | undefined,
): JsonObject {
  return {
    businessId: asString(firstValue(row, "businessId", "business_id")),
    domain: asNullableString(business?.websiteDomain),
    locality: asNullableString(business?.city),
    generatedAt: iso(firstValue(row, "createdAt", "created_at")),
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
      topSourceFamily: "unknown",
      finalOutcome: "recovery_opened",
      verificationVerdict: "skipped",
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

function mapContactRecoveryItem(
  row: Row,
  business: Row | undefined,
  icpName: string | null,
): JsonObject {
  const normalizedBusiness = normalizeBusinessRow(business);
  const snapshot =
    asObject(firstValue(row, "recoverySnapshot", "recovery_snapshot")) ??
      defaultRecoverySnapshot(row, normalizedBusiness);
  return {
    id: asString(row.id),
    businessId: asString(firstValue(row, "businessId", "business_id")),
    icpProfileId: asString(firstValue(row, "icpProfileId", "icp_profile_id")),
    icpProfileName: icpName,
    discoveryRunId: asString(
      firstValue(row, "discoveryRunId", "discovery_run_id"),
    ),
    status: asString(row.status, "OPEN"),
    reason: asString(row.reason, "NO_CONTACTS_FOUND"),
    evidenceScore: asNumber(firstValue(row, "evidenceScore", "evidence_score")),
    candidateCount: asNumber(
      firstValue(row, "candidateCount", "candidate_count"),
    ),
    rejectedBy: asNullableString(firstValue(row, "rejectedBy", "rejected_by")),
    rejectedAt: nullableIso(firstValue(row, "rejectedAt", "rejected_at")),
    createdAt: iso(firstValue(row, "createdAt", "created_at")),
    updatedAt: iso(firstValue(row, "updatedAt", "updated_at")),
    business: {
      id: asString(normalizedBusiness?.id),
      name: asString(normalizedBusiness?.name),
      city: asNullableString(normalizedBusiness?.city),
      country: asNullableString(normalizedBusiness?.country),
      countryCode: asNullableString(normalizedBusiness?.countryCode),
      websiteDomain: asNullableString(normalizedBusiness?.websiteDomain),
      instagramHandle: asNullableString(normalizedBusiness?.instagramHandle),
      category: asNullableString(normalizedBusiness?.category),
      deterministicScore: asNullableNumber(
        normalizedBusiness?.deterministicScore,
      ),
      scoreBand: asNullableString(normalizedBusiness?.scoreBand),
      preQualified: typeof normalizedBusiness?.preQualified === "boolean"
        ? normalizedBusiness.preQualified
        : null,
      disqualificationReason: asNullableString(
        normalizedBusiness?.disqualificationReason,
      ),
    },
    snapshot: sanitizePublicOperationalJson(snapshot),
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
    error: toPublicOperationalError(asNullableString(row.error), "search_task"),
    updatedAt: iso(row.updated_at),
    createdAt: iso(row.created_at),
  };
}

async function handleListIcps(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "name.asc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const isActive = url.searchParams.get("isActive");
  if (isActive !== null) params.isActive = `eq.${isActive === "true"}`;
  const q = url.searchParams.get("q");
  if (q) params.name = `ilike.${ilikePattern(q)}`;

  const result = await listRows("IcpProfile", params);
  return jsonResponse({
    items: result.data.map((row) => mapIcp(row)),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleDemoReadiness(): Promise<Response> {
  const now = Date.now();
  if (demoReadinessCacheExpiresAt <= now) {
    await singleRow("IcpProfile", {
      select: "id",
      isActive: "eq.true",
    });
    demoReadinessCacheExpiresAt = now + DEMO_READINESS_CACHE_TTL_MS;
  }

  return jsonResponse({ ok: true, service: "demo-edge-api", database: "ok" });
}

async function handleGetIcp(icpId: string): Promise<Response> {
  const [icp, rules] = await Promise.all([
    singleRow("IcpProfile", { select: "*", id: `eq.${icpId}` }),
    listRows("QualificationRule", {
      select: "*",
      icpProfileId: `eq.${icpId}`,
      order: "orderIndex.asc,priority.asc,createdAt.asc",
      limit: 500,
    }),
  ]);
  if (!icp) throw new HttpError(404, "ICP profile not found");
  return jsonResponse(mapIcp(icp, rules.data));
}

async function handleGetIcpRules(icpId: string): Promise<Response> {
  const rules = await listRows("QualificationRule", {
    select: "*",
    icpProfileId: `eq.${icpId}`,
    order: "orderIndex.asc,priority.asc,createdAt.asc",
    limit: 500,
  });
  return jsonResponse({ items: rules.data.map(mapRule) });
}

async function handleListLeads(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const includeRejected = parseBoolean(
    url.searchParams.get("includeRejected"),
    false,
  );
  const sortBy = url.searchParams.get("sortBy") ?? "created_desc";
  const scoreSort = sortBy === "score_desc" || sortBy === "score_asc";
  const icpProfileId = url.searchParams.get("icpProfileId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const search = url.searchParams.get("search");
  const scoreBand = url.searchParams.get("scoreBand");
  const minBlendedScore = url.searchParams.get("minBlendedScore");
  const status = url.searchParams.get("status");
  const useCachedRanking = scoreSort && !icpProfileId;

  let leadIdFilter: Set<string> | null = null;
  if (icpProfileId) {
    leadIdFilter = await leadIdsForIcp(icpProfileId);
    if (leadIdFilter.size === 0) {
      return jsonResponse({
        items: [],
        qualityMetrics: null,
        page,
        pageSize,
        total: 0,
      });
    }
  }

  const params: Record<string, string | number> = {
    select: "*",
    deletedAt: "is.null",
    limit: scoreSort ? MAX_DEMO_ROWS : pageSize,
    offset: scoreSort ? 0 : (page - 1) * pageSize,
  };

  if (!includeRejected) params.status = "neq.rejected";
  if (status) params.status = `eq.${status}`;
  if (from) params.createdAt = `gte.${from}`;
  if (to) params.createdAt = `lte.${to}`;
  if (search) {
    const pattern = ilikePattern(search);
    params.or =
      `(firstName.ilike.${pattern},lastName.ilike.${pattern},email.ilike.${pattern})`;
  }
  if (leadIdFilter) {
    params.id = pgIn([...leadIdFilter]);
  }
  if (!scoreSort) {
    params.order = "createdAt.desc,id.desc";
  }

  let preloadedScores: Map<string, Row> | null = null;
  let result: RestResult<Row[]>;
  if (useCachedRanking) {
    const rankingParams: Record<string, string | number> = {
      select: "response_json",
      order: sortBy === "score_asc"
        ? "display_score.asc.nullslast,created_at.desc,lead_id.desc"
        : "display_score.desc.nullslast,created_at.desc,lead_id.desc",
      offset: (page - 1) * pageSize,
      limit: pageSize,
    };
    if (!includeRejected) rankingParams.status = "neq.rejected";
    if (status) rankingParams.status = `eq.${status}`;
    if (from) rankingParams.created_at = `gte.${from}`;
    if (to) rankingParams.created_at = `lte.${to}`;
    if (search) rankingParams.search_text = `ilike.${ilikePattern(search)}`;
    if (scoreBand) rankingParams.score_band = `eq.${scoreBand}`;
    if (minBlendedScore) {
      rankingParams.display_score = `gte.${Number(minBlendedScore)}`;
    }

    const rankings = await listRows(
      "leadzilla_demo_lead_rankings",
      rankingParams,
    );
    return jsonResponse({
      items: rankings.data
        .map((ranking) => asObject(ranking.response_json))
        .filter((lead): lead is JsonObject => lead !== null),
      qualityMetrics: null,
      page,
      pageSize,
      total: rankings.total ?? rankings.data.length,
    });
  } else if (scoreSort) {
    const [allLeads, allScoreRows] = await Promise.all([
      listAllRows("Lead", params),
      listAllRows("LeadScorePrediction", {
        select:
          "id,leadId,icpProfileId,deterministicScore,logisticScore,blendedScore,scoreBand,reasonsJson,ruleEvaluationJson,predictedAt,createdAt",
        order: "predictedAt.desc,createdAt.desc,id.desc",
      }),
    ]);
    preloadedScores = new Map<string, Row>();
    for (const score of allScoreRows) {
      const leadId = asNullableString(score.leadId);
      if (leadId && !preloadedScores.has(leadId)) {
        preloadedScores.set(leadId, score);
      }
    }
    result = { data: allLeads, total: allLeads.length };
  } else {
    result = await listRows("Lead", params);
  }
  let leads = result.data;

  if (!useCachedRanking && (scoreBand || minBlendedScore || scoreSort)) {
    const candidateIds = leads.map((lead) => asString(lead.id)).filter(Boolean);
    const scores = preloadedScores ?? await latestScoresByLeadId(candidateIds);
    const businesses = scoreSort
      ? new Map<string, Row>()
      : await businessesById(
        leads
          .map((lead) => asNullableString(lead.businessId))
          .filter((id): id is string => id !== null),
      );

    leads = leads.filter((lead) => {
      const score = scores.get(asString(lead.id));
      const business = businesses.get(asString(lead.businessId));
      const resolvedScore = asNullableNumber(score?.blendedScore) ??
        asNullableNumber(business?.deterministicScore);
      const resolvedBand = asNullableString(score?.scoreBand) ??
        asNullableString(business?.scoreBand);
      if (scoreBand && resolvedBand !== scoreBand) return false;
      if (
        minBlendedScore &&
        (resolvedScore === null || resolvedScore < Number(minBlendedScore))
      ) return false;
      return true;
    });

    if (scoreSort) {
      leads.sort((a, b) => {
        const scoreA =
          asNullableNumber(scores.get(asString(a.id))?.blendedScore) ??
            asNullableNumber(
              businesses.get(asString(a.businessId))?.deterministicScore,
            ) ??
            -1;
        const scoreB =
          asNullableNumber(scores.get(asString(b.id))?.blendedScore) ??
            asNullableNumber(
              businesses.get(asString(b.businessId))?.deterministicScore,
            ) ??
            -1;
        return sortBy === "score_asc" ? scoreA - scoreB : scoreB - scoreA;
      });
    }

    result = {
      data: leads.slice((page - 1) * pageSize, page * pageSize),
      total: leads.length,
    };
  }

  const pageRows = result.data;
  const leadIds = pageRows.map((lead) => asString(lead.id)).filter(Boolean);
  const businessIds = pageRows
    .map((lead) => asNullableString(lead.businessId))
    .filter((id): id is string => id !== null);
  const [scores, discoveryRecords, enrichmentRecords, businesses] =
    await Promise.all([
      latestScoresByLeadId(leadIds),
      latestDiscoveryByLeadId(leadIds),
      latestEnrichmentByLeadId(leadIds),
      businessesById(businessIds),
    ]);

  return jsonResponse({
    items: pageRows.map((lead) =>
      mapLeadListRow(
        lead,
        scores.get(asString(lead.id)),
        discoveryRecords.get(asString(lead.id)),
        enrichmentRecords.get(asString(lead.id)),
        businesses.get(asString(lead.businessId)),
      )
    ),
    qualityMetrics: null,
    page,
    pageSize,
    total: result.total ?? pageRows.length,
  });
}

async function handleGetLead(id: string): Promise<Response> {
  const lead = await singleRow("Lead", {
    select: "*",
    id: `eq.${id}`,
    deletedAt: "is.null",
  });
  if (!lead) throw new HttpError(404, "Lead not found");

  const businessId = asNullableString(lead.businessId);
  const [business, contactsResult, scores, discovery, conversions] =
    await Promise.all([
      businessId
        ? singleRow("businesses", { select: "*", id: `eq.${businessId}` })
        : Promise.resolve(null),
      businessId
        ? listRows("business_contacts", {
          select: "*",
          businessId: `eq.${businessId}`,
          order: "positionRank.asc,name.asc",
          limit: 100,
        })
        : Promise.resolve({ data: [], total: 0 } satisfies RestResult<Row[]>),
      latestScoresByLeadId([id]),
      latestDiscoveryByLeadId([id]),
      listRows("business_conversions", {
        select: "*",
        leadId: `eq.${id}`,
        order: "convertedAt.desc,createdAt.desc,id.desc",
        limit: 1,
      }),
    ]);
  const latestScore = scores.get(id);
  const latestDiscovery = discovery.get(id);
  const latestIcpProfileId = asNullableString(latestDiscovery?.icpProfileId) ??
    asNullableString(latestScore?.icpProfileId) ??
    asNullableString(conversions.data[0]?.icpProfileId);
  const icpNames = latestIcpProfileId
    ? await icpNamesById([latestIcpProfileId])
    : new Map<string, string>();

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

async function handleEnrichLead(leadId: string): Promise<Response> {
  const lead = await singleRow("Lead", {
    select: "*",
    id: `eq.${leadId}`,
    deletedAt: "is.null",
  });
  if (!lead) {
    throw new HttpError(404, "Lead not found");
  }

  const businessId = asNullableString(lead.businessId);
  if (!businessId) {
    throw new HttpError(
      422,
      "This lead is not connected to a company that Hunter can enrich",
    );
  }
  const [business, icpProfileId] = await Promise.all([
    singleRow("businesses", { select: "*", id: `eq.${businessId}` }),
    resolveLeadIcpProfileId(leadId),
  ]);
  const domain = normalizeHunterDomain(
    asNullableString(normalizeBusinessRow(business)?.websiteDomain),
  );
  if (!domain) {
    throw new HttpError(
      422,
      "This company does not have a website domain that Hunter can search",
    );
  }

  const requestKey = `hunter:edge:${leadId}`;
  const existingEnrichment = await singleRow("LeadEnrichmentRecord", {
    select: "id",
    requestKey: `eq.${requestKey}`,
  });
  if (existingEnrichment) {
    return jsonResponse({
      jobId: asString(existingEnrichment.id),
      status: "QUEUED",
      provider: "HUNTER",
    }, 202);
  }

  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const [hunterRunsToday, hunterRunsThisMonth] = await Promise.all([
    countRows("LeadEnrichmentRecord", {
      provider: "eq.HUNTER",
      requestKey: "like.hunter:edge:*",
      createdAt: `gte.${today.toISOString()}`,
    }),
    countRows("LeadEnrichmentRecord", {
      provider: "eq.HUNTER",
      requestKey: "like.hunter:edge:*",
      createdAt: `gte.${utcMonthStart(now).toISOString()}`,
    }),
  ]);
  if (hunterRunsToday >= edgeHunterDailyLimit()) {
    throw new HttpError(
      429,
      "The demo enrichment allowance has been reached for today",
    );
  }
  if (hunterRunsThisMonth >= edgeHunterMonthlyLimit()) {
    throw new HttpError(
      429,
      "The demo enrichment allowance has been reached for this month",
    );
  }

  const hunterApiKey = normalizeOptionalString(Deno.env.get("HUNTER_API_KEY"));
  if (!hunterApiKey) {
    throw new HttpError(503, "Hunter enrichment is temporarily unavailable");
  }

  let contacts: EdgeHunterContact[];
  try {
    contacts = await searchHunterDomainContacts({
      apiKey: hunterApiKey,
      domain,
      baseUrl: normalizeOptionalString(Deno.env.get("HUNTER_BASE_URL")) ??
        undefined,
    });
  } catch (error: unknown) {
    if (error instanceof HunterDomainSearchError) {
      if (error.statusCode === 429) {
        throw new HttpError(
          429,
          "Hunter is temporarily rate limited. Please try again shortly.",
        );
      }
      if (error.retryable) {
        throw new HttpError(
          503,
          "Hunter enrichment is temporarily unavailable",
        );
      }
      throw new HttpError(502, "Hunter could not enrich this company");
    }
    throw error;
  }

  const result = await createEdgeEnrichmentAndScore({
    lead,
    business,
    icpProfileId,
    hunter: { domain, contacts },
  });

  return jsonResponse({
    jobId: asString(result.enrichment.id),
    status: "QUEUED",
    provider: "HUNTER",
  }, 202);
}

async function handleLatestLeadScore(
  leadId: string,
  url: URL,
): Promise<Response> {
  const icpProfileId = url.searchParams.get("icpProfileId");
  const prediction = await singleRow("LeadScorePrediction", {
    select:
      "id,leadId,icpProfileId,featureSnapshotId,modelVersionId,deterministicScore,logisticScore,blendedScore,scoreBand,reasonsJson,ruleEvaluationJson,predictedAt,createdAt",
    leadId: `eq.${leadId}`,
    ...(icpProfileId ? { icpProfileId: `eq.${icpProfileId}` } : {}),
    order: "predictedAt.desc,createdAt.desc,id.desc",
  });

  return jsonResponse({
    leadId,
    prediction: prediction ? mapScorePrediction(prediction) : null,
  });
}

async function handleLatestLeadFeatureSnapshot(
  leadId: string,
  url: URL,
): Promise<Response> {
  const icpProfileId = url.searchParams.get("icpProfileId");
  const snapshot = await singleRow("LeadFeatureSnapshot", {
    select: "*",
    leadId: `eq.${leadId}`,
    ...(icpProfileId ? { icpProfileId: `eq.${icpProfileId}` } : {}),
    order: "computedAt.desc,createdAt.desc,id.desc",
  });

  return jsonResponse({
    leadId,
    icpProfileId,
    snapshot: snapshot ? mapFeatureSnapshot(snapshot) : null,
  });
}

async function handleLatestLeadDeterministicScore(
  leadId: string,
  url: URL,
): Promise<Response> {
  const icpProfileId = url.searchParams.get("icpProfileId");
  const prediction = await singleRow("LeadScorePrediction", {
    select:
      "id,leadId,icpProfileId,deterministicScore,scoreBand,reasonsJson,ruleEvaluationJson,predictedAt,createdAt",
    leadId: `eq.${leadId}`,
    ...(icpProfileId ? { icpProfileId: `eq.${icpProfileId}` } : {}),
    order: "predictedAt.desc,createdAt.desc,id.desc",
  });
  const reasons = asObject(prediction?.reasonsJson) ?? {};
  const reasonCodes = asStringArray(reasons.reasonCodes);

  return jsonResponse({
    leadId,
    icpProfileId: icpProfileId ?? asNullableString(prediction?.icpProfileId),
    predictionId: asNullableString(prediction?.id),
    deterministicScore: prediction
      ? asNumber(prediction.deterministicScore)
      : null,
    reasonCodes,
    ruleEvaluation: sanitizePublicOperationalJson(
      Array.isArray(prediction?.ruleEvaluationJson)
        ? prediction.ruleEvaluationJson
        : [],
    ),
    predictedAt: prediction ? iso(prediction.predictedAt) : null,
  });
}

async function handleListRejectedLeads(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "rejectedAt.desc,createdAt.desc,id.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const reason = url.searchParams.get("reason");
  if (reason) params.reason = `eq.${reason}`;
  const result = await listRows("lead_rejections", params);
  const leadIds = result.data.map((row) => asString(row.leadId)).filter(
    Boolean,
  );
  const leads = leadIds.length
    ? await listRows("Lead", {
      select: "*",
      id: pgIn(leadIds),
      limit: leadIds.length,
    })
    : { data: [], total: 0 };
  const leadById = new Map(leads.data.map((row) => [asString(row.id), row]));
  const businessIds = result.data
    .map((row) =>
      asNullableString(row.businessId) ??
        asNullableString(leadById.get(asString(row.leadId))?.businessId)
    )
    .filter((id): id is string => id !== null);
  const [businesses, icpNames] = await Promise.all([
    businessesById(businessIds),
    icpNamesById(
      result.data.map((row) => asNullableString(row.icpProfileId)).filter((
        id,
      ): id is string => id !== null),
    ),
  ]);

  return jsonResponse({
    items: result.data.map((row) => {
      const lead = leadById.get(asString(row.leadId));
      const business = businesses.get(asString(row.businessId)) ??
        businesses.get(asString(lead?.businessId));
      const metadata = asObject(row.metadata);
      return {
        id: asString(row.id),
        leadId: asString(row.leadId),
        firstName: asString(lead?.firstName),
        lastName: asString(lead?.lastName),
        email: asString(lead?.email, "unknown@example.invalid"),
        companyName: asNullableString(business?.name),
        businessName: asNullableString(business?.name),
        websiteDomain: asNullableString(business?.websiteDomain),
        category: asNullableString(business?.category),
        city: asNullableString(business?.city),
        country: asNullableString(business?.countryCode),
        icpProfileId: asNullableString(row.icpProfileId),
        icpProfileName: asNullableString(row.icpProfileId)
          ? icpNames.get(asString(row.icpProfileId)) ?? null
          : null,
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
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "updated_at.desc,id.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const status = url.searchParams.get("status");
  if (status) params.status = `eq.${status}`;
  const icpProfileId = url.searchParams.get("icpProfileId");
  if (icpProfileId) params.icp_profile_id = `eq.${icpProfileId}`;
  const from = url.searchParams.get("from");
  if (from) params.created_at = `gte.${from}`;
  const to = url.searchParams.get("to");
  if (to) params.created_at = `lte.${to}`;

  const q = url.searchParams.get("q");
  if (q) {
    const pattern = ilikePattern(q);
    const businessMatches = await listRows("businesses", {
      select: "id",
      or:
        `(name.ilike.${pattern},website_domain.ilike.${pattern},category.ilike.${pattern},city.ilike.${pattern})`,
      limit: MAX_DEMO_ROWS,
    });
    const businessIds = businessMatches.data.map((row) => asString(row.id))
      .filter(Boolean);
    if (businessIds.length === 0) {
      return jsonResponse({ items: [], page, pageSize, total: 0 });
    }
    params.business_id = pgIn(businessIds);
  }

  const result = await listRows("contact_recovery_items", params);
  const businessIds = result.data
    .map((row) => asString(firstValue(row, "businessId", "business_id")))
    .filter(Boolean);
  const icpIds = result.data
    .map((row) => asString(firstValue(row, "icpProfileId", "icp_profile_id")))
    .filter(Boolean);
  const [businesses, icpNames] = await Promise.all([
    businessesById(businessIds),
    icpNamesById(icpIds),
  ]);

  return jsonResponse({
    items: result.data.map((row) => {
      const businessId = asString(firstValue(row, "businessId", "business_id"));
      const rowIcpId = asString(
        firstValue(row, "icpProfileId", "icp_profile_id"),
      );
      return mapContactRecoveryItem(
        row,
        businesses.get(businessId),
        icpNames.get(rowIcpId) ?? null,
      );
    }),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleGetContactRecovery(id: string): Promise<Response> {
  const row = await singleRow("contact_recovery_items", {
    select: "*",
    id: `eq.${id}`,
  });
  if (!row) throw new HttpError(404, "Contact recovery item not found");

  const businessId = asString(firstValue(row, "businessId", "business_id"));
  const icpProfileId = asString(
    firstValue(row, "icpProfileId", "icp_profile_id"),
  );
  const [businesses, icpNames] = await Promise.all([
    businessesById([businessId]),
    icpNamesById([icpProfileId]),
  ]);
  return jsonResponse(
    mapContactRecoveryItem(
      row,
      businesses.get(businessId),
      icpNames.get(icpProfileId) ?? null,
    ),
  );
}

async function handleListDrafts(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "createdAt.desc,id.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (const key of ["leadId", "icpProfileId", "approvalStatus"]) {
    const value = url.searchParams.get(key);
    if (value) params[key] = `eq.${value}`;
  }
  if (parseBoolean(url.searchParams.get("followUpOnly"), false)) {
    params.followUpNumber = "gt.0";
  }

  const result = await listRows("MessageDraft", params);
  const draftIds = result.data.map((row) => asString(row.id)).filter(Boolean);
  const variants = draftIds.length
    ? await listRows("MessageVariant", {
      select: "*",
      messageDraftId: pgIn(draftIds),
      order: "variantKey.asc,createdAt.asc",
      limit: MAX_DEMO_ROWS,
    })
    : { data: [], total: 0 };
  const variantsByDraft = new Map<string, Row[]>();
  for (const row of variants.data) {
    const draftId = asString(row.messageDraftId);
    variantsByDraft.set(draftId, [
      ...(variantsByDraft.get(draftId) ?? []),
      row,
    ]);
  }

  return jsonResponse({
    items: result.data.map((row) =>
      mapDraft(row, variantsByDraft.get(asString(row.id)) ?? [])
    ),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleGetDraft(id: string): Promise<Response> {
  const draft = await singleRow("MessageDraft", {
    select: "*",
    id: `eq.${id}`,
  });
  if (!draft) throw new HttpError(404, "Message draft not found");
  const variants = await listRows("MessageVariant", {
    select: "*",
    messageDraftId: `eq.${id}`,
    order: "variantKey.asc,createdAt.asc",
    limit: 50,
  });
  return jsonResponse(mapDraft(draft, variants.data));
}

async function handleListSends(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "createdAt.desc,id.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (const key of ["leadId", "status", "channel", "provider"]) {
    const value = url.searchParams.get(key);
    if (value) params[key] = `eq.${value}`;
  }
  const from = url.searchParams.get("from");
  if (from) params.createdAt = `gte.${from}`;
  const result = await listRows("MessageSend", params);
  return jsonResponse({
    items: result.data.map(mapSend),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleConversation(leadId: string): Promise<Response> {
  const [sends, feedback] = await Promise.all([
    listRows("MessageSend", {
      select: "*",
      leadId: `eq.${leadId}`,
      order: "createdAt.asc",
      limit: 200,
    }),
    listRows("FeedbackEvent", {
      select: "*",
      leadId: `eq.${leadId}`,
      order: "occurredAt.asc,createdAt.asc",
      limit: 200,
    }),
  ]);
  const variantIds = sends.data.map((row) => asString(row.messageVariantId))
    .filter(Boolean);
  const variants = variantIds.length
    ? await listRows("MessageVariant", {
      select: "*",
      id: pgIn(variantIds),
      limit: variantIds.length,
    })
    : { data: [], total: 0 };
  const variantsById = new Map(
    variants.data.map((row) => [asString(row.id), row]),
  );

  const entries = [
    ...sends.data.map((send) => {
      const variant = variantsById.get(asString(send.messageVariantId));
      return {
        id: asString(send.id),
        type: "sent",
        timestamp: iso(send.sentAt ?? send.createdAt),
        channel: asString(send.channel, "EMAIL"),
        bodyText: asString(variant?.bodyText),
        bodyHtml: asNullableString(variant?.bodyHtml),
        subject: asNullableString(variant?.subject),
        replyClassification: null,
        status: asString(send.status, "QUEUED"),
        followUpNumber: asNullableNumber(send.followUpNumber),
      };
    }),
    ...feedback.data.map((event) => ({
      id: asString(event.id),
      type: "reply",
      timestamp: iso(event.occurredAt),
      channel: "EMAIL",
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
  const from = url.searchParams.get("from");
  if (from) params.occurredAt = `gte.${from}`;
  const to = url.searchParams.get("to");
  if (to) params.occurredAt = `lte.${to}`;
  const icpProfileId = url.searchParams.get("icpProfileId");
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
    countRowsWithOptionalInChunks("FeedbackEvent", params, "leadId", leadIds),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      { ...params, eventType: "eq.REPLIED" },
      "leadId",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      { ...params, eventType: "eq.MEETING_BOOKED" },
      "leadId",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      { ...params, eventType: "eq.DEAL_WON" },
      "leadId",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      { ...params, eventType: "eq.DEAL_LOST" },
      "leadId",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      { ...params, eventType: "eq.BOUNCED" },
      "leadId",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      { ...params, eventType: "eq.NOT_INTERESTED" },
      "leadId",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      { ...params, eventType: "eq.UNSUBSCRIBED" },
      "leadId",
      leadIds,
    ),
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

function emptyFeedbackSummary(
  from: string | null,
  to: string | null,
): JsonObject {
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
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "occurredAt.desc,createdAt.desc,id.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (const key of ["leadId", "messageSendId", "eventType", "source"]) {
    const value = url.searchParams.get(key);
    if (value) params[key] = `eq.${value}`;
  }
  const result = await listRows("FeedbackEvent", params);
  return jsonResponse({
    items: result.data.map(mapFeedbackEvent),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleFunnel(url: URL): Promise<Response> {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const icpProfileId = url.searchParams.get("icpProfileId");
  const businessCountPromise = countRows("businesses");
  let leadIds: string[] | null = null;
  let messageDraftIds: string[] | null = null;
  if (icpProfileId) {
    const [ids, draftIds] = await Promise.all([
      leadIdsForIcp(icpProfileId),
      messageDraftIdsForIcp(icpProfileId),
    ]);
    if (ids.size === 0) {
      return jsonResponse(
        emptyFunnel(from, to, icpProfileId, await businessCountPromise),
      );
    }
    leadIds = [...ids];
    messageDraftIds = draftIds;
  }
  const leadFilter: Record<string, string | number> = {
    deletedAt: "is.null",
  };
  applyDateRange(leadFilter, "createdAt", from, to);

  const draftFilter: Record<string, string | number> = {};
  applyDateRange(draftFilter, "createdAt", from, to);

  const sendFilter: Record<string, string | number> = {
    status: pgIn(SENT_MESSAGE_STATUSES),
  };
  applyDateRange(sendFilter, "sentAt", from, to);

  const repliedFilter: Record<string, string | number> = {
    eventType: "eq.REPLIED",
  };
  applyDateRange(repliedFilter, "occurredAt", from, to);

  const meetingFilter: Record<string, string | number> = {
    eventType: "eq.MEETING_BOOKED",
  };
  applyDateRange(meetingFilter, "occurredAt", from, to);

  const wonFilter: Record<string, string | number> = {
    eventType: "eq.DEAL_WON",
  };
  applyDateRange(wonFilter, "occurredAt", from, to);

  const [
    businessCount,
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
    businessCountPromise,
    countRowsWithOptionalInChunks("Lead", leadFilter, "id", leadIds),
    countRowsWithOptionalInChunks(
      "Lead",
      { ...leadFilter, status: pgIn(QUALIFIED_LEAD_STATUSES) },
      "id",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "Lead",
      { ...leadFilter, status: pgIn(ENRICHED_LEAD_STATUSES) },
      "id",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "Lead",
      { ...leadFilter, status: pgIn(SCORED_LEAD_STATUSES) },
      "id",
      leadIds,
    ),
    listRowsWithOptionalInChunks(
      "Lead",
      { ...leadFilter, select: "costCents" },
      "id",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "MessageDraft",
      draftFilter,
      "id",
      messageDraftIds,
    ),
    countRowsWithOptionalInChunks(
      "MessageSend",
      sendFilter,
      "messageDraftId",
      messageDraftIds,
    ),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      repliedFilter,
      "leadId",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      meetingFilter,
      "leadId",
      leadIds,
    ),
    countRowsWithOptionalInChunks(
      "FeedbackEvent",
      wonFilter,
      "leadId",
      leadIds,
    ),
  ]);
  const totalCostCents = leadCostRows.reduce(
    (sum, row) => sum + asNumber(row.costCents),
    0,
  );
  return jsonResponse({
    from,
    to,
    icpProfileId,
    businessCount,
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
    costPerLead: discoveredCount > 0
      ? Math.round((totalCostCents / discoveredCount) * 100) / 100
      : 0,
  });
}

function emptyFunnel(
  from: string | null,
  to: string | null,
  icpProfileId: string | null,
  businessCount = 0,
): JsonObject {
  return {
    from,
    to,
    icpProfileId,
    businessCount,
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

const DASHBOARD_ROLLUP_SELECT = [
  "day",
  "icpProfileId",
  "discoveredCount",
  "qualifiedCount",
  "enrichedCount",
  "scoredCount",
  "scoreSum",
  "lowScoreCount",
  "mediumScoreCount",
  "highScoreCount",
  "scoreBucket0Count",
  "scoreBucket1Count",
  "scoreBucket2Count",
  "scoreBucket3Count",
  "scoreBucket4Count",
  "scoreBucket5Count",
  "scoreBucket6Count",
  "scoreBucket7Count",
  "scoreBucket8Count",
  "scoreBucket9Count",
  "messagesGeneratedCount",
  "sentCount",
  "failedCount",
  "repliedCount",
  "meetingsCount",
  "dealsWonCount",
  "dealLostCount",
  "bouncedCount",
  "notInterestedCount",
  "rejectedCount",
  "totalCostCents",
].join(",");

const LEGACY_DASHBOARD_ROLLUP_SELECT = [
  "day",
  "icpProfileId",
  "discoveredCount",
  "enrichedCount",
  "scoredCount",
  "validEmailCount",
  "validDomainCount",
  "industryMatchRate",
  "geoMatchRate",
  "sentCount",
  "failedCount",
  "repliedCount",
  "bouncedCount",
].join(",");

interface EdgeDashboardRollupTotals {
  discoveredCount: number;
  qualifiedCount: number;
  enrichedCount: number;
  scoredCount: number;
  scoreSum: number;
  lowScoreCount: number;
  mediumScoreCount: number;
  highScoreCount: number;
  scoreBucketCounts: number[];
  messagesGeneratedCount: number;
  sentCount: number;
  failedCount: number;
  repliedCount: number;
  meetingsCount: number;
  dealsWonCount: number;
  dealLostCount: number;
  bouncedCount: number;
  notInterestedCount: number;
  rejectedCount: number;
  totalCostCents: number;
}

function toRollupDayIso(value: string | null): string | null {
  if (!value) return null;
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) return null;
  return new Date(
    Date.UTC(
      source.getUTCFullYear(),
      source.getUTCMonth(),
      source.getUTCDate(),
    ),
  ).toISOString();
}

function applyRollupDateRange(
  params: Record<string, string | number>,
  from: string | null,
  to: string | null,
): void {
  const fromDay = toRollupDayIso(from);
  const toDay = toRollupDayIso(to);

  if (fromDay && toDay) {
    params.and = `(day.gte.${fromDay},day.lte.${toDay})`;
    return;
  }

  if (fromDay) {
    params.day = `gte.${fromDay}`;
    return;
  }

  if (toDay) {
    params.day = `lte.${toDay}`;
  }
}

function emptyRollupTotals(): EdgeDashboardRollupTotals {
  return {
    discoveredCount: 0,
    qualifiedCount: 0,
    enrichedCount: 0,
    scoredCount: 0,
    scoreSum: 0,
    lowScoreCount: 0,
    mediumScoreCount: 0,
    highScoreCount: 0,
    scoreBucketCounts: Array.from({ length: 10 }, () => 0),
    messagesGeneratedCount: 0,
    sentCount: 0,
    failedCount: 0,
    repliedCount: 0,
    meetingsCount: 0,
    dealsWonCount: 0,
    dealLostCount: 0,
    bouncedCount: 0,
    notInterestedCount: 0,
    rejectedCount: 0,
    totalCostCents: 0,
  };
}

function addRollup(total: EdgeDashboardRollupTotals, row: Row): void {
  const scoredCount = asNumber(row.scoredCount);
  total.discoveredCount += asNumber(row.discoveredCount);
  total.qualifiedCount += asNumber(row.qualifiedCount);
  total.enrichedCount += asNumber(row.enrichedCount);
  total.scoredCount += scoredCount;
  total.scoreSum += row.scoreSum === undefined
    ? asNumber(row.industryMatchRate) * scoredCount
    : asNumber(row.scoreSum);
  total.lowScoreCount += asNumber(row.lowScoreCount);
  total.mediumScoreCount += asNumber(row.mediumScoreCount);
  total.highScoreCount += asNumber(row.highScoreCount);
  total.scoreBucketCounts[0]! += asNumber(row.scoreBucket0Count);
  total.scoreBucketCounts[1]! += asNumber(row.scoreBucket1Count);
  total.scoreBucketCounts[2]! += asNumber(row.scoreBucket2Count);
  total.scoreBucketCounts[3]! += asNumber(row.scoreBucket3Count);
  total.scoreBucketCounts[4]! += asNumber(row.scoreBucket4Count);
  total.scoreBucketCounts[5]! += asNumber(row.scoreBucket5Count);
  total.scoreBucketCounts[6]! += asNumber(row.scoreBucket6Count);
  total.scoreBucketCounts[7]! += asNumber(row.scoreBucket7Count);
  total.scoreBucketCounts[8]! += asNumber(row.scoreBucket8Count);
  total.scoreBucketCounts[9]! += asNumber(row.scoreBucket9Count);
  total.messagesGeneratedCount += asNumber(row.messagesGeneratedCount);
  total.sentCount += asNumber(row.sentCount);
  total.failedCount += asNumber(row.failedCount);
  total.repliedCount += asNumber(row.repliedCount);
  total.meetingsCount += asNumber(row.meetingsCount);
  total.dealsWonCount += asNumber(row.dealsWonCount);
  total.dealLostCount += asNumber(row.dealLostCount);
  total.bouncedCount += asNumber(row.bouncedCount);
  total.notInterestedCount += asNumber(row.notInterestedCount);
  total.rejectedCount += asNumber(row.rejectedCount);
  total.totalCostCents += asNumber(row.totalCostCents);
}

function summarizeRollups(rows: Row[]): EdgeDashboardRollupTotals {
  const total = emptyRollupTotals();
  for (const row of rows) {
    addRollup(total, row);
  }
  return total;
}

function rollupScoreBandTotal(total: EdgeDashboardRollupTotals): number {
  return total.lowScoreCount + total.mediumScoreCount + total.highScoreCount;
}

function rollupScoreBucketTotal(total: EdgeDashboardRollupTotals): number {
  return total.scoreBucketCounts.reduce((sum, count) => sum + count, 0);
}

function shouldHydrateDashboardSummaryFromDirectAnalytics(
  total: EdgeDashboardRollupTotals,
  rollupRowCount: number,
): boolean {
  if (rollupRowCount === 0) return true;

  const hasImpossibleFunnel = total.discoveredCount > 0 &&
    total.qualifiedCount > total.discoveredCount;
  if (hasImpossibleFunnel) return true;

  const missingScoreLayer = total.qualifiedCount > 0 && total.scoredCount === 0;
  if (missingScoreLayer) return true;

  const missingScoreBreakdown = total.scoredCount > 0 &&
    rollupScoreBandTotal(total) === 0 && rollupScoreBucketTotal(total) === 0;
  return missingScoreBreakdown;
}

function buildRollupHistogram(bucketCounts: number[]): JsonObject[] {
  return bucketCounts.map((count, index) => ({
    scoreMin: index / 10,
    scoreMax: (index + 1) / 10,
    count,
  }));
}

function buildRollupQualityTrends(rows: Row[]): JsonObject[] {
  const byDay = new Map<string, EdgeDashboardRollupTotals>();

  for (const row of rows) {
    const day = iso(row.day).slice(0, 10);
    const total = byDay.get(day) ?? emptyRollupTotals();
    addRollup(total, row);
    byDay.set(day, total);
  }

  return Array.from(byDay.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, total]) => ({
      day,
      avgScore: total.scoredCount > 0 ? total.scoreSum / total.scoredCount : 0,
      totalCreated: total.discoveredCount,
      rejectedCount: total.rejectedCount,
    }));
}

function buildRollupIcpPerformance(rows: Row[]): JsonObject[] {
  const byIcp = new Map<string, EdgeDashboardRollupTotals>();

  for (const row of rows) {
    const icpProfileId = asString(row.icpProfileId);
    if (!icpProfileId) continue;
    const total = byIcp.get(icpProfileId) ?? emptyRollupTotals();
    addRollup(total, row);
    byIcp.set(icpProfileId, total);
  }

  return Array.from(byIcp.entries())
    .map(([icpProfileId, total]) => ({
      icpProfileId,
      leadCount: total.scoredCount,
      avgScore: total.scoredCount > 0
        ? total.scoreSum / total.scoredCount
        : null,
      qualifiedCount: total.qualifiedCount,
      rejectedCount: total.rejectedCount,
    }))
    .sort((left, right) =>
      asNumber(right.leadCount) - asNumber(left.leadCount) ||
      asString(left.icpProfileId).localeCompare(asString(right.icpProfileId))
    );
}

async function listDashboardRollups(
  baseParams: Record<string, string | number>,
): Promise<{ rows: Row[]; extended: boolean }> {
  try {
    const rows = await listAllRows("AnalyticsDailyRollup", {
      ...baseParams,
      select: DASHBOARD_ROLLUP_SELECT,
    });
    return { rows, extended: true };
  } catch (error) {
    console.warn(
      "[demo-edge-api] extended analytics rollup unavailable; using legacy rollup fallback",
      error,
    );
    const rows = await listAllRows("AnalyticsDailyRollup", {
      ...baseParams,
      select: LEGACY_DASHBOARD_ROLLUP_SELECT,
    });
    return { rows, extended: false };
  }
}

async function handleScoreDistribution(url: URL): Promise<Response> {
  const params: Record<string, string | number> = {
    order: "predictedAt.asc,id.asc",
  };
  const icpProfileId = url.searchParams.get("icpProfileId");
  if (icpProfileId) params.icpProfileId = `eq.${icpProfileId}`;
  const modelVersionId = url.searchParams.get("modelVersionId");
  if (modelVersionId) params.modelVersionId = `eq.${modelVersionId}`;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && to) {
    params.and = `(predictedAt.gte.${from},predictedAt.lte.${to})`;
  } else if (from) {
    params.predictedAt = `gte.${from}`;
  } else if (to) {
    params.predictedAt = `lte.${to}`;
  }
  const scoreRows = await listAllRows("LeadScorePrediction", {
    ...params,
    select: "leadId,scoreBand,blendedScore,predictedAt,createdAt",
  });
  const latestByLeadId = new Map<string, Row>();
  for (const row of scoreRows) {
    const leadId = asNullableString(row.leadId);
    if (!leadId) continue;

    const existing = latestByLeadId.get(leadId);
    const rowTime = Date.parse(
      iso(firstValue(row, "predictedAt", "createdAt")),
    );
    const existingTime = existing
      ? Date.parse(iso(firstValue(existing, "predictedAt", "createdAt")))
      : Number.NEGATIVE_INFINITY;

    if (!existing || rowTime > existingTime) {
      latestByLeadId.set(leadId, row);
    }
  }

  const latestScores = Array.from(latestByLeadId.values());
  const scoreBands = ["LOW", "MEDIUM", "HIGH"] as const;
  const thresholds = Array.from({ length: 10 }, (_, index) => index / 10);
  const bands = scoreBands.map((scoreBand) => ({
    scoreBand,
    count:
      latestScores.filter((row) =>
        asNullableString(row.scoreBand) === scoreBand
      ).length,
  }));
  const histogram = thresholds.map((scoreMin, index) => {
    const scoreMax = (index + 1) / 10;
    const count = latestScores.filter((row) => {
      const score = asNullableNumber(row.blendedScore);
      if (score === null) return false;
      return index === thresholds.length - 1
        ? score >= scoreMin && score <= scoreMax
        : score >= scoreMin && score < scoreMax;
    }).length;

    return {
      scoreMin,
      scoreMax,
      count,
    };
  });
  return jsonResponse({
    bands,
    histogram,
  });
}

async function handleDailyQualityTrends(url: URL): Promise<Response> {
  const params: Record<string, string | number> = {
    order: "day.asc",
  };
  applyRollupDateRange(
    params,
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const { rows } = await listDashboardRollups(params);
  return jsonResponse({
    items: buildRollupQualityTrends(rows),
  });
}

async function handleAvgScore(url: URL): Promise<Response> {
  const params: Record<string, string | number> = {
    select: "leadId,icpProfileId,blendedScore,predictedAt,createdAt",
    order: "predictedAt.asc,id.asc",
  };
  const icpProfileId = url.searchParams.get("icpProfileId");
  if (icpProfileId) params.icpProfileId = `eq.${icpProfileId}`;
  applyDateRange(
    params,
    "predictedAt",
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );

  const rows = await listAllRows("LeadScorePrediction", params);
  const latestByLeadId = new Map<string, Row>();
  for (const row of rows) {
    const leadId = asNullableString(row.leadId);
    if (!leadId) continue;

    const existing = latestByLeadId.get(leadId);
    const rowTime = Date.parse(
      iso(firstValue(row, "predictedAt", "createdAt")),
    );
    const existingTime = existing
      ? Date.parse(iso(firstValue(existing, "predictedAt", "createdAt")))
      : Number.NEGATIVE_INFINITY;

    if (!existing || rowTime > existingTime) {
      latestByLeadId.set(leadId, row);
    }
  }

  const scores = Array.from(latestByLeadId.values())
    .map((row) => asNullableNumber(row.blendedScore))
    .filter((value): value is number => value !== null);
  return jsonResponse({
    avgScore: scores.length > 0
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : null,
  });
}

async function handleIcpPerformance(url: URL): Promise<Response> {
  const params: Record<string, string | number> = {
    select: "leadId,icpProfileId,blendedScore,scoreBand,predictedAt,createdAt",
    order: "predictedAt.asc,id.asc",
  };
  const icpProfileId = url.searchParams.get("icpProfileId");
  if (icpProfileId) params.icpProfileId = `eq.${icpProfileId}`;
  applyDateRange(
    params,
    "predictedAt",
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );

  const rows = await listAllRows("LeadScorePrediction", params);
  const latestByLeadIcp = new Map<string, Row>();
  for (const row of rows) {
    const leadId = asNullableString(row.leadId);
    const rowIcpProfileId = asNullableString(row.icpProfileId);
    if (!leadId || !rowIcpProfileId) continue;

    const key = `${leadId}:${rowIcpProfileId}`;
    const existing = latestByLeadIcp.get(key);
    const rowTime = Date.parse(
      iso(firstValue(row, "predictedAt", "createdAt")),
    );
    const existingTime = existing
      ? Date.parse(iso(firstValue(existing, "predictedAt", "createdAt")))
      : Number.NEGATIVE_INFINITY;

    if (!existing || rowTime > existingTime) {
      latestByLeadIcp.set(key, row);
    }
  }

  const grouped = new Map<
    string,
    { count: number; scoreTotal: number; qualified: number; rejected: number }
  >();
  for (const row of latestByLeadIcp.values()) {
    const rowIcpProfileId = asNullableString(row.icpProfileId);
    const score = asNullableNumber(row.blendedScore);
    if (!rowIcpProfileId || score === null) continue;
    const group = grouped.get(rowIcpProfileId) ??
      { count: 0, scoreTotal: 0, qualified: 0, rejected: 0 };
    group.count += 1;
    group.scoreTotal += score;
    if (score >= 0.5) group.qualified += 1;
    grouped.set(rowIcpProfileId, group);
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

async function handleDashboardSummary(url: URL): Promise<Response> {
  const cacheKey = url.searchParams.toString() || "default";
  const cached = dashboardSummaryCache.get(cacheKey);
  const nowMs = Date.now();
  if (cached && cached.expiresAt > nowMs) {
    return jsonResponse(cached.payload);
  }
  if (cached) {
    dashboardSummaryCache.delete(cacheKey);
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const icpProfileId = url.searchParams.get("icpProfileId");
  const rollupParams: Record<string, string | number> = {
    order: "day.asc,icpProfileId.asc",
  };
  if (icpProfileId) {
    rollupParams.icpProfileId = `eq.${icpProfileId}`;
  }
  applyRollupDateRange(rollupParams, from, to);

  const [rollups, businessCount, pendingDraftsCount, discoveryRuns] =
    await Promise.all([
      listDashboardRollups(rollupParams),
      countRows("businesses"),
      countRows("MessageDraft", {
        approvalStatus: "eq.PENDING",
        ...(icpProfileId ? { icpProfileId: `eq.${icpProfileId}` } : {}),
      }),
      listRows("JobExecution", {
        select: "*",
        type: "eq.discovery.run",
        order: "createdAt.desc",
        offset: 0,
        limit: 6,
      }),
    ]);
  const rollupRows = rollups.rows;
  const totals = summarizeRollups(rollupRows);
  const latestRollup = rollupRows.reduce<string | null>((latest, row) => {
    const day = iso(row.day).slice(0, 10);
    return latest === null || day > latest ? day : latest;
  }, null);
  const shouldUseDirectAnalyticsFallback = !rollups.extended ||
    shouldHydrateDashboardSummaryFromDirectAnalytics(totals, rollupRows.length);
  const [
    fallbackFunnel,
    fallbackScoreDistribution,
    fallbackFeedback,
    fallbackAvgScore,
    fallbackIcpPerformance,
  ] = shouldUseDirectAnalyticsFallback
    ? await Promise.all([
      responseJson(await handleFunnel(url)),
      responseJson(await handleScoreDistribution(url)),
      responseJson(await handleFeedbackSummary(url)),
      responseJson(await handleAvgScore(url)),
      responseJson(await handleIcpPerformance(url)),
    ])
    : [null, null, null, null, null];

  const payload: JsonObject = {
    from,
    to,
    icpProfileId,
    generatedAt: new Date().toISOString(),
    dataFreshness: {
      qualityRollupBacked: rollupRows.length > 0,
      qualityRollupLatestDay: latestRollup,
      dashboardRollupExtended: rollups.extended,
      dashboardDirectAnalyticsFallback: shouldUseDirectAnalyticsFallback,
    },
    funnel: fallbackFunnel ?? {
      from,
      to,
      icpProfileId,
      businessCount,
      discoveredCount: totals.discoveredCount,
      qualifiedCount: totals.qualifiedCount,
      enrichedCount: totals.enrichedCount,
      scoredCount: totals.scoredCount,
      messagesGeneratedCount: totals.messagesGeneratedCount,
      messagesSentCount: totals.sentCount,
      repliesCount: totals.repliedCount,
      meetingsCount: totals.meetingsCount,
      dealsWonCount: totals.dealsWonCount,
      totalCostCents: totals.totalCostCents,
      costPerLead: totals.discoveredCount > 0
        ? Math.round((totals.totalCostCents / totals.discoveredCount) * 100) /
          100
        : 0,
    },
    scoreDistribution: fallbackScoreDistribution ?? {
      bands: [
        { scoreBand: "LOW", count: totals.lowScoreCount },
        { scoreBand: "MEDIUM", count: totals.mediumScoreCount },
        { scoreBand: "HIGH", count: totals.highScoreCount },
      ],
      histogram: buildRollupHistogram(totals.scoreBucketCounts),
    },
    feedback: fallbackFeedback ?? {
      from,
      to,
      totalEvents: totals.repliedCount +
        totals.meetingsCount +
        totals.dealsWonCount +
        totals.dealLostCount +
        totals.bouncedCount +
        totals.notInterestedCount,
      repliedCount: totals.repliedCount,
      meetingBookedCount: totals.meetingsCount,
      dealWonCount: totals.dealsWonCount,
      dealLostCount: totals.dealLostCount,
      bouncedCount: totals.bouncedCount,
      notInterestedCount: totals.notInterestedCount,
    },
    qualityTrends: {
      items: buildRollupQualityTrends(rollupRows),
    },
    avgScore: fallbackAvgScore ?? {
      avgScore: totals.scoredCount > 0
        ? totals.scoreSum / totals.scoredCount
        : null,
    },
    icpPerformance: fallbackIcpPerformance ?? {
      items: buildRollupIcpPerformance(rollupRows),
    },
    pendingDraftsCount,
    discoveryRuns: discoveryRuns.data.map(mapDiscoveryRun),
    discoveryRunsTotal: discoveryRuns.total ?? discoveryRuns.data.length,
  };
  dashboardSummaryCache.set(cacheKey, {
    expiresAt: Date.now() + DASHBOARD_SUMMARY_CACHE_TTL_MS,
    payload,
  });

  return jsonResponse(payload);
}

async function handleModelMetrics(): Promise<Response> {
  const rows = await listAllRows("ModelEvaluation", {
    select: "*,ModelVersion(versionTag)",
    order: "evaluatedAt.desc",
  });
  return jsonResponse({
    items: rows.map((row) => {
      const modelVersion = asObject(row.ModelVersion);
      return {
        modelVersionId: asString(row.modelVersionId),
        versionTag: asString(
          modelVersion?.versionTag,
          asString(row.modelVersionId),
        ),
        split: asString(row.split, "VALIDATION"),
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
    singleRow("ModelVersion", {
      select: "id",
      stage: "eq.ACTIVE",
      order: "activatedAt.desc,createdAt.desc",
    }),
    singleRow("TrainingRun", {
      select: "*",
      status: "in.(QUEUED,RUNNING)",
      order: "createdAt.desc",
    }),
    singleRow("TrainingRun", {
      select: "*",
      status: "eq.SUCCEEDED",
      order: "endedAt.desc,createdAt.desc",
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
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const result = await listRows("manager_recommendation_records", {
    select: "*",
    order: "priority.asc,createdAt.desc",
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
      status: asString(row.status, "active"),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function admitPublicDemoDiscovery(input: {
  sessionHash: string;
  idempotencyKey: string;
  runId: string;
  taskBudget: number;
  payload: JsonObject;
  result: JsonObject;
  seedPayloads: JsonObject[];
}): Promise<PublicDemoAdmission> {
  const rows = await rpcRequest<PublicDemoAdmission>(
    "admit_and_enqueue_public_demo_discovery",
    {
      p_session_hash: input.sessionHash,
      p_idempotency_key: input.idempotencyKey,
      p_run_id: input.runId,
      p_task_budget: input.taskBudget,
      p_payload: input.payload,
      p_result: input.result,
      p_seed_payloads: input.seedPayloads,
    },
  );
  const admission = rows[0];
  if (!admission) {
    throw new HttpError(
      502,
      "Discovery admission did not return a result",
      false,
    );
  }
  return admission;
}

async function updatePublicDemoAdmission(
  runId: string,
  state: "running" | "completed" | "failed",
): Promise<void> {
  await updateRows<Row>("public_demo_discovery_admissions", {
    run_id: `eq.${runId}`,
  }, {
    state,
    updated_at: new Date().toISOString(),
    expires_at: state === "running"
      ? new Date(Date.now() + PUBLIC_DEMO_STALE_RUN_MS).toISOString()
      : new Date().toISOString(),
  });
}

async function reconcileStalePublicDemoRuns(
  context: PublicDemoContext,
): Promise<void> {
  const staleBefore = new Date(Date.now() - PUBLIC_DEMO_STALE_RUN_MS)
    .toISOString();
  const failedAt = new Date().toISOString();
  const staleRuns = await updateRows<Row>("JobExecution", {
    type: "eq.discovery.run",
    status: "in.(queued,running)",
    updatedAt: `lt.${staleBefore}`,
    "payload->>publicDemo": "eq.true",
    "payload->>publicDemoSessionHash": `eq.${context.sessionHash}`,
  }, {
    status: "failed",
    error:
      "This demo run stopped before it could finish. Start a new bounded run to try again.",
    finishedAt: failedAt,
    updatedAt: failedAt,
  });

  const staleRunIds = staleRuns.map((row) => asString(row.id)).filter(Boolean);
  if (staleRunIds.length > 0) {
    await updateRows<Row>("public_demo_discovery_admissions", {
      run_id: pgIn(staleRunIds),
    }, {
      state: "failed",
      updated_at: failedAt,
      expires_at: failedAt,
    });
  }
}

function publicDemoQuotaError(reason: EdgePublicDemoQuotaOutcome): HttpError {
  if (reason === "session_daily_limit") {
    return new HttpError(
      429,
      "This browser session has reached today’s discovery limit. Try again tomorrow.",
    );
  }
  if (reason === "concurrent_limit") {
    return new HttpError(429, "The live demo is busy. Try again in a moment.");
  }
  return new HttpError(
    429,
    "Today’s live demo discovery limit has been reached. Try again tomorrow.",
  );
}

async function handleCreateDiscoveryRun(
  request: Request,
  auth: AuthContext,
  publicDemoContext?: PublicDemoContext,
): Promise<Response> {
  const body = await request.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  });
  const input = parseCreateDiscoveryRunBody(body, Boolean(publicDemoContext));
  if (publicDemoContext) {
    await validatePublicDemoCities(input);
  }
  const requestedIcpIds = resolveRequestedIcpIds(input);
  if (publicDemoContext) {
    await validatePublicDemoIcpIds(requestedIcpIds);
  }
  const icpRows = await listRows("IcpProfile", {
    select: "id,name,targetIndustries,targetCountries,metadataJson",
    id: pgIn(requestedIcpIds),
    isActive: "eq.true",
    limit: requestedIcpIds.length,
  });
  const icps = icpRows.data.map((row) => {
    const profile = normalizeIcpProfile(row);
    const presentation = publicDemoContext
      ? getPublicDemoIcpPresentation(profile.name)
      : null;
    return presentation
      ? {
        ...profile,
        name: presentation.name,
        targetIndustries: [...presentation.targetIndustries],
        targetCountries: ["US"],
      }
      : profile;
  });
  const missingIcpIds = requestedIcpIds.filter((id) =>
    !icps.some((icp) => icp.id === id)
  );
  if (missingIcpIds.length > 0 || icps.length === 0) {
    throw new HttpError(
      400,
      "Choose one or more active ICPs before starting discovery",
    );
  }

  let runId = newId("run");
  const now = new Date().toISOString();
  const primaryIcp = icps[0]!;
  const resultSeed = {
    totalItems: 0,
    processedItems: 0,
    failedItems: 0,
    totalFound: 0,
    scoredResults: 0,
    scoreBandCounts: { high: 0, medium: 0, low: 0 },
    alreadyKnown: 0,
    newFound: 0,
    newBusinesses: 0,
    disqualified: 0,
    converted: 0,
    searchTasksComplete: false,
    provider: "SERPAPI",
    edgeMode: !publicDemoContext,
    workerPipeline: Boolean(publicDemoContext),
  };
  const runPayload = {
    ...input,
    icpProfileId: primaryIcp.id,
    icpProfileIds: icps.map((icp) => icp.id),
    requestedByUserId: auth.userId,
    includeWebsiteAnalysis: publicDemoContext
      ? true
      : input.includeWebsiteAnalysis,
    edgeMode: !publicDemoContext,
    workerPipeline: Boolean(publicDemoContext),
    executionVersion: publicDemoContext
      ? "production-worker-v1"
      : "full-discovery-scoring-v1",
    ...(publicDemoContext
      ? {
        publicDemo: true,
        publicDemoSessionHash: publicDemoContext.sessionHash,
      }
      : {}),
  };

  if (publicDemoContext) {
    if (!publicDemoContext.idempotencyKey) {
      throw new HttpError(400, "A valid idempotency key is required.");
    }
    const taskBudget = input.limit ?? EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS;
    const shardBudgets = distributeEdgeDiscoveryTaskBudget(
      taskBudget,
      icps.length,
    );
    const cities = input.cities?.length
      ? input.cities
      : [...EDGE_PUBLIC_DEMO_US_CITIES];
    const seedPayloads = shardBudgets.map((maxTasks, index) => ({
      reason: "api",
      correlationId: runId,
      jobExecutionId: newId("seed"),
      outboxEventId: newId("outbox"),
      discoveryRunId: runId,
      icpProfileId: icps[index]!.id,
      countries: ["US"],
      cities,
      searchCategories: input.advancedSettings?.searchCategories?.length
        ? input.advancedSettings.searchCategories
        : icps[index]!.targetIndustries,
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: input.includeSocialMediaAnalysis ?? false,
      maxTasks,
      runMaxTasks: taskBudget,
      maxPages: 1,
      taskTypes: ["SERP_MAPS_LOCAL"],
      languages: ["en"],
      validationMode: true,
      minReviewCount: input.advancedSettings?.minReviewCount ?? 0,
      enqueueRunTasks: true,
    }));
    const admission = await admitPublicDemoDiscovery({
      sessionHash: publicDemoContext.sessionHash,
      idempotencyKey: publicDemoContext.idempotencyKey,
      runId,
      taskBudget,
      payload: runPayload,
      result: resultSeed,
      seedPayloads,
    });
    runId = admission.resolved_run_id;
    if (!admission.admitted) {
      if (admission.reason === "duplicate") {
        const existingRun = await singleRow("JobExecution", {
          select: "*",
          id: `eq.${runId}`,
          type: "eq.discovery.run",
          "payload->>publicDemoSessionHash":
            `eq.${publicDemoContext.sessionHash}`,
        });
        if (!existingRun) {
          throw new HttpError(
            409,
            "The existing discovery run could not be resumed.",
          );
        }
        return jsonResponse({
          runId,
          status: mapDiscoveryRun(existingRun).status,
        }, 200);
      }
      if (admission.reason === "repaired") {
        throw new HttpError(
          502,
          "Discovery admission could not be resumed.",
          false,
        );
      }
      throw publicDemoQuotaError(admission.reason);
    }
    return jsonResponse({
      runId,
      status: "QUEUED",
    }, 202);
  } else {
    await insertRow<Row>("JobExecution", {
      id: runId,
      type: "discovery.run",
      status: "running",
      attempts: 1,
      payload: runPayload,
      result: resultSeed,
      error: null,
      leadId: null,
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    });
  }

  try {
    let processedItems = 0;
    let failedItems = 0;
    let newBusinesses = 0;
    let alreadyKnown = 0;
    let converted = 0;
    let taskCount = 0;
    let inspectedResultCount = 0;
    let scoredResults = 0;
    const scoreBandCounts = { high: 0, medium: 0, low: 0 };
    const errors: string[] = [];
    const searchTaskLimit = input.limit ?? EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS;
    const taskTargets = planEdgeDiscoveryTaskTargets({
      icpCount: icps.length,
      countries: input.countries,
      cities: input.cities ?? [],
      searchTaskLimit,
    });

    for (const [taskIndex, target] of taskTargets.entries()) {
      if (!canCreateEdgeSearchTask({ taskCount, searchTaskLimit })) {
        break;
      }

      const icp = icps[target.icpIndex]!;
      const { countryCode, city } = target;
      const category = resolveSearchCategory(icp, input);
      const query = [category, city, countryCode].filter(Boolean).join(" ");
      const normalizedQueryKey = normalizeSearchText(query);
      const queryHash = edgeHash(
        `${runId}:${icp.id}:${countryCode}:${city ?? ""}:${normalizedQueryKey}`,
      );
      const taskNow = new Date().toISOString();
      const taskParams = {
        edgeMode: true,
        engine: "google_maps",
        provider: "SERPAPI",
        icpProfileId: icp.id,
        runId,
      };
      const task = await insertRow<Row>("search_tasks", {
        id: newId("task"),
        task_type: "SERP_MAPS_LOCAL",
        country_code: countryCode,
        city,
        language: "en",
        query_text: query,
        normalized_query_key: normalizedQueryKey,
        query_hash: queryHash,
        params_json: taskParams,
        page: 1,
        time_bucket: `edge-${taskNow.slice(0, 10)}`,
        status: "RUNNING",
        attempts: 1,
        run_after: taskNow,
        last_result_hash: null,
        error: null,
        created_at: taskNow,
        updated_at: taskNow,
        discovery_run_id: runId,
      });
      taskCount += 1;
      let taskInspectedResults = 0;
      let taskScoredResults = 0;
      let taskAlreadyKnown = 0;
      let taskNewBusinesses = 0;

      try {
        const serpApiPayload = await fetchSerpApiMapsResults({
          query,
          countryCode,
          city,
        });
        const minReviewCount = input.advancedSettings?.minReviewCount ?? 0;
        const businesses = normalizeSerpApiLocalBusinesses(
          serpApiPayload,
          countryCode,
        )
          .filter((business) => (business.reviewCount ?? 0) >= minReviewCount);
        const persistedProviderIds: string[] = [];
        const taskResultAllowance = edgeDiscoveryTaskResultAllowance({
          inspectedResultCount,
          taskIndex,
          plannedTaskCount: taskTargets.length,
        });

        for (const local of businesses) {
          if (
            taskInspectedResults >= taskResultAllowance ||
            !canInspectEdgeDiscoveryResult(inspectedResultCount)
          ) {
            break;
          }

          const persistResult = await persistEdgeDiscoveryBusiness({
            runId,
            taskId: asString(task.id),
            icpProfileId: icp.id,
            queryHash,
            local,
            now: new Date().toISOString(),
          });
          inspectedResultCount += 1;
          scoredResults += 1;
          taskInspectedResults += 1;
          taskScoredResults += 1;
          scoreBandCounts[
            persistResult.scoreBand.toLowerCase() as "high" | "medium" | "low"
          ] += 1;
          persistedProviderIds.push(local.providerRecordId);
          if (persistResult.status === "already_known") {
            alreadyKnown += 1;
            taskAlreadyKnown += 1;
            continue;
          }
          processedItems += 1;
          newBusinesses += 1;
          taskNewBusinesses += 1;
          converted += 1;
        }

        try {
          await insertRow<Row>("discovery_cost_events", {
            id: newId("cost"),
            discoveryRunId: runId,
            provider: "SERPAPI",
            costCents: 0,
            apiCallType: "google_maps_search",
            businessId: null,
            leadId: null,
            recordedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          });
        } catch (costError) {
          console.error("[demo-edge-api] discovery cost telemetry failed", {
            runId,
            taskId: asString(task.id),
            error: costError,
          });
        }

        await updateRows<Row>(
          "search_tasks",
          { id: `eq.${asString(task.id)}` },
          {
            status: "DONE",
            params_json: {
              ...taskParams,
              resultsCount: taskInspectedResults,
              scoredCount: taskScoredResults,
              alreadyKnownCount: taskAlreadyKnown,
              newBusinessCount: taskNewBusinesses,
            },
            last_result_hash: edgeHash(JSON.stringify(persistedProviderIds)),
            error: null,
            updated_at: new Date().toISOString(),
          },
        );
      } catch (error) {
        failedItems += 1;
        console.error("[demo-edge-api] discovery task failed", {
          runId,
          taskId: asString(task.id),
          error,
        });
        const message = toPublicOperationalError(
          error instanceof Error ? error.message : "Discovery task failed",
          "search_task",
        ) ?? "This search task could not be completed.";
        errors.push(message);
        await updateRows<Row>(
          "search_tasks",
          { id: `eq.${asString(task.id)}` },
          {
            status: "FAILED",
            params_json: {
              ...taskParams,
              resultsCount: taskInspectedResults,
              scoredCount: taskScoredResults,
              alreadyKnownCount: taskAlreadyKnown,
              newBusinessCount: taskNewBusinesses,
            },
            error: message,
            updated_at: new Date().toISOString(),
          },
        );
      }
    }

    const finishedAt = new Date().toISOString();
    const totalFound = inspectedResultCount;
    const terminalStatus = resolveEdgeDiscoveryTerminalStatus({
      taskCount,
      failedTaskCount: failedItems,
      persistedResultCount: inspectedResultCount,
    });
    const storedErrors = uniqueErrorMessages(errors);
    await updateRows<Row>("JobExecution", { id: `eq.${runId}` }, {
      status: terminalStatus,
      result: {
        totalItems: totalFound,
        processedItems: totalFound,
        failedItems,
        totalFound,
        scoredResults,
        scoreBandCounts,
        alreadyKnown,
        newFound: processedItems,
        newBusinesses,
        disqualified: 0,
        converted,
        searchTasksComplete: true,
        provider: "SERPAPI",
        edgeMode: true,
        taskCount,
      },
      error: storedErrors.length > 0
        ? toPublicOperationalError(storedErrors.join("; "), "discovery_run")
        : null,
      finishedAt,
      updatedAt: finishedAt,
    });
    if (publicDemoContext) {
      await updatePublicDemoAdmission(
        runId,
        terminalStatus === "failed" ? "failed" : "completed",
      );
    }

    return jsonResponse({
      runId,
      status: terminalStatus === "failed"
        ? "FAILED"
        : failedItems > 0
        ? "PARTIAL"
        : "SUCCEEDED",
    }, 201);
  } catch (error: unknown) {
    const failedAt = new Date().toISOString();
    try {
      await updateRows<Row>("JobExecution", { id: `eq.${runId}` }, {
        status: "failed",
        error: toPublicOperationalError(
          error instanceof Error
            ? error.message
            : "Discovery execution stopped unexpectedly",
          "discovery_run",
        ),
        finishedAt: failedAt,
        updatedAt: failedAt,
      });
      if (publicDemoContext) {
        await updatePublicDemoAdmission(runId, "failed");
      }
    } catch (finalizationError) {
      console.error("[demo-edge-api] discovery failure finalization failed", {
        runId,
        error: finalizationError,
      });
    }
    throw error;
  }
}

async function handleDiscoveryRuns(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 50);
  const result = await listRows("JobExecution", {
    select: "*",
    type: "eq.discovery.run",
    order: "createdAt.desc",
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

async function handlePublicDemoDiscoveryRuns(
  url: URL,
  context: PublicDemoContext,
): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 20);
  const listSessionRuns = () =>
    listRows("JobExecution", {
      select: "*",
      type: "eq.discovery.run",
      "payload->>publicDemo": "eq.true",
      "payload->>publicDemoSessionHash": `eq.${context.sessionHash}`,
      order: "createdAt.desc",
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
  let result = await listSessionRuns();
  const staleBefore = Date.now() - PUBLIC_DEMO_STALE_RUN_MS;
  const hasStaleRun = result.data.some((row) => {
    const status = asString(row.status).toLowerCase();
    const updatedAt = Date.parse(asString(row.updatedAt));
    return (
      (status === "queued" || status === "running") &&
      Number.isFinite(updatedAt) &&
      updatedAt < staleBefore
    );
  });
  if (hasStaleRun) {
    await reconcileStalePublicDemoRuns(context);
    result = await listSessionRuns();
  }
  const completedRunIds = result.data
    .filter((row) => asString(row.status).toLowerCase() === "completed")
    .map((row) => asString(row.id))
    .filter(Boolean);
  const failedRunIds = result.data
    .filter((row) =>
      ["failed", "cancelled"].includes(asString(row.status).toLowerCase())
    )
    .map((row) => asString(row.id))
    .filter(Boolean);
  const admissionFinishedAt = new Date().toISOString();
  await Promise.all([
    completedRunIds.length > 0
      ? updateRows<Row>("public_demo_discovery_admissions", {
        run_id: pgIn(completedRunIds),
      }, {
        state: "completed",
        updated_at: admissionFinishedAt,
        expires_at: admissionFinishedAt,
      })
      : Promise.resolve([]),
    failedRunIds.length > 0
      ? updateRows<Row>("public_demo_discovery_admissions", {
        run_id: pgIn(failedRunIds),
      }, {
        state: "failed",
        updated_at: admissionFinishedAt,
        expires_at: admissionFinishedAt,
      })
      : Promise.resolve([]),
  ]);
  return jsonResponse({
    runs: result.data.map(mapDiscoveryRun),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handlePublicDemoDiscoveryIcps(url: URL): Promise<Response> {
  void url;
  const page = 1;
  const pageSize = PUBLIC_DEMO_ICP_PRESENTATIONS.length;
  const result = await listRows("IcpProfile", {
    select:
      "id,name,qualificationLogic,targetIndustries,targetCountries,minCompanySize,maxCompanySize,isActive,createdAt,updatedAt",
    isActive: "eq.true",
    order: "name.asc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });
  return jsonResponse({
    items: result.data.map((row) => {
      const presentation = getPublicDemoIcpPresentation(asString(row.name));
      return {
        id: asString(row.id),
        name: presentation?.name ?? asString(row.name),
        description: presentation?.description ?? null,
        qualificationLogic: asString(row.qualificationLogic, "WEIGHTED"),
        metadataJson: null,
        targetIndustries: presentation
          ? [...presentation.targetIndustries]
          : asArray<string>(row.targetIndustries),
        targetCountries: presentation
          ? ["US"]
          : asArray<string>(row.targetCountries),
        minCompanySize: presentation?.minCompanySize ??
          asNullableNumber(row.minCompanySize),
        maxCompanySize: presentation?.maxCompanySize ??
          asNullableNumber(row.maxCompanySize),
        requiredTechnologies: [],
        excludedDomains: [],
        featureList: null,
        isActive: true,
        createdByUserId: null,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      };
    }),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handlePublicDemoDiscoverySettings(): Promise<Response> {
  const row = await singleRow("pipeline_settings", {
    select: "key,valueJson,updatedAt",
    key: "eq.countryCities",
  });
  return jsonResponse({
    items: row
      ? [{
        key: "countryCities",
        value: sanitizePublicOperationalJson(row.valueJson ?? null),
        updatedAt: iso(row.updatedAt),
      }]
      : [],
  });
}

async function handlePublicDemoDiscoveryRunPerformance(
  runId: string,
  context: PublicDemoContext,
): Promise<Response> {
  const run = await singleRow("JobExecution", {
    select: "*",
    id: `eq.${runId}`,
    type: "eq.discovery.run",
    "payload->>publicDemo": "eq.true",
    "payload->>publicDemoSessionHash": `eq.${context.sessionHash}`,
  });
  if (!run) {
    throw new HttpError(404, "Discovery run not found");
  }

  const payload = asObject(run.payload) ?? {};
  const result = asObject(run.result) ?? {};
  const icpProfileId = asNullableString(payload.icpProfileId);
  const [tasks, icp, attributions] = await Promise.all([
    listRows("search_tasks", {
      select:
        "id,query_text,country_code,city,status,task_type,params_json,created_at,updated_at",
      discovery_run_id: `eq.${runId}`,
      order: "created_at.asc",
      limit: EDGE_DISCOVERY_MAX_SEARCH_TASKS,
    }),
    icpProfileId
      ? singleRow("IcpProfile", { select: "name", id: `eq.${icpProfileId}` })
      : Promise.resolve(null),
    listRows("discovery_attribution_assignments", {
      select:
        "business_id,icp_profile_id,search_task_id,primary_outcome_code,assigned_at",
      discovery_run_id: `eq.${runId}`,
      order: "assigned_at.asc",
      limit: 200,
    }),
  ]);
  const attributedBusinessIds = [
    ...new Set(
      attributions.data
        .map((row) => asString(row.business_id))
        .filter(Boolean),
    ),
  ];
  const businesses = attributedBusinessIds.length > 0
    ? await listRows("businesses", {
      select:
        "id,discovery_run_id,website_scraped_at,apify_website_scrape_json",
      id: pgIn(attributedBusinessIds),
      limit: 200,
    })
    : { data: [], total: 0 } satisfies RestResult<Row[]>;
  const conversions = attributedBusinessIds.length > 0
    ? await listRows("business_conversions", {
      select: "businessId,leadId,icpProfileId,metadata,convertedAt",
      businessId: pgIn(attributedBusinessIds),
      "metadata->>discoveryRunId": `eq.${runId}`,
      limit: 200,
    })
    : { data: [], total: 0 } satisfies RestResult<Row[]>;
  const convertedLeadIds = [
    ...new Set(
      conversions.data.map((row) => asString(row.leadId)).filter(Boolean),
    ),
  ];
  const startedAt = asNullableString(run.startedAt);
  const finishedAt = asNullableString(run.finishedAt);
  const predictions = convertedLeadIds.length > 0 && startedAt
    ? await listRows("LeadScorePrediction", {
      select: "leadId,icpProfileId,reasonsJson,predictedAt",
      leadId: pgIn(convertedLeadIds),
      predictedAt: `gte.${startedAt}`,
      order: "predictedAt.desc",
      limit: 200,
    })
    : { data: [], total: 0 } satisfies RestResult<Row[]>;
  const latestPredictions = new Map<string, Row>();
  for (const prediction of predictions.data) {
    const key = `${asString(prediction.leadId)}:${
      asString(prediction.icpProfileId)
    }`;
    if (!latestPredictions.has(key)) {
      latestPredictions.set(key, prediction);
    }
  }
  const scoringSources = {
    openAi: 0,
    trainedModel: 0,
    deterministicFallback: 0,
  };
  for (const prediction of latestPredictions.values()) {
    const scoreSource = asString(asObject(prediction.reasonsJson)?.scoreSource);
    if (scoreSource === "llm") {
      scoringSources.openAi += 1;
    } else if (scoreSource === "trained_model") {
      scoringSources.trainedModel += 1;
    } else {
      scoringSources.deterministicFallback += 1;
    }
  }
  const taskBudget = asNumber(
    payload.limit,
    EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS,
  );
  const workerPipelineRun =
    asString(payload.executionVersion) === "production-worker-v1";
  const workerBusinessCounts = resolveWorkerDiscoveryBusinessCounts(
    businesses.data,
    runId,
  );
  const resultsInspected = workerPipelineRun && attributions.data.length > 0
    ? attributedBusinessIds.length
    : asNumber(result.totalFound);
  const scoredResults = workerPipelineRun
    ? latestPredictions.size
    : asNumber(result.scoredResults);
  const tasksExecuted =
    tasks.data.filter((row) =>
      ["DONE", "SKIPPED", "FAILED"].includes(asString(row.status).toUpperCase())
    ).length;
  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const finishedAtMs = finishedAt ? Date.parse(finishedAt) : Number.NaN;
  const scrapeWindowEndMs = Number.isFinite(finishedAtMs)
    ? finishedAtMs
    : Date.now();
  const websitesScraped = businesses.data.filter((row) => {
    const websiteScrapedAt = asNullableString(row.website_scraped_at);
    if (!websiteScrapedAt || !Number.isFinite(startedAtMs)) {
      return false;
    }
    const websiteScrapedAtMs = Date.parse(websiteScrapedAt);
    return Number.isFinite(websiteScrapedAtMs) &&
      websiteScrapedAtMs >= startedAtMs &&
      websiteScrapedAtMs <= scrapeWindowEndMs;
  }).length;
  const durationMs =
    Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
      ? Math.max(0, finishedAtMs - startedAtMs)
      : null;
  const fullPipelineRun =
    asString(payload.executionVersion) === "full-discovery-scoring-v1";
  const stoppedAtResultCap = !fullPipelineRun &&
    resultsInspected >= EDGE_DISCOVERY_MAX_RESULTS &&
    tasksExecuted < taskBudget;
  const scoreSourceSummary = [
    scoringSources.openAi > 0 ? `${scoringSources.openAi} OpenAI` : null,
    scoringSources.trainedModel > 0
      ? `${scoringSources.trainedModel} trained-model`
      : null,
    scoringSources.deterministicFallback > 0
      ? `${scoringSources.deterministicFallback} deterministic fallback`
      : null,
  ].filter((value): value is string => value !== null).join(", ");
  const stopReason =
    workerPipelineRun && asString(run.status).toLowerCase() === "running"
      ? `The production worker is executing the five-task discovery, website-analysis, feature, and scoring pipeline. Persisted evidence below updates as each stage finishes.`
      : workerPipelineRun && asString(run.status).toLowerCase() === "queued"
      ? "The durable production run is queued and waiting for a discovery worker."
      : workerPipelineRun && asString(run.status).toLowerCase() === "completed"
      ? `The production worker completed ${tasksExecuted} SerpAPI task${
        tasksExecuted === 1 ? "" : "s"
      }, ${websitesScraped} fresh website scrape${
        websitesScraped === 1 ? "" : "s"
      }, and ${scoredResults} scored lead${scoredResults === 1 ? "" : "s"}${
        scoreSourceSummary ? ` (${scoreSourceSummary})` : ""
      }.`
      : workerPipelineRun
      ? "The production pipeline stopped before every discovery stage could complete."
      : fullPipelineRun && tasksExecuted >= taskBudget
      ? `All ${tasksExecuted} provider tasks completed, and ${scoredResults} inspected results passed deterministic fit scoring before deduplication and lead creation.`
      : stoppedAtResultCap
      ? `This legacy demo run used ${tasksExecuted} of ${taskBudget} available tasks because it stopped after reaching the ${EDGE_DISCOVERY_MAX_RESULTS}-result safety cap.`
      : tasksExecuted >= taskBudget
      ? `All ${tasksExecuted} provider search tasks completed within the configured budget.`
      : asString(run.status).toLowerCase() === "failed"
      ? "The run stopped after a provider task did not complete."
      : "The run completed after exhausting the available targeting combinations.";

  const sourceIcpName = asNullableString(icp?.name);
  return jsonResponse({
    run: mapDiscoveryRun(run),
    icpName: getPublicDemoIcpPresentation(sourceIcpName)?.name ?? sourceIcpName,
    provider: asString(result.provider, "SERPAPI"),
    taskBudget,
    tasksExecuted,
    resultsInspected,
    scoredResults,
    alreadyKnown: workerPipelineRun
      ? workerBusinessCounts.alreadyKnown
      : asNumber(result.alreadyKnown),
    newBusinesses: workerPipelineRun
      ? workerBusinessCounts.newBusinesses
      : asNumber(result.newBusinesses),
    leadsCreated: asNumber(result.converted),
    websitesScraped,
    pipelineMode: workerPipelineRun ? "production_worker" : "edge_legacy",
    scoringSources,
    durationMs,
    stopReason,
    tasks: tasks.data.map((row) => {
      const taskStartedAt = iso(firstValue(row, "created_at", "createdAt"));
      const terminal = ["DONE", "SKIPPED", "FAILED"].includes(
        asString(row.status).toUpperCase(),
      );
      const taskFinishedAt = terminal
        ? iso(firstValue(row, "updated_at", "updatedAt"))
        : null;
      const taskStartedAtMs = Date.parse(taskStartedAt);
      const taskFinishedAtMs = taskFinishedAt
        ? Date.parse(taskFinishedAt)
        : Number.NaN;
      const params = asObject(row.params_json) ?? {};
      const taskId = asString(row.id);
      const taskAttributions = attributions.data.filter(
        (attribution) => asString(attribution.search_task_id) === taskId,
      );
      const taskBusinessIds = new Set(
        taskAttributions.map((attribution) => asString(attribution.business_id))
          .filter(Boolean),
      );
      const taskLeadIds = new Set(
        conversions.data
          .filter((conversion) =>
            taskBusinessIds.has(asString(conversion.businessId))
          )
          .map((conversion) => asString(conversion.leadId))
          .filter(Boolean),
      );
      const taskScoredCount = [...latestPredictions.values()].filter(
        (prediction) => taskLeadIds.has(asString(prediction.leadId)),
      ).length;
      return {
        id: taskId,
        queryText: asString(row.query_text),
        countryCode: asString(row.country_code),
        city: asNullableString(row.city),
        status: asString(row.status),
        provider: asString(
          params.providerUsed,
          asString(params.provider, "SERPAPI"),
        ),
        resultsCount: workerPipelineRun
          ? taskBusinessIds.size
          : asNullableNumber(params.resultsCount) ??
            (tasksExecuted === 1 ? resultsInspected : null),
        scoredCount: workerPipelineRun
          ? taskScoredCount
          : asNumber(params.scoredCount),
        startedAt: taskStartedAt,
        finishedAt: taskFinishedAt,
        durationMs:
          Number.isFinite(taskStartedAtMs) && Number.isFinite(taskFinishedAtMs)
            ? Math.max(0, taskFinishedAtMs - taskStartedAtMs)
            : null,
      };
    }),
  });
}

async function handleDiscoveryRunStatus(runId: string): Promise<Response> {
  const row = await singleRow("JobExecution", {
    select: "*",
    id: `eq.${runId}`,
    type: "eq.discovery.run",
  });
  if (!row) throw new HttpError(404, "Discovery run not found");
  return jsonResponse(mapDiscoveryRunStatus(row));
}

async function handleDiscoveryRunDetails(runId: string): Promise<Response> {
  const run = await singleRow("JobExecution", {
    select: "*",
    id: `eq.${runId}`,
    type: "eq.discovery.run",
  });
  if (!run) throw new HttpError(404, "Discovery run not found");

  const [tasks, businesses, costs] = await Promise.all([
    listRows("search_tasks", {
      select: "*",
      discovery_run_id: `eq.${runId}`,
      order: "updated_at.desc",
      limit: 200,
    }),
    listRows("businesses", {
      select: "*",
      discovery_run_id: `eq.${runId}`,
      order: "deterministic_score.desc,updated_at.desc",
      limit: 200,
    }),
    listRows("discovery_cost_events", {
      select: "*",
      discoveryRunId: `eq.${runId}`,
      order: "createdAt.desc",
      limit: 200,
    }),
  ]);
  const normalizedBusinesses = businesses.data.map((row) =>
    normalizeBusinessRow(row) as Row
  );
  const businessById = new Map(
    normalizedBusinesses.map((row) => [asString(row.id), row]),
  );
  const businessIds = normalizedBusinesses.map((row) => asString(row.id))
    .filter(Boolean);
  const leads = businessIds.length > 0
    ? await listRows("Lead", {
      select:
        "id,firstName,lastName,email,businessEmail,source,status,businessId",
      businessId: pgIn(businessIds),
      deletedAt: "is.null",
      order: "createdAt.desc,id.desc",
      limit: 200,
    })
    : { data: [], total: 0 } satisfies RestResult<Row[]>;

  return jsonResponse({
    run: mapDiscoveryRunDetailStatus(run),
    searchTasks: tasks.data.map((row) => ({
      id: asString(row.id),
      queryText: asString(row.query_text),
      countryCode: asString(row.country_code),
      city: asNullableString(row.city),
      status: asString(row.status),
      resultsCount: 0,
      provider: asString(row.task_type),
      error: toPublicOperationalError(
        asNullableString(row.error),
        "search_task",
      ),
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
          email: asString(row.email, "unknown@example.invalid"),
          businessEmail: asNullableString(row.businessEmail),
          source: asString(row.source, "demo"),
          blendedScore: null,
          scoreBand: null,
          status: asString(row.status),
          businessId: asString(row.businessId),
          businessName: asString(business?.name),
          businessDeterministicScore: asNullableNumber(
            business?.deterministicScore,
          ),
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
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "discoveredAt.desc,createdAt.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (const key of ["leadId", "icpProfileId", "provider", "status"]) {
    const value = url.searchParams.get(key);
    if (value) params[key] = `eq.${value}`;
  }
  const result = await listRows("LeadDiscoveryRecord", params);
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
      status: asString(row.status, "DISCOVERED"),
      rawPayload: sanitizePublicOperationalJson(row.rawPayload ?? {}),
      provenanceJson: sanitizePublicOperationalJson(row.provenanceJson ?? null),
      errorMessage: toPublicOperationalError(
        asNullableString(row.errorMessage),
        "discovery_record",
      ),
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
  const [discovered, enriched, scored, messaged, draftCount] = await Promise
    .all([
      countRows("Lead", { deletedAt: "is.null" }),
      countRows("Lead", {
        deletedAt: "is.null",
        status: pgIn(ENRICHED_LEAD_STATUSES),
      }),
      countRows("Lead", {
        deletedAt: "is.null",
        status: pgIn(SCORED_LEAD_STATUSES),
      }),
      countRows("Lead", {
        deletedAt: "is.null",
        status: pgIn(MESSAGED_LEAD_STATUSES),
      }),
      countRows("MessageDraft", { approvalStatus: "eq.PENDING" }),
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
  const result = await listRows("pipeline_settings", {
    select: "*",
    order: "key.asc",
    limit: 200,
  });
  return jsonResponse({
    items: result.data
      .filter((row) => isPublicPipelineSettingKey(row.key))
      .map((row) => ({
        key: asString(row.key),
        value: sanitizePublicOperationalJson(row.valueJson ?? null),
        updatedAt: iso(row.updatedAt),
      })),
  });
}

async function handleSetting(key: string): Promise<Response> {
  if (!isPublicPipelineSettingKey(key)) {
    throw new HttpError(404, "Pipeline setting not found");
  }
  const row = await singleRow("pipeline_settings", {
    select: "*",
    key: `eq.${key}`,
  });
  if (!row) throw new HttpError(404, "Pipeline setting not found");
  return jsonResponse({
    key: asString(row.key),
    value: sanitizePublicOperationalJson(row.valueJson ?? null),
    updatedAt: iso(row.updatedAt),
  });
}

async function handleAdminLeads(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    offset: (page - 1) * pageSize,
    limit: pageSize,
    order: adminBusinessOrder(url.searchParams.get("sortBy")),
  };
  const countries = csv(url.searchParams.get("countries")).map((country) =>
    country.toUpperCase()
  );
  if (countries.length > 0) params.country_code = pgIn(countries);
  const city = url.searchParams.get("city");
  if (city) params.city = `ilike.${ilikePattern(city)}`;
  const scoreMin = url.searchParams.get("scoreMin");
  if (scoreMin) params.deterministic_score = `gte.${scoreMin}`;
  const hasWhatsapp = url.searchParams.get("hasWhatsapp");
  if (hasWhatsapp !== null) {
    params.has_whatsapp = `eq.${hasWhatsapp === "true"}`;
  }
  const result = await listRows("businesses", params);
  return jsonResponse({
    items: result.data.map(mapAdminLead),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

function adminBusinessOrder(sortBy: string | null): string {
  if (sortBy === "recent") return "updated_at.desc,id.desc";
  if (sortBy === "review_count") {
    return "review_count.desc,deterministic_score.desc,id.desc";
  }
  if (sortBy === "score_desc") {
    return "deterministic_score.desc,updated_at.desc,id.desc";
  }
  return "created_at.desc,id.desc";
}

async function handleAdminLeadDetail(id: string): Promise<Response> {
  const business = await singleRow("businesses", {
    select: "*",
    id: `eq.${id}`,
  });
  if (!business) throw new HttpError(404, "Lead not found");
  const normalizedBusiness = normalizeBusinessRow(business) as Row;
  const evidence = await listRows("business_evidence", {
    select: "*",
    business_id: `eq.${id}`,
    order: "created_at.desc",
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
      rawJson: sanitizePublicOperationalJson(row.raw_json ?? {}),
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
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 30, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "updated_at.desc,id.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const q = url.searchParams.get("q");
  if (q) {
    const pattern = ilikePattern(q);
    params.or =
      `(name.ilike.${pattern},category.ilike.${pattern},website_domain.ilike.${pattern},city.ilike.${pattern},instagram_handle.ilike.${pattern})`;
  }
  const result = await listRows("businesses", params);
  const businessIds = result.data.map((row) => asString(row.id)).filter(
    Boolean,
  );
  const [leadRows, scores, recoveries] = await Promise.all([
    listRows("Lead", {
      select: "id,businessId",
      businessId: pgIn(businessIds),
      limit: MAX_DEMO_ROWS,
    }),
    listRows("LeadScorePrediction", {
      select: "leadId,blendedScore",
      limit: MAX_DEMO_ROWS,
    }),
    listRows("contact_recovery_items", {
      select: "*",
      business_id: pgIn(businessIds),
      limit: MAX_DEMO_ROWS,
    }),
  ]);
  const leadByBusiness = new Map(
    leadRows.data.map((row) => [asString(row.businessId), row]),
  );
  const scoreByLead = new Map(
    scores.data.map((
      row,
    ) => [asString(row.leadId), asNullableNumber(row.blendedScore)]),
  );
  const recoveryByBusiness = new Map(
    recoveries.data.map((row) => [asString(row.business_id), row]),
  );
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
  const business = await singleRow("businesses", {
    select: "*",
    id: `eq.${id}`,
  });
  if (!business) throw new HttpError(404, "Business not found");
  const contacts = await listRows("business_contacts", {
    select: "*",
    businessId: `eq.${id}`,
    order: "positionRank.asc,name.asc",
    limit: 100,
  });
  return jsonResponse({
    business: mapAdminBusiness(business),
    selectedContacts: contacts.data.map(mapBusinessContact),
  });
}

async function handleSearchTasks(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: url.searchParams.get("sortBy") === "attempts_desc"
      ? "attempts.desc,updated_at.desc"
      : url.searchParams.get("sortBy") === "run_after_asc"
      ? "run_after.asc,updated_at.desc"
      : "updated_at.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  for (
    const [queryKey, column] of [
      ["status", "status"],
      ["taskType", "task_type"],
      ["countryCode", "country_code"],
      ["timeBucket", "time_bucket"],
    ] as const
  ) {
    const value = url.searchParams.get(queryKey);
    if (value) params[column] = `eq.${value}`;
  }
  const result = await listRows("search_tasks", params);
  return jsonResponse({
    items: result.data.map(mapSearchTask),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleSearchTaskDetail(id: string): Promise<Response> {
  const task = await singleRow("search_tasks", { select: "*", id: `eq.${id}` });
  if (!task) throw new HttpError(404, "Search task not found");
  return jsonResponse({
    task: {
      ...mapSearchTask(task),
      paramsJson: sanitizePublicOperationalJson(task.params_json ?? {}),
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
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "started_at.desc,id.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const status = url.searchParams.get("status");
  if (status) params.status = `eq.${status}`;
  const jobName = url.searchParams.get("jobName");
  if (jobName) params.job_name = `eq.${jobName}`;
  const result = await listRows("job_runs", params);
  return jsonResponse({
    items: result.data.map(mapJobRun),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

async function handleJobRunDetail(id: string): Promise<Response> {
  const row = await singleRow("job_runs", { select: "*", id: `eq.${id}` });
  if (!row) throw new HttpError(404, "Job run not found");
  return jsonResponse({ run: mapJobRun(row) });
}

async function handleJobRequests(url: URL): Promise<Response> {
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20, 100);
  const params: Record<string, string | number> = {
    select: "*",
    order: "created_at.desc,id.desc",
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const status = url.searchParams.get("status");
  if (status) params.status = `eq.${status}`;
  const requestType = url.searchParams.get("requestType");
  if (requestType) params.request_type = `eq.${requestType}`;
  const result = await listRows("job_requests", params);
  return jsonResponse({
    items: result.data.map(mapJobRequest),
    page,
    pageSize,
    total: result.total ?? result.data.length,
  });
}

const DEMO_DASHBOARD_SNAPSHOT_VERSION = "2026.08.two-month-db-anchored.v5";
const DEMO_DASHBOARD_GENERATED_AT = "2026-08-01T14:00:00.000Z";

const DEMO_OPERATIONS_DASHBOARD_SNAPSHOT = {
  id: "demo-dashboard-operations-2026-08",
  workspaceSlug: "leadzilla-recruiter-demo",
  version: DEMO_DASHBOARD_SNAPSHOT_VERSION,
  kind: "operations",
  generatedAt: DEMO_DASHBOARD_GENERATED_AT,
  headline: {
    title: "Operations",
    eyebrow: "Operations",
    summary:
      "Discovery, scoring, review, and historical outcomes across June – July 2026.",
    status: "Two-month operating view",
  },
  metrics: [
    {
      id: "source-inventory",
      label: "Database leads",
      value: "5,007",
      unit: "leads",
      detail:
        "A curated two-month lead inventory for the recruiter-demo workspace.",
      tone: "teal",
    },
    {
      id: "discovered-leads",
      label: "Screened universe",
      value: "5,007",
      unit: "leads",
      detail: "Active, non-deleted database leads in the screening population.",
      tone: "green",
    },
    {
      id: "enriched-scored",
      label: "Scored profiles",
      value: "4,528",
      unit: "profiles",
      detail:
        "Businesses with enough public context to receive a Leadzilla fit score.",
      tone: "blue",
    },
    {
      id: "drafts-generated",
      label: "AI drafts generated",
      value: "189",
      unit: "drafts",
      detail: "OpenAI-assisted outreach drafts prepared for operator review.",
      tone: "purple",
    },
    {
      id: "pending-review",
      label: "Pending review",
      value: "12",
      unit: "drafts",
      detail: "Three drafts are older than the 24-hour review target.",
      tone: "amber",
    },
  ],
  pipeline: [
    {
      id: "discover",
      label: "Discover",
      count: 5007,
      displayValue: "5,007",
      caption: "SERP discovery and dedupe",
      status: "Ready",
      health: "healthy",
    },
    {
      id: "enrich",
      label: "Enrich",
      count: 4528,
      displayValue: "4,528",
      caption: "Contacts, domains, and business context",
      status: "Enabled",
      health: "healthy",
    },
    {
      id: "score",
      label: "Score",
      count: 4528,
      displayValue: "4,528",
      caption: "Model and rule-based lead fit",
      status: "Enabled",
      health: "healthy",
    },
    {
      id: "draft",
      label: "Draft",
      count: 189,
      displayValue: "189",
      caption: "OpenAI-assisted message generation",
      status: "Ready",
      health: "healthy",
    },
    {
      id: "review",
      label: "Review",
      count: 177,
      displayValue: "177",
      caption: "12 drafts remain in the operator queue",
      status: "93.7% reviewed",
      health: "healthy",
    },
  ],
  queues: [
    {
      id: "discovery-capacity",
      label: "Discovery capacity",
      value: "Small-run enabled",
      detail:
        "Users can launch bounded discovery jobs without worker-backed delivery.",
    },
    {
      id: "draft-generation",
      label: "Draft generation",
      value: "OpenAI wired",
      detail:
        "Drafts use a frontier OpenAI model through the Supabase Edge API.",
    },
    {
      id: "review-queue",
      label: "Review queue",
      value: "12 waiting",
      detail:
        "Three drafts are older than 24 hours; delivery remains disabled.",
    },
  ],
  systemHealth: [
    {
      id: "edge-api",
      label: "Supabase Edge API",
      status: "Operational",
      detail:
        "Dashboard and workspace actions are served through the Supabase Edge Function.",
      tone: "green",
    },
    {
      id: "openai-drafting",
      label: "OpenAI drafting",
      status: "Enabled",
      detail:
        "Message drafts can be generated from lead, ICP, and prompt context.",
      tone: "green",
    },
    {
      id: "discovery-provider",
      label: "Discovery provider",
      status: "Bounded",
      detail:
        "Small SerpAPI discovery jobs are enabled for bounded exploration.",
      tone: "teal",
    },
    {
      id: "outbound-delivery",
      label: "Outbound delivery",
      status: "Disabled",
      detail:
        "Email, SMS, WhatsApp, provider delivery, follow-ups, and message.send remain blocked.",
      tone: "amber",
    },
  ],
  recentRuns: [
    {
      id: "demo-run-2026-06-initial-inventory",
      title: "June · Initial scored inventory",
      status: "Complete",
      found: 2214,
      converted: 1999,
      detail:
        "1,999 scored and 1,150 high-priority leads in the initial operating cohort.",
    },
    {
      id: "demo-run-2026-07-icp-expansion",
      title: "July · ICP expansion and review",
      status: "Complete",
      found: 2793,
      converted: 2529,
      detail:
        "2,529 scored and 1,378 high-priority leads in the latest completed month.",
    },
  ],
  safety: {
    title: "Demo safety boundary",
    status: "Outbound delivery locked",
    detail:
      "Discovery, enrichment, scoring, and draft generation are enabled. Email, SMS, WhatsApp, provider delivery calls, follow-up delivery, and message.send publishing are disabled.",
  },
} satisfies JsonObject;

const DEMO_ANALYTICS_DASHBOARD_SNAPSHOT = {
  id: "demo-dashboard-analytics-2026-08",
  workspaceSlug: "leadzilla-recruiter-demo",
  version: DEMO_DASHBOARD_SNAPSHOT_VERSION,
  kind: "analytics",
  generatedAt: DEMO_DASHBOARD_GENERATED_AT,
  headline: {
    title: "Analytics Dashboard",
    eyebrow: "Curated GTM snapshot",
    summary:
      "Executive view of market coverage, lead quality, review throughput, and historical outcomes across June – July 2026.",
    status: "Two-month operating view",
  },
  metrics: [
    {
      id: "qualified-rate",
      label: "Priority rate",
      value: "55.8%",
      detail: "2,528 high-fit opportunities from 4,528 scored leads.",
      tone: "teal",
    },
    {
      id: "avg-fit-score",
      label: "Average lead score",
      value: "0.67",
      detail:
        "Weighted Leadzilla fit score across the screened business universe.",
      tone: "purple",
    },
    {
      id: "priority-leads",
      label: "Priority leads",
      value: "2,528",
      detail: "High-fit leads ready for immediate review and message drafting.",
      tone: "green",
    },
    {
      id: "filtered-out",
      label: "Rejected",
      value: "479",
      detail: "Database leads held in the separate rejected-review lane.",
      tone: "amber",
    },
  ],
  leadFlow: {
    totalBusinesses: 5007,
    evaluated: 4528,
    outsideFlow: 0,
    qualified: 2528,
    notQualified: 479,
    high: 2528,
    medium: 1845,
    low: 155,
    unbanded: 0,
  },
  scoreBands: [
    {
      id: "high",
      label: "High fit",
      count: 2528,
      percent: 56,
      detail: "Best accounts for immediate review and high-context drafting.",
      tone: "green",
    },
    {
      id: "medium",
      label: "Medium fit",
      count: 1845,
      percent: 41,
      detail: "Solid-fit businesses for segment-specific campaigns.",
      tone: "amber",
    },
    {
      id: "low",
      label: "Low fit",
      count: 155,
      percent: 3,
      detail: "Lower-priority leads kept out of active outreach lanes.",
      tone: "red",
    },
  ],
  icpPerformance: [
    {
      id: "boutique-hotels-vacation-rentals",
      name: "Boutique Hotels & Vacation Rentals",
      scored: 1240,
      avgScore: 0.700,
      qualifiedRate: 59,
      qualified: 728,
      insight:
        "The largest priority cohort, with portfolio scale and visible guest-acquisition signals supporting focused operator follow-up.",
    },
    {
      id: "commercial-solar-roofing-contractors",
      name: "Commercial Solar & Roofing Contractors",
      scored: 1170,
      avgScore: 0.680,
      qualifiedRate: 57,
      qualified: 663,
      insight:
        "A deep regional contractor cohort with high-value project signals and enough commercial context for territory-focused review.",
    },
    {
      id: "b2b-saas-developer-platforms",
      name: "B2B SaaS & Developer Platforms",
      scored: 1070,
      avgScore: 0.650,
      qualifiedRate: 55,
      qualified: 586,
      insight:
        "Technical vendors form a balanced priority cohort for product-signal research and buying-committee messaging tests.",
    },
    {
      id: "multi-location-dental-groups",
      name: "Multi-Location Dental Groups",
      scored: 1048,
      avgScore: 0.640,
      qualifiedRate: 53,
      qualified: 551,
      insight:
        "A selective healthcare-services segment where location growth and centralized operations support a measured regional motion.",
    },
  ],
  outcomeSummary: [
    {
      id: "drafts",
      label: "Drafts generated",
      value: "189",
      detail:
        "Actual OpenAI-assisted draft records in the demo database snapshot.",
    },
    {
      id: "replies",
      label: "Replies",
      value: "23",
      detail: "Historical replies from the two-month outreach cohort.",
    },
    {
      id: "sent",
      label: "Messages sent",
      value: "165",
      detail: "Historical messages only; current sending is disabled.",
    },
    {
      id: "meetings",
      label: "Meetings booked",
      value: "6",
      detail: "Confirmed meetings attributed to the historical reply cohort.",
    },
    {
      id: "reply-rate",
      label: "Reply rate",
      value: "13.9%",
      detail:
        "Replies divided by historical delivered messages in the two-month cohort.",
    },
  ],
  recommendations: [
    {
      id: "prioritize-product-led",
      title: "Protect product-led review capacity",
      detail:
        "728 priority accounts make this the deepest immediate-review segment; clear the three overdue drafts before expanding volume.",
    },
    {
      id: "expand-gtm-playbook",
      title: "Expand the mid-market GTM playbook",
      detail:
        "Mid-market GTM teams produced a 57% priority rate: 663 high-fit accounts from 1,170 scored profiles.",
    },
    {
      id: "nurture-medium-fit",
      title: "Build a measured medium-fit nurture lane",
      detail:
        "1,845 medium-fit leads provide enough depth for controlled copy testing without diluting the high-priority review queue.",
    },
  ],
  disqualificationReasons: [],
  safety: {
    title: "Analytics snapshot",
    detail:
      "Metrics are intentionally stable for executive review. Discovery, enrichment, scoring, and drafting can run; outbound delivery remains disabled.",
  },
} satisfies JsonObject;

function handleDemoDashboard(kind: string | undefined): Response {
  if (kind === "operations") {
    return jsonResponse(DEMO_OPERATIONS_DASHBOARD_SNAPSHOT);
  }
  if (kind === "analytics") {
    return jsonResponse(DEMO_ANALYTICS_DASHBOARD_SNAPSHOT);
  }
  throw new HttpError(404, "Demo dashboard snapshot not found");
}

function disabled(): Response {
  return jsonResponse({ error: DEMO_DISABLED_MESSAGE }, 403);
}

async function routePublicDemoRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const routePath = extractRoutePath(url.pathname);
  const parts = pathParts(routePath);
  const method = request.method.toUpperCase();

  if (
    parts.length < 3 ||
    parts.length > 6 ||
    parts[0] !== "v1" ||
    parts[1] !== "demo"
  ) {
    throw new HttpError(404, "Not found");
  }

  const context = await readPublicDemoContext(request);
  if (parts[2] === "leads") {
    if (method === "GET" && parts.length === 3) {
      return handleListLeads(url);
    }
    if (method === "GET" && parts.length === 4 && parts[3]) {
      return handleGetLead(parts[3]);
    }
    if (
      method === "GET" && parts.length === 5 && parts[3] &&
      parts[4] === "latest-score"
    ) {
      return handleLatestLeadScore(parts[3], url);
    }
    if (
      method === "GET" && parts.length === 5 && parts[3] &&
      parts[4] === "latest-feature-snapshot"
    ) {
      return handleLatestLeadFeatureSnapshot(parts[3], url);
    }
    if (
      method === "GET" && parts.length === 5 && parts[3] &&
      parts[4] === "latest-deterministic"
    ) {
      return handleLatestLeadDeterministicScore(parts[3], url);
    }
    if (
      method === "POST" && parts.length === 5 && parts[3] &&
      parts[4] === "enrich"
    ) {
      return handleEnrichLead(parts[3]);
    }
    throw new HttpError(404, "Not found");
  }

  if (parts[2] !== "discovery") {
    throw new HttpError(404, "Not found");
  }
  if (method === "GET" && parts.length === 4 && parts[3] === "icps") {
    return handlePublicDemoDiscoveryIcps(url);
  }
  if (method === "GET" && parts.length === 4 && parts[3] === "settings") {
    return handlePublicDemoDiscoverySettings();
  }
  if (method === "GET" && parts.length === 4 && parts[3] === "runs") {
    return handlePublicDemoDiscoveryRuns(url, context);
  }
  if (
    method === "GET" &&
    parts.length === 6 &&
    parts[3] === "runs" &&
    parts[4] &&
    parts[5] === "performance"
  ) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(parts[4])) {
      throw new HttpError(404, "Not found");
    }
    return handlePublicDemoDiscoveryRunPerformance(parts[4], context);
  }
  if (method === "POST" && parts.length === 4 && parts[3] === "runs") {
    await reconcileStalePublicDemoRuns(context);
    return handleCreateDiscoveryRun(
      request,
      {
        userId: `public-demo:${context.sessionHash.slice(0, 16)}`,
        email: null,
      },
      context,
    );
  }

  throw new HttpError(404, "Not found");
}

async function routeRequest(
  request: Request,
  auth: AuthContext,
): Promise<Response> {
  const url = new URL(request.url);
  const routePath = extractRoutePath(url.pathname);
  const parts = pathParts(routePath);
  const method = request.method.toUpperCase();

  if (routePath === "/health" || routePath === "/ready") {
    return jsonResponse({ ok: true, service: "demo-edge-api" });
  }

  if (parts[0] !== "v1") {
    throw new HttpError(404, "Not found");
  }

  if (
    method === "POST" && parts[1] === "discovery" && parts[2] === "runs" &&
    parts.length === 3
  ) {
    return handleCreateDiscoveryRun(request, auth);
  }

  if (
    method === "POST" && parts[1] === "leads" && parts[2] &&
    parts[3] === "enrich" && parts.length === 4
  ) {
    return handleEnrichLead(parts[2]);
  }

  if (
    method === "POST" && parts[1] === "messaging" && parts[2] === "drafts" &&
    parts[3] === "generate" && parts.length === 4
  ) {
    return handleGenerateDraft(request);
  }

  if (method !== "GET") {
    return disabled();
  }

  if (parts[1] === "demo" && parts[2] === "readiness" && parts.length === 3) {
    return handleDemoReadiness();
  }
  if (parts[1] === "demo" && parts[2] === "dashboard") {
    return handleDemoDashboard(parts[3]);
  }

  if (parts[1] === "icps" && parts.length === 2) return handleListIcps(url);
  if (parts[1] === "icps" && parts[2] && parts.length === 3) {
    return handleGetIcp(parts[2]);
  }
  if (parts[1] === "icps" && parts[2] && parts[3] === "rules") {
    return handleGetIcpRules(parts[2]);
  }

  if (parts[1] === "leads" && parts[2] === "rejected") {
    return handleListRejectedLeads(url);
  }
  if (parts[1] === "leads" && parts[2] === "recovery" && parts[3]) {
    return handleGetContactRecovery(parts[3]);
  }
  if (parts[1] === "leads" && parts[2] === "recovery") {
    return handleListContactRecovery(url);
  }
  if (parts[1] === "leads" && parts.length === 2) return handleListLeads(url);
  if (parts[1] === "leads" && parts[2]) return handleGetLead(parts[2]);

  if (
    parts[1] === "scoring" && parts[2] === "leads" && parts[3] &&
    parts[4] === "latest"
  ) {
    return handleLatestLeadScore(parts[3], url);
  }
  if (
    parts[1] === "scoring" && parts[2] === "leads" && parts[3] &&
    parts[4] === "latest-feature-snapshot"
  ) {
    return handleLatestLeadFeatureSnapshot(parts[3], url);
  }
  if (
    parts[1] === "scoring" && parts[2] === "leads" && parts[3] &&
    parts[4] === "latest-deterministic"
  ) {
    return handleLatestLeadDeterministicScore(parts[3], url);
  }

  if (parts[1] === "messaging" && parts[2] === "drafts" && parts.length === 3) {
    return handleListDrafts(url);
  }
  if (
    parts[1] === "messaging" && parts[2] === "drafts" && parts[3] === "events"
  ) {
    return new Response("event: timeout\ndata: {}\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  }
  if (parts[1] === "messaging" && parts[2] === "drafts" && parts[3]) {
    return handleGetDraft(parts[3]);
  }
  if (parts[1] === "messaging" && parts[2] === "sends") {
    return handleListSends(url);
  }
  if (parts[1] === "messaging" && parts[2] === "conversations" && parts[3]) {
    return handleConversation(parts[3]);
  }

  if (parts[1] === "analytics" && parts[2] === "dashboard-summary") {
    return handleDashboardSummary(url);
  }
  if (parts[1] === "analytics" && parts[2] === "funnel") {
    return handleFunnel(url);
  }
  if (parts[1] === "analytics" && parts[2] === "score-distribution") {
    return handleScoreDistribution(url);
  }
  if (parts[1] === "analytics" && parts[2] === "daily-quality-trends") {
    return handleDailyQualityTrends(url);
  }
  if (parts[1] === "analytics" && parts[2] === "avg-score") {
    return handleAvgScore(url);
  }
  if (parts[1] === "analytics" && parts[2] === "icp-performance") {
    return handleIcpPerformance(url);
  }
  if (parts[1] === "analytics" && parts[2] === "model-metrics") {
    return handleModelMetrics();
  }
  if (parts[1] === "analytics" && parts[2] === "retrain-status") {
    return handleRetrainStatus();
  }
  if (parts[1] === "analytics" && parts[2] === "recommendations") {
    return handleRecommendations(url);
  }

  if (parts[1] === "feedback" && parts[2] === "summary") {
    return handleFeedbackSummary(url);
  }
  if (parts[1] === "feedback" && parts[2] === "events") {
    return handleListFeedbackEvents(url);
  }

  if (
    parts[1] === "discovery" && parts[2] === "runs" && parts[3] &&
    parts[4] === "details"
  ) {
    return handleDiscoveryRunDetails(parts[3]);
  }
  if (parts[1] === "discovery" && parts[2] === "runs" && parts[3]) {
    return handleDiscoveryRunStatus(parts[3]);
  }
  if (parts[1] === "discovery" && parts[2] === "runs") {
    return handleDiscoveryRuns(url);
  }
  if (parts[1] === "discovery" && parts[2] === "records") {
    return handleDiscoveryRecords(url);
  }

  if (parts[1] === "stats" && parts[2] === "pipeline") {
    return handlePipelineStats();
  }
  if (parts[1] === "settings" && parts[2] === "pipeline" && parts[3]) {
    return handleSetting(parts[3]);
  }
  if (parts[1] === "settings" && parts[2] === "pipeline") {
    return handleSettings();
  }

  if (parts[1] === "admin" && parts[2] === "leads" && parts[3]) {
    return handleAdminLeadDetail(parts[3]);
  }
  if (parts[1] === "admin" && parts[2] === "leads") {
    return handleAdminLeads(url);
  }
  if (parts[1] === "admin" && parts[2] === "businesses" && parts[3]) {
    return handleAdminBusinessDetail(parts[3]);
  }
  if (parts[1] === "admin" && parts[2] === "businesses") {
    return handleAdminBusinesses(url);
  }
  if (parts[1] === "admin" && parts[2] === "search-tasks" && parts[3]) {
    return handleSearchTaskDetail(parts[3]);
  }
  if (parts[1] === "admin" && parts[2] === "search-tasks") {
    return handleSearchTasks(url);
  }
  if (
    parts[1] === "admin" && parts[2] === "jobs" && parts[3] === "runs" &&
    parts[4]
  ) return handleJobRunDetail(parts[4]);
  if (parts[1] === "admin" && parts[2] === "jobs" && parts[3] === "runs") {
    return handleJobRuns(url);
  }
  if (parts[1] === "admin" && parts[2] === "jobs" && parts[3] === "requests") {
    return handleJobRequests(url);
  }

  if (parts[1] === "discovery-admin" && parts[2] === "runs" && parts[3]) {
    return handleDiscoveryRunDetails(parts[3]);
  }

  throw new HttpError(404, "Not found");
}

Deno.serve(async (request) => {
  const corsHeaders = buildCorsHeaders(request);
  if (request.method.toUpperCase() === "OPTIONS") {
    return withCors(emptyResponse(), corsHeaders);
  }

  try {
    const routePath = extractRoutePath(new URL(request.url).pathname);
    const response = routePath.startsWith("/v1/demo/")
      ? await routePublicDemoRequest(request)
      : await routeRequest(request, await authenticate(request));
    return withCors(response, corsHeaders);
  } catch (error) {
    return withCors(errorResponse(error), corsHeaders);
  }
});

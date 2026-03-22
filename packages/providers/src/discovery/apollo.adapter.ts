export interface DiscoveryIcpFilters {
  industries?: string[];
  countries?: string[];
  requiredTechnologies?: string[];
  excludedDomains?: string[];
  minCompanySize?: number;
  maxCompanySize?: number;
  includeTerms?: string[];
  excludeTerms?: string[];
}

export interface ApolloDiscoveryRequest {
  icpProfileId?: string;
  limit: number;
  cursor?: string;
  correlationId?: string;
  filters?: DiscoveryIcpFilters;
}

export interface NormalizedDiscoveredLead {
  provider: 'apollo';
  providerRecordId: string;
  firstName: string;
  lastName: string;
  email: string;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companySize: number | null;
  country: string | null;
  raw: unknown;
}

export interface ApolloDiscoveryResult {
  leads: NormalizedDiscoveredLead[];
  nextCursor: string | null;
  rateLimitedUntil: Date | null;
}

export interface ApolloDiscoveryAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  maxPageSize?: number;
  minRequestIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ApolloContactSearchContact {
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  title: string | null;
  companyName: string | null;
}

export type ApolloContactSearchResult =
  | { status: 'success'; contacts: ApolloContactSearchContact[] }
  | {
      status: 'retryable_error';
      failure: { classification: 'retryable'; statusCode: number | null; message: string; raw: unknown };
    }
  | {
      status: 'terminal_error';
      failure: { classification: 'terminal'; statusCode: number | null; message: string; raw: unknown };
    };

export interface ApolloRevealEmailParams {
  firstName: string;
  lastName: string;
  domain: string;
  organizationName?: string | undefined;
}

export type ApolloRevealEmailResult =
  | { status: 'success'; email: string | null; apolloId: string | null }
  | { status: 'retryable_error'; failure: { classification: 'retryable'; statusCode: number | null; message: string; raw: unknown } }
  | { status: 'terminal_error'; failure: { classification: 'terminal'; statusCode: number | null; message: string; raw: unknown } };

export interface ApolloRevealPhoneParams {
  apolloId?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  domain?: string | undefined;
}

export type ApolloRevealPhoneResult =
  | { status: 'success'; phone: string | null; asyncPending: boolean }
  | { status: 'retryable_error'; failure: { classification: 'retryable'; statusCode: number | null; message: string; raw: unknown } }
  | { status: 'terminal_error'; failure: { classification: 'terminal'; statusCode: number | null; message: string; raw: unknown } };

export interface ApolloOrgEnrichmentData {
  name: string | null;
  industry: string | null;
  estimatedEmployees: number | null;
  linkedinUrl: string | null;
  primaryPhone: string | null;
  city: string | null;
  country: string | null;
  foundedYear: number | null;
  annualRevenue: string | null;
  websiteUrl: string | null;
}

export type ApolloOrgEnrichmentResult =
  | { status: 'success'; data: ApolloOrgEnrichmentData }
  | { status: 'retryable_error'; failure: { classification: 'retryable'; statusCode: number | null; message: string; raw: unknown } }
  | { status: 'terminal_error'; failure: { classification: 'terminal'; statusCode: number | null; message: string; raw: unknown } };

interface ApolloPeopleSearchResponse {
  people?: unknown;
  pagination?: {
    page?: number;
    total_pages?: number;
    next_page?: number;
  };
}

const DEFAULT_APOLLO_BASE_URL = 'https://api.apollo.io';
const DEFAULT_APOLLO_MAX_PAGE_SIZE = 25;
const DEFAULT_APOLLO_MIN_REQUEST_INTERVAL_MS = 250;
const DEFAULT_APOLLO_TIMEOUT_MS = 10000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeCompanySize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized || !normalized.includes('@')) {
    return null;
  }

  return normalized.toLowerCase();
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 1;
  }

  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseRetryAfterSeconds(retryAfterHeader: string | null): number {
  if (!retryAfterHeader) {
    return 30;
  }

  const numeric = Number.parseInt(retryAfterHeader, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 30;
}

function normalizeTerms(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => normalizeString(value)?.toLowerCase())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export function buildApolloSearchRequestBody(
  input: Pick<ApolloDiscoveryRequest, 'filters'>,
  page: number,
  perPage: number,
): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    page,
    per_page: perPage,
  };

  if (input.filters?.countries?.length) {
    requestBody.person_locations = input.filters.countries;
  }

  const includeTerms = normalizeTerms([
    ...(input.filters?.industries ?? []),
    ...(input.filters?.includeTerms ?? []),
  ]);
  const excludeTerms = normalizeTerms(input.filters?.excludeTerms);
  const excludedDomains = normalizeTerms(input.filters?.excludedDomains);
  const keywordTerms: string[] = [];

  if (includeTerms.length > 0) {
    keywordTerms.push(...includeTerms);
  }
  if (excludeTerms.length > 0) {
    keywordTerms.push(...excludeTerms.map((term) => `NOT ${term}`));
  }
  if (excludedDomains.length > 0) {
    keywordTerms.push(...excludedDomains.map((domain) => `NOT ${domain}`));
  }
  if (keywordTerms.length > 0) {
    requestBody.q_keywords = keywordTerms.join(' ');
  }

  if (input.filters?.requiredTechnologies?.length) {
    requestBody.q_organization_technology_names = input.filters.requiredTechnologies;
  }

  if (input.filters?.minCompanySize !== undefined) {
    requestBody.q_organization_num_employees_gte = input.filters.minCompanySize;
  }

  if (input.filters?.maxCompanySize !== undefined) {
    requestBody.q_organization_num_employees_lte = input.filters.maxCompanySize;
  }

  return requestBody;
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const TITLE_RANK_MAP: ReadonlyArray<readonly [string, number]> = [
  ['owner', 1],
  ['ceo', 2],
  ['chief executive', 2],
  ['founder', 3],
  ['co-founder', 3],
  ['cofounder', 3],
  ['director', 4],
  ['vp', 5],
  ['vice president', 5],
  ['manager', 6],
  ['head', 6],
];

function titleRank(title: string | null): number {
  if (!title) return 99;
  const lower = title.toLowerCase();
  for (const [keyword, rank] of TITLE_RANK_MAP) {
    if (lower.includes(keyword)) {
      return rank;
    }
  }
  return 99;
}

export class ApolloRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'ApolloRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ApolloDiscoveryAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxPageSize: number;
  private readonly minRequestIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private nextAllowedRequestAt = 0;

  constructor(config: ApolloDiscoveryAdapterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_APOLLO_BASE_URL;
    this.maxPageSize = config.maxPageSize ?? DEFAULT_APOLLO_MAX_PAGE_SIZE;
    this.minRequestIntervalMs = config.minRequestIntervalMs ?? DEFAULT_APOLLO_MIN_REQUEST_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_APOLLO_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  async discoverLeads(input: ApolloDiscoveryRequest): Promise<ApolloDiscoveryResult> {
    await this.waitForRateLimit();

    const page = parseCursor(input.cursor);
    const perPage = Math.min(Math.max(input.limit, 1), this.maxPageSize);

    const requestBody = buildApolloSearchRequestBody(input, page, perPage);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/mixed_people/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'user-agent': 'LeadFlood/1.0 (+https://leadflood.io)',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      this.nextAllowedRequestAt = Date.now() + this.minRequestIntervalMs;
    }

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
      this.nextAllowedRequestAt = Date.now() + retryAfterSeconds * 1000;
      throw new ApolloRateLimitError('Apollo request rate limited', retryAfterSeconds);
    }

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Apollo request failed: status=${response.status} body=${responseBody}`);
    }

    const payload = (await response.json()) as ApolloPeopleSearchResponse;
    const rawPeople = Array.isArray(payload.people) ? payload.people : [];

    const normalizedLeads = rawPeople
      .map((rawPerson) => this.normalizePerson(rawPerson))
      .filter((lead): lead is NormalizedDiscoveredLead => lead !== null)
      .filter((lead) => this.matchesIcpFilters(lead, input.filters));

    const pagination = payload.pagination ?? {};
    const currentPage = typeof pagination.page === 'number' ? pagination.page : page;
    const nextPage =
      typeof pagination.next_page === 'number'
        ? pagination.next_page
        : typeof pagination.total_pages === 'number' && currentPage < pagination.total_pages
          ? currentPage + 1
          : null;

    return {
      leads: normalizedLeads,
      nextCursor: nextPage ? String(nextPage) : null,
      rateLimitedUntil: null,
    };
  }

  private async waitForRateLimit(): Promise<void> {
    const waitMs = this.nextAllowedRequestAt - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  private normalizePerson(rawPerson: unknown): NormalizedDiscoveredLead | null {
    if (!rawPerson || typeof rawPerson !== 'object') {
      return null;
    }

    const value = rawPerson as Record<string, unknown>;
    const organization =
      value.organization && typeof value.organization === 'object'
        ? (value.organization as Record<string, unknown>)
        : null;

    const email = normalizeEmail(value.email);
    const providerRecordId = normalizeString(value.id);

    if (!email || !providerRecordId) {
      return null;
    }

    return {
      provider: 'apollo',
      providerRecordId,
      firstName: normalizeString(value.first_name) ?? '',
      lastName: normalizeString(value.last_name) ?? '',
      email,
      title: normalizeString(value.title),
      companyName: normalizeString(organization?.name),
      companyDomain: normalizeString(organization?.primary_domain),
      companySize: normalizeCompanySize(organization?.estimated_num_employees),
      country: normalizeString(value.country),
      raw: rawPerson,
    };
  }

  async searchContactsByDomain(domain: string): Promise<ApolloContactSearchResult> {
    await this.waitForRateLimit();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/mixed_people/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'user-agent': 'LeadFlood/1.0 (+https://leadflood.io)',
        },
        body: JSON.stringify({
          q_organization_domains: [domain],
          per_page: 10,
        }),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Apollo contact search request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
      this.nextAllowedRequestAt = Date.now() + this.minRequestIntervalMs;
    }

    const rawText = await response.text();

    if (response.status === 429) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: 429,
          message: 'Apollo contact search rate limited',
          raw: parseJsonSafe(rawText),
        },
      };
    }

    if (!response.ok) {
      if (response.status >= 500) {
        return {
          status: 'retryable_error',
          failure: {
            classification: 'retryable',
            statusCode: response.status,
            message: `Apollo contact search failed with status ${response.status}`,
            raw: parseJsonSafe(rawText),
          },
        };
      }
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: response.status,
          message: `Apollo contact search failed with status ${response.status}`,
          raw: parseJsonSafe(rawText),
        },
      };
    }

    const payload = parseJsonSafe(rawText);
    const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const rawPeople = Array.isArray(data.people) ? data.people : [];

    const contacts: ApolloContactSearchContact[] = rawPeople
      .map((person: unknown) => {
        if (!person || typeof person !== 'object') return null;
        const p = person as Record<string, unknown>;

        const email = normalizeEmail(p.email);
        if (!email) return null;

        const phone = normalizeString(
          p.sanitized_phone ??
          (Array.isArray(p.phone_numbers) && p.phone_numbers[0] && typeof p.phone_numbers[0] === 'object'
            ? (p.phone_numbers[0] as Record<string, unknown>).sanitized_number
            : null),
        );

        const organization = p.organization && typeof p.organization === 'object'
          ? (p.organization as Record<string, unknown>)
          : null;

        return {
          email,
          phone,
          firstName: normalizeString(p.first_name) ?? '',
          lastName: normalizeString(p.last_name) ?? '',
          title: normalizeString(p.title),
          companyName: normalizeString(organization?.name),
        };
      })
      .filter((c): c is ApolloContactSearchContact => c !== null);

    // Rank by title: owner > CEO > founder > director > manager > other
    const ranked = contacts.sort((a, b) => titleRank(a.title) - titleRank(b.title));

    return {
      status: 'success',
      contacts: ranked.slice(0, 5),
    };
  }

  /**
   * Pre-screen a domain via Apollo's People Search endpoint.
   * This is a FREE call (zero credits) — it returns metadata about whether
   * contacts at this domain have emails/phones without revealing the actual data.
   */
  async preScreenDomain(domain: string): Promise<
    | { status: 'success'; hasEmail: boolean; hasDirectPhone: boolean; topContactTitle: string | null }
    | { status: 'retryable_error'; failure: { classification: 'retryable'; statusCode: number | null; message: string; raw: unknown } }
    | { status: 'terminal_error'; failure: { classification: 'terminal'; statusCode: number | null; message: string; raw: unknown } }
  > {
    if (!this.isConfigured) {
      return {
        status: 'terminal_error',
        failure: { classification: 'terminal', statusCode: null, message: 'Apollo API key not configured', raw: null },
      };
    }

    await this.waitForRateLimit();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/mixed_people/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'user-agent': 'LeadFlood/1.0 (+https://leadflood.io)',
        },
        body: JSON.stringify({
          q_organization_domains: [domain],
          per_page: 1,
        }),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Apollo pre-screen request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
      this.nextAllowedRequestAt = Date.now() + this.minRequestIntervalMs;
    }

    const rawText = await response.text();

    if (response.status === 429) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: 429,
          message: 'Apollo pre-screen rate limited',
          raw: parseJsonSafe(rawText),
        },
      };
    }

    if (!response.ok) {
      if (response.status >= 500) {
        return {
          status: 'retryable_error',
          failure: {
            classification: 'retryable',
            statusCode: response.status,
            message: `Apollo pre-screen failed with status ${response.status}`,
            raw: parseJsonSafe(rawText),
          },
        };
      }
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: response.status,
          message: `Apollo pre-screen failed with status ${response.status}`,
          raw: parseJsonSafe(rawText),
        },
      };
    }

    const payload = parseJsonSafe(rawText);
    const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const rawPeople = Array.isArray(data.people) ? data.people : [];

    if (rawPeople.length === 0) {
      return { status: 'success', hasEmail: false, hasDirectPhone: false, topContactTitle: null };
    }

    const topPerson = rawPeople[0] as Record<string, unknown>;
    const hasEmail = typeof topPerson.email === 'string' && topPerson.email.includes('@');
    const phoneNumbers = Array.isArray(topPerson.phone_numbers) ? topPerson.phone_numbers : [];
    const hasDirectPhone = phoneNumbers.length > 0 || typeof topPerson.sanitized_phone === 'string';
    const topContactTitle = normalizeString(topPerson.title);

    return { status: 'success', hasEmail, hasDirectPhone, topContactTitle };
  }

  async revealContactEmail(params: ApolloRevealEmailParams): Promise<ApolloRevealEmailResult> {
    if (!this.isConfigured) {
      return {
        status: 'terminal_error',
        failure: { classification: 'terminal', statusCode: null, message: 'Apollo API key not configured', raw: null },
      };
    }

    await this.waitForRateLimit();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/people/match`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'user-agent': 'LeadFlood/1.0 (+https://leadflood.io)',
        },
        body: JSON.stringify({
          first_name: params.firstName,
          last_name: params.lastName,
          domain: params.domain,
          ...(params.organizationName ? { organization_name: params.organizationName } : {}),
          reveal_personal_emails: true,
        }),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Apollo email reveal request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
      this.nextAllowedRequestAt = Date.now() + this.minRequestIntervalMs;
    }

    const rawText = await response.text();

    if (response.status === 429) {
      return {
        status: 'retryable_error',
        failure: { classification: 'retryable', statusCode: 429, message: 'Apollo email reveal rate limited', raw: parseJsonSafe(rawText) },
      };
    }

    if (!response.ok) {
      if (response.status >= 500) {
        return {
          status: 'retryable_error',
          failure: { classification: 'retryable', statusCode: response.status, message: `Apollo email reveal failed with status ${response.status}`, raw: parseJsonSafe(rawText) },
        };
      }
      return {
        status: 'terminal_error',
        failure: { classification: 'terminal', statusCode: response.status, message: `Apollo email reveal failed with status ${response.status}`, raw: parseJsonSafe(rawText) },
      };
    }

    const payload = parseJsonSafe(rawText);
    const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const person = data.person && typeof data.person === 'object' ? (data.person as Record<string, unknown>) : null;

    if (!person) {
      return { status: 'success', email: null, apolloId: null };
    }

    const apolloId = normalizeString(person.id);
    const email = normalizeEmail(person.email);

    return { status: 'success', email, apolloId };
  }

  async revealContactPhone(params: ApolloRevealPhoneParams): Promise<ApolloRevealPhoneResult> {
    if (!this.isConfigured) {
      return {
        status: 'terminal_error',
        failure: { classification: 'terminal', statusCode: null, message: 'Apollo API key not configured', raw: null },
      };
    }

    await this.waitForRateLimit();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const body: Record<string, unknown> = { reveal_phone_number: true };
    if (params.apolloId) {
      body.id = params.apolloId;
    } else {
      if (params.firstName) body.first_name = params.firstName;
      if (params.lastName) body.last_name = params.lastName;
      if (params.domain) body.domain = params.domain;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/people/match`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'user-agent': 'LeadFlood/1.0 (+https://leadflood.io)',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Apollo phone reveal request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
      this.nextAllowedRequestAt = Date.now() + this.minRequestIntervalMs;
    }

    const rawText = await response.text();

    if (response.status === 429) {
      return {
        status: 'retryable_error',
        failure: { classification: 'retryable', statusCode: 429, message: 'Apollo phone reveal rate limited', raw: parseJsonSafe(rawText) },
      };
    }

    if (!response.ok) {
      if (response.status >= 500) {
        return {
          status: 'retryable_error',
          failure: { classification: 'retryable', statusCode: response.status, message: `Apollo phone reveal failed with status ${response.status}`, raw: parseJsonSafe(rawText) },
        };
      }
      return {
        status: 'terminal_error',
        failure: { classification: 'terminal', statusCode: response.status, message: `Apollo phone reveal failed with status ${response.status}`, raw: parseJsonSafe(rawText) },
      };
    }

    const payload = parseJsonSafe(rawText);
    const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const person = data.person && typeof data.person === 'object' ? (data.person as Record<string, unknown>) : null;

    if (!person) {
      return { status: 'success', phone: null, asyncPending: false };
    }

    const phone = normalizeString(
      person.sanitized_phone ??
      (Array.isArray(person.phone_numbers) && person.phone_numbers[0] && typeof person.phone_numbers[0] === 'object'
        ? (person.phone_numbers[0] as Record<string, unknown>).sanitized_number
        : null),
    );

    return { status: 'success', phone, asyncPending: phone === null };
  }

  async enrichOrganization(domain: string): Promise<ApolloOrgEnrichmentResult> {
    if (!this.isConfigured) {
      return {
        status: 'terminal_error',
        failure: { classification: 'terminal', statusCode: null, message: 'Apollo API key not configured', raw: null },
      };
    }

    await this.waitForRateLimit();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      const url = new URL(`${this.baseUrl}/api/v1/organizations/enrich`);
      url.searchParams.set('domain', domain);

      response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'user-agent': 'LeadFlood/1.0 (+https://leadflood.io)',
        },
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Apollo org enrichment request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
      this.nextAllowedRequestAt = Date.now() + this.minRequestIntervalMs;
    }

    const rawText = await response.text();

    if (response.status === 429) {
      return {
        status: 'retryable_error',
        failure: { classification: 'retryable', statusCode: 429, message: 'Apollo org enrichment rate limited', raw: parseJsonSafe(rawText) },
      };
    }

    if (!response.ok) {
      if (response.status >= 500) {
        return {
          status: 'retryable_error',
          failure: { classification: 'retryable', statusCode: response.status, message: `Apollo org enrichment failed with status ${response.status}`, raw: parseJsonSafe(rawText) },
        };
      }
      return {
        status: 'terminal_error',
        failure: { classification: 'terminal', statusCode: response.status, message: `Apollo org enrichment failed with status ${response.status}`, raw: parseJsonSafe(rawText) },
      };
    }

    const payload = parseJsonSafe(rawText);
    const wrapper = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const org = wrapper.organization && typeof wrapper.organization === 'object' ? (wrapper.organization as Record<string, unknown>) : null;

    if (!org) {
      return { status: 'success', data: { name: null, industry: null, estimatedEmployees: null, linkedinUrl: null, primaryPhone: null, city: null, country: null, foundedYear: null, annualRevenue: null, websiteUrl: null } };
    }

    const phone = org.primary_phone && typeof org.primary_phone === 'object'
      ? normalizeString((org.primary_phone as Record<string, unknown>).sanitized_number)
      : normalizeString(org.primary_phone);

    return {
      status: 'success',
      data: {
        name: normalizeString(org.name),
        industry: normalizeString(org.industry),
        estimatedEmployees: typeof org.estimated_num_employees === 'number' ? org.estimated_num_employees : null,
        linkedinUrl: normalizeString(org.linkedin_url),
        primaryPhone: phone,
        city: normalizeString(org.city),
        country: normalizeString(org.country),
        foundedYear: typeof org.founded_year === 'number' ? org.founded_year : null,
        annualRevenue: normalizeString(org.annual_revenue_printed),
        websiteUrl: normalizeString(org.website_url),
      },
    };
  }

  private matchesIcpFilters(lead: NormalizedDiscoveredLead, filters?: DiscoveryIcpFilters): boolean {
    if (!filters) {
      return true;
    }

    if (filters.excludedDomains?.length && lead.companyDomain) {
      const normalizedDomain = lead.companyDomain.toLowerCase();
      if (filters.excludedDomains.some((domain) => domain.toLowerCase() === normalizedDomain)) {
        return false;
      }
    }

    if (filters.minCompanySize !== undefined && lead.companySize !== null) {
      if (lead.companySize < filters.minCompanySize) {
        return false;
      }
    }

    if (filters.maxCompanySize !== undefined && lead.companySize !== null) {
      if (lead.companySize > filters.maxCompanySize) {
        return false;
      }
    }

    if (filters.countries?.length && lead.country) {
      const countries = new Set(filters.countries.map((country) => country.toLowerCase()));
      if (!countries.has(lead.country.toLowerCase())) {
        return false;
      }
    }

    const searchableText = [
      lead.title,
      lead.companyName,
      lead.companyDomain,
      lead.country,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();

    if (filters.includeTerms?.length) {
      const includeTerms = filters.includeTerms.map((term) => term.toLowerCase());
      if (!includeTerms.every((term) => searchableText.includes(term))) {
        return false;
      }
    }

    if (filters.excludeTerms?.length) {
      const excludeTerms = filters.excludeTerms.map((term) => term.toLowerCase());
      if (excludeTerms.some((term) => searchableText.includes(term))) {
        return false;
      }
    }

    return true;
  }
}

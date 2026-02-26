import type { NormalizedEnrichmentPayload } from './normalized.types.js';

export interface HunterEnrichmentRequest {
  email?: string;
  domain?: string;
  companyName?: string;
  correlationId?: string;
}

export interface HunterFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export type HunterEnrichmentResult =
  | {
      status: 'success';
      normalized: NormalizedEnrichmentPayload;
      raw: unknown;
    }
  | {
      status: 'retryable_error';
      failure: HunterFailure;
    }
  | {
      status: 'terminal_error';
      failure: HunterFailure;
    };

export interface HunterDomainContact {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  type: 'personal' | 'generic' | null;
}

export type HunterDomainSearchResult =
  | { status: 'success'; contacts: HunterDomainContact[] }
  | { status: 'retryable_error'; failure: HunterFailure }
  | { status: 'terminal_error'; failure: HunterFailure };

export interface HunterAdapterConfig {
  apiKey: string | undefined;
  baseUrl?: string;
  minRequestIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.hunter.io/v2';
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 250;
const DEFAULT_TIMEOUT_MS = 10000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function classifyStatus(statusCode: number): 'retryable' | 'terminal' {
  if (statusCode === 429 || statusCode >= 500) {
    return 'retryable';
  }

  return 'terminal';
}

function domainFromEmail(email?: string): string | null {
  if (!email || !email.includes('@')) {
    return null;
  }

  const [, domain] = email.split('@');
  return domain?.toLowerCase() ?? null;
}

const EXECUTIVE_KEYWORDS = ['owner', 'ceo', 'chief', 'founder', 'director', 'vp', 'vice president', 'president', 'head', 'manager'] as const;

function hunterPositionRank(position: string | null): number {
  if (!position) return 99;
  const lower = position.toLowerCase();
  for (let i = 0; i < EXECUTIVE_KEYWORDS.length; i++) {
    if (lower.includes(EXECUTIVE_KEYWORDS[i]!)) {
      return i;
    }
  }
  return 99;
}

export class HunterAdapter {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly minRequestIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private nextAllowedRequestAt = 0;

  constructor(config: HunterAdapterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.minRequestIntervalMs = config.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async enrichLead(request: HunterEnrichmentRequest): Promise<HunterEnrichmentResult> {
    if (!this.apiKey) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'HUNTER_API_KEY is not configured',
          raw: null,
        },
      };
    }

    const derivedDomain = request.domain ?? domainFromEmail(request.email) ?? null;
    if (!request.email && !derivedDomain) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'Hunter enrichment requires email or domain',
          raw: null,
        },
      };
    }

    await this.waitForRateLimit();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    let lookupMode: 'email_verifier' | 'domain_search';
    try {
      if (request.email) {
        lookupMode = 'email_verifier';
        const params = new URLSearchParams({
          api_key: this.apiKey,
          email: request.email,
        });
        response = await this.fetchImpl(`${this.baseUrl}/email-verifier?${params.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });
      } else {
        lookupMode = 'domain_search';
        const params = new URLSearchParams({
          api_key: this.apiKey,
          domain: derivedDomain ?? '',
          limit: '1',
        });
        response = await this.fetchImpl(`${this.baseUrl}/domain-search?${params.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });
      }
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Hunter request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
      this.nextAllowedRequestAt = Date.now() + this.minRequestIntervalMs;
    }

    const rawText = await response.text();
    const raw = this.parseRaw(rawText);

    if (!response.ok) {
      const classification = classifyStatus(response.status);
      const failure: HunterFailure = {
        classification,
        statusCode: response.status,
        message: `Hunter enrichment failed with status ${response.status}`,
        raw,
      };

      return classification === 'retryable'
        ? { status: 'retryable_error', failure }
        : { status: 'terminal_error', failure };
    }

    return {
      status: 'success',
      normalized: this.normalize(raw, request, lookupMode, derivedDomain),
      raw,
    };
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async searchDomainContacts(domain: string): Promise<HunterDomainSearchResult> {
    if (!this.apiKey) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'HUNTER_API_KEY is not configured',
          raw: null,
        },
      };
    }

    if (!domain) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'domain is required for Hunter domain search',
          raw: null,
        },
      };
    }

    await this.waitForRateLimit();

    const params = new URLSearchParams({
      api_key: this.apiKey,
      domain,
      limit: '5',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/domain-search?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Hunter domain search request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
      this.nextAllowedRequestAt = Date.now() + this.minRequestIntervalMs;
    }

    const rawText = await response.text();
    const raw = this.parseRaw(rawText);

    if (!response.ok) {
      const classification = classifyStatus(response.status);
      const failure: HunterFailure = {
        classification,
        statusCode: response.status,
        message: `Hunter domain search failed with status ${response.status}`,
        raw,
      };
      return classification === 'retryable'
        ? { status: 'retryable_error', failure }
        : { status: 'terminal_error', failure };
    }

    const payload = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const data = payload.data && typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : {};
    const emails = Array.isArray(data.emails) ? data.emails : [];

    const contacts: HunterDomainContact[] = emails
      .map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return null;
        const e = entry as Record<string, unknown>;
        const email = normalizeString(e.value);
        if (!email) return null;

        const emailType = e.type === 'personal' ? 'personal' as const
          : e.type === 'generic' ? 'generic' as const
          : null;

        return {
          email,
          firstName: normalizeString(e.first_name),
          lastName: normalizeString(e.last_name),
          position: normalizeString(e.position),
          type: emailType,
        };
      })
      .filter((c): c is HunterDomainContact => c !== null);

    // Rank: personal before generic, executive positions first
    contacts.sort((a, b) => {
      // Personal emails first
      const typeA = a.type === 'personal' ? 0 : a.type === 'generic' ? 2 : 1;
      const typeB = b.type === 'personal' ? 0 : b.type === 'generic' ? 2 : 1;
      if (typeA !== typeB) return typeA - typeB;

      // Executive positions first
      return hunterPositionRank(a.position) - hunterPositionRank(b.position);
    });

    return {
      status: 'success',
      contacts,
    };
  }

  private parseRaw(rawText: string): unknown {
    if (!rawText) {
      return null;
    }

    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      return rawText;
    }
  }

  private normalize(
    raw: unknown,
    request: HunterEnrichmentRequest,
    lookupMode: 'email_verifier' | 'domain_search',
    derivedDomain: string | null,
  ): NormalizedEnrichmentPayload {
    const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const data = value.data && typeof value.data === 'object' ? (value.data as Record<string, unknown>) : {};
    const firstDomainEmail =
      Array.isArray(data.emails) && data.emails.length > 0 && data.emails[0] && typeof data.emails[0] === 'object'
        ? (data.emails[0] as Record<string, unknown>)
        : null;

    const email =
      normalizeString(data.email) ??
      normalizeString(firstDomainEmail?.value) ??
      normalizeString(request.email);
    const domain = derivedDomain ?? domainFromEmail(email ?? undefined);
    const companyName = normalizeString(data.organization) ?? normalizeString(request.companyName);

    return {
      email,
      phone: normalizeString(data.phone_number),
      domain,
      companyName,
      industry: normalizeString(data.industry),
      employeeCount: null,
      country: normalizeString(data.country),
      city: normalizeString(data.city),
      linkedinUrl: null,
      website: domain ? `https://${domain}` : null,
    };
  }

  private async waitForRateLimit(): Promise<void> {
    const waitMs = this.nextAllowedRequestAt - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
}

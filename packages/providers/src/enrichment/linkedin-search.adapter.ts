// ── LinkedIn Search Adapter (Brave-only) ─────────────────────────────
// Uses Brave Web Search for both broad people discovery and LinkedIn verification.

export interface LinkedInSearchConfig {
  braveApiKey?: string | undefined;
  braveBaseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface LinkedInProfileResult {
  name: string;
  title: string | null;
  linkedinUrl: string;
}

export type DecisionMakerSearchStage =
  | 'VERIFY_V1_PEOPLE_WEB'
  | 'VERIFY_V2_LINKEDIN'
  | 'DISCOVER_D1_PEOPLE_WEB'
  | 'DISCOVER_D2_LINKEDIN';

export interface LinkedInSearchFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export type LinkedInSearchResponse =
  | { status: 'success'; data: LinkedInProfileResult[]; query: string; stage: DecisionMakerSearchStage }
  | { status: 'retryable_error'; failure: LinkedInSearchFailure }
  | { status: 'terminal_error'; failure: LinkedInSearchFailure };

interface BraveResultItem {
  title?: string;
  description?: string;
  url?: string;
}

const DEFAULT_BRAVE_BASE = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_TIMEOUT_MS = 15_000;

function classifyStatus(statusCode: number): 'retryable' | 'terminal' {
  if (statusCode === 429 || statusCode >= 500) return 'retryable';
  return 'terminal';
}

/**
 * Parse a LinkedIn search result title to extract person name and title.
 * LinkedIn titles are typically: "John Smith - CEO - Company | LinkedIn"
 * or "John Smith – Sales Director – Acme Corp | LinkedIn"
 */
function parseLinkedInTitle(title: string): { name: string; title: string | null } {
  // Remove " | LinkedIn" or " - LinkedIn" suffix
  const cleaned = title.replace(/\s*[|–-]\s*LinkedIn\s*$/i, '').trim();

  // Split on " - " or " – " (em dash)
  const parts = cleaned.split(/\s*[–-]\s*/);

  if (parts.length >= 2) {
    return {
      name: parts[0]?.trim() ?? '',
      title: parts[1]?.trim() ?? null,
    };
  }

  return { name: cleaned, title: null };
}

/**
 * Filter results to only valid LinkedIn profile URLs (/in/ path).
 */
function isLinkedInProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes('linkedin.com') &&
      parsed.pathname.startsWith('/in/')
    );
  } catch {
    return false;
  }
}

export class LinkedInSearchAdapter {
  private readonly braveApiKey: string | undefined;
  private readonly braveBase: string;
  private readonly timeout: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: LinkedInSearchConfig) {
    this.braveApiKey = config.braveApiKey;
    this.braveBase = config.braveBaseUrl ?? DEFAULT_BRAVE_BASE;
    this.timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return Boolean(this.braveApiKey);
  }

  async searchPersonVerification(input: {
    name: string;
    companyName: string;
    cityOrCountry?: string | null | undefined;
    titleOrFunction?: string | null | undefined;
    maxResults?: number | undefined;
  }): Promise<LinkedInSearchResponse> {
    const locality = input.cityOrCountry?.trim() ? `"${input.cityOrCountry.trim()}"` : '';
    const queryV1 = `"${input.name}" "${input.companyName}" ${locality} (founder OR ceo OR cmo OR head OR director OR leadership OR team)`.trim();
    const v1 = await this.searchViaBrave(queryV1, 'VERIFY_V1_PEOPLE_WEB', input.maxResults ?? 5);
    if (v1.status !== 'success') return v1;

    const title = input.titleOrFunction?.trim() ? `"${input.titleOrFunction.trim()}"` : '';
    const queryV2 = `site:linkedin.com/in "${input.name}" "${input.companyName}" ${title}`.trim();
    const v2 = await this.searchViaBrave(queryV2, 'VERIFY_V2_LINKEDIN', input.maxResults ?? 5);
    if (v2.status === 'success') {
      return {
        ...v2,
        data: this.mergeProfiles(v1.data, v2.data),
      };
    }
    return {
      status: 'success',
      data: v1.data,
      query: queryV1,
      stage: 'VERIFY_V1_PEOPLE_WEB',
    };
  }

  async searchCompanyPeople(
    companyName: string,
    cityOrCountry?: string | null | undefined,
    maxResults = 3,
  ): Promise<LinkedInSearchResponse> {
    const locality = cityOrCountry?.trim() ? `"${cityOrCountry.trim()}"` : '';
    const queryD1 = `"${companyName}" ${locality} (team OR leadership OR c-suite OR management OR executives OR about us)`.trim();
    const d1 = await this.searchViaBrave(queryD1, 'DISCOVER_D1_PEOPLE_WEB', maxResults);
    if (d1.status !== 'success') return d1;

    const queryD2 = `site:linkedin.com/in "${companyName}" ("ceo" OR "founder" OR "head of" OR "director")`;
    const d2 = await this.searchViaBrave(queryD2, 'DISCOVER_D2_LINKEDIN', maxResults);
    if (d2.status === 'success') {
      return {
        ...d2,
        data: this.mergeProfiles(d1.data, d2.data),
      };
    }
    return {
      status: 'success',
      data: d1.data,
      query: queryD1,
      stage: 'DISCOVER_D1_PEOPLE_WEB',
    };
  }

  private async searchViaBrave(
    query: string,
    stage: DecisionMakerSearchStage,
    maxResults: number,
  ): Promise<LinkedInSearchResponse> {
    if (!this.braveApiKey) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'Brave Search API key not configured',
          raw: null,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const url = new URL(this.braveBase);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(maxResults, 10)));

      const response = await this.fetchFn(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'x-subscription-token': this.braveApiKey,
        },
      });

      if (!response.ok) {
        const classification = classifyStatus(response.status);
        const text = await response.text().catch(() => '');
        return {
          status: classification === 'retryable' ? 'retryable_error' : 'terminal_error',
            failure: {
              classification,
              statusCode: response.status,
              message: `Brave Search returned ${response.status}`,
              raw: text,
            },
          };
      }

      const json = (await response.json()) as {
        web?: {
          results?: BraveResultItem[];
        };
      };
      const items = Array.isArray(json.web?.results) ? json.web!.results! : [];

      return {
        status: 'success',
        data: this.parseResults(items, maxResults),
        query,
        stage,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          status: 'retryable_error',
            failure: {
              classification: 'retryable',
              statusCode: null,
              message: 'Brave LinkedIn search timed out',
              raw: null,
            },
          };
      }
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: err instanceof Error ? err.message : 'Unknown network error',
          raw: err,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private parseResults(
    items: BraveResultItem[],
    maxResults: number,
  ): LinkedInProfileResult[] {
    return items
      .filter((item) => item.url && isLinkedInProfileUrl(item.url))
      .slice(0, maxResults)
      .map((item) => {
        const parsed = parseLinkedInTitle(item.title ?? '');
        return {
          name: parsed.name,
          title: parsed.title ?? (item.description ? item.description.split(/[.–-]/).at(0)?.trim() ?? null : null),
          linkedinUrl: item.url!,
        };
      })
      .filter((r) => r.name.length > 0);
  }

  private mergeProfiles(
    first: LinkedInProfileResult[],
    second: LinkedInProfileResult[],
  ): LinkedInProfileResult[] {
    const merged = [...first];
    for (const item of second) {
      const key = item.linkedinUrl.toLowerCase();
      if (!merged.some((m) => m.linkedinUrl.toLowerCase() === key)) {
        merged.push(item);
      }
    }
    return merged;
  }
}

// ── Web Search Adapter (Brave Search) ────────────────────────────────
// Wraps the Brave Search API to return parsed web search results.
// Used by the LinkedIn search step to find CEO/founder LinkedIn profiles.
// NOTE: Originally used Google Custom Search JSON API, but Google shut down
// new customer access in Jan 2026. Brave Search is the drop-in replacement.
// Interface kept as GoogleCustomSearch* for backwards compatibility.

export interface GoogleCustomSearchConfig {
  apiKey: string | undefined;
  engineId?: string | undefined; // Not used by Brave, kept for backwards compat
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface GoogleSearchResult {
  title: string;
  snippet: string;
  link: string;
}

export interface GoogleCustomSearchFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export type GoogleCustomSearchResponse =
  | { status: 'success'; data: GoogleSearchResult[] }
  | { status: 'retryable_error'; failure: GoogleCustomSearchFailure }
  | { status: 'terminal_error'; failure: GoogleCustomSearchFailure };

const DEFAULT_BASE_URL = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_TIMEOUT_MS = 15_000;

function classifyStatus(statusCode: number): 'retryable' | 'terminal' {
  if (statusCode === 429 || statusCode >= 500) return 'retryable';
  return 'terminal';
}

export class GoogleCustomSearchAdapter {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: GoogleCustomSearchConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(query: string, numResults = 5): Promise<GoogleCustomSearchResponse> {
    if (!this.apiKey) {
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
      const url = new URL(this.baseUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(numResults, 20)));

      const response = await this.fetchFn(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey,
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
          results?: Array<{
            title?: string;
            description?: string;
            url?: string;
          }>;
        };
      };

      const results: GoogleSearchResult[] = (json.web?.results ?? [])
        .filter((item) => item.title && item.url)
        .map((item) => ({
          title: item.title ?? '',
          snippet: item.description ?? '',
          link: item.url ?? '',
        }));

      return { status: 'success', data: results };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          status: 'retryable_error',
          failure: {
            classification: 'retryable',
            statusCode: null,
            message: 'Brave Search request timed out',
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
}

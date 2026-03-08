// ── Google Custom Search Adapter ─────────────────────────────────────
// Wraps the Google Custom Search JSON API to return parsed search results.
// Used by the LinkedIn search adapter to find LinkedIn profiles.

export interface GoogleCustomSearchConfig {
  apiKey: string | undefined;
  engineId: string | undefined;
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

const DEFAULT_BASE_URL = 'https://www.googleapis.com/customsearch/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

function classifyStatus(statusCode: number): 'retryable' | 'terminal' {
  if (statusCode === 429 || statusCode >= 500) return 'retryable';
  return 'terminal';
}

export class GoogleCustomSearchAdapter {
  private readonly apiKey: string | undefined;
  private readonly engineId: string | undefined;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: GoogleCustomSearchConfig) {
    this.apiKey = config.apiKey;
    this.engineId = config.engineId;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey) && Boolean(this.engineId);
  }

  async search(query: string, numResults = 5): Promise<GoogleCustomSearchResponse> {
    if (!this.apiKey || !this.engineId) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'Google Custom Search API key or Engine ID not configured',
          raw: null,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('key', this.apiKey);
      url.searchParams.set('cx', this.engineId);
      url.searchParams.set('q', query);
      url.searchParams.set('num', String(Math.min(numResults, 10)));

      const response = await this.fetchFn(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        const classification = classifyStatus(response.status);
        const text = await response.text().catch(() => '');
        return {
          status: classification === 'retryable' ? 'retryable_error' : 'terminal_error',
          failure: {
            classification,
            statusCode: response.status,
            message: `Google Custom Search returned ${response.status}`,
            raw: text,
          },
        };
      }

      const json = (await response.json()) as {
        items?: Array<{
          title?: string;
          snippet?: string;
          link?: string;
        }>;
      };

      const results: GoogleSearchResult[] = (json.items ?? [])
        .filter((item) => item.title && item.link)
        .map((item) => ({
          title: item.title ?? '',
          snippet: item.snippet ?? '',
          link: item.link ?? '',
        }));

      return { status: 'success', data: results };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          status: 'retryable_error',
          failure: {
            classification: 'retryable',
            statusCode: null,
            message: 'Google Custom Search request timed out',
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

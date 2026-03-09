// ── SerpAPI Web Search Adapter ──────────────────────────────────────
// Drop-in replacement for GoogleCustomSearchAdapter using SerpAPI's
// regular Google search (engine=google). No CSE site restrictions.
// Same interface: isConfigured + search(query, numResults) → GoogleCustomSearchResponse

import type { GoogleSearchResult, GoogleCustomSearchResponse } from './google-custom-search.adapter.js';

export interface SerpApiWebSearchConfig {
  apiKey: string | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

const DEFAULT_BASE_URL = 'https://serpapi.com/search.json';
const DEFAULT_TIMEOUT_MS = 15_000;

function classifyStatus(statusCode: number): 'retryable' | 'terminal' {
  if (statusCode === 429 || statusCode >= 500) return 'retryable';
  return 'terminal';
}

function isQuotaExhaustedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('run out of searches')
    || normalized.includes('out of searches')
    || normalized.includes('credits exhausted')
    || normalized.includes('quota exceeded');
}

export class SerpApiWebSearchAdapter {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: SerpApiWebSearchConfig) {
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
          message: 'SerpAPI API key not configured for web search',
          raw: null,
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('api_key', this.apiKey);
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', query);
      url.searchParams.set('num', String(Math.min(numResults, 10)));

      const response = await this.fetchFn(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        const classification = classifyStatus(response.status);
        const text = await response.text().catch(() => '');
        const quotaExhausted = isQuotaExhaustedMessage(text);
        return {
          status: quotaExhausted ? 'terminal_error' : (classification === 'retryable' ? 'retryable_error' : 'terminal_error'),
          failure: {
            classification: quotaExhausted ? 'terminal' : classification,
            statusCode: response.status,
            message: quotaExhausted
              ? `SerpAPI credits exhausted — resubscribe at serpapi.com (quotaExhausted=true, status=${response.status})`
              : `SerpAPI web search returned ${response.status}`,
            raw: text,
          },
        };
      }

      const json = (await response.json()) as {
        organic_results?: Array<{
          title?: string;
          snippet?: string;
          link?: string;
        }>;
        error?: string;
      };

      if (json.error) {
        const quotaExhausted = isQuotaExhaustedMessage(json.error);
        return {
          status: 'terminal_error',
          failure: {
            classification: 'terminal',
            statusCode: null,
            message: quotaExhausted
              ? `SerpAPI credits exhausted — resubscribe at serpapi.com (quotaExhausted=true)`
              : `SerpAPI error: ${json.error}`,
            raw: json,
          },
        };
      }

      const results: GoogleSearchResult[] = (json.organic_results ?? [])
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
            message: 'SerpAPI web search request timed out',
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

import type {
  DiscoveryProvider,
  NormalizedProviderResponse,
  SerpApiCommonRequest,
} from './types.js';

/**
 * Wraps a primary and fallback discovery provider.
 * If the primary throws an error that looks like quota/credit exhaustion
 * (status 402, 429, or contains 'quota'/'credit' in the message),
 * automatically retries with the fallback provider.
 */
export class FallbackDiscoveryProvider implements DiscoveryProvider {
  private readonly primary: DiscoveryProvider;
  private readonly fallback: DiscoveryProvider;
  private readonly primaryName: string;
  private readonly fallbackName: string;
  /**
   * Tracks exhausted scopes (typically discoveryRunId) so fallback switching is
   * isolated per run instead of process-global.
   */
  private readonly exhaustedScopeKeys = new Set<string>();

  constructor(options: {
    primary: DiscoveryProvider;
    fallback: DiscoveryProvider;
    primaryName?: string;
    fallbackName?: string;
  }) {
    this.primary = options.primary;
    this.fallback = options.fallback;
    this.primaryName = options.primaryName ?? 'primary';
    this.fallbackName = options.fallbackName ?? 'fallback';
  }

  async searchGoogle(params: SerpApiCommonRequest): Promise<NormalizedProviderResponse> {
    return this.withFallback('searchGoogle', params);
  }

  async searchGoogleLocal(params: SerpApiCommonRequest): Promise<NormalizedProviderResponse> {
    return this.withFallback('searchGoogleLocal', params);
  }

  async searchMapsLocal(params: SerpApiCommonRequest): Promise<NormalizedProviderResponse> {
    return this.withFallback('searchMapsLocal', params);
  }

  private async withFallback(
    method: 'searchGoogle' | 'searchGoogleLocal' | 'searchMapsLocal',
    params: SerpApiCommonRequest,
  ): Promise<NormalizedProviderResponse> {
    const scopeKey = normalizeScopeKey(params.fallbackScopeKey);

    // If this scope is already known to be exhausted, go straight to fallback
    if (scopeKey !== null && this.exhaustedScopeKeys.has(scopeKey)) {
      return this.fallback[method](params);
    }

    try {
      return await this.primary[method](params);
    } catch (error: unknown) {
      if (isQuotaExhaustedError(error)) {
        // Persist switch only when a scope key is provided (e.g. discoveryRunId).
        if (scopeKey !== null) {
          this.exhaustedScopeKeys.add(scopeKey);
        }
        const scopeText = scopeKey ? ` scope=${scopeKey}` : '';
        const persistenceText = scopeKey
          ? 'for remaining requests in this scope'
          : 'for this request';
        console.warn(
          `[FallbackDiscoveryProvider] ${this.primaryName} quota exhausted${scopeText} — switching to ${this.fallbackName} ${persistenceText}`,
        );
        return this.fallback[method](params);
      }

      // Non-quota errors propagate normally
      throw error;
    }
  }
}

function normalizeScopeKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Detect quota/credit exhaustion errors from any provider.
 * - SerpAPI: statusCode 402 + "QUOTA EXHAUSTED"
 * - Generic: 402, 429 with quota message, or "credits" in error message
 */
function isQuotaExhaustedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Check for statusCode property (SerpApiRequestError, etc.)
  const statusCode = (error as unknown as Record<string, unknown>).statusCode;
  if (statusCode === 402 || statusCode === 403) return true;

  // Check error message for quota/credit keywords
  const message = error.message.toLowerCase();
  if (
    message.includes('quota exhausted') ||
    message.includes('credits depleted') ||
    message.includes('quota exceeded') ||
    message.includes('insufficient credits') ||
    message.includes('run out of searches') ||
    message.includes('billing') ||
    message.includes('rate limit') ||
    message.includes('plan limit') ||
    message.includes('account limit') ||
    (statusCode === 429 && (message.includes('quota') || message.includes('limit') || message.includes('run out')))
  ) {
    return true;
  }

  return false;
}

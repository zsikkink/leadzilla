import { describe, expect, it } from 'vitest';

import { FallbackDiscoveryProvider } from './fallback.provider.js';
import type { DiscoveryProvider, SerpApiCommonRequest } from './types.js';

function request(scopeKey?: string): SerpApiCommonRequest {
  return {
    query: 'salon dubai',
    countryCode: 'AE',
    language: 'en',
    city: 'Dubai',
    page: 1,
    ...(scopeKey !== undefined ? { fallbackScopeKey: scopeKey } : {}),
  };
}

function createQuotaError(message = 'quota exhausted'): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 402;
  return error;
}

function createProviderHandlers(options: {
  onPrimarySearchGoogle: DiscoveryProvider['searchGoogle'];
  onFallbackSearchGoogle: DiscoveryProvider['searchGoogle'];
}): { primary: DiscoveryProvider; fallback: DiscoveryProvider } {
  const primary: DiscoveryProvider = {
    searchGoogle: options.onPrimarySearchGoogle,
    searchGoogleLocal: options.onPrimarySearchGoogle,
    searchMapsLocal: options.onPrimarySearchGoogle,
  };
  const fallback: DiscoveryProvider = {
    searchGoogle: options.onFallbackSearchGoogle,
    searchGoogleLocal: options.onFallbackSearchGoogle,
    searchMapsLocal: options.onFallbackSearchGoogle,
  };
  return { primary, fallback };
}

describe('FallbackDiscoveryProvider', () => {
  it('keeps fallback switching scoped per run key', async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const { primary, fallback } = createProviderHandlers({
      onPrimarySearchGoogle: async () => {
        primaryCalls += 1;
        throw createQuotaError();
      },
      onFallbackSearchGoogle: async () => {
        fallbackCalls += 1;
        return {
          engine: 'google',
          provider: 'GOOGLE_PLACES',
          organicResults: [],
          localBusinesses: [],
          raw: { source: 'fallback' },
        };
      },
    });

    const provider = new FallbackDiscoveryProvider({ primary, fallback });

    await provider.searchGoogle(request('run-A'));
    await provider.searchGoogle(request('run-A'));

    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(2);
  });

  it('does not leak exhausted scope to different run keys', async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const { primary, fallback } = createProviderHandlers({
      onPrimarySearchGoogle: async () => {
        primaryCalls += 1;
        if (primaryCalls === 1) {
          throw createQuotaError();
        }
        return {
          engine: 'google',
          provider: 'SERPAPI',
          organicResults: [],
          localBusinesses: [],
          raw: { source: 'primary' },
        };
      },
      onFallbackSearchGoogle: async () => {
        fallbackCalls += 1;
        return {
          engine: 'google',
          provider: 'GOOGLE_PLACES',
          organicResults: [],
          localBusinesses: [],
          raw: { source: 'fallback' },
        };
      },
    });

    const provider = new FallbackDiscoveryProvider({ primary, fallback });

    await provider.searchGoogle(request('run-A'));
    const runBResult = await provider.searchGoogle(request('run-B'));

    expect(primaryCalls).toBe(2);
    expect(fallbackCalls).toBe(1);
    expect(runBResult.provider).toBe('SERPAPI');
  });
});

import { describe, expect, it } from 'vitest';

import { loadDiscoveryRuntimeConfig } from './config.js';

describe('loadDiscoveryRuntimeConfig', () => {
  it('defaults initial discovery to SerpAPI and does not require Google Places', () => {
    const config = loadDiscoveryRuntimeConfig({
      SERPAPI_API_KEY: 'serpapi-key',
      DISCOVERY_RPS: '2',
      DISCOVERY_CONCURRENCY: '4',
      DISCOVERY_ENABLE_CACHE: 'false',
      DISCOVERY_MAPS_ZOOM: '14',
      DISCOVERY_MAX_TASK_ATTEMPTS: '6',
      DISCOVERY_BACKOFF_BASE_SECONDS: '45',
    });

    expect(config.searchProvider).toBe('SERPAPI');
    expect(config.serpApiKey).toBe('serpapi-key');
    expect(config.googlePlacesApiKey).toBeNull();
    expect(config.rps).toBe(2);
    expect(config.concurrency).toBe(4);
    expect(config.enableCache).toBe(false);
    expect(config.mapsZoom).toBe(14);
    expect(config.maxTaskAttempts).toBe(6);
    expect(config.backoffBaseSeconds).toBe(45);
  });

  it('accepts explicit SerpAPI when SERPAPI_API_KEY is configured', () => {
    const config = loadDiscoveryRuntimeConfig({
      DISCOVERY_SEARCH_PROVIDER: 'SERPAPI',
      SERPAPI_API_KEY: 'serpapi-key',
    });

    expect(config.searchProvider).toBe('SERPAPI');
    expect(config.serpApiKey).toBe('serpapi-key');
  });

  it('fails clearly when SerpAPI is selected without SERPAPI_API_KEY', () => {
    expect(() =>
      loadDiscoveryRuntimeConfig({
        DISCOVERY_SEARCH_PROVIDER: 'SERPAPI',
      }),
    ).toThrow('Set SERPAPI_API_KEY for DISCOVERY_SEARCH_PROVIDER=SERPAPI');
  });

  it('keeps explicit Google Places support when GOOGLE_PLACES_API_KEY is configured', () => {
    const config = loadDiscoveryRuntimeConfig({
      DISCOVERY_SEARCH_PROVIDER: 'GOOGLE_PLACES',
      GOOGLE_PLACES_API_KEY: 'google-places-key',
    });

    expect(config.searchProvider).toBe('GOOGLE_PLACES');
    expect(config.googlePlacesApiKey).toBe('google-places-key');
    expect(config.serpApiKey).toBeNull();
  });
});

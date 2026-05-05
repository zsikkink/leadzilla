import { describe, expect, it } from 'vitest';

import { SerpApiDiscoveryProvider } from './serpapi.client.js';

function createProvider(
  payload: unknown,
  fetchImplOverride?: typeof fetch,
): SerpApiDiscoveryProvider {
  const fetchImpl: typeof fetch = fetchImplOverride ?? (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }));

  return new SerpApiDiscoveryProvider({
    apiKey: 'test-key',
    rps: 100,
    enableCache: true,
    fetchImpl,
  });
}

describe('SerpApiDiscoveryProvider local parsing', () => {
  it('extracts website and instagram from google_local links object', async () => {
    const provider = createProvider({
      local_results: [
        {
          title: 'Sao Paulo Beauty',
          links: {
            website: 'https://saopaulomicroblading.com/',
            directions: 'https://www.google.com/maps/dir//example',
          },
        },
        {
          title: 'Sand Salon',
          links: {
            website: 'https://www.instagram.com/sand__salon',
            directions: 'https://www.google.com/maps/dir//example',
          },
        },
      ],
    });

    const result = await provider.searchGoogleLocal({
      query: 'beauty salon cairo',
      countryCode: 'EG',
      language: 'ar',
      city: 'Cairo',
      page: 1,
    });

    expect(result.localBusinesses).toHaveLength(2);
    expect(result.localBusinesses[0]?.websiteUrl).toBe('https://saopaulomicroblading.com/');
    expect(result.localBusinesses[0]?.instagramHandle).toBeNull();
    expect(result.localBusinesses[1]?.websiteUrl).toBeNull();
    expect(result.localBusinesses[1]?.instagramHandle).toBe('sand__salon');
  });

  it('extracts from links array and ignores google maps urls as website', async () => {
    const provider = createProvider({
      local_results: [
        {
          title: 'Dehya Beauty',
          links: [
            { url: 'https://www.google.com/maps/dir//example' },
            { url: 'https://www.instagram.com/dehyasalon/' },
            { url: 'https://dehyabeauty.com/' },
          ],
        },
      ],
    });

    const result = await provider.searchGoogleLocal({
      query: 'beauty salon cairo',
      countryCode: 'EG',
      language: 'ar',
      city: 'Cairo',
      page: 1,
    });

    expect(result.localBusinesses).toHaveLength(1);
    expect(result.localBusinesses[0]?.websiteUrl).toBe('https://dehyabeauty.com/');
    expect(result.localBusinesses[0]?.instagramHandle).toBe('dehyasalon');
  });

  it('does not treat Facebook or WhatsApp utility links as business websites', async () => {
    const provider = createProvider({
      local_results: [
        {
          title: 'Social Only Market',
          website: 'https://m.facebook.com/social-only-market',
          links: {
            website: 'https://wa.me/971501234567',
          },
        },
        {
          title: 'WhatsApp Gym',
          website: 'https://api.whatsapp.com/send?phone=971501234567',
        },
      ],
    });

    const result = await provider.searchMapsLocal({
      query: 'gym dubai',
      countryCode: 'AE',
      language: 'en',
      city: 'Dubai',
      page: 1,
    });

    expect(result.localBusinesses).toHaveLength(2);
    expect(result.localBusinesses[0]?.websiteUrl).toBeNull();
    expect(result.localBusinesses[1]?.websiteUrl).toBeNull();
  });

  it('uses 20-result pagination offsets for local engines', async () => {
    let requestUrl = '';
    const fetchImpl: typeof fetch = async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ local_results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const provider = createProvider({}, fetchImpl);

    await provider.searchMapsLocal({
      query: 'beauty salon cairo',
      countryCode: 'EG',
      language: 'ar',
      city: 'Cairo',
      page: 3,
    });

    const url = new URL(requestUrl);
    expect(url.searchParams.get('start')).toBe('40');
  });
});

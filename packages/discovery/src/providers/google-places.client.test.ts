import { describe, expect, it, vi } from 'vitest';

import { GooglePlacesDiscoveryProvider, GooglePlacesRequestError } from './google-places.client.js';

function createProvider(
  payload: unknown,
  status = 200,
): GooglePlacesDiscoveryProvider {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  return new GooglePlacesDiscoveryProvider({
    apiKey: 'test-key',
    rps: 100,
    fetchImpl,
  });
}

function createProviderWithFetch(
  fetchImpl: typeof fetch,
): GooglePlacesDiscoveryProvider {
  return new GooglePlacesDiscoveryProvider({
    apiKey: 'test-key',
    rps: 100,
    maxAttempts: 1,
    fetchImpl,
  });
}

const BASE_REQUEST = {
  query: 'beauty salon dubai',
  countryCode: 'AE' as const,
  language: 'en' as const,
  city: 'Dubai',
  page: 1,
};

describe('GooglePlacesDiscoveryProvider', () => {
  it('normalizes Places API response into NormalizedLocalBusiness', async () => {
    const provider = createProvider({
      places: [
        {
          id: 'ChIJ123',
          displayName: { text: 'Glamour Beauty Salon' },
          websiteUri: 'https://glamour-beauty.ae',
          googleMapsUri: 'https://maps.google.com/?cid=123',
          nationalPhoneNumber: '04-123-4567',
          rating: 4.7,
          userRatingCount: 142,
          primaryTypeDisplayName: { text: 'Beauty Salon' },
          formattedAddress: '123 Sheikh Zayed Rd, Dubai, United Arab Emirates',
          addressComponents: [
            { longText: 'Dubai', shortText: 'Dubai', types: ['locality'] },
            { longText: 'United Arab Emirates', shortText: 'AE', types: ['country'] },
          ],
          location: { latitude: 25.2048, longitude: 55.2708 },
        },
      ],
    });

    const result = await provider.searchGoogleLocal(BASE_REQUEST);

    expect(result.engine).toBe('google_local');
    expect(result.organicResults).toHaveLength(0);
    expect(result.localBusinesses).toHaveLength(1);

    const biz = result.localBusinesses[0]!;
    expect(biz.id).toBe('ChIJ123');
    expect(biz.name).toBe('Glamour Beauty Salon');
    expect(biz.websiteUrl).toBe('https://glamour-beauty.ae');
    expect(biz.url).toBe('https://maps.google.com/?cid=123');
    expect(biz.phone).toBe('04-123-4567');
    expect(biz.city).toBe('Dubai');
    expect(biz.countryCode).toBe('AE');
    expect(biz.category).toBe('Beauty Salon');
    expect(biz.rating).toBe(4.7);
    expect(biz.reviewCount).toBe(142);
    expect(biz.latitude).toBe(25.2048);
    expect(biz.longitude).toBe(55.2708);
    expect(biz.instagramHandle).toBeNull();
  });

  it('does not expose WhatsApp utility links as business websites', async () => {
    const provider = createProvider({
      places: [
        {
          id: 'ChIJ123',
          displayName: { text: 'WhatsApp Only Gym' },
          websiteUri: 'https://wa.me/971501234567',
          googleMapsUri: 'https://maps.google.com/?cid=123',
          addressComponents: [
            { longText: 'United Arab Emirates', shortText: 'AE', types: ['country'] },
          ],
        },
      ],
    });

    const result = await provider.searchGoogleLocal(BASE_REQUEST);

    expect(result.localBusinesses).toHaveLength(1);
    expect(result.localBusinesses[0]?.websiteUrl).toBeNull();
  });

  it('filters out cross-border results by country code', async () => {
    const provider = createProvider({
      places: [
        {
          id: 'ae-1',
          displayName: { text: 'Dubai Salon' },
          addressComponents: [
            { shortText: 'AE', types: ['country'] },
          ],
        },
        {
          id: 'om-1',
          displayName: { text: 'Muscat Salon' },
          addressComponents: [
            { shortText: 'OM', types: ['country'] },
          ],
        },
      ],
    });

    const result = await provider.searchGoogleLocal(BASE_REQUEST);
    expect(result.localBusinesses).toHaveLength(1);
    expect(result.localBusinesses[0]!.name).toBe('Dubai Salon');
  });

  it('returns empty result for page > 1', async () => {
    const fetchSpy = vi.fn();
    const provider = createProviderWithFetch(fetchSpy as unknown as typeof fetch);

    const result = await provider.searchGoogleLocal({
      ...BASE_REQUEST,
      page: 2,
    });

    expect(result.localBusinesses).toHaveLength(0);
    expect(result.organicResults).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('searchGoogle returns engine "google"', async () => {
    const provider = createProvider({ places: [] });
    const result = await provider.searchGoogle(BASE_REQUEST);
    expect(result.engine).toBe('google');
  });

  it('searchGoogleLocal returns engine "google_local"', async () => {
    const provider = createProvider({ places: [] });
    const result = await provider.searchGoogleLocal(BASE_REQUEST);
    expect(result.engine).toBe('google_local');
  });

  it('searchMapsLocal returns engine "google_local"', async () => {
    const provider = createProvider({ places: [] });
    const result = await provider.searchMapsLocal(BASE_REQUEST);
    expect(result.engine).toBe('google_local');
  });

  it('skips places with no displayName', async () => {
    const provider = createProvider({
      places: [
        { id: 'no-name', displayName: {} },
        { id: 'has-name', displayName: { text: 'Valid Salon' } },
      ],
    });

    const result = await provider.searchGoogleLocal(BASE_REQUEST);
    expect(result.localBusinesses).toHaveLength(1);
    expect(result.localBusinesses[0]!.name).toBe('Valid Salon');
  });

  it('handles empty places array', async () => {
    const provider = createProvider({ places: [] });
    const result = await provider.searchGoogleLocal(BASE_REQUEST);
    expect(result.localBusinesses).toHaveLength(0);
  });

  it('handles missing places field', async () => {
    const provider = createProvider({});
    const result = await provider.searchGoogleLocal(BASE_REQUEST);
    expect(result.localBusinesses).toHaveLength(0);
  });

  it('throws GooglePlacesRequestError on non-ok response', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'bad request' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });

    const provider = new GooglePlacesDiscoveryProvider({
      apiKey: 'test-key',
      rps: 100,
      maxAttempts: 1,
      fetchImpl,
    });

    await expect(provider.searchGoogleLocal(BASE_REQUEST)).rejects.toThrow(
      GooglePlacesRequestError,
    );
  });

  it('throws on 402 billing error without retry', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'billing' } }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      });

    const provider = new GooglePlacesDiscoveryProvider({
      apiKey: 'test-key',
      rps: 100,
      maxAttempts: 1,
      fetchImpl,
    });

    await expect(provider.searchGoogleLocal(BASE_REQUEST)).rejects.toThrow(
      /billing/i,
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('BILLING/AUTH ERROR'),
    );
    consoleSpy.mockRestore();
  });

  it('sends correct headers and body', async () => {
    let capturedRequest: { url: string; init: RequestInit } | null = null;

    const fetchImpl: typeof fetch = async (input, init) => {
      capturedRequest = { url: String(input), init: init ?? {} };
      return new Response(JSON.stringify({ places: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const provider = new GooglePlacesDiscoveryProvider({
      apiKey: 'my-test-key',
      rps: 100,
      fetchImpl,
    });

    await provider.searchGoogleLocal(BASE_REQUEST);

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.url).toBe(
      'https://places.googleapis.com/v1/places:searchText',
    );
    const headers = capturedRequest!.init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('my-test-key');
    expect(headers['X-Goog-FieldMask']).toContain('places.displayName');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(capturedRequest!.init.body as string);
    expect(body.textQuery).toBe('beauty salon dubai');
    expect(body.languageCode).toBe('en');
    expect(body.locationRestriction).toBeDefined();
    expect(body.locationRestriction.rectangle.low.latitude).toBe(22.63);
  });

  it('prefers nationalPhoneNumber over internationalPhoneNumber', async () => {
    const provider = createProvider({
      places: [
        {
          id: 'phone-test',
          displayName: { text: 'Phone Test' },
          nationalPhoneNumber: '04-111-2222',
          internationalPhoneNumber: '+971-4-111-2222',
        },
      ],
    });

    const result = await provider.searchGoogleLocal(BASE_REQUEST);
    expect(result.localBusinesses[0]!.phone).toBe('04-111-2222');
  });

  it('falls back to internationalPhoneNumber when national is missing', async () => {
    const provider = createProvider({
      places: [
        {
          id: 'phone-test-2',
          displayName: { text: 'Phone Test 2' },
          internationalPhoneNumber: '+971-4-111-2222',
        },
      ],
    });

    const result = await provider.searchGoogleLocal(BASE_REQUEST);
    expect(result.localBusinesses[0]!.phone).toBe('+971-4-111-2222');
  });

  it('extracts city from locality address component', async () => {
    const provider = createProvider({
      places: [
        {
          id: 'city-test',
          displayName: { text: 'City Test' },
          addressComponents: [
            { longText: 'Riyadh', shortText: 'Riyadh', types: ['locality'] },
            { longText: 'Saudi Arabia', shortText: 'SA', types: ['country'] },
          ],
        },
      ],
    });

    const result = await provider.searchGoogleLocal({
      ...BASE_REQUEST,
      countryCode: 'SA',
    });
    expect(result.localBusinesses[0]!.city).toBe('Riyadh');
  });

  it('falls back to admin area when locality is missing', async () => {
    const provider = createProvider({
      places: [
        {
          id: 'admin-test',
          displayName: { text: 'Admin Test' },
          addressComponents: [
            { longText: 'Amman Governorate', shortText: 'Amman', types: ['administrative_area_level_1'] },
            { longText: 'Jordan', shortText: 'JO', types: ['country'] },
          ],
        },
      ],
    });

    const result = await provider.searchGoogleLocal({
      ...BASE_REQUEST,
      countryCode: 'JO',
    });
    expect(result.localBusinesses[0]!.city).toBe('Amman Governorate');
  });
});

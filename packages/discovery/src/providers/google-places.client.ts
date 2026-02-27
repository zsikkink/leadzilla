import { setTimeout as delay } from 'node:timers/promises';

import type {
  DiscoveryCountryCode,
  DiscoveryProvider,
  NormalizedLocalBusiness,
  NormalizedProviderResponse,
  SerpApiCommonRequest,
} from './types.js';

/* ------------------------------------------------------------------ */
/* Config & constants                                                  */
/* ------------------------------------------------------------------ */

export interface GooglePlacesClientConfig {
  apiKey: string;
  rps?: number | undefined;
  maxAttempts?: number | undefined;
  backoffBaseSeconds?: number | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

const BASE_URL = 'https://places.googleapis.com/v1/places:searchText';
const DEFAULT_RPS = 2;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_SECONDS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.addressComponents',
  'places.location',
].join(',');

/* ------------------------------------------------------------------ */
/* Country bounding boxes (SW lat/lng, NE lat/lng)                     */
/* ------------------------------------------------------------------ */

interface BoundingBox {
  low: { latitude: number; longitude: number };
  high: { latitude: number; longitude: number };
}

const COUNTRY_BOUNDING_BOXES: Record<DiscoveryCountryCode, BoundingBox> = {
  AE: { low: { latitude: 22.63, longitude: 51.50 }, high: { latitude: 26.08, longitude: 56.38 } },
  SA: { low: { latitude: 16.38, longitude: 34.57 }, high: { latitude: 32.15, longitude: 55.67 } },
  JO: { low: { latitude: 29.18, longitude: 34.96 }, high: { latitude: 33.37, longitude: 39.30 } },
  EG: { low: { latitude: 22.00, longitude: 24.70 }, high: { latitude: 31.67, longitude: 36.90 } },
};

/* ------------------------------------------------------------------ */
/* Rate limiter (process-global singleton, same pattern as SerpAPI)    */
/* ------------------------------------------------------------------ */

class GlobalRpsLimiter {
  private nextAllowedAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly intervalMs: number;

  constructor(rps: number) {
    const normalized = Number.isFinite(rps) && rps > 0 ? rps : 1;
    this.intervalMs = Math.ceil(1000 / normalized);
  }

  async waitTurn(): Promise<void> {
    const ticket = this.queue.then(async () => {
      const now = Date.now();
      const waitMs = this.nextAllowedAt - now;
      if (waitMs > 0) {
        await delay(waitMs);
      }
      this.nextAllowedAt = Date.now() + this.intervalMs;
    });

    this.queue = ticket.catch(() => undefined);
    await ticket;
  }
}

const limiterByKey = new Map<string, GlobalRpsLimiter>();

function getGlobalLimiter(key: string, rps: number): GlobalRpsLimiter {
  const existing = limiterByKey.get(key);
  if (existing) {
    return existing;
  }
  const limiter = new GlobalRpsLimiter(rps);
  limiterByKey.set(key, limiter);
  return limiter;
}

/* ------------------------------------------------------------------ */
/* Google Places API response types                                    */
/* ------------------------------------------------------------------ */

interface PlacesAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface PlacesResult {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  websiteUri?: string;
  googleMapsUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: PlacesAddressComponent[];
  location?: { latitude?: number; longitude?: number };
}

interface PlacesApiResponse {
  places?: PlacesResult[];
  error?: { code?: number; message?: string; status?: string };
}

/* ------------------------------------------------------------------ */
/* Error class                                                         */
/* ------------------------------------------------------------------ */

export class GooglePlacesRequestError extends Error {
  readonly statusCode: number | null;
  readonly body: string | null;
  override readonly cause: unknown;

  constructor(
    message: string,
    options: {
      statusCode: number | null;
      body: string | null;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'GooglePlacesRequestError';
    this.statusCode = options.statusCode;
    this.body = options.body;
    this.cause = options.cause;
  }
}

/* ------------------------------------------------------------------ */
/* Normalization helpers                                                */
/* ------------------------------------------------------------------ */

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractAddressComponent(
  components: PlacesAddressComponent[] | undefined,
  type: string,
  field: 'shortText' | 'longText' = 'shortText',
): string | null {
  if (!components) {
    return null;
  }
  for (const component of components) {
    if (component.types?.includes(type)) {
      return normalizeString(component[field]) ?? null;
    }
  }
  return null;
}

function normalizePlace(
  place: PlacesResult,
  requestCountryCode: DiscoveryCountryCode,
): NormalizedLocalBusiness | null {
  const name = normalizeString(place.displayName?.text);
  if (!name) {
    return null;
  }

  const placeCountry = extractAddressComponent(place.addressComponents, 'country', 'shortText');
  if (placeCountry && placeCountry.toUpperCase() !== requestCountryCode) {
    return null;
  }

  const phone =
    normalizeString(place.nationalPhoneNumber) ??
    normalizeString(place.internationalPhoneNumber);

  const city =
    extractAddressComponent(place.addressComponents, 'locality', 'longText') ??
    extractAddressComponent(place.addressComponents, 'administrative_area_level_1', 'longText');

  return {
    id: place.id ?? `gp-${name}`,
    name,
    url: normalizeString(place.googleMapsUri),
    websiteUrl: normalizeString(place.websiteUri),
    address: normalizeString(place.formattedAddress),
    phone,
    city,
    countryCode: requestCountryCode,
    category: normalizeString(place.primaryTypeDisplayName?.text),
    rating: typeof place.rating === 'number' && Number.isFinite(place.rating) ? place.rating : null,
    reviewCount:
      typeof place.userRatingCount === 'number' && Number.isFinite(place.userRatingCount)
        ? Math.floor(place.userRatingCount)
        : null,
    latitude:
      typeof place.location?.latitude === 'number' && Number.isFinite(place.location.latitude)
        ? place.location.latitude
        : null,
    longitude:
      typeof place.location?.longitude === 'number' && Number.isFinite(place.location.longitude)
        ? place.location.longitude
        : null,
    instagramHandle: null,
    raw: place,
  };
}

/* ------------------------------------------------------------------ */
/* Provider implementation                                             */
/* ------------------------------------------------------------------ */

export class GooglePlacesDiscoveryProvider implements DiscoveryProvider {
  private readonly apiKey: string;
  private readonly maxAttempts: number;
  private readonly backoffBaseSeconds: number;
  private readonly timeoutMs: number;
  private readonly limiter: GlobalRpsLimiter;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GooglePlacesClientConfig) {
    this.apiKey = config.apiKey;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffBaseSeconds = config.backoffBaseSeconds ?? DEFAULT_BACKOFF_BASE_SECONDS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.limiter = getGlobalLimiter('google-places-global', config.rps ?? DEFAULT_RPS);
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async searchGoogle(params: SerpApiCommonRequest): Promise<NormalizedProviderResponse> {
    return this.executeSearch(params, 'google');
  }

  async searchGoogleLocal(params: SerpApiCommonRequest): Promise<NormalizedProviderResponse> {
    return this.executeSearch(params, 'google_local');
  }

  async searchMapsLocal(params: SerpApiCommonRequest): Promise<NormalizedProviderResponse> {
    return this.executeSearch(params, 'google_local');
  }

  private async executeSearch(
    params: SerpApiCommonRequest,
    engine: 'google' | 'google_local',
  ): Promise<NormalizedProviderResponse> {
    if (params.page > 1) {
      return {
        engine,
        organicResults: [],
        localBusinesses: [],
        raw: { skipped: true, reason: 'page > 1 not supported by Google Places API' },
      };
    }

    const boundingBox = COUNTRY_BOUNDING_BOXES[params.countryCode];
    const body: Record<string, unknown> = {
      textQuery: params.query,
      languageCode: params.language,
    };

    if (boundingBox) {
      body.locationRestriction = {
        rectangle: {
          low: boundingBox.low,
          high: boundingBox.high,
        },
      };
    }

    const response = await this.requestWithRetry(body);
    const places = response.places ?? [];

    const localBusinesses: NormalizedLocalBusiness[] = [];
    for (const place of places) {
      const normalized = normalizePlace(place, params.countryCode);
      if (normalized) {
        localBusinesses.push(normalized);
      }
    }

    return {
      engine,
      organicResults: [],
      localBusinesses,
      raw: response,
    };
  }

  private async requestWithRetry(body: Record<string, unknown>): Promise<PlacesApiResponse> {
    let lastError: GooglePlacesRequestError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await this.limiter.waitTurn();

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, this.timeoutMs);

      try {
        const response = await this.fetchImpl(BASE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': FIELD_MASK,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const responseBody = await readResponseText(response);

          if (response.status === 402 || response.status === 403) {
            const error = new GooglePlacesRequestError(
              `Google Places API billing/auth error: status=${response.status}`,
              { statusCode: response.status, body: responseBody },
            );
            console.error(
              '[google-places] BILLING/AUTH ERROR — API key may be invalid or billing quota exhausted. ' +
                `status=${response.status} body=${responseBody ?? '(empty)'}`,
            );
            throw error;
          }

          const error = new GooglePlacesRequestError(
            `Google Places API request failed: status=${response.status}`,
            { statusCode: response.status, body: responseBody },
          );

          if (TRANSIENT_STATUSES.has(response.status) && attempt < this.maxAttempts) {
            await this.waitBackoff(attempt);
            lastError = error;
            continue;
          }

          throw error;
        }

        const json = (await response.json()) as unknown;
        if (!json || typeof json !== 'object') {
          throw new GooglePlacesRequestError(
            'Google Places API response is not a JSON object',
            { statusCode: response.status, body: JSON.stringify(json) },
          );
        }

        const payload = json as PlacesApiResponse;
        if (payload.error) {
          throw new GooglePlacesRequestError(
            `Google Places API error: ${payload.error.message ?? 'unknown'}`,
            { statusCode: payload.error.code ?? response.status, body: JSON.stringify(payload) },
          );
        }

        return payload;
      } catch (error: unknown) {
        const wrapped =
          error instanceof GooglePlacesRequestError
            ? error
            : new GooglePlacesRequestError(
                `Google Places API request failed before response completion`,
                { statusCode: null, body: null, cause: error },
              );

        if (attempt < this.maxAttempts) {
          await this.waitBackoff(attempt);
          lastError = wrapped;
          continue;
        }

        throw wrapped;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new GooglePlacesRequestError(
      'Google Places API request failed',
      { statusCode: null, body: null },
    );
  }

  private async waitBackoff(attempt: number): Promise<void> {
    const baseMs = this.backoffBaseSeconds * 1000;
    const exponential = baseMs * (2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * Math.max(1, baseMs));
    await delay(exponential + jitter);
  }
}

async function readResponseText(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

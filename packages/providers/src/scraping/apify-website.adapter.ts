export interface ApifyWebsiteAdapterConfig {
  apiKey: string | undefined;
  actorId: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface ApifyWebsiteData {
  paymentWidgets: string[];
  hasShopify: boolean;
  hasBookingForm: boolean;
  hasPricingTiers: boolean;
  hasProductCatalog: boolean;
  detectedPlatforms: string[];
}

export interface ApifyWebsiteFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export type ApifyWebsiteResult =
  | { status: 'success'; data: ApifyWebsiteData }
  | { status: 'retryable_error'; failure: ApifyWebsiteFailure }
  | { status: 'terminal_error'; failure: ApifyWebsiteFailure };

const DEFAULT_TIMEOUT_MS = 60_000;

const PAYMENT_KEYWORDS = [
  'stripe',
  'paypal',
  'square',
  'braintree',
  'adyen',
  'checkout.com',
  'tabby',
  'tamara',
  'postpay',
  'cashfree',
  'razorpay',
  'paddle',
  'klarna',
  'afterpay',
] as const;

const BOOKING_KEYWORDS = [
  'calendly',
  'booking',
  'schedule',
  'appointment',
  'reserve',
  'book-now',
  'book_now',
] as const;

const PRICING_KEYWORDS = [
  'pricing',
  'plans',
  'subscription',
  'per month',
  '/mo',
  'per year',
  '/yr',
  'enterprise',
  'starter',
  'professional',
] as const;

const CATALOG_KEYWORDS = [
  'add to cart',
  'add-to-cart',
  'product-card',
  'product-list',
  'shop-now',
  'buy now',
  'product catalog',
] as const;

const PLATFORM_SIGNATURES: ReadonlyArray<readonly [string, string]> = [
  ['shopify', 'Shopify'],
  ['woocommerce', 'WooCommerce'],
  ['magento', 'Magento'],
  ['bigcommerce', 'BigCommerce'],
  ['squarespace', 'Squarespace'],
  ['wix', 'Wix'],
  ['wordpress', 'WordPress'],
  ['webflow', 'Webflow'],
  ['salla', 'Salla'],
  ['zid.sa', 'Zid'],
] as const;

function classifyStatus(statusCode: number): 'retryable' | 'terminal' {
  if (statusCode === 429 || statusCode >= 500) {
    return 'retryable';
  }
  return 'terminal';
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function matchesAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function findAllMatches(text: string, keywords: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw));
}

function extractFromItems(items: unknown[]): ApifyWebsiteData {
  // Combine all text content from crawled pages
  const allText = items
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      return [
        typeof record.text === 'string' ? record.text : '',
        typeof record.html === 'string' ? record.html : '',
        typeof record.body === 'string' ? record.body : '',
        typeof record.pageContent === 'string' ? record.pageContent : '',
        typeof record.url === 'string' ? record.url : '',
      ].join(' ');
    })
    .join(' ');

  const paymentWidgets = findAllMatches(allText, PAYMENT_KEYWORDS as unknown as string[]);
  const detectedPlatforms = PLATFORM_SIGNATURES
    .filter(([sig]) => allText.toLowerCase().includes(sig))
    .map(([, name]) => name);

  return {
    paymentWidgets: [...new Set(paymentWidgets)],
    hasShopify: allText.toLowerCase().includes('shopify'),
    hasBookingForm: matchesAny(allText, BOOKING_KEYWORDS as unknown as string[]),
    hasPricingTiers: matchesAny(allText, PRICING_KEYWORDS as unknown as string[]),
    hasProductCatalog: matchesAny(allText, CATALOG_KEYWORDS as unknown as string[]),
    detectedPlatforms: [...new Set(detectedPlatforms)],
  };
}

export class ApifyWebsiteAdapter {
  private readonly apiKey: string | undefined;
  private readonly actorId: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ApifyWebsiteAdapterConfig) {
    this.apiKey = config.apiKey;
    this.actorId = config.actorId;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey) && Boolean(this.actorId);
  }

  async scrapeWebsite(domain: string): Promise<ApifyWebsiteResult> {
    if (!this.apiKey || !this.actorId) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'APIFY_API_KEY or APIFY_WEBSITE_ACTOR_ID is not configured',
          raw: null,
        },
      };
    }

    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(this.actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(this.apiKey)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          startUrls: [{ url: `https://${domain}` }],
        }),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Apify website scrape request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await response.text();

    if (!response.ok) {
      const classification = classifyStatus(response.status);
      const failure: ApifyWebsiteFailure = {
        classification,
        statusCode: response.status,
        message: `Apify website scrape failed with status ${response.status}`,
        raw: parseJsonSafe(rawText),
      };
      return classification === 'retryable'
        ? { status: 'retryable_error', failure }
        : { status: 'terminal_error', failure };
    }

    const parsed = parseJsonSafe(rawText);
    const items = Array.isArray(parsed) ? parsed : [];

    return {
      status: 'success',
      data: extractFromItems(items),
    };
  }
}

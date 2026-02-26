import * as cheerio from 'cheerio';

// ── Config ─────────────────────────────────────────────────────────────────

export interface WebsiteScraperConfig {
  timeoutMs?: number | undefined;
  userAgent?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

// ── Result types ───────────────────────────────────────────────────────────

export interface WebsiteScraperData {
  paymentWidgets: string[];
  hasShopify: boolean;
  platform: string | null;
  hasBookingForm: boolean;
  hasPricingTiers: boolean;
  hasProductCatalog: boolean;
  hasWhatsApp: boolean;
  detectedPlatforms: string[];
}

export interface WebsiteScraperFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export type WebsiteScraperResult =
  | { status: 'success'; data: WebsiteScraperData }
  | { status: 'retryable_error'; failure: WebsiteScraperFailure }
  | { status: 'terminal_error'; failure: WebsiteScraperFailure };

// ── Keyword lists (superset of apify-website.adapter.ts) ───────────────────

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
  'payfort',
] as const;

const BOOKING_KEYWORDS = [
  'calendly',
  'booking',
  'schedule',
  'appointment',
  'reserve',
  'book-now',
  'book_now',
  'quote',
  'contact',
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

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; LeadFlood/1.0)';

function classifyStatus(statusCode: number): 'retryable' | 'terminal' {
  if (statusCode === 429 || statusCode >= 500) {
    return 'retryable';
  }
  return 'terminal';
}

function normaliseUrl(input: string): string {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return input;
  }
  return `https://${input}`;
}

function matchesAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

// ── Cheerio extraction ─────────────────────────────────────────────────────

function extractPaymentWidgets($: cheerio.CheerioAPI): string[] {
  const found = new Set<string>();
  const html = $.html().toLowerCase();

  // Broad text search across entire HTML (scripts, iframes, forms, links)
  for (const kw of PAYMENT_KEYWORDS) {
    if (html.includes(kw)) {
      found.add(kw);
    }
  }

  // Targeted: script src attributes
  $('script[src]').each((_, el) => {
    const src = ($(el).attr('src') ?? '').toLowerCase();
    for (const kw of PAYMENT_KEYWORDS) {
      if (src.includes(kw)) {
        found.add(kw);
      }
    }
  });

  // Targeted: iframe src attributes
  $('iframe[src]').each((_, el) => {
    const src = ($(el).attr('src') ?? '').toLowerCase();
    for (const kw of PAYMENT_KEYWORDS) {
      if (src.includes(kw)) {
        found.add(kw);
      }
    }
  });

  // Targeted: form actions
  $('form[action]').each((_, el) => {
    const action = ($(el).attr('action') ?? '').toLowerCase();
    for (const kw of PAYMENT_KEYWORDS) {
      if (action.includes(kw)) {
        found.add(kw);
      }
    }
  });

  return [...found];
}

function detectPlatforms(
  $: cheerio.CheerioAPI,
): { primary: string | null; all: string[] } {
  const html = $.html().toLowerCase();
  const detected = new Set<string>();

  // Check full HTML for signature keywords
  for (const [sig, name] of PLATFORM_SIGNATURES) {
    if (html.includes(sig)) {
      detected.add(name);
    }
  }

  // Shopify-specific: `Shopify.` in inline scripts, myshopify.com links
  const scriptText = $('script')
    .map((_, el) => $(el).html() ?? '')
    .get()
    .join(' ');

  if (
    scriptText.includes('Shopify.') ||
    html.includes('myshopify.com')
  ) {
    detected.add('Shopify');
  }

  // WooCommerce-specific: body or element classes
  if (
    $('[class*="woocommerce"]').length > 0 ||
    $('body.woocommerce').length > 0
  ) {
    detected.add('WooCommerce');
  }

  const all = [...detected];

  // Primary platform: first match in PLATFORM_SIGNATURES order
  let primary: string | null = null;
  for (const [, name] of PLATFORM_SIGNATURES) {
    if (detected.has(name)) {
      primary = name;
      break;
    }
  }

  return { primary, all };
}

function detectBookingForm($: cheerio.CheerioAPI): boolean {
  // Check form elements for booking/contact/quote keywords
  const forms = $('form');
  let found = false;

  forms.each((_, el) => {
    const action = ($(el).attr('action') ?? '').toLowerCase();
    const cls = ($(el).attr('class') ?? '').toLowerCase();
    const id = ($(el).attr('id') ?? '').toLowerCase();
    const combined = `${action} ${cls} ${id}`;

    if (matchesAny(combined, BOOKING_KEYWORDS as unknown as string[])) {
      found = true;
    }
  });

  if (found) return true;

  // Also check for Calendly embeds and similar widgets
  const html = $.html().toLowerCase();
  return matchesAny(html, BOOKING_KEYWORDS as unknown as string[]);
}

function detectPricingTiers($: cheerio.CheerioAPI): boolean {
  // Check for elements with pricing-related class names
  if (
    $('[class*="price"]').length > 0 ||
    $('[class*="pricing"]').length > 0 ||
    $('[class*="plan"]').length > 0
  ) {
    return true;
  }

  // Check for currency symbols near pricing keywords
  const text = $.text().toLowerCase();
  if (matchesAny(text, PRICING_KEYWORDS as unknown as string[])) {
    return true;
  }

  // Currency symbol heuristic: $ or AED near numeric values
  const hasCurrencyPattern =
    /(?:\$|AED|USD|EUR|GBP|SAR|QAR|BHD|KWD|OMR)\s*\d/.test($.text());
  if (
    hasCurrencyPattern &&
    ($('[class*="price"]').length > 0 || $('[class*="plan"]').length > 0)
  ) {
    return true;
  }

  return false;
}

function detectProductCatalog($: cheerio.CheerioAPI): boolean {
  // og:type product meta tag
  if ($('meta[property="og:type"][content="product"]').length > 0) {
    return true;
  }

  // JSON-LD structured data with @type: Product
  let hasProductSchema = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html() ?? '';
    if (content.includes('"Product"') || content.includes('"@type":"Product"')) {
      hasProductSchema = true;
    }
  });
  if (hasProductSchema) return true;

  // Catalog keyword heuristic in HTML
  const html = $.html().toLowerCase();
  return matchesAny(html, CATALOG_KEYWORDS as unknown as string[]);
}

function detectWhatsApp($: cheerio.CheerioAPI): boolean {
  const html = $.html().toLowerCase();
  return html.includes('wa.me/') || html.includes('api.whatsapp.com');
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class WebsiteScraperAdapter {
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: WebsiteScraperConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return true;
  }

  async scrapeWebsite(domain: string): Promise<WebsiteScraperResult> {
    const url = normaliseUrl(domain);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message:
            error instanceof Error
              ? error.message
              : 'Website scrape request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const classification = classifyStatus(response.status);
      const rawText = await response.text().catch(() => '');
      const failure: WebsiteScraperFailure = {
        classification,
        statusCode: response.status,
        message: `Website scrape failed with status ${response.status}`,
        raw: rawText,
      };
      return classification === 'retryable'
        ? { status: 'retryable_error', failure }
        : { status: 'terminal_error', failure };
    }

    let html: string;
    try {
      html = await response.text();
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: response.status,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to read response body',
          raw: error,
        },
      };
    }

    const $ = cheerio.load(html);

    const paymentWidgets = extractPaymentWidgets($);
    const { primary: platform, all: detectedPlatforms } = detectPlatforms($);
    const hasShopify = detectedPlatforms.includes('Shopify');
    const hasBookingForm = detectBookingForm($);
    const hasPricingTiers = detectPricingTiers($);
    const hasProductCatalog = detectProductCatalog($);
    const hasWhatsApp = detectWhatsApp($);

    return {
      status: 'success',
      data: {
        paymentWidgets: [...new Set(paymentWidgets)],
        hasShopify,
        platform,
        hasBookingForm,
        hasPricingTiers,
        hasProductCatalog,
        hasWhatsApp,
        detectedPlatforms: [...new Set(detectedPlatforms)],
      },
    };
  }
}

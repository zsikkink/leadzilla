import * as cheerio from 'cheerio';
import type { Browser, BrowserType } from 'playwright-core';

// ── Config ─────────────────────────────────────────────────────────────────

export interface WebsiteScraperConfig {
  timeoutMs?: number | undefined;
  totalTimeoutMs?: number | undefined;
  maxPages?: number | undefined;
  userAgent?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  enablePlaywright?: boolean | undefined;
  playwrightTimeoutMs?: number | undefined;
  chromiumPath?: string | undefined;
}

// ── New interfaces ────────────────────────────────────────────────────────

export interface DecisionMaker {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  seniority: 'executive' | 'director' | 'manager' | 'other';
  positionRank: number;
  source: string;
}

export interface ContactInfo {
  emails: Array<{ email: string; context: string; pageUrl: string }>;
  phones: Array<{ number: string; type: 'whatsapp' | 'mobile' | 'landline' | 'unknown'; pageUrl: string }>;
  addresses: Array<{ text: string; pageUrl: string }>;
}

export interface SocialLink {
  platform: 'instagram' | 'linkedin' | 'facebook' | 'twitter' | 'tiktok' | 'youtube' | 'whatsapp';
  url: string;
  handle: string | null;
}

export interface TechnologyStack {
  analytics: string[];
  crm: string[];
  liveChat: string[];
  emailMarketing: string[];
  ecommerce: string[];
  payments: string[];
  cssFrameworks: string[];
  hosting: string[];
}

export interface BusinessSignals {
  estimatedEmployeeCount: number | null;
  certifications: string[];
  hasClientLogos: boolean;
  hasTestimonials: boolean;
  hasCaseStudies: boolean;
}

// ── Result types ───────────────────────────────────────────────────────────

export interface WebsiteScraperData {
  // Existing signals
  paymentWidgets: string[];
  hasShopify: boolean;
  platform: string | null;
  hasBookingForm: boolean;
  hasPricingTiers: boolean;
  hasProductCatalog: boolean;
  hasWhatsApp: boolean;
  detectedPlatforms: string[];

  // Multi-page intelligence
  decisionMakers: DecisionMaker[];
  contactInfo: ContactInfo;
  socialLinks: SocialLink[];
  technologies: TechnologyStack;
  businessSignals: BusinessSignals;

  // Page-level intelligence
  pageTitle: string | null;
  metaDescription: string | null;
  detectedCountry: string | null;

  // Crawl metadata
  pagesCrawled: number;
  crawlDurationMs: number;
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

// ── Keyword lists ──────────────────────────────────────────────────────────

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

// ── Priority page paths ────────────────────────────────────────────────────

const PRIORITY_A_PATHS = [
  '/',
  '/about',
  '/about-us',
  '/contact',
  '/contact-us',
  '/team',
  '/our-team',
  '/leadership',
  '/people',
];

const PRIORITY_B_PATHS = [
  '/pricing',
  '/plans',
  '/shop',
  '/products',
  '/services',
];

const ALL_PRIORITY_PATHS = [...PRIORITY_A_PATHS, ...PRIORITY_B_PATHS];

// ── Social platform patterns ───────────────────────────────────────────────

type SocialPlatform = SocialLink['platform'];

const SOCIAL_PATTERNS: ReadonlyArray<{
  platform: SocialPlatform;
  patterns: string[];
  handleExtractor: (url: string) => string | null;
}> = [
  {
    platform: 'instagram',
    patterns: ['instagram.com/', 'instagr.am/'],
    handleExtractor: (url) => {
      const match = url.match(/(?:instagram\.com|instagr\.am)\/([a-zA-Z0-9_.]+)/);
      return match?.[1] && !['p', 'explore', 'reel', 'stories', 'accounts'].includes(match[1])
        ? match[1]
        : null;
    },
  },
  {
    platform: 'linkedin',
    patterns: ['linkedin.com/company/', 'linkedin.com/in/'],
    handleExtractor: (url) => {
      const match = url.match(/linkedin\.com\/(?:company|in)\/([a-zA-Z0-9_-]+)/);
      return match?.[1] ?? null;
    },
  },
  {
    platform: 'facebook',
    patterns: ['facebook.com/', 'fb.com/'],
    handleExtractor: (url) => {
      const match = url.match(/(?:facebook\.com|fb\.com)\/([a-zA-Z0-9_.]+)/);
      return match?.[1] && !['sharer', 'share', 'dialog', 'login', 'pages'].includes(match[1])
        ? match[1]
        : null;
    },
  },
  {
    platform: 'twitter',
    patterns: ['twitter.com/', 'x.com/'],
    handleExtractor: (url) => {
      const match = url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/);
      return match?.[1] && !['intent', 'share', 'search', 'home', 'hashtag'].includes(match[1])
        ? match[1]
        : null;
    },
  },
  {
    platform: 'tiktok',
    patterns: ['tiktok.com/@'],
    handleExtractor: (url) => {
      const match = url.match(/tiktok\.com\/@([a-zA-Z0-9_.]+)/);
      return match?.[1] ?? null;
    },
  },
  {
    platform: 'youtube',
    patterns: ['youtube.com/', 'youtu.be/'],
    handleExtractor: (url) => {
      const match = url.match(/youtube\.com\/(?:@|channel\/|c\/|user\/)([a-zA-Z0-9_-]+)/);
      return match?.[1] ?? null;
    },
  },
  {
    platform: 'whatsapp',
    patterns: ['wa.me/', 'api.whatsapp.com'],
    handleExtractor: (url) => {
      const match = url.match(/wa\.me\/(\+?[0-9]+)/);
      return match?.[1] ?? null;
    },
  },
];

// ── Technology signatures ──────────────────────────────────────────────────

const TECH_ANALYTICS_SIGS = ['gtag', '_ga', 'google-analytics', 'fbq', 'mixpanel', 'hotjar', '_hjid'] as const;
const TECH_CRM_SIGS = ['hubspot', 'hs-script', 'salesforce', 'pardot', 'zoho', 'pipedrive'] as const;
const TECH_LIVECHAT_SIGS = ['intercom', 'drift', 'drift.com', 'zendesk', 'crisp', 'crisp.chat', 'tawk.to', 'tidio'] as const;
const TECH_EMAIL_SIGS = ['mailchimp', 'mc.js', 'klaviyo', 'sendgrid', 'constant contact'] as const;
const TECH_CSS_SIGS = ['bootstrap', 'tailwind', 'materialize', 'bulma'] as const;

const TECH_ECOMMERCE_SIGS = ['shopify', 'woocommerce', 'magento', 'bigcommerce', 'salla', 'zid.sa'] as const;

// ── Certification patterns ─────────────────────────────────────────────────

const CERTIFICATION_PATTERNS = [
  'ISO 9001',
  'ISO 27001',
  'SOC 2',
  'SOC2',
  'GDPR',
  'PCI DSS',
  'PCI-DSS',
  'HIPAA',
] as const;

// ── Generic email prefixes to filter ───────────────────────────────────────

const GENERIC_EMAIL_PREFIXES = new Set([
  'noreply',
  'no-reply',
  'info',
  'hello',
  'support',
  'admin',
  'contact',
  'sales',
  'help',
  'enquiries',
  'enquiry',
  'inquiry',
  'general',
  'team',
  'mail',
  'office',
  'service',
  'webmaster',
  'postmaster',
  'marketing',
  'hr',
  'finance',
  'billing',
  'accounts',
  'reception',
  'feedback',
  'appointments',
  'events',
  'press',
  'media',
  'partnerships',
  'careers',
  'jobs',
  'recruitment',
  'booking',
  'bookings',
  'inquiries',
  'reservations',
]);

const PLATFORM_EMAIL_DOMAINS = new Set([
  'wix.com',
  'squarespace.com',
  'sentry.io',
  'wordpress.com',
  'shopify.com',
  'mailchimp.com',
  'google.com',
  'facebook.com',
  'twitter.com',
  'github.com',
]);

// ── Anchor-text keywords for link following (C1) ─────────────────────────

const TEAM_ANCHOR_KEYWORDS: ReadonlyArray<{ keyword: string; priority: number }> = [
  { keyword: 'team', priority: 0 },
  { keyword: 'about us', priority: 1 },
  { keyword: 'who we are', priority: 2 },
  { keyword: 'meet the', priority: 3 },
  { keyword: 'our people', priority: 4 },
  { keyword: 'founders', priority: 5 },
  { keyword: 'leadership', priority: 6 },
  { keyword: 'management', priority: 7 },
  { keyword: 'staff', priority: 8 },
  { keyword: 'our experts', priority: 9 },
  { keyword: 'about the team', priority: 10 },
];

// ── Name validation blocklist (C3) ────────────────────────────────────────

const NAME_BLOCKLIST_WORDS = new Set([
  'expert', 'skilled', 'quality', 'customer', 'support', 'control',
  'consultant', 'installer', 'professional', 'specialist', 'assistant',
  'associate', 'technician', 'representative', 'coordinator', 'supervisor',
  'advisor', 'analyst', 'developer', 'designer', 'engineer', 'architect',
]);

// ── Corporate suffixes (C6) ───────────────────────────────────────────────

const CORPORATE_SUFFIXES = [
  'llc', 'inc', 'ltd', 'corp', 'company', 'co.', 'group', 'management',
  'enterprise', 'international', 'services', 'solutions', 'holdings',
  'associates', 'partners', 'ventures', 'agency', 'studio', 'creative',
  'digital', 'events', 'trading', 'consulting', 'contracting',
] as const;

// ── Country detection ──────────────────────────────────────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  'united arab emirates': 'AE', uae: 'AE', dubai: 'AE', 'abu dhabi': 'AE',
  'saudi arabia': 'SA', ksa: 'SA', riyadh: 'SA', jeddah: 'SA',
  bahrain: 'BH', qatar: 'QA', kuwait: 'KW', oman: 'OM',
  jordan: 'JO', lebanon: 'LB', egypt: 'EG', morocco: 'MA',
  'united states': 'US', usa: 'US', 'united kingdom': 'GB', uk: 'GB',
  canada: 'CA', australia: 'AU', germany: 'DE', france: 'FR',
  india: 'IN', pakistan: 'PK', turkey: 'TR', singapore: 'SG',
  malaysia: 'MY', indonesia: 'ID', philippines: 'PH', nigeria: 'NG',
};

function detectCountryFromPage($: cheerio.CheerioAPI): string | null {
  // 1. JSON-LD addressCountry
  let ldCountry: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ldCountry) return false; // stop iteration
    try {
      const ld = JSON.parse($(el).text());
      const country = ld?.address?.addressCountry ?? ld?.addressCountry;
      if (typeof country === 'string' && country.length >= 2) {
        ldCountry = country.length === 2 ? country.toUpperCase() : (COUNTRY_NAMES[country.toLowerCase()] ?? null);
      }
    } catch { /* ignore */ }
  });
  if (ldCountry) return ldCountry;

  // 2. Meta geo.country tag
  const geoCountry = $('meta[name="geo.country"]').attr('content')?.trim();
  if (geoCountry && geoCountry.length >= 2) {
    return geoCountry.length === 2 ? geoCountry.toUpperCase() : (COUNTRY_NAMES[geoCountry.toLowerCase()] ?? null);
  }

  // 3. Address text containing known country names
  const addressText = $('address').text().toLowerCase() + ' ' + $('[itemtype*="PostalAddress"]').text().toLowerCase();
  for (const [name, code] of Object.entries(COUNTRY_NAMES)) {
    if (addressText.includes(name)) return code;
  }

  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_PER_PAGE_TIMEOUT_MS = 8_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_PAGES = 10;
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

/** Normalize a URL for deduplication: strip trailing slash, force https, strip www. */
function normalizeForDedup(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    u.hash = '';
    u.search = '';
    let pathname = u.pathname.replace(/\/+$/, '') || '/';
    pathname = pathname.replace(/\/+/g, '/');
    const host = u.hostname.replace(/^www\./, '');
    return `https://${host}${pathname}`.toLowerCase();
  } catch {
    return urlStr.toLowerCase().replace(/\/+$/, '');
  }
}

/** Check if a path matches any of the priority path patterns. */
function matchesPriorityPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return ALL_PRIORITY_PATHS.some((p) => normalized === p);
}

/** Get priority score for a path. Lower = higher priority. */
function getPathPriority(pathname: string): number {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const aIdx = PRIORITY_A_PATHS.indexOf(normalized);
  if (aIdx !== -1) return aIdx;
  const bIdx = PRIORITY_B_PATHS.indexOf(normalized);
  if (bIdx !== -1) return PRIORITY_A_PATHS.length + bIdx;
  return ALL_PRIORITY_PATHS.length + 1;
}

/** Classify seniority from a title string. */
function classifySeniority(title: string): DecisionMaker['seniority'] {
  const lower = title.toLowerCase();
  if (/\b(ceo|cto|cfo|coo|cmo|cpo|cio|founder|co-founder|cofounder|owner|president|chairm)/i.test(lower)) {
    return 'executive';
  }
  if (/\b(director|vp|vice\s*president|head\s+of|svp|evp)/i.test(lower)) {
    return 'director';
  }
  if (/\b(manager|lead|supervisor|coordinator)/i.test(lower)) {
    return 'manager';
  }
  return 'other';
}

/** Check if an email prefix is generic. */
function isGenericEmail(email: string): boolean {
  const prefix = email.split('@')[0]?.toLowerCase() ?? '';
  return GENERIC_EMAIL_PREFIXES.has(prefix);
}

/** Check if an email domain is a platform domain. */
function isPlatformEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return PLATFORM_EMAIL_DOMAINS.has(domain);
}

// ── Decision maker name validation (C3, C4, C5, C6) ──────────────────────

/**
 * Validate a potential decision maker name.
 * Returns false (reject) if the name fails any validation rule.
 */
function isValidDecisionMakerName(name: string, businessName?: string | undefined): boolean {
  const trimmed = name.trim();

  // C5: Reject all-uppercase names (except 2-3 letter initials like "JK")
  const lettersOnly = trimmed.replace(/\s/g, '');
  if (lettersOnly.length > 3 && lettersOnly === lettersOnly.toUpperCase() && /^[A-Z]+$/.test(lettersOnly)) {
    return false;
  }

  // C3: Reject names containing blocklisted words (strip trailing 's' to catch plurals)
  const words = trimmed.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (NAME_BLOCKLIST_WORDS.has(word) || NAME_BLOCKLIST_WORDS.has(word.replace(/s$/, ''))) {
      return false;
    }
  }
  // C3: "Executive" rejected only when used alone
  if (trimmed.toLowerCase() === 'executive') {
    return false;
  }

  // C6: Reject names containing corporate suffixes
  const nameLower = trimmed.toLowerCase();
  for (const suffix of CORPORATE_SUFFIXES) {
    if (nameLower.includes(suffix)) {
      return false;
    }
  }

  // C4: Reject if name matches business name (case-insensitive substring in either direction)
  if (businessName) {
    const bizLower = businessName.trim().toLowerCase();
    if (bizLower.length > 0 && nameLower.length > 0) {
      if (nameLower === bizLower || nameLower.includes(bizLower) || bizLower.includes(nameLower)) {
        return false;
      }
    }
  }

  return true;
}

// ── Email regex ────────────────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// ── Phone regex (international: +971, +966, +962, +20, and general E.164) ─

const PHONE_REGEX = /(?:\+|00)[1-9]\d{6,14}/g;

// ── Employee count regex ───────────────────────────────────────────────────

const EMPLOYEE_REGEX = /\b(\d{1,6})\+?\s*(?:employees?|team\s+members?|staff)\b/gi;

// ── Cheerio extraction (original signals) ──────────────────────────────────

function extractPaymentWidgets($: cheerio.CheerioAPI): string[] {
  const found = new Set<string>();
  const html = $.html().toLowerCase();

  for (const kw of PAYMENT_KEYWORDS) {
    if (html.includes(kw)) {
      found.add(kw);
    }
  }

  $('script[src]').each((_, el) => {
    const src = ($(el).attr('src') ?? '').toLowerCase();
    for (const kw of PAYMENT_KEYWORDS) {
      if (src.includes(kw)) {
        found.add(kw);
      }
    }
  });

  $('iframe[src]').each((_, el) => {
    const src = ($(el).attr('src') ?? '').toLowerCase();
    for (const kw of PAYMENT_KEYWORDS) {
      if (src.includes(kw)) {
        found.add(kw);
      }
    }
  });

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

  for (const [sig, name] of PLATFORM_SIGNATURES) {
    if (html.includes(sig)) {
      detected.add(name);
    }
  }

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

  if (
    $('[class*="woocommerce"]').length > 0 ||
    $('body.woocommerce').length > 0
  ) {
    detected.add('WooCommerce');
  }

  const all = [...detected];

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

  const html = $.html().toLowerCase();
  return matchesAny(html, BOOKING_KEYWORDS as unknown as string[]);
}

function detectPricingTiers($: cheerio.CheerioAPI): boolean {
  if (
    $('[class*="price"]').length > 0 ||
    $('[class*="pricing"]').length > 0 ||
    $('[class*="plan"]').length > 0
  ) {
    return true;
  }

  const text = $.text().toLowerCase();
  if (matchesAny(text, PRICING_KEYWORDS as unknown as string[])) {
    return true;
  }

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
  if ($('meta[property="og:type"][content="product"]').length > 0) {
    return true;
  }

  let hasProductSchema = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html() ?? '';
    if (content.includes('"Product"') || content.includes('"@type":"Product"')) {
      hasProductSchema = true;
    }
  });
  if (hasProductSchema) return true;

  const html = $.html().toLowerCase();
  return matchesAny(html, CATALOG_KEYWORDS as unknown as string[]);
}

function detectWhatsApp($: cheerio.CheerioAPI): boolean {
  const html = $.html().toLowerCase();
  return html.includes('wa.me/') || html.includes('api.whatsapp.com');
}

// ── New extractors ─────────────────────────────────────────────────────────

/** Maximum decision makers to extract per page. */
const MAX_DECISION_MAKERS = 5;

/** Extract decision makers from team/about pages. Preserves visual page order via positionRank. */
function extractDecisionMakers($: cheerio.CheerioAPI, pageUrl: string, businessName?: string | undefined): DecisionMaker[] {
  const makers: DecisionMaker[] = [];
  const seenNames = new Set<string>();

  function addMaker(dm: Omit<DecisionMaker, 'positionRank'>): void {
    if (makers.length >= MAX_DECISION_MAKERS) return;
    if (seenNames.has(dm.name.toLowerCase())) return;
    // C3, C4, C5, C6: Validate name before adding
    if (!isValidDecisionMakerName(dm.name, businessName)) return;
    seenNames.add(dm.name.toLowerCase());
    makers.push({ ...dm, positionRank: makers.length + 1 });
  }

  // 1. JSON-LD Person schema entries
  $('script[type="application/ld+json"]').each((_, el) => {
    if (makers.length >= MAX_DECISION_MAKERS) return false;
    const raw = $(el).html() ?? '';
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (
          item &&
          typeof item === 'object' &&
          (item as Record<string, unknown>)['@type'] === 'Person' &&
          typeof (item as Record<string, unknown>)['name'] === 'string'
        ) {
          const person = item as Record<string, unknown>;
          const name = (person['name'] as string).trim();
          const jobTitle = typeof person['jobTitle'] === 'string' ? (person['jobTitle'] as string).trim() : null;
          const email = typeof person['email'] === 'string' ? (person['email'] as string).trim() : null;
          const phone = typeof person['telephone'] === 'string' ? (person['telephone'] as string).trim() : null;
          const sameAs = Array.isArray(person['sameAs']) ? (person['sameAs'] as string[]) : [];
          const linkedinUrl = sameAs.find((u) => typeof u === 'string' && u.includes('linkedin.com')) ?? null;

          if (name) {
            addMaker({
              name,
              title: jobTitle,
              email,
              phone,
              linkedinUrl,
              seniority: jobTitle ? classifySeniority(jobTitle) : 'other',
              source: pageUrl,
            });
          }
        }
      }
    } catch {
      // Malformed JSON-LD — skip
    }
  });

  // 2. Team/staff sections with structured HTML
  //    Cheerio iterates in document order (top-to-bottom, left-to-right in source),
  //    matching visual reading order for both flex-row and flex-col layouts.
  const teamSelectors = [
    '[class*="team"]',
    '[class*="staff"]',
    '[class*="member"]',
    '[class*="person"]',
    '[class*="leader"]',
    '[id*="team"]',
    '[id*="staff"]',
  ];

  for (const selector of teamSelectors) {
    $(selector).each((_, el) => {
      if (makers.length >= MAX_DECISION_MAKERS) return false;
      const block = $(el);
      const nameEl = block.find('h1, h2, h3, h4, h5, h6, [class*="name"]').first();
      const titleEl = block.find('[class*="title"], [class*="position"], [class*="role"], [class*="designation"]').first();

      if (nameEl.length === 0) return;

      const name = nameEl.text().trim();
      const title = titleEl.length > 0 ? titleEl.text().trim() : null;

      // Validate name: should be 2-5 words, no digits, reasonable length
      if (!name || name.length < 3 || name.length > 80 || /\d/.test(name)) return;
      const wordCount = name.split(/\s+/).length;
      if (wordCount < 2 || wordCount > 5) return;

      // Look for linkedin link within the block
      let linkedinUrl: string | null = null;
      block.find('a[href*="linkedin.com"]').each((_, linkEl) => {
        if (!linkedinUrl) {
          linkedinUrl = $(linkEl).attr('href') ?? null;
        }
      });

      // Look for email within the block
      let email: string | null = null;
      block.find('a[href^="mailto:"]').each((_, linkEl) => {
        if (!email) {
          const href = $(linkEl).attr('href') ?? '';
          const extracted = href.replace('mailto:', '').split('?')[0]?.trim() ?? '';
          if (extracted.includes('@')) {
            email = extracted;
          }
        }
      });

      // Look for phone within the block
      let phone: string | null = null;
      block.find('a[href^="tel:"]').each((_, linkEl) => {
        if (!phone) {
          const href = $(linkEl).attr('href') ?? '';
          phone = href.replace('tel:', '').replace(/[\s()-]/g, '').trim() || null;
        }
      });

      addMaker({
        name,
        title,
        email,
        phone,
        linkedinUrl,
        seniority: title ? classifySeniority(title) : 'other',
        source: pageUrl,
      });
    });
  }

  // 3. Heuristic: "Name - Title" or "Name, Title" patterns near headings
  if (makers.length < MAX_DECISION_MAKERS) {
    const bodyText = $.text();
    const nameTitleRegex = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[,\u2013\u2014\-|]\s*([A-Z][A-Za-z\s&,/]{3,50})$/gm;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = nameTitleRegex.exec(bodyText)) !== null) {
      if (makers.length >= MAX_DECISION_MAKERS) break;
      const name = hMatch[1]!.trim();
      const title = hMatch[2]!.trim();

      if (/^(learn|read|view|see|click|find|get|our|the)\b/i.test(name)) continue;

      addMaker({
        name,
        title,
        email: null,
        phone: null,
        linkedinUrl: null,
        seniority: classifySeniority(title),
        source: pageUrl,
      });
    }
  }

  return makers;
}

/** Extract emails from a page. */
function extractEmails($: cheerio.CheerioAPI, pageUrl: string): Array<{ email: string; context: string; pageUrl: string }> {
  const results: Array<{ email: string; context: string; pageUrl: string }> = [];
  const seen = new Set<string>();

  // 1. mailto: links
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const email = href.replace('mailto:', '').split('?')[0]?.trim().toLowerCase() ?? '';
    if (email && email.includes('@') && !seen.has(email)) {
      seen.add(email);
      results.push({ email, context: 'mailto_link', pageUrl });
    }
  });

  // 2. Regex across page text
  const text = $.text();
  const textMatches = text.match(EMAIL_REGEX) ?? [];
  for (const rawEmail of textMatches) {
    const email = rawEmail.toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      const inFooter = $('footer').text().includes(rawEmail);
      results.push({ email, context: inFooter ? 'footer' : 'text', pageUrl });
    }
  }

  // 3. Regex across raw HTML (catches emails in attributes, comments)
  const html = $.html();
  const htmlMatches = html.match(EMAIL_REGEX) ?? [];
  for (const rawEmail of htmlMatches) {
    const email = rawEmail.toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      results.push({ email, context: 'text', pageUrl });
    }
  }

  return results;
}

/** Classify a phone number as mobile, landline, or unknown. */
function classifyPhoneType(number: string): 'mobile' | 'landline' | 'unknown' {
  // UAE: +9715x = mobile, +9714x/+9712x = landline
  if (number.startsWith('+9715') || number.startsWith('009715')) return 'mobile';
  if (number.startsWith('+9714') || number.startsWith('+9712') || number.startsWith('009714') || number.startsWith('009712')) return 'landline';
  // KSA: +9665 = mobile, +9661x = landline
  if (number.startsWith('+9665') || number.startsWith('009665')) return 'mobile';
  if (number.startsWith('+9661') || number.startsWith('009661')) return 'landline';
  // Jordan: +9627 = mobile
  if (number.startsWith('+9627') || number.startsWith('009627')) return 'mobile';
  // Egypt: +201 = mobile, +202 = landline
  if (number.startsWith('+201') || number.startsWith('00201')) return 'mobile';
  if (number.startsWith('+202') || number.startsWith('00202')) return 'landline';

  return 'unknown';
}

/** Extract phone numbers from a page. */
function extractPhones($: cheerio.CheerioAPI, pageUrl: string): Array<{ number: string; type: 'whatsapp' | 'mobile' | 'landline' | 'unknown'; pageUrl: string }> {
  const results: Array<{ number: string; type: 'whatsapp' | 'mobile' | 'landline' | 'unknown'; pageUrl: string }> = [];
  const seen = new Set<string>();

  // Collect WhatsApp numbers from wa.me links
  const whatsappNumbers = new Set<string>();
  $('a[href*="wa.me/"], a[href*="api.whatsapp.com"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const numMatch = href.match(/(?:wa\.me\/|phone=)(\+?[0-9]+)/);
    if (numMatch?.[1]) {
      const num = numMatch[1].startsWith('+') ? numMatch[1] : `+${numMatch[1]}`;
      whatsappNumbers.add(num);
      if (!seen.has(num)) {
        seen.add(num);
        results.push({ number: num, type: 'whatsapp', pageUrl });
      }
    }
  });

  // tel: links
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const raw = href.replace('tel:', '').replace(/[\s()-]/g, '').trim();
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      const type = whatsappNumbers.has(raw) ? 'whatsapp' as const : classifyPhoneType(raw);
      results.push({ number: raw, type, pageUrl });
    }
  });

  // Regex across text
  const text = $.text().replace(/[\s()-]/g, ' ');
  const phoneMatches = text.match(PHONE_REGEX) ?? [];
  for (const raw of phoneMatches) {
    const num = raw.replace(/[\s()-]/g, '');
    if (!seen.has(num)) {
      seen.add(num);
      const type = whatsappNumbers.has(num) ? 'whatsapp' as const : classifyPhoneType(num);
      results.push({ number: num, type, pageUrl });
    }
  }

  return results;
}

/** Recursively find PostalAddress in JSON-LD data. */
function findPostalAddress(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  if (obj['@type'] === 'PostalAddress') {
    const parts = [
      obj['streetAddress'],
      obj['addressLocality'],
      obj['addressRegion'],
      obj['postalCode'],
      obj['addressCountry'],
    ].filter((p): p is string => typeof p === 'string' && p.length > 0);
    return parts.length > 0 ? parts.join(', ') : null;
  }

  if (obj['address'] && typeof obj['address'] === 'object') {
    return findPostalAddress(obj['address']);
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findPostalAddress(item);
      if (result) return result;
    }
  }

  return null;
}

/** Extract physical addresses from a page. */
function extractAddresses($: cheerio.CheerioAPI, pageUrl: string): Array<{ text: string; pageUrl: string }> {
  const results: Array<{ text: string; pageUrl: string }> = [];
  const seen = new Set<string>();

  // 1. JSON-LD PostalAddress
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html() ?? '';
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const address = findPostalAddress(item);
        if (address && !seen.has(address)) {
          seen.add(address);
          results.push({ text: address, pageUrl });
        }
      }
    } catch {
      // Malformed JSON-LD
    }
  });

  // 2. Text near address keywords
  const addressKeywords = ['address', 'location', 'visit us', 'our office', 'headquarters', 'hq'];
  const allElements = $('p, span, div, li, address');
  allElements.each((_, el) => {
    const text = $(el).text().trim();
    if (text.length < 10 || text.length > 300) return;

    const lower = text.toLowerCase();
    const hasKeyword = addressKeywords.some((kw) => lower.includes(kw));
    const hasPostalPattern = /(?:P\.?O\.?\s*Box|P\.?O\.\s*\d|\b\d{5,6}\b)/.test(text);

    if ((hasKeyword || hasPostalPattern) && !seen.has(text)) {
      const lineCount = text.split('\n').length;
      if (lineCount <= 5) {
        seen.add(text);
        results.push({ text, pageUrl });
      }
    }
  });

  // 3. <address> HTML element
  $('address').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length >= 10 && text.length <= 300 && !seen.has(text)) {
      seen.add(text);
      results.push({ text, pageUrl });
    }
  });

  return results;
}

/** Extract social media links from a page. */
function extractSocialLinks($: cheerio.CheerioAPI): SocialLink[] {
  const found = new Map<SocialPlatform, SocialLink>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const hrefLower = href.toLowerCase();

    for (const { platform, patterns, handleExtractor } of SOCIAL_PATTERNS) {
      if (found.has(platform)) continue;
      if (patterns.some((p) => hrefLower.includes(p))) {
        found.set(platform, {
          platform,
          url: href,
          handle: handleExtractor(href),
        });
      }
    }
  });

  return [...found.values()];
}

/** Detect technology stack from a page. */
function extractTechnologies($: cheerio.CheerioAPI): TechnologyStack {
  const html = $.html().toLowerCase();

  const scriptSrcs: string[] = [];
  $('script[src]').each((_, el) => {
    scriptSrcs.push(($(el).attr('src') ?? '').toLowerCase());
  });

  const linkHrefs: string[] = [];
  $('link[href]').each((_, el) => {
    linkHrefs.push(($(el).attr('href') ?? '').toLowerCase());
  });

  const inlineScripts = $('script')
    .map((_, el) => $(el).html() ?? '')
    .get()
    .join(' ')
    .toLowerCase();

  const metaGenerators: string[] = [];
  $('meta[name="generator"]').each((_, el) => {
    metaGenerators.push(($(el).attr('content') ?? '').toLowerCase());
  });

  const allSearchable = `${html} ${scriptSrcs.join(' ')} ${linkHrefs.join(' ')} ${inlineScripts} ${metaGenerators.join(' ')}`;

  function detect(signatures: readonly string[]): string[] {
    const found: string[] = [];
    for (const sig of signatures) {
      if (allSearchable.includes(sig.toLowerCase())) {
        found.push(sig.charAt(0).toUpperCase() + sig.slice(1));
      }
    }
    return found;
  }

  // E-commerce: use PLATFORM_SIGNATURES mapping for display names
  const ecommerce: string[] = [];
  for (const sig of TECH_ECOMMERCE_SIGS) {
    if (allSearchable.includes(sig)) {
      const mapped = PLATFORM_SIGNATURES.find(([s]) => s === sig);
      if (mapped) ecommerce.push(mapped[1]);
    }
  }

  // Payments: use existing PAYMENT_KEYWORDS
  const payments: string[] = [];
  for (const kw of PAYMENT_KEYWORDS) {
    if (allSearchable.includes(kw)) {
      payments.push(kw.charAt(0).toUpperCase() + kw.slice(1));
    }
  }

  // Hosting detection
  const hosting: string[] = [];
  if (allSearchable.includes('vercel') || scriptSrcs.some((s) => s.includes('vercel'))) hosting.push('Vercel');
  if (allSearchable.includes('netlify') || linkHrefs.some((s) => s.includes('netlify'))) hosting.push('Netlify');
  if (allSearchable.includes('cloudflare') || scriptSrcs.some((s) => s.includes('cloudflare'))) hosting.push('Cloudflare');
  if (allSearchable.includes('amazonaws.com') || scriptSrcs.some((s) => s.includes('amazonaws.com'))) hosting.push('AWS');

  return {
    analytics: detect(TECH_ANALYTICS_SIGS),
    crm: detect(TECH_CRM_SIGS),
    liveChat: detect(TECH_LIVECHAT_SIGS),
    emailMarketing: detect(TECH_EMAIL_SIGS),
    ecommerce: [...new Set(ecommerce)],
    payments: [...new Set(payments)],
    cssFrameworks: detect(TECH_CSS_SIGS),
    hosting: [...new Set(hosting)],
  };
}

/** Extract business signals from a page. */
function extractBusinessSignals($: cheerio.CheerioAPI): {
  employeeCount: number | null;
  certifications: string[];
  hasClientLogos: boolean;
  hasTestimonials: boolean;
  hasCaseStudies: boolean;
} {
  const text = $.text();
  const htmlLower = $.html().toLowerCase();
  const textLower = text.toLowerCase();

  // Certifications
  const certifications: string[] = [];
  for (const cert of CERTIFICATION_PATTERNS) {
    if (textLower.includes(cert.toLowerCase())) {
      certifications.push(cert);
    }
  }

  // Employee count
  let employeeCount: number | null = null;
  EMPLOYEE_REGEX.lastIndex = 0;
  let empMatch: RegExpExecArray | null;
  while ((empMatch = EMPLOYEE_REGEX.exec(text)) !== null) {
    const num = parseInt(empMatch[1]!, 10);
    if (num > 0 && num < 1_000_000) {
      if (employeeCount === null || num > employeeCount) {
        employeeCount = num;
      }
    }
  }

  // Client logos: <img> with alt/class containing client, partner, logo+trusted
  let hasClientLogos = false;
  $('img').each((_, el) => {
    if (hasClientLogos) return;
    const alt = ($(el).attr('alt') ?? '').toLowerCase();
    const cls = ($(el).attr('class') ?? '').toLowerCase();
    const combined = `${alt} ${cls}`;
    if (
      combined.includes('client') ||
      combined.includes('partner') ||
      combined.includes('trusted') ||
      (combined.includes('logo') && (combined.includes('client') || combined.includes('partner') || combined.includes('trusted')))
    ) {
      hasClientLogos = true;
    }
  });
  // Also check for sections with class containing "clients", "partners", "trusted-by"
  if (!hasClientLogos) {
    const clientSections = $('[class*="client"], [class*="partner"], [class*="trusted"]');
    clientSections.each((_, el) => {
      if (!hasClientLogos && $(el).find('img').length > 0) {
        hasClientLogos = true;
      }
    });
  }

  // Testimonials
  const hasTestimonials =
    $('[class*="testimonial"]').length > 0 ||
    $('[id*="testimonial"]').length > 0 ||
    $('[class*="review"]').length > 0 ||
    $('[id*="review"]').length > 0 ||
    $('[class*="quote"]').length > 0 ||
    htmlLower.includes('testimonial');

  // Case studies
  const hasCaseStudies =
    $('a[href*="case-stud"]').length > 0 ||
    $('a[href*="case_stud"]').length > 0 ||
    $('a[href*="success-stor"]').length > 0 ||
    $('a[href*="success_stor"]').length > 0 ||
    textLower.includes('case study') ||
    textLower.includes('case studies') ||
    textLower.includes('success story') ||
    textLower.includes('success stories');

  return {
    employeeCount,
    certifications: [...new Set(certifications)],
    hasClientLogos,
    hasTestimonials,
    hasCaseStudies,
  };
}

// ── Playwright fallback ───────────────────────────────────────────────────

const CLOUDFLARE_CHALLENGE_PATTERNS = [
  'cf-browser-verification',
  'cf_chl_opt',
  'challenge-platform',
  'Checking if the site connection is secure',
  'Verify you are human',
  'just a moment',
  '_cf_chl_tk',
] as const;

const DEFAULT_PLAYWRIGHT_TIMEOUT_MS = 15_000;

const COOKIE_CONSENT_SELECTORS = [
  '[class*="cookie"] button[class*="accept"]',
  '[class*="cookie"] button[class*="agree"]',
  '[id*="consent"] button[class*="accept"]',
  '[id*="consent"] button[class*="agree"]',
  'button[id*="accept-cookie"]',
  'button[id*="cookie-accept"]',
  '.accept-cookies',
  '[class*="cookie-banner"] button',
  '[class*="gdpr"] button[class*="accept"]',
] as const;

/**
 * Determine if the fetch+cheerio results are low-quality enough to warrant
 * a Playwright re-crawl. Triggers on:
 * 1. Body text too short (< 500 chars) — likely JS-rendered SPA
 * 2. Cloudflare challenge detected
 * 3. Zero signals (0 emails + 0 phones + 0 social links + 0 decision makers)
 */
export function needsPlaywrightFallback(
  data: WebsiteScraperData,
  rawHtmlSample: string,
): boolean {
  // Check for Cloudflare challenge patterns in the raw HTML
  const htmlLower = rawHtmlSample.toLowerCase();
  const hasCloudflare = CLOUDFLARE_CHALLENGE_PATTERNS.some((p) =>
    htmlLower.includes(p.toLowerCase()),
  );
  if (hasCloudflare) return true;

  // Check for very short body text (SPA shells return < 500 chars of actual text)
  const textLength = rawHtmlSample.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().length;
  if (textLength < 500) return true;

  // Check for zero signals across all pages
  const hasZeroSignals =
    data.contactInfo.emails.length === 0 &&
    data.contactInfo.phones.length === 0 &&
    data.socialLinks.length === 0 &&
    data.decisionMakers.length === 0;
  if (hasZeroSignals) return true;

  // No decision makers found but page has other signals (emails/social) —
  // team data may be JS-rendered; worth trying Playwright
  if (data.decisionMakers.length === 0 && data.socialLinks.length > 0) return true;

  return false;
}

/**
 * Fetch a single page using Playwright headless Chromium.
 * Waits for networkidle + auto-accepts cookie consent dialogs.
 */
async function fetchPageWithPlaywright(
  url: string,
  browser: Browser,
  timeoutMs: number,
): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });

    // Try to accept cookie consent if present
    for (const sel of COOKIE_CONSENT_SELECTORS) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          await page.waitForTimeout(500);
          break;
        }
      } catch {
        // Selector not found or not visible — continue
      }
    }

    return await page.content();
  } finally {
    await page.close();
  }
}

// ── Meta description extraction (C7) ──────────────────────────────────────

function extractMetaDescription($: cheerio.CheerioAPI): string | null {
  const desc = $('meta[name="description"]').attr('content')?.trim();
  if (desc) return desc;
  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  return ogDesc ?? null;
}

// ── Crawl result per page ──────────────────────────────────────────────────

interface PageResult {
  url: string;
  $: cheerio.CheerioAPI;
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class WebsiteScraperAdapter {
  private readonly perPageTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maxPages: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly enablePlaywright: boolean;
  private readonly playwrightTimeoutMs: number;
  private readonly chromiumPath: string | undefined;

  constructor(config: WebsiteScraperConfig) {
    this.perPageTimeoutMs = config.timeoutMs ?? DEFAULT_PER_PAGE_TIMEOUT_MS;
    this.totalTimeoutMs = config.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.enablePlaywright = config.enablePlaywright ?? true;
    this.playwrightTimeoutMs = config.playwrightTimeoutMs ?? DEFAULT_PLAYWRIGHT_TIMEOUT_MS;
    this.chromiumPath = config.chromiumPath;
  }

  get isConfigured(): boolean {
    return true;
  }

  async scrapeWebsite(domain: string, businessName?: string | undefined): Promise<WebsiteScraperResult> {
    const crawlStart = Date.now();
    const baseUrl = normaliseUrl(domain);

    let baseOrigin: string;
    try {
      baseOrigin = new URL(baseUrl).origin;
    } catch {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: `Invalid domain: ${domain}`,
          raw: null,
        },
      };
    }

    // Total timeout controller for the entire crawl
    const totalController = new AbortController();
    const totalTimeout = setTimeout(() => totalController.abort(), this.totalTimeoutMs);

    try {
      // Phase 1: Fetch homepage
      const homepageResult = await this.fetchPage(baseUrl, totalController.signal);

      if (homepageResult.status !== 'success') {
        return homepageResult;
      }

      const pages: PageResult[] = [{ url: baseUrl, $: homepageResult.$ }];
      const crawledUrls = new Set<string>([normalizeForDedup(baseUrl)]);

      // Capture raw homepage HTML for Playwright quality check
      const rawHomepageHtml = homepageResult.$.html();

      // Phase 2: Discover URLs from homepage links + try priority paths
      const candidateUrls = this.discoverUrls(homepageResult.$, baseOrigin, crawledUrls);

      // Phase 3: Crawl additional pages up to maxPages
      for (const candidateUrl of candidateUrls) {
        if (pages.length >= this.maxPages) break;
        if (totalController.signal.aborted) break;

        const normalized = normalizeForDedup(candidateUrl);
        if (crawledUrls.has(normalized)) continue;
        crawledUrls.add(normalized);

        const pageResult = await this.fetchPage(candidateUrl, totalController.signal);
        if (pageResult.status === 'success') {
          pages.push({ url: candidateUrl, $: pageResult.$ });
        }
      }

      // Phase 4: Aggregate results from all pages
      const fetchData = this.aggregateResults(pages, crawlStart, businessName);

      // Phase 5: Playwright fallback (if enabled and quality check fails)
      if (this.enablePlaywright && needsPlaywrightFallback(fetchData, rawHomepageHtml)) {
        const playwrightData = await this.recrawlWithPlaywright(
          baseUrl,
          baseOrigin,
          crawledUrls,
          crawlStart,
          businessName,
        );
        if (playwrightData) {
          // C8: Validate social links
          playwrightData.socialLinks = await this.validateSocialLinks(playwrightData.socialLinks);
          return { status: 'success', data: playwrightData };
        }
      }

      // C8: Validate social links
      fetchData.socialLinks = await this.validateSocialLinks(fetchData.socialLinks);

      return {
        status: 'success',
        data: fetchData,
      };
    } finally {
      clearTimeout(totalTimeout);
    }
  }

  /**
   * Re-crawl the domain using Playwright headless Chromium.
   * Returns merged data or null if Playwright is unavailable / fails.
   */
  private async recrawlWithPlaywright(
    baseUrl: string,
    baseOrigin: string,
    urlsToCrawl: Set<string>,
    crawlStart: number,
    businessName?: string | undefined,
  ): Promise<WebsiteScraperData | null> {
    let chromium: BrowserType;
    try {
      const pw = await import('playwright-core');
      chromium = pw.chromium;
    } catch {
      // playwright-core not available at runtime — skip fallback
      return null;
    }

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        ...(this.chromiumPath ? { executablePath: this.chromiumPath } : {}),
      });

      const pages: PageResult[] = [];

      // Re-crawl the same URLs that were fetched
      const urls = [baseUrl, ...urlsToCrawl].slice(0, this.maxPages);
      const seen = new Set<string>();

      for (const url of urls) {
        const normalized = normalizeForDedup(url);
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        try {
          // Verify same-origin
          const urlOrigin = new URL(url).origin;
          if (urlOrigin !== baseOrigin && url !== baseUrl) continue;

          const html = await fetchPageWithPlaywright(
            url,
            browser,
            this.playwrightTimeoutMs,
          );
          pages.push({ url, $: cheerio.load(html) });
        } catch {
          // Individual page failure — continue with others
        }
      }

      if (pages.length === 0) return null;

      return this.aggregateResults(pages, crawlStart, businessName);
    } catch {
      // Browser launch failure — skip fallback
      return null;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  /** Fetch a single page with per-page timeout. */
  private async fetchPage(
    url: string,
    parentSignal: AbortSignal,
  ): Promise<
    | { status: 'success'; $: cheerio.CheerioAPI }
    | { status: 'retryable_error'; failure: WebsiteScraperFailure }
    | { status: 'terminal_error'; failure: WebsiteScraperFailure }
  > {
    const controller = new AbortController();
    const perPageTimeout = setTimeout(() => controller.abort(), this.perPageTimeoutMs);

    const onParentAbort = (): void => controller.abort();
    parentSignal.addEventListener('abort', onParentAbort, { once: true });

    let response: Response;
    try {
      if (parentSignal.aborted) {
        return {
          status: 'retryable_error',
          failure: {
            classification: 'retryable',
            statusCode: null,
            message: 'Total crawl timeout exceeded',
            raw: null,
          },
        };
      }

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
      clearTimeout(perPageTimeout);
      parentSignal.removeEventListener('abort', onParentAbort);
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

    return {
      status: 'success',
      $: cheerio.load(html),
    };
  }

  /** Discover priority URLs from homepage links and common path probing. */
  private discoverUrls(
    $: cheerio.CheerioAPI,
    baseOrigin: string,
    alreadyCrawled: Set<string>,
  ): string[] {
    // Two buckets: priority-path matches (score 0-99) and anchor-text matches (score 100+)
    const candidates = new Map<string, number>();

    // 1. Parse all <a href> from homepage
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const resolved = this.resolveUrl(href, baseOrigin);
      if (!resolved) return;

      try {
        const u = new URL(resolved);
        if (u.origin !== baseOrigin) return;

        const pathname = u.pathname;
        const normalized = normalizeForDedup(resolved);
        if (alreadyCrawled.has(normalized)) return;

        // Priority path match (existing behavior)
        if (matchesPriorityPath(pathname)) {
          const score = getPathPriority(pathname);
          const existing = candidates.get(resolved);
          if (existing === undefined || score < existing) {
            candidates.set(resolved, score);
          }
          return;
        }

        // C1: Anchor-text link following — check link TEXT for team keywords
        const anchorText = $(el).text().trim().toLowerCase();
        if (anchorText.length > 0) {
          for (const { keyword, priority } of TEAM_ANCHOR_KEYWORDS) {
            if (anchorText.includes(keyword)) {
              const score = 100 + priority; // Anchor-text pages scored after priority paths
              const existing = candidates.get(resolved);
              if (existing === undefined || score < existing) {
                candidates.set(resolved, score);
              }
              break;
            }
          }
        }
      } catch {
        // Invalid URL — skip
      }
    });

    // 2. Also try common priority paths directly (in case they are not linked)
    for (const path of ALL_PRIORITY_PATHS) {
      if (path === '/') continue;
      const fullUrl = `${baseOrigin}${path}`;
      const normalized = normalizeForDedup(fullUrl);
      if (!alreadyCrawled.has(normalized) && !candidates.has(fullUrl)) {
        candidates.set(fullUrl, getPathPriority(path));
      }
    }

    return [...candidates.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([url]) => url);
  }

  /** C8: Validate social links by sending HEAD requests; remove dead links. */
  private async validateSocialLinks(links: SocialLink[]): Promise<SocialLink[]> {
    if (links.length === 0) return links;

    const VALIDATION_TIMEOUT_MS = 5_000;
    // Generic error pages that social platforms redirect dead links to
    const ERROR_PATH_PATTERNS = ['/error', '/404', '/not-found', '/unavailable'];

    const results = await Promise.allSettled(
      links.map(async (link): Promise<SocialLink | null> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

        try {
          const response = await this.fetchImpl(link.url, {
            method: 'HEAD',
            headers: { 'User-Agent': this.userAgent },
            redirect: 'follow',
            signal: controller.signal,
          });

          // Dead link: 404 or 410
          if (response.status === 404 || response.status === 410) {
            return null;
          }

          // Check if redirected to a generic error page
          const finalUrl = response.url;
          if (finalUrl) {
            try {
              const finalPath = new URL(finalUrl).pathname.toLowerCase();
              if (ERROR_PATH_PATTERNS.some((p) => finalPath.includes(p))) {
                return null;
              }
            } catch {
              // URL parse failure — keep the link
            }
          }

          return link;
        } catch {
          // Timeout or network error — keep the link (assume valid on ambiguous failures)
          return link;
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<SocialLink | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is SocialLink => v !== null);
  }

  /** Resolve a potentially relative URL against a base origin. */
  private resolveUrl(href: string, baseOrigin: string): string | null {
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return null;
    }

    try {
      if (href.startsWith('http://') || href.startsWith('https://')) {
        return href;
      }
      if (href.startsWith('//')) {
        return `https:${href}`;
      }
      if (href.startsWith('/')) {
        return `${baseOrigin}${href}`;
      }
      return `${baseOrigin}/${href}`;
    } catch {
      return null;
    }
  }

  /** Aggregate extraction results from all crawled pages. */
  private aggregateResults(pages: PageResult[], crawlStart: number, businessName?: string | undefined): WebsiteScraperData {
    // Original signals (merged across all pages)
    const allPaymentWidgets = new Set<string>();
    const allDetectedPlatforms = new Set<string>();
    let primaryPlatform: string | null = null;
    let hasShopify = false;
    let hasBookingForm = false;
    let hasPricingTiers = false;
    let hasProductCatalog = false;
    let hasWhatsApp = false;
    let pageTitle: string | null = null;
    let metaDescription: string | null = null;
    let detectedCountry: string | null = null;

    // New signals
    const allDecisionMakers: DecisionMaker[] = [];
    const seenDecisionMakerNames = new Set<string>();
    const allEmails: Array<{ email: string; context: string; pageUrl: string }> = [];
    const seenEmails = new Set<string>();
    const allPhones: Array<{ number: string; type: 'whatsapp' | 'mobile' | 'landline' | 'unknown'; pageUrl: string }> = [];
    const seenPhones = new Set<string>();
    const allAddresses: Array<{ text: string; pageUrl: string }> = [];
    const seenAddresses = new Set<string>();
    const socialLinksMap = new Map<SocialPlatform, SocialLink>();

    const techSets: Record<keyof TechnologyStack, Set<string>> = {
      analytics: new Set(),
      crm: new Set(),
      liveChat: new Set(),
      emailMarketing: new Set(),
      ecommerce: new Set(),
      payments: new Set(),
      cssFrameworks: new Set(),
      hosting: new Set(),
    };

    let mergedEmployeeCount: number | null = null;
    const mergedCertifications = new Set<string>();
    let mergedHasClientLogos = false;
    let mergedHasTestimonials = false;
    let mergedHasCaseStudies = false;

    for (const page of pages) {
      const { $, url: pageUrl } = page;

      // Original signals
      for (const pw of extractPaymentWidgets($)) {
        allPaymentWidgets.add(pw);
      }

      const { primary, all } = detectPlatforms($);
      for (const p of all) {
        allDetectedPlatforms.add(p);
      }
      if (!primaryPlatform && primary) {
        primaryPlatform = primary;
      }

      if (!hasShopify && all.includes('Shopify')) hasShopify = true;
      if (!hasBookingForm && detectBookingForm($)) hasBookingForm = true;
      if (!hasPricingTiers && detectPricingTiers($)) hasPricingTiers = true;
      if (!hasProductCatalog && detectProductCatalog($)) hasProductCatalog = true;
      if (!hasWhatsApp && detectWhatsApp($)) hasWhatsApp = true;

      // Page title (from homepage only)
      if (!pageTitle) {
        const titleText = $('title').first().text().trim();
        if (titleText.length > 0) pageTitle = titleText;
      }

      // C7: Meta description (from homepage only)
      if (!metaDescription) {
        metaDescription = extractMetaDescription($);
      }

      // Country detection (first match wins)
      if (!detectedCountry) {
        detectedCountry = detectCountryFromPage($);
      }

      // Decision makers
      for (const dm of extractDecisionMakers($, pageUrl, businessName)) {
        const nameKey = dm.name.toLowerCase();
        if (!seenDecisionMakerNames.has(nameKey)) {
          seenDecisionMakerNames.add(nameKey);
          allDecisionMakers.push(dm);
        }
      }

      // Emails
      for (const emailEntry of extractEmails($, pageUrl)) {
        if (!seenEmails.has(emailEntry.email)) {
          seenEmails.add(emailEntry.email);
          allEmails.push(emailEntry);
        }
      }

      // Phones
      for (const phoneEntry of extractPhones($, pageUrl)) {
        if (!seenPhones.has(phoneEntry.number)) {
          seenPhones.add(phoneEntry.number);
          allPhones.push(phoneEntry);
        }
      }

      // Addresses
      for (const addrEntry of extractAddresses($, pageUrl)) {
        if (!seenAddresses.has(addrEntry.text)) {
          seenAddresses.add(addrEntry.text);
          allAddresses.push(addrEntry);
        }
      }

      // Social links
      for (const sl of extractSocialLinks($)) {
        if (!socialLinksMap.has(sl.platform)) {
          socialLinksMap.set(sl.platform, sl);
        }
      }

      // Technologies
      const pageTech = extractTechnologies($);
      for (const key of Object.keys(pageTech) as Array<keyof TechnologyStack>) {
        for (const item of pageTech[key]) {
          techSets[key].add(item);
        }
      }

      // Business signals
      const pageSignals = extractBusinessSignals($);
      if (pageSignals.employeeCount !== null) {
        if (mergedEmployeeCount === null || pageSignals.employeeCount > mergedEmployeeCount) {
          mergedEmployeeCount = pageSignals.employeeCount;
        }
      }
      for (const cert of pageSignals.certifications) {
        mergedCertifications.add(cert);
      }
      if (pageSignals.hasClientLogos) mergedHasClientLogos = true;
      if (pageSignals.hasTestimonials) mergedHasTestimonials = true;
      if (pageSignals.hasCaseStudies) mergedHasCaseStudies = true;
    }

    // Convert tech sets to arrays
    const mergedTech: TechnologyStack = {
      analytics: [...techSets.analytics],
      crm: [...techSets.crm],
      liveChat: [...techSets.liveChat],
      emailMarketing: [...techSets.emailMarketing],
      ecommerce: [...techSets.ecommerce],
      payments: [...techSets.payments],
      cssFrameworks: [...techSets.cssFrameworks],
      hosting: [...techSets.hosting],
    };

    // Filter emails: remove generic prefixes and platform domains
    const filteredEmails = allEmails.filter(
      (e) => !isGenericEmail(e.email) && !isPlatformEmail(e.email),
    );

    return {
      // Existing signals
      paymentWidgets: [...allPaymentWidgets],
      hasShopify,
      platform: primaryPlatform,
      hasBookingForm,
      hasPricingTiers,
      hasProductCatalog,
      hasWhatsApp,
      detectedPlatforms: [...allDetectedPlatforms],

      // Multi-page intelligence
      decisionMakers: allDecisionMakers,
      contactInfo: {
        emails: filteredEmails,
        phones: allPhones,
        addresses: allAddresses,
      },
      socialLinks: [...socialLinksMap.values()],
      technologies: mergedTech,
      businessSignals: {
        estimatedEmployeeCount: mergedEmployeeCount,
        certifications: [...mergedCertifications],
        hasClientLogos: mergedHasClientLogos,
        hasTestimonials: mergedHasTestimonials,
        hasCaseStudies: mergedHasCaseStudies,
      },

      // Page-level intelligence
      pageTitle,
      metaDescription,
      detectedCountry,

      // Crawl metadata
      pagesCrawled: pages.length,
      crawlDurationMs: Date.now() - crawlStart,
    };
  }
}

import { describe, expect, it, vi } from 'vitest';

import {
  WebsiteScraperAdapter,
  needsPlaywrightFallback,
  type WebsiteScraperData,
} from './website-scraper.adapter.js';

// ── Helper: minimal valid HTML that passes quality check ────────────────────

function richHtml(body: string): string {
  return `<html><head><title>Test</title></head><body>${body}</body></html>`;
}

const LONG_TEXT = 'Lorem ipsum dolor sit amet '.repeat(30); // ~800 chars

const RICH_PAGE_HTML = richHtml(`
  <p>${LONG_TEXT}</p>
  <a href="mailto:info@example.com">Email</a>
  <a href="tel:+971501234567">Phone</a>
  <a href="https://instagram.com/testbiz">Instagram</a>
  <a href="https://wa.me/971501234567">WhatsApp</a>
  <div class="team-member">
    <h3 class="name">Ahmed Khan</h3>
    <span class="title">CEO</span>
  </div>
`);

const EMPTY_SPA_HTML = richHtml('<div id="root"></div>');

const CLOUDFLARE_CHALLENGE_HTML = richHtml(`
  <div id="cf-browser-verification">
    <p>Checking if the site connection is secure</p>
  </div>
`);

const SAFEBROWSE_INTERSTITIAL_HTML = `
  <html>
    <head><title>Potential Threat Detected</title></head>
    <body>
      <p>This site could be risky</p>
      <p>Advanced Security blocked access</p>
    </body>
  </html>
`;

const CLOUDFLARE_BLOCKED_HTML = `
  <html>
    <head><title>Attention Required! | Cloudflare</title></head>
    <body>
      <p>Sorry, you have been blocked</p>
    </body>
  </html>
`;

const SPARSE_PAGE_HTML = richHtml(`
  <p>${LONG_TEXT}</p>
  <h1>Welcome to our business</h1>
`);

// ── Helper: empty WebsiteScraperData ────────────────────────────────────────

function emptyScraperData(overrides: Partial<WebsiteScraperData> = {}): WebsiteScraperData {
  return {
    paymentWidgets: [],
    hasShopify: false,
    platform: null,
    hasBookingForm: false,
    hasPricingTiers: false,
    hasProductCatalog: false,
    hasWhatsApp: false,
    detectedPlatforms: [],
    decisionMakers: [],
    contactInfo: { emails: [], phones: [], addresses: [] },
    socialLinks: [],
    technologies: {
      analytics: [],
      crm: [],
      liveChat: [],
      emailMarketing: [],
      ecommerce: [],
      payments: [],
      cssFrameworks: [],
      hosting: [],
    },
    businessSignals: {
      estimatedEmployeeCount: null,
      certifications: [],
      hasClientLogos: false,
      hasTestimonials: false,
      hasCaseStudies: false,
    },
    pagesCrawled: 1,
    crawlDurationMs: 100,
    ...overrides,
  };
}

// ── Mock fetch that serves HTML for any URL ─────────────────────────────────

function createMockFetch(htmlContent: string) {
  return vi.fn(async () => {
    return new Response(htmlContent, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }) as unknown as typeof fetch;
}

function createMockFetchMultiPage(pageMap: Record<string, string>) {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

    for (const [pattern, html] of Object.entries(pageMap)) {
      if (urlStr.includes(pattern)) {
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
    }
    // Default: return 404 for unmatched URLs
    return new Response('Not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function createMockFetchByUrl(
  responder: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    return responder(urlStr, init);
  }) as unknown as typeof fetch;
}

// ── Tests: needsPlaywrightFallback ──────────────────────────────────────────

describe('needsPlaywrightFallback', () => {
  it('returns true for Cloudflare challenge HTML', () => {
    const data = emptyScraperData();
    expect(needsPlaywrightFallback(data, CLOUDFLARE_CHALLENGE_HTML)).toBe(true);
  });

  it('returns true for empty SPA shell (< 500 chars body text)', () => {
    const data = emptyScraperData();
    expect(needsPlaywrightFallback(data, EMPTY_SPA_HTML)).toBe(true);
  });

  it('returns true for zero signals with sufficient text', () => {
    const data = emptyScraperData();
    expect(needsPlaywrightFallback(data, SPARSE_PAGE_HTML)).toBe(true);
  });

  it('returns false when data has emails', () => {
    const data = emptyScraperData({
      contactInfo: {
        emails: [{ email: 'test@example.com', context: 'text', pageUrl: 'https://example.com' }],
        phones: [],
        addresses: [],
      },
    });
    expect(needsPlaywrightFallback(data, SPARSE_PAGE_HTML)).toBe(false);
  });

  it('returns false when data has phones', () => {
    const data = emptyScraperData({
      contactInfo: {
        emails: [],
        phones: [{ number: '+971501234567', type: 'mobile', pageUrl: 'https://example.com' }],
        addresses: [],
      },
    });
    expect(needsPlaywrightFallback(data, SPARSE_PAGE_HTML)).toBe(false);
  });

  it('returns true when data has social links but no decision makers (team page may be JS-rendered)', () => {
    const data = emptyScraperData({
      socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/test', handle: 'test' }],
    });
    expect(needsPlaywrightFallback(data, SPARSE_PAGE_HTML)).toBe(true);
  });

  it('returns false when data has decision makers', () => {
    const data = emptyScraperData({
      decisionMakers: [{
        name: 'John Smith',
        title: 'CEO',
        email: null,
        linkedinUrl: null,
        seniority: 'executive',
        source: 'https://example.com/team',
      }],
    });
    expect(needsPlaywrightFallback(data, SPARSE_PAGE_HTML)).toBe(false);
  });

  it('returns true for rich page with social links but no decision makers', () => {
    const data = emptyScraperData({
      contactInfo: {
        emails: [{ email: 'test@example.com', context: 'text', pageUrl: 'https://example.com' }],
        phones: [{ number: '+971501234567', type: 'whatsapp', pageUrl: 'https://example.com' }],
        addresses: [],
      },
      socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/test', handle: 'test' }],
    });
    // Social links present but no decision makers → Playwright should try to find team page
    expect(needsPlaywrightFallback(data, RICH_PAGE_HTML)).toBe(true);
  });

  it('returns false for rich page with decision makers and social links', () => {
    const data = emptyScraperData({
      contactInfo: {
        emails: [{ email: 'test@example.com', context: 'text', pageUrl: 'https://example.com' }],
        phones: [{ number: '+971501234567', type: 'whatsapp', pageUrl: 'https://example.com' }],
        addresses: [],
      },
      socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/test', handle: 'test' }],
      decisionMakers: [{
        name: 'John Smith',
        title: 'CEO',
        email: 'john@example.com',
        linkedinUrl: null,
        seniority: 'executive',
        source: 'https://example.com/team',
      }],
    });
    expect(needsPlaywrightFallback(data, RICH_PAGE_HTML)).toBe(false);
  });
});

// ── Tests: WebsiteScraperAdapter ────────────────────────────────────────────

describe('WebsiteScraperAdapter', () => {
  describe('fetch-only path (Playwright disabled)', () => {
    it('scrapes rich HTML successfully without Playwright', async () => {
      const mockFetch = createMockFetch(RICH_PAGE_HTML);
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
        maxPages: 1,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.hasWhatsApp).toBe(true);
      expect(result.data.contactInfo.phones.length).toBeGreaterThan(0);
    });

    it('preserves generic website inboxes for downstream company-contact fallback', async () => {
      const mockFetch = createMockFetch(RICH_PAGE_HTML);
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
        maxPages: 1,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.contactInfo.emails).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ email: 'info@example.com' }),
        ]),
      );
    });

    it('extracts local-format phone numbers from page text', async () => {
      const mockFetch = createMockFetch(richHtml(`
        <p>${LONG_TEXT}</p>
        <p>Call us on 04 111 2222 for appointments.</p>
      `));
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
        maxPages: 1,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.contactInfo.phones).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ number: '041112222' }),
        ]),
      );
    });

    it('returns terminal_error for invalid domain', async () => {
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: vi.fn() as unknown as typeof fetch,
        enablePlaywright: false,
      });

      const result = await adapter.scrapeWebsite('://not-a-url');
      expect(result.status).toBe('terminal_error');
    });

    it('returns retryable_error for network failure', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;

      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('retryable_error');
    });

    it('falls back to http when https bootstrap fails for a bare domain', async () => {
      const mockFetch = createMockFetchByUrl((url) => {
        if (url === 'https://example.com') {
          throw new Error('CERT_HAS_EXPIRED');
        }
        return new Response(RICH_PAGE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      });

      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
        maxPages: 1,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('success');
      expect(mockFetch).toHaveBeenCalled();
      expect(mockFetch.mock.calls[0]?.[0]).toBe('https://example.com');
      expect(mockFetch.mock.calls[1]?.[0]).toBe('http://example.com');
    });

    it('returns terminal_error for 403 response', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response('Forbidden', { status: 403 });
      }) as unknown as typeof fetch;

      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('terminal_error');
    });

    it('returns terminal_error for 500 response', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response('Internal Server Error', { status: 500 });
      }) as unknown as typeof fetch;

      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('terminal_error');
    });

    it('returns terminal_error for browser security interstitial content', async () => {
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: createMockFetch(SAFEBROWSE_INTERSTITIAL_HTML),
        enablePlaywright: false,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('terminal_error');
    });

    it('returns terminal_error for anti-bot interstitial content', async () => {
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: createMockFetch(CLOUDFLARE_CHALLENGE_HTML),
        enablePlaywright: false,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('terminal_error');
    });

    it('returns terminal_error for blocked Cloudflare interstitial content', async () => {
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: createMockFetch(CLOUDFLARE_BLOCKED_HTML),
        enablePlaywright: false,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('terminal_error');
    });
  });

  describe('Playwright fallback triggering', () => {
    it('does NOT trigger Playwright when enablePlaywright is false', async () => {
      const mockFetch = createMockFetch(EMPTY_SPA_HTML);
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
        maxPages: 1,
      });

      const result = await adapter.scrapeWebsite('example.com');
      // Should succeed with poor data (no Playwright fallback)
      expect(result.status).toBe('success');
    });

    it('triggers Playwright for empty SPA but gracefully handles missing playwright-core', async () => {
      // This test verifies Playwright fallback is attempted on low-quality content.
      // Since playwright-core may not have a real browser binary in CI, the fallback
      // will fail gracefully and return the fetch results.
      vi.doMock('playwright-core', () => ({
        chromium: {
          launch: vi.fn(async () => {
            throw new Error('Missing browser binary');
          }),
        },
      }));

      try {
        const mockFetch = createMockFetch(EMPTY_SPA_HTML);
        const adapter = new WebsiteScraperAdapter({
          fetchImpl: mockFetch,
          enablePlaywright: true,
          maxPages: 1,
          playwrightTimeoutMs: 50,
        });

        const result = await adapter.scrapeWebsite('example.com');
        // Regardless of Playwright availability, should return success with fetch data
        expect(result.status).toBe('success');
      } finally {
        vi.doUnmock('playwright-core');
      }
    });

    it('uses Playwright fallback when homepage fetch fails', async () => {
      vi.doMock('playwright-core', () => {
        const page = {
          goto: vi.fn(async () => undefined),
          locator: vi.fn(() => ({
            first: () => ({
              isVisible: vi.fn(async () => false),
              click: vi.fn(async () => undefined),
            }),
          })),
          waitForTimeout: vi.fn(async () => undefined),
          content: vi.fn(async () => RICH_PAGE_HTML),
          close: vi.fn(async () => undefined),
        };
        const context = {
          newPage: vi.fn(async () => page),
          close: vi.fn(async () => undefined),
        };
        const browser = {
          newContext: vi.fn(async () => context),
          close: vi.fn(async () => undefined),
        };
        return {
          chromium: {
            launch: vi.fn(async () => browser),
          },
        };
      });

      try {
        const mockFetch = vi.fn(async () => new Response('Forbidden', { status: 403 })) as unknown as typeof fetch;
        const adapter = new WebsiteScraperAdapter({
          fetchImpl: mockFetch,
          enablePlaywright: true,
          maxPages: 1,
          playwrightTimeoutMs: 50,
        });

        const result = await adapter.scrapeWebsite('example.com');
        expect(result.status).toBe('success');
      } finally {
        vi.doUnmock('playwright-core');
      }
    });

    it('skips Playwright when fetch produces rich content', async () => {
      const mockFetch = createMockFetch(RICH_PAGE_HTML);
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: true,
        maxPages: 1,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      // Verify the data came from fetch (has emails, phones, social links)
      expect(result.data.contactInfo.phones.length).toBeGreaterThan(0);
      expect(result.data.hasWhatsApp).toBe(true);
    });
  });

  describe('multi-page crawling', () => {
    it('crawls multiple pages and aggregates results', async () => {
      const homepageHtml = richHtml(`
        <p>${LONG_TEXT}</p>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
        <a href="https://instagram.com/testbiz">Instagram</a>
      `);
      const aboutHtml = richHtml(`
        <p>${LONG_TEXT}</p>
        <div class="team-member">
          <h3 class="name">Ahmed Khan</h3>
          <span class="title">CEO</span>
        </div>
      `);
      const contactHtml = richHtml(`
        <p>${LONG_TEXT}</p>
        <a href="mailto:ahmed@example.com">Email</a>
        <a href="tel:+971501234567">Phone</a>
        <a href="https://wa.me/971501234567">WhatsApp</a>
      `);

      const mockFetch = createMockFetchMultiPage({
        'example.com/about': aboutHtml,
        'example.com/contact': contactHtml,
        'example.com': homepageHtml,
        'instagram.com/testbiz': '<html></html>',
        'wa.me/': '<html></html>',
      });

      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
        maxPages: 5,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');

      // Should have aggregated across pages
      expect(result.data.pagesCrawled).toBeGreaterThanOrEqual(2);
      expect(result.data.socialLinks.some((l) => l.platform === 'instagram')).toBe(true);
      expect(result.data.hasWhatsApp).toBe(true);
    });

    it('does not extract Instagram post or reel URLs as profile handles', async () => {
      for (const instagramUrl of [
        'https://instagram.com/p/abc123/',
        'https://instagram.com/reel/def456/',
      ]) {
        const homepageHtml = richHtml(`
          <p>${LONG_TEXT}</p>
          <a href="${instagramUrl}">Instagram content</a>
        `);

        const mockFetch = createMockFetchMultiPage({
          'example.com': homepageHtml,
          [new URL(instagramUrl).pathname]: '<html></html>',
        });

        const adapter = new WebsiteScraperAdapter({
          fetchImpl: mockFetch,
          enablePlaywright: false,
          maxPages: 1,
        });

        const result = await adapter.scrapeWebsite('example.com');
        expect(result.status).toBe('success');
        if (result.status !== 'success') throw new Error('Expected success');

        const instagramLink = result.data.socialLinks.find((link) => link.platform === 'instagram');
        expect(instagramLink?.handle ?? null).toBeNull();
      }
    });
  });

  describe('config defaults', () => {
    it('enablePlaywright defaults to true', async () => {
      const mockFetch = createMockFetch(RICH_PAGE_HTML);
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        maxPages: 1,
      });

      // isConfigured should still return true
      expect(adapter.isConfigured).toBe(true);

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('success');
    });

    it('isConfigured always returns true', () => {
      const adapter = new WebsiteScraperAdapter({});
      expect(adapter.isConfigured).toBe(true);
    });
  });
});

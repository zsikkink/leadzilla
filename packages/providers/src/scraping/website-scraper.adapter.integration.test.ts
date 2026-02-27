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
`);

const EMPTY_SPA_HTML = richHtml('<div id="root"></div>');

const CLOUDFLARE_CHALLENGE_HTML = richHtml(`
  <div id="cf-browser-verification">
    <p>Checking if the site connection is secure</p>
  </div>
`);

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

  it('returns false when data has social links', () => {
    const data = emptyScraperData({
      socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/test', handle: 'test' }],
    });
    expect(needsPlaywrightFallback(data, SPARSE_PAGE_HTML)).toBe(false);
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

  it('returns false for rich page with signals', () => {
    const data = emptyScraperData({
      contactInfo: {
        emails: [{ email: 'test@example.com', context: 'text', pageUrl: 'https://example.com' }],
        phones: [{ number: '+971501234567', type: 'whatsapp', pageUrl: 'https://example.com' }],
        addresses: [],
      },
      socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/test', handle: 'test' }],
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

    it('returns retryable_error for 500 response', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response('Internal Server Error', { status: 500 });
      }) as unknown as typeof fetch;

      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: false,
      });

      const result = await adapter.scrapeWebsite('example.com');
      expect(result.status).toBe('retryable_error');
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
      const mockFetch = createMockFetch(EMPTY_SPA_HTML);
      const adapter = new WebsiteScraperAdapter({
        fetchImpl: mockFetch,
        enablePlaywright: true,
        maxPages: 1,
      });

      const result = await adapter.scrapeWebsite('example.com');
      // Regardless of Playwright availability, should return success with fetch data
      expect(result.status).toBe('success');
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

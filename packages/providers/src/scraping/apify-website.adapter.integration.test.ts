import { describe, expect, it, vi } from 'vitest';

import { ApifyWebsiteAdapter } from './apify-website.adapter.js';

describe('ApifyWebsiteAdapter integration', () => {
  it('returns success with extracted website data', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            url: 'https://acme.com',
            text: 'Welcome to Acme. Pay with Stripe or PayPal. Powered by Shopify.',
            html: '<div class="product-card">Buy now</div><script src="https://cdn.shopify.com/s/files/1/shop.js"></script>',
          },
          {
            url: 'https://acme.com/pricing',
            text: 'Starter plan $29/mo. Professional plan $99/mo. Enterprise custom pricing.',
            html: '<div class="pricing">Plans and subscription options</div>',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const adapter = new ApifyWebsiteAdapter({
      apiKey: 'apify-key',
      actorId: 'actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    expect(adapter.isConfigured).toBe(true);

    const result = await adapter.scrapeWebsite('acme.com');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }

    expect(result.data.hasShopify).toBe(true);
    expect(result.data.paymentWidgets).toContain('stripe');
    expect(result.data.paymentWidgets).toContain('paypal');
    expect(result.data.hasPricingTiers).toBe(true);
    expect(result.data.hasProductCatalog).toBe(true);
    expect(result.data.detectedPlatforms).toContain('Shopify');

    // Verify the URL called
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('run-sync-get-dataset-items');
    expect(String(url)).toContain('token=apify-key');
    expect((options as RequestInit).method).toBe('POST');
    const body = JSON.parse((options as RequestInit).body as string) as Record<string, unknown>;
    expect(body.startUrls).toEqual([{ url: 'https://acme.com' }]);
  });

  it('returns terminal_error when config is missing', async () => {
    const adapter = new ApifyWebsiteAdapter({
      apiKey: undefined,
      actorId: undefined,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(adapter.isConfigured).toBe(false);

    const result = await adapter.scrapeWebsite('acme.com');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') {
      throw new Error('Expected terminal_error result');
    }
    expect(result.failure.classification).toBe('terminal');
    expect(result.failure.message).toContain('not configured');
  });

  it('returns retryable_error on 500 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
      });
    }) as unknown as typeof fetch;

    const adapter = new ApifyWebsiteAdapter({
      apiKey: 'apify-key',
      actorId: 'actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    const result = await adapter.scrapeWebsite('acme.com');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.statusCode).toBe(500);
  });

  it('returns terminal_error on 403 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('Forbidden', { status: 403 });
    }) as unknown as typeof fetch;

    const adapter = new ApifyWebsiteAdapter({
      apiKey: 'apify-key',
      actorId: 'actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    const result = await adapter.scrapeWebsite('acme.com');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') {
      throw new Error('Expected terminal_error result');
    }
    expect(result.failure.classification).toBe('terminal');
    expect(result.failure.statusCode).toBe(403);
  });

  it('returns retryable_error on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Network timeout');
    }) as unknown as typeof fetch;

    const adapter = new ApifyWebsiteAdapter({
      apiKey: 'apify-key',
      actorId: 'actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    const result = await adapter.scrapeWebsite('acme.com');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.message).toBe('Network timeout');
  });

  it('handles empty items array gracefully', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const adapter = new ApifyWebsiteAdapter({
      apiKey: 'apify-key',
      actorId: 'actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    const result = await adapter.scrapeWebsite('empty.com');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }
    expect(result.data.paymentWidgets).toEqual([]);
    expect(result.data.hasShopify).toBe(false);
    expect(result.data.detectedPlatforms).toEqual([]);
  });
});

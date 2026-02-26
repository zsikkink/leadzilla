import { describe, expect, it, vi } from 'vitest';

import { ApifyInstagramAdapter } from './apify-instagram.adapter.js';

describe('ApifyInstagramAdapter integration', () => {
  it('returns success with parsed profile data', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            followersCount: 15000,
            followingCount: 320,
            biography: 'UAE fintech empowering businesses',
            externalUrl: 'https://zbooni.com',
            isBusinessAccount: true,
            latestPosts: [
              { likesCount: 450, commentsCount: 30, timestamp: '2026-02-20T12:00:00Z' },
              { likesCount: 320, commentsCount: 15, timestamp: '2026-02-18T10:00:00Z' },
              { likesCount: 500, commentsCount: 40, timestamp: '2026-02-15T08:00:00Z' },
            ],
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const adapter = new ApifyInstagramAdapter({
      apiKey: 'apify-key',
      actorId: 'insta-actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    expect(adapter.isConfigured).toBe(true);

    const result = await adapter.scrapeProfile('@zbooni');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }

    expect(result.data.followerCount).toBe(15000);
    expect(result.data.followingCount).toBe(320);
    expect(result.data.bio).toBe('UAE fintech empowering businesses');
    expect(result.data.bioLink).toBe('https://zbooni.com');
    expect(result.data.isBusinessAccount).toBe(true);
    expect(result.data.recentPostCount).toBe(3);
    expect(result.data.lastPostDate).toBe('2026-02-20T12:00:00Z');

    // Engagement: avg = (450+30+320+15+500+40)/3 = 451.67; rate = 451.67/15000 ≈ 0.0301
    expect(result.data.engagementRate).toBeGreaterThan(0);
    expect(result.data.engagementRate).toBeLessThan(1);

    // Verify handle was stripped of @
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, options] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse((options as RequestInit).body as string) as Record<string, unknown>;
    expect(body.usernames).toEqual(['zbooni']);
  });

  it('returns terminal_error when config is missing', async () => {
    const adapter = new ApifyInstagramAdapter({
      apiKey: undefined,
      actorId: undefined,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(adapter.isConfigured).toBe(false);

    const result = await adapter.scrapeProfile('somehandle');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') {
      throw new Error('Expected terminal_error result');
    }
    expect(result.failure.classification).toBe('terminal');
    expect(result.failure.message).toContain('not configured');
  });

  it('returns retryable_error on 429 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
    }) as unknown as typeof fetch;

    const adapter = new ApifyInstagramAdapter({
      apiKey: 'apify-key',
      actorId: 'insta-actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    const result = await adapter.scrapeProfile('testhandle');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.statusCode).toBe(429);
  });

  it('returns terminal_error on 400 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    }) as unknown as typeof fetch;

    const adapter = new ApifyInstagramAdapter({
      apiKey: 'apify-key',
      actorId: 'insta-actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    const result = await adapter.scrapeProfile('testhandle');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') {
      throw new Error('Expected terminal_error result');
    }
    expect(result.failure.classification).toBe('terminal');
    expect(result.failure.statusCode).toBe(400);
  });

  it('returns retryable_error on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Connection refused');
    }) as unknown as typeof fetch;

    const adapter = new ApifyInstagramAdapter({
      apiKey: 'apify-key',
      actorId: 'insta-actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    const result = await adapter.scrapeProfile('testhandle');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.message).toBe('Connection refused');
  });

  it('handles empty profile data gracefully', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify([{}]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const adapter = new ApifyInstagramAdapter({
      apiKey: 'apify-key',
      actorId: 'insta-actor-123',
      timeoutMs: 5000,
      fetchImpl,
    });

    const result = await adapter.scrapeProfile('emptyprofile');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }
    expect(result.data.followerCount).toBe(0);
    expect(result.data.followingCount).toBe(0);
    expect(result.data.engagementRate).toBe(0);
    expect(result.data.recentPostCount).toBe(0);
    expect(result.data.lastPostDate).toBeNull();
    expect(result.data.bio).toBeNull();
    expect(result.data.bioLink).toBeNull();
    expect(result.data.isBusinessAccount).toBe(false);
  });
});

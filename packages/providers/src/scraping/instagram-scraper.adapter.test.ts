import { describe, expect, it, vi } from 'vitest';

import { InstagramScraperAdapter } from './instagram-scraper.adapter.js';

describe('InstagramScraperAdapter', () => {
  it('rejects non-profile handles before making a network request', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = new InstagramScraperAdapter({ fetchImpl });

    const result = await adapter.scrapeProfile('https://www.instagram.com/reel/abc123/');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') throw new Error('Expected terminal_error');
    expect(result.failure.message).toContain('does not point to a profile');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns terminal_error when public scraping is redirected to the Instagram login wall', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://www.instagram.com/accounts/login/' },
      }),
    ) as unknown as typeof fetch;
    const adapter = new InstagramScraperAdapter({ fetchImpl });

    const result = await adapter.scrapeProfile('testbiz');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') throw new Error('Expected terminal_error');
    expect(result.failure.message).toContain('authenticated Instagram session is required');
  });

  it('returns terminal_error when Instagram serves a login wall HTML page', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        `
          <html>
            <head><title>Login * Instagram</title></head>
            <body>
              <a href="/accounts/login/">Log in</a>
            </body>
          </html>
        `,
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      ),
    ) as unknown as typeof fetch;
    const adapter = new InstagramScraperAdapter({ fetchImpl });

    const result = await adapter.scrapeProfile('testbiz');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') throw new Error('Expected terminal_error');
    expect(result.failure.message).toContain('authenticated Instagram session is required');
  });

  it('returns terminal_error with a cookie-refresh hint when configured cookies are invalid', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const urlStr =
        typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      if (urlStr.includes('/api/v1/users/web_profile_info/')) {
        return new Response('', { status: 403 });
      }

      return new Response('', {
        status: 302,
        headers: { location: 'https://www.instagram.com/accounts/login/' },
      });
    }) as unknown as typeof fetch;

    const adapter = new InstagramScraperAdapter({
      fetchImpl,
      cookies: 'sessionid=test-session; csrftoken=test-csrf; ds_user_id=12345',
    });

    const result = await adapter.scrapeProfile('testbiz');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') throw new Error('Expected terminal_error');
    expect(result.failure.message).toContain('refresh INSTAGRAM_COOKIES');
  });
});

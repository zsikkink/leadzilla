import { describe, expect, it, vi } from 'vitest';

import { SerpApiWebSearchAdapter } from './serpapi-web-search.adapter.js';

describe('SerpApiWebSearchAdapter', () => {
  it('flags quota exhaustion from non-200 responses as terminal', async () => {
    const adapter = new SerpApiWebSearchAdapter({
      apiKey: 'serp-key',
      fetchImpl: vi.fn().mockResolvedValue(
        new Response('You have run out of searches for this month.', { status: 429 }),
      ),
    });

    const result = await adapter.search('"Atlas Clinic" Amman founder OR CEO OR owner');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') return;

    expect(result.failure.message).toContain('quotaExhausted=true');
    expect(result.failure.classification).toBe('terminal');
  });

  it('returns organic results on success', async () => {
    const adapter = new SerpApiWebSearchAdapter({
      apiKey: 'serp-key',
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          organic_results: [
            {
              title: 'Jane Doe - CEO - Atlas Clinic | LinkedIn',
              snippet: 'CEO at Atlas Clinic',
              link: 'https://www.linkedin.com/in/jane-doe',
            },
          ],
        }), { status: 200 }),
      ),
    });

    const result = await adapter.search('"Atlas Clinic" Amman founder OR CEO OR owner', 3);

    expect(result).toEqual({
      status: 'success',
      data: [
        {
          title: 'Jane Doe - CEO - Atlas Clinic | LinkedIn',
          snippet: 'CEO at Atlas Clinic',
          link: 'https://www.linkedin.com/in/jane-doe',
        },
      ],
    });
  });
});

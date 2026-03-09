import { describe, expect, it, vi } from 'vitest';

import { HunterAdapter } from './hunter.adapter.js';

describe('HunterAdapter.searchDomainContacts', () => {
  it('returns ranked contacts from domain search', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            emails: [
              {
                value: 'info@acme.com',
                first_name: null,
                last_name: null,
                position: null,
                type: 'generic',
              },
              {
                value: 'sara@acme.com',
                first_name: 'Sara',
                last_name: 'Ali',
                position: 'CEO',
                type: 'personal',
              },
              {
                value: 'ahmed@acme.com',
                first_name: 'Ahmed',
                last_name: 'Khan',
                position: 'Sales Manager',
                type: 'personal',
              },
              {
                value: 'support@acme.com',
                first_name: null,
                last_name: null,
                position: null,
                type: 'generic',
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const adapter = new HunterAdapter({
      apiKey: 'hunter-key',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    expect(adapter.isConfigured).toBe(true);

    const result = await adapter.searchDomainContacts('acme.com');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }

    // Personal emails first, then generic. Within each group, executive titles first.
    expect(result.contacts).toHaveLength(4);
    expect(result.contacts[0]!.email).toBe('sara@acme.com'); // personal, CEO
    expect(result.contacts[0]!.type).toBe('personal');
    expect(result.contacts[0]!.position).toBe('CEO');
    expect(result.contacts[1]!.email).toBe('ahmed@acme.com'); // personal, Manager
    expect(result.contacts[1]!.type).toBe('personal');
    // Generic emails last
    expect(result.contacts[2]!.type).toBe('generic');
    expect(result.contacts[3]!.type).toBe('generic');

    // Verify API call uses limit=5
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('domain-search');
    expect(String(url)).toContain('limit=5');
    expect(String(url)).toContain('domain=acme.com');
  });

  it('returns terminal_error when API key is missing', async () => {
    const adapter = new HunterAdapter({
      apiKey: undefined,
      minRequestIntervalMs: 0,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(adapter.isConfigured).toBe(false);

    const result = await adapter.searchDomainContacts('acme.com');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') {
      throw new Error('Expected terminal_error result');
    }
    expect(result.failure.classification).toBe('terminal');
    expect(result.failure.message).toContain('not configured');
  });

  it('returns terminal_error when domain is empty', async () => {
    const adapter = new HunterAdapter({
      apiKey: 'hunter-key',
      minRequestIntervalMs: 0,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    const result = await adapter.searchDomainContacts('');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') {
      throw new Error('Expected terminal_error result');
    }
    expect(result.failure.message).toContain('domain is required');
  });

  it('returns retryable_error on 500 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'server error' }), { status: 500 });
    }) as unknown as typeof fetch;

    const adapter = new HunterAdapter({
      apiKey: 'hunter-key',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchDomainContacts('acme.com');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.statusCode).toBe(500);
  });

  it('returns retryable_error on 429 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
    }) as unknown as typeof fetch;

    const adapter = new HunterAdapter({
      apiKey: 'hunter-key',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchDomainContacts('acme.com');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.statusCode).toBe(429);
  });

  it('returns terminal_error on 401 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }) as unknown as typeof fetch;

    const adapter = new HunterAdapter({
      apiKey: 'bad-key',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchDomainContacts('acme.com');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') {
      throw new Error('Expected terminal_error result');
    }
    expect(result.failure.classification).toBe('terminal');
    expect(result.failure.statusCode).toBe(401);
  });

  it('returns retryable_error on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;

    const adapter = new HunterAdapter({
      apiKey: 'hunter-key',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchDomainContacts('acme.com');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.message).toBe('ETIMEDOUT');
  });

  it('handles empty emails array', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ data: { emails: [] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const adapter = new HunterAdapter({
      apiKey: 'hunter-key',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchDomainContacts('empty.com');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }
    expect(result.contacts).toEqual([]);
  });
});

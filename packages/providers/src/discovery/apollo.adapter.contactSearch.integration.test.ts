import { describe, expect, it, vi } from 'vitest';

import { ApolloDiscoveryAdapter } from './apollo.adapter.js';

describe('ApolloDiscoveryAdapter.searchContactsByDomain', () => {
  it('returns ranked contacts sorted by title', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          people: [
            {
              id: 'p1',
              first_name: 'Sara',
              last_name: 'Ali',
              email: 'sara@acme.com',
              title: 'Sales Manager',
              sanitized_phone: '+971501234567',
              organization: { name: 'Acme Corp' },
            },
            {
              id: 'p2',
              first_name: 'Ahmed',
              last_name: 'Khan',
              email: 'ahmed@acme.com',
              title: 'CEO',
              phone_numbers: [{ sanitized_number: '+971509876543' }],
              organization: { name: 'Acme Corp' },
            },
            {
              id: 'p3',
              first_name: 'Lina',
              last_name: 'Hasan',
              email: 'lina@acme.com',
              title: 'Co-Founder & CTO',
              sanitized_phone: null,
              organization: { name: 'Acme Corp' },
            },
            {
              id: 'p4',
              first_name: 'Omar',
              last_name: 'Rizk',
              email: 'omar@acme.com',
              title: 'Owner',
              organization: { name: 'Acme Corp' },
            },
            {
              id: 'p5',
              first_name: 'Dana',
              last_name: 'Noor',
              email: 'dana@acme.com',
              title: 'Software Engineer',
              organization: { name: 'Acme Corp' },
            },
            {
              id: 'p6',
              first_name: 'Zain',
              last_name: 'Malik',
              email: 'zain@acme.com',
              title: 'Director of Operations',
              organization: { name: 'Acme Corp' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const adapter = new ApolloDiscoveryAdapter({
      apiKey: 'apollo-test-key',
      baseUrl: 'https://apollo.test',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchContactsByDomain('acme.com');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }

    // Should return top 5 sorted: Owner(1) > CEO(2) > Co-Founder(3) > Director(4) > Manager(6)
    expect(result.contacts).toHaveLength(5);
    expect(result.contacts[0]!.firstName).toBe('Omar'); // Owner
    expect(result.contacts[1]!.firstName).toBe('Ahmed'); // CEO
    expect(result.contacts[2]!.firstName).toBe('Lina'); // Co-Founder
    expect(result.contacts[3]!.firstName).toBe('Zain'); // Director
    expect(result.contacts[4]!.firstName).toBe('Sara'); // Manager

    // Check phone extraction
    expect(result.contacts[0]!.phone).toBeNull(); // Omar has no phone
    expect(result.contacts[1]!.phone).toBe('+971509876543'); // Ahmed from phone_numbers array

    // Verify API call
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/mixed_people/search');
    const body = JSON.parse((options as RequestInit).body as string) as Record<string, unknown>;
    expect(body.q_organization_domains).toEqual(['acme.com']);
    expect(body.per_page).toBe(10);
  });

  it('returns retryable_error on 429 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { 'retry-after': '30' },
      });
    }) as unknown as typeof fetch;

    const adapter = new ApolloDiscoveryAdapter({
      apiKey: 'apollo-test-key',
      baseUrl: 'https://apollo.test',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchContactsByDomain('acme.com');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.statusCode).toBe(429);
  });

  it('returns terminal_error on 403 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('Forbidden', { status: 403 });
    }) as unknown as typeof fetch;

    const adapter = new ApolloDiscoveryAdapter({
      apiKey: 'apollo-test-key',
      baseUrl: 'https://apollo.test',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchContactsByDomain('acme.com');

    expect(result.status).toBe('terminal_error');
    if (result.status !== 'terminal_error') {
      throw new Error('Expected terminal_error result');
    }
    expect(result.failure.classification).toBe('terminal');
    expect(result.failure.statusCode).toBe(403);
  });

  it('returns retryable_error on 500 response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
    }) as unknown as typeof fetch;

    const adapter = new ApolloDiscoveryAdapter({
      apiKey: 'apollo-test-key',
      baseUrl: 'https://apollo.test',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchContactsByDomain('acme.com');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.statusCode).toBe(500);
  });

  it('returns retryable_error on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const adapter = new ApolloDiscoveryAdapter({
      apiKey: 'apollo-test-key',
      baseUrl: 'https://apollo.test',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchContactsByDomain('acme.com');

    expect(result.status).toBe('retryable_error');
    if (result.status !== 'retryable_error') {
      throw new Error('Expected retryable_error result');
    }
    expect(result.failure.classification).toBe('retryable');
    expect(result.failure.message).toBe('ECONNREFUSED');
  });

  it('handles empty people array', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ people: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const adapter = new ApolloDiscoveryAdapter({
      apiKey: 'apollo-test-key',
      baseUrl: 'https://apollo.test',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchContactsByDomain('empty.com');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }
    expect(result.contacts).toEqual([]);
  });

  it('skips people without email', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          people: [
            { id: 'p1', first_name: 'No', last_name: 'Email', title: 'CEO' },
            { id: 'p2', first_name: 'Has', last_name: 'Email', email: 'has@acme.com', title: 'Manager' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const adapter = new ApolloDiscoveryAdapter({
      apiKey: 'apollo-test-key',
      baseUrl: 'https://apollo.test',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.searchContactsByDomain('acme.com');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]!.email).toBe('has@acme.com');
  });
});

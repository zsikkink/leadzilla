import { describe, expect, it, vi } from 'vitest';

import { HunterAdapter } from './hunter.adapter.js';

describe('HunterAdapter integration', () => {
  it('returns normalized success result', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            email: 'sara@acme.com',
            first_name: 'Sara',
            last_name: 'Ali',
            organization: 'Acme',
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

    const result = await adapter.enrichLead({
      email: 'sara@acme.com',
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }
    expect(result.normalized.email).toBe('sara@acme.com');
    expect(result.normalized.domain).toBe('acme.com');
    expect(result.normalized.companyName).toBe('Acme');
    expect(result.normalized.linkedinUrl).toBeNull();
  });

  it('returns terminal_error when API key is missing', async () => {
    const adapter = new HunterAdapter({
      apiKey: undefined,
      minRequestIntervalMs: 0,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    const result = await adapter.enrichLead({
      email: 'sara@acme.com',
    });

    expect(result.status).toBe('terminal_error');
  });

  it('searchDomainContacts returns confidence and verification fields', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            emails: [
              {
                value: 'ceo@acme.com',
                first_name: 'John',
                last_name: 'Doe',
                position: 'CEO',
                type: 'personal',
                confidence: 92,
                verification: { status: 'valid' },
              },
              {
                value: 'intern@acme.com',
                first_name: 'Jane',
                last_name: 'Smith',
                position: null,
                type: 'personal',
                confidence: 30,
                verification: 'unknown',
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

    const result = await adapter.searchDomainContacts('acme.com');
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected success');

    // First contact: confidence as number, verification as object with status
    expect(result.contacts[0]!.confidence).toBe(92);
    expect(result.contacts[0]!.verification).toBe('valid');

    // Second contact: lower confidence, verification as plain string
    const intern = result.contacts.find((c) => c.email === 'intern@acme.com')!;
    expect(intern.confidence).toBe(30);
    expect(intern.verification).toBe('unknown');
  });

  it('searchDomainContacts handles missing confidence/verification', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            emails: [
              {
                value: 'legacy@acme.com',
                first_name: 'Old',
                last_name: 'Contact',
                position: null,
                type: 'personal',
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

    const result = await adapter.searchDomainContacts('acme.com');
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected success');

    expect(result.contacts[0]!.confidence).toBeNull();
    expect(result.contacts[0]!.verification).toBeNull();
  });

  it('classifies 500 responses as retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'temporary' }), { status: 500 });
    }) as unknown as typeof fetch;

    const adapter = new HunterAdapter({
      apiKey: 'hunter-key',
      minRequestIntervalMs: 0,
      fetchImpl,
    });

    const result = await adapter.enrichLead({
      email: 'retry@acme.com',
    });

    expect(result.status).toBe('retryable_error');
  });
});

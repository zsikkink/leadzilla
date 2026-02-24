import { describe, expect, it, vi } from 'vitest';

import { TrengoAdapter } from './trengo.adapter.js';

describe('TrengoAdapter integration', () => {
  describe('sendTemplateMessage', () => {
    it('returns success with provider message id and ticket id', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(
          JSON.stringify({ id: 12345, ticket_id: 99 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const adapter = new TrengoAdapter({
        apiKey: 'trengo-key',
        channelId: 'ch-123',
        templateId: 'tmpl-456',
        fetchImpl,
      });

      const result = await adapter.sendTemplateMessage({
        recipientPhoneNumber: '+971501234567',
        params: ['Sara', 'Hello from Zbooni'],
      });

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.providerMessageId).toBe('12345');
      expect(result.ticketId).toBe('99');

      // Verify request structure
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, options] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://app.trengo.com/api/v2/wa_sessions');

      const body = JSON.parse((options as RequestInit).body as string) as Record<string, unknown>;
      expect(body.channel_id).toBe('ch-123');
      expect(body.recipient_phone_number).toBe('+971501234567');
      expect(body.hsm_id).toBe('tmpl-456');
      expect(body.params).toEqual(['Sara', 'Hello from Zbooni']);
    });

    it('returns terminal_error when API key is missing', async () => {
      const adapter = new TrengoAdapter({
        apiKey: undefined,
        channelId: 'ch-123',
        templateId: 'tmpl-456',
        fetchImpl: vi.fn() as unknown as typeof fetch,
      });

      const result = await adapter.sendTemplateMessage({
        recipientPhoneNumber: '+971501234567',
        params: [],
      });

      expect(result.status).toBe('terminal_error');
      if (result.status !== 'terminal_error') throw new Error('Expected terminal_error');
      expect(result.failure.message).toContain('TRENGO_API_KEY');
    });

    it('returns terminal_error when channel ID is missing', async () => {
      const adapter = new TrengoAdapter({
        apiKey: 'trengo-key',
        channelId: undefined,
        templateId: 'tmpl-456',
        fetchImpl: vi.fn() as unknown as typeof fetch,
      });

      const result = await adapter.sendTemplateMessage({
        recipientPhoneNumber: '+971501234567',
        params: [],
      });

      expect(result.status).toBe('terminal_error');
      if (result.status !== 'terminal_error') throw new Error('Expected terminal_error');
      expect(result.failure.message).toContain('TRENGO_CHANNEL_ID');
    });

    it('returns terminal_error when template ID is missing', async () => {
      const adapter = new TrengoAdapter({
        apiKey: 'trengo-key',
        channelId: 'ch-123',
        templateId: undefined,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      });

      const result = await adapter.sendTemplateMessage({
        recipientPhoneNumber: '+971501234567',
        params: [],
      });

      expect(result.status).toBe('terminal_error');
      if (result.status !== 'terminal_error') throw new Error('Expected terminal_error');
      expect(result.failure.message).toContain('TRENGO_TEMPLATE_ID');
    });
  });

  describe('sendMessage', () => {
    it('returns success for direct message to ticket', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(
          JSON.stringify({ id: 67890 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const adapter = new TrengoAdapter({
        apiKey: 'trengo-key',
        channelId: 'ch-123',
        fetchImpl,
      });

      const result = await adapter.sendMessage({
        ticketId: '99',
        bodyText: 'Follow-up message...',
      });

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.providerMessageId).toBe('67890');

      // Verify correct endpoint
      const [url] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://app.trengo.com/api/v2/tickets/99/messages');

      const body = JSON.parse(
        (fetchImpl.mock.calls[0]![1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(body.body).toBe('Follow-up message...');
    });

    it('returns terminal_error when API key is missing', async () => {
      const adapter = new TrengoAdapter({
        apiKey: undefined,
        channelId: 'ch-123',
        fetchImpl: vi.fn() as unknown as typeof fetch,
      });

      const result = await adapter.sendMessage({
        ticketId: '99',
        bodyText: 'Hello',
      });

      expect(result.status).toBe('terminal_error');
    });
  });

  describe('error classification', () => {
    it('classifies 429 as retryable', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'rate limit' }), { status: 429 });
      }) as unknown as typeof fetch;

      const adapter = new TrengoAdapter({
        apiKey: 'trengo-key',
        channelId: 'ch-123',
        templateId: 'tmpl-456',
        fetchImpl,
      });

      const result = await adapter.sendTemplateMessage({
        recipientPhoneNumber: '+971501234567',
        params: [],
      });

      expect(result.status).toBe('retryable_error');
    });

    it('classifies 500 as retryable', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
      }) as unknown as typeof fetch;

      const adapter = new TrengoAdapter({
        apiKey: 'trengo-key',
        channelId: 'ch-123',
        fetchImpl,
      });

      const result = await adapter.sendMessage({
        ticketId: '99',
        bodyText: 'Test',
      });

      expect(result.status).toBe('retryable_error');
    });

    it('classifies 403 as terminal', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
      }) as unknown as typeof fetch;

      const adapter = new TrengoAdapter({
        apiKey: 'trengo-key',
        channelId: 'ch-123',
        templateId: 'tmpl-456',
        fetchImpl,
      });

      const result = await adapter.sendTemplateMessage({
        recipientPhoneNumber: '+971501234567',
        params: [],
      });

      expect(result.status).toBe('terminal_error');
    });

    it('returns retryable_error on network failure', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;

      const adapter = new TrengoAdapter({
        apiKey: 'trengo-key',
        channelId: 'ch-123',
        templateId: 'tmpl-456',
        fetchImpl,
      });

      const result = await adapter.sendTemplateMessage({
        recipientPhoneNumber: '+971501234567',
        params: [],
      });

      expect(result.status).toBe('retryable_error');
    });
  });

  describe('isConfigured', () => {
    it('returns true when both apiKey and channelId are set', () => {
      const adapter = new TrengoAdapter({ apiKey: 'key', channelId: 'ch' });
      expect(adapter.isConfigured).toBe(true);
    });

    it('returns false when apiKey is missing', () => {
      const adapter = new TrengoAdapter({ apiKey: undefined, channelId: 'ch' });
      expect(adapter.isConfigured).toBe(false);
    });

    it('returns false when channelId is missing', () => {
      const adapter = new TrengoAdapter({ apiKey: 'key', channelId: undefined });
      expect(adapter.isConfigured).toBe(false);
    });
  });
});

import { describe, expect, it, vi } from 'vitest';

import { OpenAiAdapter } from './openai.adapter.js';

function makeOpenAiResponse(content: string) {
  return JSON.stringify({
    id: 'chatcmpl-abc123',
    object: 'chat.completion',
    model: 'gpt-4o-2024-08-06',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
  });
}

const VALID_GENERATION_RESPONSE = {
  message: {
    subject: 'Boost your fintech payments',
    bodyText: 'Hi Sara, I noticed Acme is growing fast...',
    bodyHtml: '<p>Hi Sara, I noticed Acme is growing fast...</p>',
    ctaText: 'Schedule a demo',
  },
};

const VALID_SCORING_RESPONSE = {
  score: 0.82,
  reasoning: ['Strong fintech alignment', 'UAE market presence'],
};

const GENERATION_CONTEXT = {
  leadName: 'Sara Ali',
  leadEmail: 'sara@acme.com',
  companyName: 'Acme Corp',
  industry: 'Fintech',
  country: 'UAE',
  featuresJson: { employees: 50, revenue: 1000000 },
  scoreBand: 'A',
  blendedScore: 0.85,
  icpDescription: 'UAE fintech company with 10-200 employees',
};

const SCORING_CONTEXT = {
  featuresJson: { employees: 50, revenue: 1000000 },
  icpDescription: 'UAE fintech company with 10-200 employees',
  deterministicScore: 0.75,
};

describe('OpenAiAdapter integration', () => {
  describe('generateMessageVariants', () => {
    it('returns parsed single message on success', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(
          makeOpenAiResponse(JSON.stringify(VALID_GENERATION_RESPONSE)),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const adapter = new OpenAiAdapter({ apiKey: 'sk-test', fetchImpl });
      const result = await adapter.generateMessageVariants(GENERATION_CONTEXT);

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.model).toBe('gpt-4o');
      expect(result.data.message.subject).toBe('Boost your fintech payments');
      expect(result.data.message.bodyText).toContain('Sara');
    });

    it('strips markdown fences from response', async () => {
      const fencedContent = '```json\n' + JSON.stringify(VALID_GENERATION_RESPONSE) + '\n```';
      const fetchImpl = vi.fn(async () => {
        return new Response(
          makeOpenAiResponse(fencedContent),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const adapter = new OpenAiAdapter({ apiKey: 'sk-test', fetchImpl });
      const result = await adapter.generateMessageVariants(GENERATION_CONTEXT);

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.message.subject).toBe('Boost your fintech payments');
    });

    it('sends icpHook as a mandatory system instruction when provided', async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(
          makeOpenAiResponse(JSON.stringify(VALID_GENERATION_RESPONSE)),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const adapter = new OpenAiAdapter({
        apiKey: 'sk-test',
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await adapter.generateMessageVariants({
        ...GENERATION_CONTEXT,
        icpHook: 'Zbooni helps luxury hotels increase repeat bookings through WhatsApp-based ordering',
      });

      expect(result.status).toBe('success');

      const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const payload = JSON.parse(String(requestInit?.body ?? '{}')) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const systemPrompt = payload.messages?.find((msg) => msg.role === 'system')?.content ?? '';
      const userPrompt = payload.messages?.find((msg) => msg.role === 'user')?.content ?? '';

      expect(systemPrompt).toContain('MANDATORY ICP HOOK INSTRUCTION');
      expect(systemPrompt).toContain('You MUST incorporate the following sales hook as the core angle of your message');
      expect(systemPrompt).toContain('Zbooni helps luxury hotels increase repeat bookings through WhatsApp-based ordering');
      expect(userPrompt).not.toContain('ICP hook (use as opening line)');
    });

    it('uses custom role, replaces default system prompt, and appends user instructions', async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(
          makeOpenAiResponse(JSON.stringify(VALID_GENERATION_RESPONSE)),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const adapter = new OpenAiAdapter({
        apiKey: 'sk-test',
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await adapter.generateMessageVariants({
        ...GENERATION_CONTEXT,
        customRole: 'Senior Enterprise Account Executive at Zbooni',
        customSystemPrompt: 'Write one concise line and sign off as an enterprise AE.',
        messagingInstructions: "Never use the word 'leverage'.",
      });

      expect(result.status).toBe('success');

      const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const payload = JSON.parse(String(requestInit?.body ?? '{}')) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const systemPrompt = payload.messages?.find((msg) => msg.role === 'system')?.content ?? '';

      expect(systemPrompt).toContain('Senior Enterprise Account Executive at Zbooni');
      expect(systemPrompt).toContain('Write one concise line and sign off as an enterprise AE.');
      expect(systemPrompt).toContain("Additional instructions from the user: Never use the word 'leverage'.");
      expect(systemPrompt).toContain('I’m reaching out from Zbooni. We help businesses turn customer messages into paid, trackable orders.');
      expect(systemPrompt).not.toContain('## ZBOONI POSITIONING');
      expect(systemPrompt).not.toContain('You are a senior sales development representative at Zbooni');
    });

    it('passes channel and contact-type context into the user prompt', async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(
          makeOpenAiResponse(JSON.stringify(VALID_GENERATION_RESPONSE)),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const adapter = new OpenAiAdapter({
        apiKey: 'sk-test',
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await adapter.generateMessageVariants({
        ...GENERATION_CONTEXT,
        channel: 'EMAIL',
        recipientType: 'GENERIC_CONTACT',
        recipientName: null,
        recipientEmailKind: 'GENERIC',
      });

      expect(result.status).toBe('success');

      const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const payload = JSON.parse(String(requestInit?.body ?? '{}')) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const userPrompt = payload.messages?.find((msg) => msg.role === 'user')?.content ?? '';

      expect(userPrompt).toContain('Channel: EMAIL');
      expect(userPrompt).toContain('Contact type: GENERIC_CONTACT');
      expect(userPrompt).toContain('Recipient name: none verified');
      expect(userPrompt).toContain('Recipient email kind: GENERIC');
      expect(userPrompt).toContain('Recipient guidance: write to the company team');
    });

    it('passes operator re-draft feedback into the user prompt', async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(
          makeOpenAiResponse(JSON.stringify(VALID_GENERATION_RESPONSE)),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const adapter = new OpenAiAdapter({
        apiKey: 'sk-test',
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await adapter.generateMessageVariants({
        ...GENERATION_CONTEXT,
        redraftFeedback:
          "Don't offer to send an example, ask to schedule a meeting, and ask if she's the right person to message.",
        previousDraftSubject: 'Milestone payments?',
        previousDraftBody: 'Would it be useful if I sent a quick example?',
      });

      expect(result.status).toBe('success');

      const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const payload = JSON.parse(String(requestInit?.body ?? '{}')) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const userPrompt = payload.messages?.find((msg) => msg.role === 'user')?.content ?? '';
      const systemPrompt = payload.messages?.find((msg) => msg.role === 'system')?.content ?? '';

      expect(systemPrompt).toContain('RE-DRAFT INSTRUCTION');
      expect(systemPrompt).toContain('Treat this feedback as high priority');
      expect(systemPrompt).toContain('Do not use the word "example" anywhere in the new draft.');
      expect(systemPrompt).toContain('meeting-oriented right-person CTA');
      expect(userPrompt).toContain('Operator re-draft feedback');
      expect(userPrompt).toContain("Don't offer to send an example");
      expect(userPrompt).toContain('Apply this feedback to the new draft');
      expect(userPrompt).toContain('Previous draft subject');
      expect(userPrompt).toContain('Milestone payments?');
      expect(userPrompt).toContain('Previous draft body');
      expect(userPrompt).toContain('Would it be useful if I sent a quick example?');
    });

    it('returns terminal_error when API key is missing', async () => {
      const adapter = new OpenAiAdapter({
        apiKey: undefined,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      });

      const result = await adapter.generateMessageVariants(GENERATION_CONTEXT);

      expect(result.status).toBe('terminal_error');
      if (result.status !== 'terminal_error') throw new Error('Expected terminal_error');
      expect(result.failure.message).toContain('OPENAI_API_KEY');
    });

    it('classifies 429 as retryable', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'rate limit' }), { status: 429 });
      }) as unknown as typeof fetch;

      const adapter = new OpenAiAdapter({ apiKey: 'sk-test', fetchImpl });
      const result = await adapter.generateMessageVariants(GENERATION_CONTEXT);

      expect(result.status).toBe('retryable_error');
    });

    it('classifies 500 as retryable', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
      }) as unknown as typeof fetch;

      const adapter = new OpenAiAdapter({ apiKey: 'sk-test', fetchImpl });
      const result = await adapter.generateMessageVariants(GENERATION_CONTEXT);

      expect(result.status).toBe('retryable_error');
    });

    it('classifies 401 as terminal', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'invalid_api_key' }), { status: 401 });
      }) as unknown as typeof fetch;

      const adapter = new OpenAiAdapter({ apiKey: 'sk-test', fetchImpl });
      const result = await adapter.generateMessageVariants(GENERATION_CONTEXT);

      expect(result.status).toBe('terminal_error');
    });

    it('returns terminal_error when response content is missing', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(
          JSON.stringify({ choices: [{ message: {} }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const adapter = new OpenAiAdapter({ apiKey: 'sk-test', fetchImpl });
      const result = await adapter.generateMessageVariants(GENERATION_CONTEXT);

      expect(result.status).toBe('terminal_error');
    });

    it('returns retryable_error on network failure', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;

      const adapter = new OpenAiAdapter({ apiKey: 'sk-test', fetchImpl });
      const result = await adapter.generateMessageVariants(GENERATION_CONTEXT);

      expect(result.status).toBe('retryable_error');
      if (result.status !== 'retryable_error') throw new Error('Expected retryable_error');
      expect(result.failure.message).toBe('ECONNREFUSED');
    });
  });

  describe('evaluateLeadScore', () => {
    it('returns parsed score result on success', async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(
          makeOpenAiResponse(JSON.stringify(VALID_SCORING_RESPONSE)),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const adapter = new OpenAiAdapter({ apiKey: 'sk-test', fetchImpl });
      const result = await adapter.evaluateLeadScore(SCORING_CONTEXT);

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.score).toBe(0.82);
      expect(result.data.reasoning).toHaveLength(2);
    });

    it('returns terminal_error when API key is missing', async () => {
      const adapter = new OpenAiAdapter({
        apiKey: undefined,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      });

      const result = await adapter.evaluateLeadScore(SCORING_CONTEXT);

      expect(result.status).toBe('terminal_error');
    });
  });

  describe('isConfigured', () => {
    it('returns true when API key is set', () => {
      const adapter = new OpenAiAdapter({ apiKey: 'sk-test' });
      expect(adapter.isConfigured).toBe(true);
    });

    it('returns false when API key is undefined', () => {
      const adapter = new OpenAiAdapter({ apiKey: undefined });
      expect(adapter.isConfigured).toBe(false);
    });
  });
});

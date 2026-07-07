import { describe, expect, it } from 'vitest';

import {
  ensureZbooniTeamSignoff,
  mergeCtaIntoBody,
  validateMessageVariant,
  buildStricterPromptSuffix,
} from './validate-message.js';

describe('validateMessageVariant', () => {
  const base = { subject: null, bodyHtml: null, ctaText: null };

  it('hard-rejects stub body "Message generation pending"', () => {
    const result = validateMessageVariant('WHATSAPP', { ...base, bodyText: 'Message generation pending' });
    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons[0]).toMatch(/stub/i);
  });

  it('hard-rejects empty body', () => {
    const result = validateMessageVariant('EMAIL', { ...base, bodyText: '  ' });
    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
  });

  it('hard-rejects placeholder patterns', () => {
    const result = validateMessageVariant('WHATSAPP', {
      ...base,
      bodyText: 'Hi {firstName}, welcome to {{company}}. We would love to connect with you about our services.',
    });
    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Contains unfilled placeholder patterns');
  });

  it('hard-rejects spam trigger words', () => {
    const result = validateMessageVariant('EMAIL', {
      ...base,
      bodyText: 'Act now to get this GUARANTEED offer before the limited time expires. This is a great opportunity for your business.',
    });
    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Contains spam trigger words: act now, limited time, guaranteed');
  });

  it('does not treat hyphenated non-offer language as standalone spam trigger words', () => {
    const result = validateMessageVariant('EMAIL', {
      ...base,
      bodyText:
        'Hi Ann, Leadzilla helps teams create a friction-free chat-to-payment flow for customer conversations. Would it be useful to compare this with how your team handles chat-driven orders today?\n\nBest,\nLeadzilla Team',
    });
    expect(result.reasons).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Contains spam trigger words')]),
    );
  });

  it('hard-rejects too-short body', () => {
    const result = validateMessageVariant('EMAIL', { ...base, bodyText: 'Hi there, check us out.' });
    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons[0]).toMatch(/too short/i);
  });

  it('soft-truncates long WhatsApp messages', () => {
    const longBody = 'This is a sentence about Leadzilla. '.repeat(20);
    const result = validateMessageVariant('WHATSAPP', { ...base, bodyText: longBody });
    expect(result.valid).toBe(true);
    expect(result.hardReject).toBe(false);
    expect(result.cleaned.bodyText.length).toBeLessThanOrEqual(300);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('preserves Leadzilla Team sign-off when truncating long email messages', () => {
    const body = [
      'Hi Ann,',
      '',
      'This is a long note about Leadzilla and conversational commerce. '.repeat(18),
      'Would it be useful to compare this with how your team handles chat-driven orders today?',
      '',
      'Best,',
      'Leadzilla Team',
    ].join('\n');
    const result = validateMessageVariant(
      'EMAIL',
      { ...base, bodyText: body },
      {
        requireClosingQuestion: true,
        requireProfessionalGreeting: true,
        requireZbooniTeamSignoff: true,
      },
    );

    expect(result.valid).toBe(true);
    expect(result.cleaned.bodyText.length).toBeLessThanOrEqual(900);
    expect(result.cleaned.bodyText).toMatch(/Best,\nLeadzilla Team$/);
    expect(result.cleaned.bodyText).not.toMatch(/you can$/i);
  });

  it('hard-rejects messages that start with only a recipient name when greeting is required', () => {
    const result = validateMessageVariant(
      'EMAIL',
      {
        ...base,
        bodyText:
          'Ann, Leadzilla helps turn WhatsApp conversations into trackable orders. Would it be useful to compare this with how your team handles chat-driven orders today?\n\nBest,\nLeadzilla Team',
      },
      { requireProfessionalGreeting: true },
    );

    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Missing professional greeting');
  });

  it('allows the required Leadzilla intro immediately after the greeting', () => {
    const result = validateMessageVariant(
      'EMAIL',
      {
        ...base,
        subject: 'Track client inquiries?',
        bodyText:
          'Hi Zack,\n\nI’m reaching out from Leadzilla. We help businesses turn customer messages into paid, trackable orders. When a customer asks about a product, your team can send a cart, collect payment, and track the sale from the same conversation. Would it be useful to compare this with how your team handles client conversations today?\n\nBest,\nLeadzilla Team',
      },
      {
        requireProfessionalGreeting: true,
        requireZbooniIntroAfterGreeting: true,
        requireZbooniTeamSignoff: true,
      },
    );

    expect(result.valid).toBe(true);
    expect(result.hardReject).toBe(false);
  });

  it('hard-rejects drafts missing the Leadzilla intro after the greeting when required', () => {
    const result = validateMessageVariant(
      'EMAIL',
      {
        ...base,
        subject: 'Track client inquiries?',
        bodyText:
          'Hi Zack,\n\nWhen a customer asks about a product, your team can send a cart, collect payment, and track the sale from the same conversation. Would it be useful to compare this with how your team handles client conversations today?\n\nBest,\nLeadzilla Team',
      },
      {
        requireProfessionalGreeting: true,
        requireZbooniIntroAfterGreeting: true,
        requireZbooniTeamSignoff: true,
      },
    );

    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Missing Leadzilla intro after greeting');
  });

  it('hard-rejects vague feature-only email subjects', () => {
    const result = validateMessageVariant('EMAIL', {
      ...base,
      subject: 'Milestone payments?',
      bodyText:
        'Hi Ann, Leadzilla helps turn WhatsApp conversations into trackable orders and cleaner payment follow-up for project-based teams. Would it be useful to compare this with how your team handles chat-driven orders today?\n\nBest,\nLeadzilla Team',
    });

    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Vague feature-only subject');
  });

  it('hard-rejects alarmist email subjects', () => {
    const result = validateMessageVariant('EMAIL', {
      ...base,
      subject: 'Failed payments on big deals?',
      bodyText:
        'Hi Zack, I’m reaching out from Leadzilla. We help businesses turn customer messages into paid, trackable orders. When a customer asks about a product, your team can send a cart, collect payment, and track the sale from the same conversation. Would it be useful to compare this with how your team handles chat-driven inquiries today?\n\nBest,\nLeadzilla Team',
    });

    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Alarmist subject');
  });

  it('hard-rejects redrafts that ignore explicit operator feedback', () => {
    const result = validateMessageVariant(
      'EMAIL',
      {
        ...base,
        subject: 'Chat payment workflow?',
        bodyText:
          'Hi Ann, Leadzilla helps project teams collect staged card payments inside customer conversations. Would it be useful if I sent a quick example of how this works?\n\nBest,\nLeadzilla Team',
      },
      {
        redraftFeedback:
          "don't offer to send an example, ask to schedule a meeting, and ask if she's the right person to message.",
      },
    );

    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Redraft feedback not followed: still offers an example');
    expect(result.reasons).toContain('Redraft feedback not followed: missing right-person question');
    expect(result.reasons).toContain('Redraft feedback not followed: missing meeting-oriented CTA');
  });

  it('strips emojis from email messages', () => {
    const result = validateMessageVariant('EMAIL', {
      ...base,
      bodyText:
        'Hi Ann, Leadzilla helps turn WhatsApp conversations into trackable orders and cleaner payment follow-up for project-based teams. Would it be useful to compare this with how your team handles chat-driven orders today? 😊\n\nBest,\nLeadzilla Team',
    });

    expect(result.valid).toBe(true);
    expect(result.cleaned.bodyText).not.toContain('😊');
  });

  it('soft-strips excess emojis for WhatsApp', () => {
    const body = 'Great news for your business! 🎉🚀💰🌟🎊 We have something special for you today.';
    const result = validateMessageVariant('WHATSAPP', { ...base, bodyText: body });
    expect(result.valid).toBe(true);
    const cleaned = result.cleaned.bodyText;
    // eslint-disable-next-line no-misleading-character-class
    const emojiMatches = cleaned.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu);
    expect((emojiMatches ?? []).length).toBeLessThanOrEqual(3);
  });

  it('passes a clean message through', () => {
    const body = 'Hi Sarah, I came across your business and thought Leadzilla could help streamline your sales operations. Would you be open to a quick chat?';
    const result = validateMessageVariant('WHATSAPP', { ...base, bodyText: body });
    expect(result.valid).toBe(true);
    expect(result.hardReject).toBe(false);
    expect(result.cleaned.bodyText).toBe(body);
  });

  it('merges ctaText into bodyText when the model returns it separately', () => {
    const result = mergeCtaIntoBody({
      ...base,
      bodyText: 'I noticed Rady Interior has tiered pricing and Square payments.',
      bodyHtml: '<p>I noticed Rady Interior has tiered pricing and Square payments.</p>',
      ctaText: 'Would it be useful if I sent a quick example?',
    });

    expect(result.bodyText).toBe(
      'I noticed Rady Interior has tiered pricing and Square payments.\n\nWould it be useful if I sent a quick example?',
    );
    expect(result.bodyHtml).toContain('<p>Would it be useful if I sent a quick example?</p>');
  });

  it('does not duplicate ctaText when bodyText already includes it', () => {
    const body = 'I noticed Rady Interior has tiered pricing and Square payments. Would it be useful if I sent a quick example?';
    const result = mergeCtaIntoBody({
      ...base,
      bodyText: body,
      ctaText: 'Would it be useful if I sent a quick example?',
    });

    expect(result.bodyText).toBe(body);
  });

  it('inserts ctaText before the Leadzilla Team sign-off when returned separately', () => {
    const result = mergeCtaIntoBody({
      ...base,
      bodyText: 'Hi Rady Interior team, Leadzilla helps turn WhatsApp chats into trackable orders.\n\nBest,\nLeadzilla Team',
      ctaText: 'Would it be useful to compare this with your current flow?',
    });

    expect(result.bodyText).toBe(
      'Hi Rady Interior team, Leadzilla helps turn WhatsApp chats into trackable orders.\n\nWould it be useful to compare this with your current flow?\n\nBest,\nLeadzilla Team',
    );
  });

  it('appends the Leadzilla Team sign-off when it is missing', () => {
    const result = ensureZbooniTeamSignoff({
      ...base,
      bodyText: 'Hi Rady Interior team, Leadzilla helps turn WhatsApp chats into trackable orders. Would it be useful to compare this with your current flow?',
    });

    expect(result.bodyText).toBe(
      'Hi Rady Interior team, Leadzilla helps turn WhatsApp chats into trackable orders. Would it be useful to compare this with your current flow?\n\nBest,\nLeadzilla Team',
    );
  });

  it('hard-rejects missing closing questions when required', () => {
    const result = validateMessageVariant(
      'EMAIL',
      {
        ...base,
        bodyText: 'I noticed Rady Interior has tiered pricing and Square payments. Leadzilla helps firms collect clean staged card payments.',
      },
      { requireClosingQuestion: true },
    );

    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Missing low-friction closing question');
  });

  it('hard-rejects messages without enough light personalization signals when required', () => {
    const result = validateMessageVariant(
      'EMAIL',
      {
        ...base,
        bodyText: 'I noticed Rady Interior handles project work, and Leadzilla can help with staged card payments. Would a quick example be useful?',
      },
      {
        businessSignalTerms: ['Square', 'tiered pricing'],
        minBusinessSignalMatches: 2,
      },
    );

    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Not enough light personalization signals: 0/2');
  });

  it('accepts a baseline-style lightly personalized message with one required signal', () => {
    const result = validateMessageVariant(
      'EMAIL',
      {
        ...base,
        bodyText:
          'Hi Rady Interior team, many service businesses handle customer questions and payment follow-up through WhatsApp. Leadzilla helps turn those conversations into structured orders, payment links, receipts, and trackable sales without forcing customers through a full ecommerce flow. Would it be useful to compare this with how your team handles chat-driven orders today?\n\nBest,\nLeadzilla Team',
      },
      {
        requireClosingQuestion: true,
        requireProfessionalGreeting: true,
        requireZbooniTeamSignoff: true,
        businessSignalTerms: ['Rady Interior', 'Shopify', 'tiered pricing'],
        minBusinessSignalMatches: 1,
      },
    );

    expect(result.valid).toBe(true);
    expect(result.hardReject).toBe(false);
  });

  it('hard-rejects missing Leadzilla Team sign-off when required', () => {
    const result = validateMessageVariant(
      'EMAIL',
      {
        ...base,
        bodyText:
          'Hi Rady Interior team, many service businesses handle customer questions and payment follow-up through WhatsApp. Leadzilla helps turn those conversations into structured orders and trackable sales. Would it be useful to compare this with how your team handles chat-driven orders today?',
      },
      { requireZbooniTeamSignoff: true },
    );

    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons).toContain('Missing Leadzilla Team sign-off');
  });
});

describe('buildStricterPromptSuffix', () => {
  it('returns a string with character limit for WhatsApp', () => {
    const suffix = buildStricterPromptSuffix('WHATSAPP');
    expect(suffix).toContain('300');
    expect(suffix).toContain('placeholder');
    expect(suffix).toContain('Leadzilla Team');
  });

  it('returns a string with character limit for Email', () => {
    const suffix = buildStricterPromptSuffix('EMAIL');
    expect(suffix).toContain('900');
    expect(suffix).toContain('fresh 2-6 word buyer-readable subject');
    expect(suffix).toContain('Do not copy example subjects verbatim');
    expect(suffix).toContain('Avoid alarmist email subjects');
    expect(suffix).toContain('Immediately after the greeting');
    expect(suffix).not.toContain('Cleaner project payments');
  });

  it('includes exact validation reasons when provided', () => {
    const suffix = buildStricterPromptSuffix('EMAIL', [
      'Contains spam trigger words: act now',
      'Missing low-friction closing question',
    ]);

    expect(suffix).toContain('The previous draft failed validation for these exact reasons');
    expect(suffix).toContain('Contains spam trigger words: act now');
    expect(suffix).toContain('Missing low-friction closing question');
  });
});

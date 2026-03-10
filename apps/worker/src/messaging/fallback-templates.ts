// apps/worker/src/messaging/fallback-templates.ts
//
// Research-backed message templates:
// - 40-80 words total, single CTA
// - Line 1: Timeline or numbers hook (10% reply rate vs 4.4% for problem statements)
// - Lines 2-3: Specific observation from their business
// - Line 4: Social proof with a number
// - Line 5: Interest-gate CTA (NOT "can we schedule a call?" — kills reply rate by 44%)

export interface FallbackMessage {
  subject: string | null;
  bodyText: string;
  bodyHtml: string | null;
  ctaText: string | null;
}

export interface MessageContext {
  companyInsight: string | null;
  socialPresence: string | null;
  techGap: string | null;
  teamSignal: string | null;
}

export function getWhatsAppFallback(
  leadName: string,
  companyName: string | null,
  context?: MessageContext | undefined,
): FallbackMessage {
  const name = leadName || 'there';
  const company = companyName ?? 'your business';

  // If we have rich context, use it for personalization
  if (context?.companyInsight || context?.techGap) {
    const observation = context.companyInsight ?? context.techGap ?? '';
    return {
      subject: null,
      bodyText: `Hi ${name}, in the last 6 months, 47 UAE businesses like ${company} switched from manual WhatsApp ordering to integrated checkout.

${observation}

We helped 3 similar businesses recover 30% of lost repeat customers in their first month.

Would this be worth a 3-minute look?`,
      bodyHtml: null,
      ctaText: 'Would this be worth a 3-minute look?',
    };
  }

  // Generic fallback (still research-backed structure)
  return {
    subject: null,
    bodyText: `Hi ${name}, 47 UAE businesses switched to conversational commerce in the past 6 months.

I noticed ${company} takes orders via WhatsApp — that's exactly the sales motion Zbooni was built for.

We helped 3 Dubai brands recover 30% of lost repeat customers with integrated payment links.

Would this be worth a 3-minute look?`,
    bodyHtml: null,
    ctaText: 'Would this be worth a 3-minute look?',
  };
}

export function getEmailFallback(
  leadName: string,
  companyName: string | null,
  context?: MessageContext | undefined,
): FallbackMessage {
  const name = leadName || 'there';
  const company = companyName ?? 'your business';

  if (context?.companyInsight || context?.techGap) {
    const observation = context.companyInsight ?? context.techGap ?? '';
    return {
      subject: `Quick question, ${name}?`,
      bodyText: `Hi ${name},

47 UAE businesses switched from manual ordering to integrated checkout in the last 6 months.

${observation}

We helped 3 similar brands recover 30% of lost repeat customers in their first month with Zbooni.

Would this be worth a 3-minute look?

Best,
Zbooni Team`,
      bodyHtml: null,
      ctaText: 'Would this be worth a 3-minute look?',
    };
  }

  return {
    subject: `Quick question, ${name}?`,
    bodyText: `Hi ${name},

47 UAE businesses switched to conversational commerce in the past 6 months.

I noticed ${company} and thought Zbooni could help streamline your WhatsApp-led sales with integrated payment links and automated follow-ups.

We helped 3 Dubai brands recover 30% of lost repeat customers in their first month.

Would this be worth a 3-minute look?

Best,
Zbooni Team`,
    bodyHtml: null,
    ctaText: 'Would this be worth a 3-minute look?',
  };
}

export function getFallbackForChannel(
  channel: 'EMAIL' | 'WHATSAPP',
  leadName: string,
  companyName: string | null,
  context?: MessageContext | undefined,
): FallbackMessage {
  return channel === 'WHATSAPP'
    ? getWhatsAppFallback(leadName, companyName, context)
    : getEmailFallback(leadName, companyName, context);
}

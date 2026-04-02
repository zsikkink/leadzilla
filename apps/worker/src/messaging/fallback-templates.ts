// apps/worker/src/messaging/fallback-templates.ts
//
// Personalized fallback templates for when OpenAI generation fails.
// These are the safety net — they should still feel like hand-written outreach.
//
// Structure (research-backed):
// - 40-80 words total, single CTA
// - Line 1: Specific observation about their business (NOT generic stats)
// - Lines 2-3: Relevant value proposition tied to what we know
// - Line 4: Social proof with a number
// - Line 5: Interest-gate CTA (NOT "can we schedule a call?")

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

/** Extra context for richer fallback personalization. */
export interface FallbackExtra {
  /** ICP sales hook — the sharpest value proposition for this segment. */
  icpHook?: string | null | undefined;
  /** ICP segment name (e.g. "Luxury & High-Ticket", "Gifting & Bespoke"). */
  icpSegment?: string | null | undefined;
  /** Business category from Google Maps / Instagram (e.g. "Restaurant", "Spa"). */
  businessCategory?: string | null | undefined;
}

// ---------------------------------------------------------------------------
// Template pools — rotated by a hash of the lead name to avoid repetition
// Each template is a function that fills in the blanks from available context.
// ---------------------------------------------------------------------------

type TemplateBuilder = (vars: {
  name: string;
  company: string;
  observation: string;
  hook: string;
  socialProof: string;
}) => string;

const WHATSAPP_TEMPLATES: TemplateBuilder[] = [
  // Template 1: Observation-led
  ({ name, observation, hook, socialProof }) =>
    `Hi ${name}, ${observation}

${hook}

${socialProof}

Would this be worth a quick look?`,

  // Template 2: Compliment-led
  ({ name, company, observation, hook, socialProof }) =>
    `Hi ${name}, I came across ${company} and noticed ${observation.charAt(0).toLowerCase()}${observation.slice(1)}

${hook} ${socialProof}

Is this something on your radar right now?`,

  // Template 3: Question-led
  ({ name, company, hook, socialProof }) =>
    `Hi ${name}, how does ${company} currently handle high-value orders that come through WhatsApp?

${hook}

${socialProof} Happy to share how if it's relevant.`,

  // Template 4: Direct value
  ({ name, observation, hook, socialProof }) =>
    `Hi ${name}, ${observation}

${hook} ${socialProof}

Worth a 3-minute look?`,
];

const EMAIL_TEMPLATES: TemplateBuilder[] = [
  // Template 1: Observation-led
  ({ name, observation, hook, socialProof }) =>
    `Hi ${name},

${observation}

${hook}

${socialProof}

Would this be worth a quick look?

Best regards,
Zbooni Team`,

  // Template 2: Question-led
  ({ name, company, hook, socialProof }) =>
    `Hi ${name},

How does ${company} currently manage payments for high-value orders?

${hook}

${socialProof}

Is this something you are exploring right now?

Best regards,
Zbooni Team`,

  // Template 3: Compliment-led
  ({ name, company, observation, hook, socialProof }) =>
    `Hi ${name},

I came across ${company} and was impressed — ${observation.charAt(0).toLowerCase()}${observation.slice(1)}

${hook} ${socialProof}

Worth a 3-minute look?

Best regards,
Zbooni Team`,

  // Template 4: Social-proof-led
  ({ name, observation, hook, socialProof }) =>
    `Hi ${name},

${socialProof}

${observation} ${hook}

Curious if this resonates — happy to share specifics if so.

Best regards,
Zbooni Team`,
];

const EMAIL_SUBJECTS: Array<(name: string, company: string) => string> = [
  (name) => `Quick question, ${name}?`,
  (_name, company) => `Noticed something about ${company}`,
  (name) => `${name}, is this on your radar?`,
  (_name, company) => `How ${company} handles high-value orders`,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple stable hash from a string to pick a template index. */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/** Build the best observation line from available context. */
function buildObservation(
  company: string,
  context: MessageContext | undefined,
  extra: FallbackExtra | undefined,
): string {
  // Priority: company insight (richest) > tech gap > social presence > generic
  if (context?.companyInsight) {
    // Trim to first sentence if very long
    const firstSentence = context.companyInsight.split('.')[0]?.trim();
    if (firstSentence && firstSentence.length > 15) {
      return firstSentence + '.';
    }
    return context.companyInsight;
  }

  if (context?.techGap) {
    return `${company} appears to be ${context.techGap}`;
  }

  if (context?.socialPresence) {
    return `${company} has a solid social presence — ${context.socialPresence.split('.')[0]?.trim()}.`;
  }

  if (extra?.businessCategory) {
    return `I noticed ${company} in the ${extra.businessCategory} space.`;
  }

  return `I came across ${company} and thought there might be a fit.`;
}

/** Build the hook line from ICP data. */
function buildHook(extra: FallbackExtra | undefined): string {
  if (extra?.icpHook && extra.icpHook.trim().length > 0) {
    // Use the ICP hook directly — it's the sharpest value prop
    return extra.icpHook.trim();
  }

  // Generic but still value-oriented
  return 'Zbooni helps high-ticket businesses turn WhatsApp conversations into confirmed, paid orders — no manual follow-ups or bank transfer chasing.';
}

/** Build social proof line. */
function buildSocialProof(name: string, company: string): string {
  // Rotate between a few social proof variants
  const proofs = [
    'Over 200 merchants across the UAE already use Zbooni, with an average 81% payment completion rate.',
    'We work with 200+ UAE merchants who process high-value orders through WhatsApp daily.',
    'Similar businesses using Zbooni see 30% more repeat customers in their first month.',
  ];
  // Use stable hash for consistent per-lead rotation
  const idx = simpleHash(name + company) % proofs.length;
  return proofs[idx] as string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getWhatsAppFallback(
  leadName: string,
  companyName: string | null,
  context?: MessageContext | undefined,
  extra?: FallbackExtra | undefined,
): FallbackMessage {
  const name = leadName || 'there';
  const company = companyName ?? 'your business';

  const observation = buildObservation(company, context, extra);
  const hook = buildHook(extra);
  const socialProof = buildSocialProof(name, company);

  const templateIndex = simpleHash(name + company) % WHATSAPP_TEMPLATES.length;
  const template = WHATSAPP_TEMPLATES[templateIndex] as TemplateBuilder;

  const bodyText = template({ name, company, observation, hook, socialProof });

  return {
    subject: null,
    bodyText,
    bodyHtml: null,
    ctaText: null,
  };
}

export function getEmailFallback(
  leadName: string,
  companyName: string | null,
  context?: MessageContext | undefined,
  extra?: FallbackExtra | undefined,
): FallbackMessage {
  const name = leadName || 'there';
  const company = companyName ?? 'your business';

  const observation = buildObservation(company, context, extra);
  const hook = buildHook(extra);
  const socialProof = buildSocialProof(name, company);

  const templateIndex = simpleHash(name + company) % EMAIL_TEMPLATES.length;
  const template = EMAIL_TEMPLATES[templateIndex] as TemplateBuilder;

  const bodyText = template({ name, company, observation, hook, socialProof });

  const subjectIndex = simpleHash(name + company) % EMAIL_SUBJECTS.length;
  const subjectFn = EMAIL_SUBJECTS[subjectIndex] as (name: string, company: string) => string;
  const subject = subjectFn(name, company);

  return {
    subject,
    bodyText,
    bodyHtml: null,
    ctaText: null,
  };
}

export function getFallbackForChannel(
  channel: 'EMAIL' | 'WHATSAPP' | string,
  leadName: string,
  companyName: string | null,
  context?: MessageContext | undefined,
  extra?: FallbackExtra | undefined,
): FallbackMessage {
  return channel === 'WHATSAPP'
    ? getWhatsAppFallback(leadName, companyName, context, extra)
    : getEmailFallback(leadName, companyName, context, extra);
}

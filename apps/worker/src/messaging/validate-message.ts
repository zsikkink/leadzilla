// apps/worker/src/messaging/validate-message.ts

export type MessageChannel = 'EMAIL' | 'WHATSAPP';

export interface ValidationResult {
  valid: boolean;
  hardReject: boolean;
  reasons: string[];
  cleaned: {
    subject: string | null;
    bodyText: string;
    bodyHtml: string | null;
    ctaText: string | null;
  };
}

export interface MessageQualityOptions {
  requireClosingQuestion?: boolean | undefined;
  requireProfessionalGreeting?: boolean | undefined;
  requireZbooniIntroAfterGreeting?: boolean | undefined;
  requireZbooniTeamSignoff?: boolean | undefined;
  businessSignalTerms?: string[] | undefined;
  minBusinessSignalMatches?: number | undefined;
  redraftFeedback?: string | undefined;
}

const PLACEHOLDER_PATTERNS = [
  /\[.*?\]/g,        // [Name], [Company]
  /\{[^{].*?\}/g,    // {name}, {company}  (not {{)
  /\{\{.*?\}\}/g,    // {{name}}
  /\$\{.*?\}/g,      // ${name}
  /<[A-Z][A-Za-z]*>/g, // <Name>, <Company> (uppercase start to avoid HTML tags)
];

const SPAM_TRIGGER_WORDS = [
  'free', 'act now', 'limited time', 'exclusive offer', 'guaranteed',
  'winner', 'free money', 'urgent', 'no obligation', 'risk free',
  'click here', 'buy now', 'order now', 'don\'t miss', 'last chance',
];

const CHANNEL_LIMITS: Record<MessageChannel, { min: number; max: number; maxEmoji: number }> = {
  WHATSAPP: { min: 50, max: 300, maxEmoji: 3 },
  EMAIL: { min: 100, max: 900, maxEmoji: 0 },
};

const VAGUE_FEATURE_ONLY_SUBJECTS = [
  /^milestone payments\??$/i,
];

const ALARMIST_SUBJECT_PATTERNS = [
  /\bfailed payments?\b/i,
  /\bbig deals?\b/i,
  /\blost revenue\b/i,
];

// Unicode emoji regex (covers most common emojis)
// eslint-disable-next-line no-misleading-character-class
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countEmojis(text: string): number {
  const matches = text.match(EMOJI_REGEX);
  return matches ? matches.length : 0;
}

function stripExcessEmojis(text: string, maxEmoji: number): string {
  let count = 0;
  return text.replace(EMOJI_REGEX, (match) => {
    count++;
    return count <= maxEmoji ? match : '';
  });
}

function truncateAtSentenceBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('? '),
  );
  if (lastSentenceEnd > maxLength * 0.5) {
    return truncated.slice(0, lastSentenceEnd + 1).trim();
  }
  // Fall back to last space
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLength * 0.5
    ? truncated.slice(0, lastSpace).trim()
    : truncated.trim();
}

function hasPlaceholders(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function findSpamWords(text: string): string[] {
  return SPAM_TRIGGER_WORDS.filter((trigger) => {
    const escaped = trigger
      .trim()
      .split(/\s+/)
      .map(escapeRegExp)
      .join('\\s+');
    const pattern = new RegExp(`(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`, 'i');
    return pattern.test(text);
  });
}

const STUB_BODY = 'Message generation pending';
const ZBOONI_TEAM_SIGNOFF_PATTERN = /(?:^|\n)\s*Best,?\s*\n\s*Leadzilla Team\s*$/i;
const ZBOONI_INTRO_PATTERN =
  /^(?:I’m|I'm) reaching out from Leadzilla\. We help businesses turn customer messages into paid, trackable orders\./i;

function normalizeForComparison(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeHtmlForComparison(value: string): string {
  return normalizeForComparison(value.replace(/<[^>]*>/g, ' '));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasClosingQuestion(text: string): boolean {
  const tail = text.trim().slice(-220);
  return /[?؟]/.test(tail);
}

function hasProfessionalGreeting(text: string): boolean {
  const firstLine = text.trim().split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? '';
  return /^(?:Hi|Hello)\s+[^,\n]+,/i.test(firstLine);
}

function hasZbooniIntroAfterGreeting(text: string): boolean {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!/^(?:Hi|Hello)\s+[^,\n]+,/i.test(lines[0] ?? '')) {
    return false;
  }

  return ZBOONI_INTRO_PATTERN.test(lines[1] ?? '');
}

function hasZbooniTeamSignoff(text: string): boolean {
  return ZBOONI_TEAM_SIGNOFF_PATTERN.test(text.trim());
}

function hasVagueFeatureOnlySubject(subject: string | null): boolean {
  const normalized = subject?.trim();
  return Boolean(normalized && VAGUE_FEATURE_ONLY_SUBJECTS.some((pattern) => pattern.test(normalized)));
}

function hasAlarmistSubject(subject: string | null): boolean {
  const normalized = subject?.trim();
  return Boolean(normalized && ALARMIST_SUBJECT_PATTERNS.some((pattern) => pattern.test(normalized)));
}

function truncatePreservingZbooniTeamSignoff(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const signoffMatch = text.match(ZBOONI_TEAM_SIGNOFF_PATTERN);
  if (!signoffMatch?.index) {
    return truncateAtSentenceBoundary(text, maxLength);
  }

  const signoff = text.slice(signoffMatch.index).trimStart();
  const content = text.slice(0, signoffMatch.index).trimEnd();
  const reservedLength = signoff.length + 2;
  const contentLimit = Math.max(0, maxLength - reservedLength);
  const truncatedContent = truncateAtSentenceBoundary(content, contentLimit);

  return truncatedContent.length > 0
    ? `${truncatedContent}\n\n${signoff}`
    : signoff;
}

function countBusinessSignalMatches(bodyText: string, signalTerms: string[]): number {
  const normalizedBody = normalizeForComparison(bodyText);
  const uniqueTerms = Array.from(
    new Set(
      signalTerms
        .map((term) => normalizeForComparison(term))
        .filter((term) => term.length >= 3),
    ),
  );

  return uniqueTerms.filter((term) => normalizedBody.includes(term)).length;
}

function findRedraftFeedbackViolations(bodyText: string, feedback: string | undefined): string[] {
  const normalizedFeedback = feedback?.toLowerCase().replace(/\s+/g, ' ').trim() ?? '';
  if (!normalizedFeedback) return [];

  const normalizedBody = bodyText.toLowerCase().replace(/\s+/g, ' ').trim();
  const violations: string[] = [];

  if (/\b(?:do not|don't|dont|avoid|stop)\b[^.?!]*(?:send|offer|share)?[^.?!]*\bexample\b/.test(normalizedFeedback) && /\bexample\b/.test(normalizedBody)) {
    violations.push('Redraft feedback not followed: still offers an example');
  }

  if (/\bright person\b/.test(normalizedFeedback) && !/\bright person\b/.test(normalizedBody)) {
    violations.push('Redraft feedback not followed: missing right-person question');
  }

  if (/\b(?:schedule|meeting|meet)\b/.test(normalizedFeedback) && !/\b(?:meeting|meet|conversation|discuss)\b/.test(normalizedBody)) {
    violations.push('Redraft feedback not followed: missing meeting-oriented CTA');
  }

  return violations;
}

export function mergeCtaIntoBody<T extends {
  subject: string | null;
  bodyText: string;
  bodyHtml: string | null;
  ctaText: string | null;
}>(content: T): T {
  const ctaText = content.ctaText?.trim();
  if (!ctaText) return content;

  const bodyText = content.bodyText.trimEnd();
  const normalizedCta = normalizeForComparison(ctaText);
  let nextBodyText = bodyText;

  if (!normalizeForComparison(bodyText).includes(normalizedCta)) {
    const signoffMatch = bodyText.match(ZBOONI_TEAM_SIGNOFF_PATTERN);
    if (signoffMatch?.index !== undefined) {
      const beforeSignoff = bodyText.slice(0, signoffMatch.index).trimEnd();
      const signoff = bodyText.slice(signoffMatch.index).trimStart();
      nextBodyText = beforeSignoff.length > 0
        ? `${beforeSignoff}\n\n${ctaText}\n\n${signoff}`
        : `${ctaText}\n\n${signoff}`;
    } else {
      nextBodyText = bodyText.length > 0
        ? `${bodyText}\n\n${ctaText}`
        : ctaText;
    }
  }

  const nextBodyHtml = content.bodyHtml && !normalizeHtmlForComparison(content.bodyHtml).includes(normalizedCta)
    ? `${content.bodyHtml.trimEnd()}\n<p>${escapeHtml(ctaText)}</p>`
    : content.bodyHtml;

  return {
    ...content,
    bodyText: nextBodyText,
    bodyHtml: nextBodyHtml,
  };
}

export function ensureZbooniTeamSignoff<T extends {
  bodyText: string;
  bodyHtml: string | null;
}>(content: T): T {
  if (hasZbooniTeamSignoff(content.bodyText)) {
    return content;
  }

  const bodyText = `${content.bodyText.trimEnd()}\n\nBest,\nLeadzilla Team`;
  const bodyHtml = content.bodyHtml
    ? `${content.bodyHtml.trimEnd()}\n<p>Best,<br />Leadzilla Team</p>`
    : content.bodyHtml;

  return {
    ...content,
    bodyText,
    bodyHtml,
  };
}

export function validateMessageVariant(
  channel: MessageChannel,
  content: { subject: string | null; bodyText: string; bodyHtml: string | null; ctaText: string | null },
  qualityOptions: MessageQualityOptions = {},
): ValidationResult {
  const reasons: string[] = [];
  let hardReject = false;
  const limits = CHANNEL_LIMITS[channel];

  const { bodyHtml, ctaText } = content;
  let { subject, bodyText } = content;

  // Hard reject: stub body from failed OpenAI
  if (bodyText === STUB_BODY || bodyText.trim() === '') {
    return {
      valid: false,
      hardReject: true,
      reasons: ['Body is stub/empty — OpenAI generation failed'],
      cleaned: content,
    };
  }

  // Hard reject: placeholders
  if (hasPlaceholders(bodyText) || (subject && hasPlaceholders(subject))) {
    hardReject = true;
    reasons.push('Contains unfilled placeholder patterns');
  }

  // Hard reject: spam trigger words
  const spamWordMatches = Array.from(
    new Set([
      ...findSpamWords(bodyText),
      ...(subject ? findSpamWords(subject) : []),
    ]),
  );
  if (spamWordMatches.length > 0) {
    hardReject = true;
    reasons.push(`Contains spam trigger words: ${spamWordMatches.join(', ')}`);
  }

  // Hard reject: too short
  if (bodyText.length < limits.min) {
    hardReject = true;
    reasons.push(`Body too short: ${bodyText.length} chars (min: ${limits.min})`);
  }

  if (qualityOptions.requireClosingQuestion && !hasClosingQuestion(bodyText)) {
    hardReject = true;
    reasons.push('Missing low-friction closing question');
  }

  if (qualityOptions.requireProfessionalGreeting && !hasProfessionalGreeting(bodyText)) {
    hardReject = true;
    reasons.push('Missing professional greeting');
  }

  if (qualityOptions.requireZbooniIntroAfterGreeting && !hasZbooniIntroAfterGreeting(bodyText)) {
    hardReject = true;
    reasons.push('Missing Leadzilla intro after greeting');
  }

  if (qualityOptions.requireZbooniTeamSignoff && !hasZbooniTeamSignoff(bodyText)) {
    hardReject = true;
    reasons.push('Missing Leadzilla Team sign-off');
  }

  if (channel === 'EMAIL' && hasVagueFeatureOnlySubject(subject)) {
    hardReject = true;
    reasons.push('Vague feature-only subject');
  }

  if (channel === 'EMAIL' && hasAlarmistSubject(subject)) {
    hardReject = true;
    reasons.push('Alarmist subject');
  }

  const minBusinessSignalMatches = qualityOptions.minBusinessSignalMatches ?? 0;
  const businessSignalTerms = qualityOptions.businessSignalTerms ?? [];
  if (minBusinessSignalMatches > 0 && businessSignalTerms.length > 0) {
    const matchCount = countBusinessSignalMatches(bodyText, businessSignalTerms);
    if (matchCount < minBusinessSignalMatches) {
      hardReject = true;
      reasons.push(`Not enough light personalization signals: ${matchCount}/${minBusinessSignalMatches}`);
    }
  }

  const redraftViolations = findRedraftFeedbackViolations(bodyText, qualityOptions.redraftFeedback);
  if (redraftViolations.length > 0) {
    hardReject = true;
    reasons.push(...redraftViolations);
  }

  if (hardReject) {
    return { valid: false, hardReject: true, reasons, cleaned: content };
  }

  // Soft: truncate if too long
  if (bodyText.length > limits.max) {
    reasons.push(`Truncated from ${bodyText.length} to within ${limits.max} chars`);
    bodyText = truncatePreservingZbooniTeamSignoff(bodyText, limits.max);
  }

  // Soft: strip excess emojis
  const emojiCount = countEmojis(bodyText);
  if (emojiCount > limits.maxEmoji) {
    reasons.push(`Stripped emojis from ${emojiCount} to ${limits.maxEmoji}`);
    bodyText = stripExcessEmojis(bodyText, limits.maxEmoji);
  }

  // Clean subject too if email
  if (subject) {
    const subjectEmojis = countEmojis(subject);
    if (subjectEmojis > 1) {
      subject = stripExcessEmojis(subject, 1);
    }
    if (subject.length > 100) {
      subject = truncateAtSentenceBoundary(subject, 100);
    }
  }

  return {
    valid: true,
    hardReject: false,
    reasons,
    cleaned: { subject, bodyText, bodyHtml, ctaText },
  };
}

/** Builds a stricter prompt suffix for retry attempts. */
export function buildStricterPromptSuffix(channel: MessageChannel, validationReasons: string[] = []): string {
  const limits = CHANNEL_LIMITS[channel];
  return [
    'IMPORTANT CONSTRAINTS:',
    validationReasons.length > 0
      ? `The previous draft failed validation for these exact reasons: ${validationReasons.join('; ')}. Fix every listed issue in the next draft.`
      : null,
    `- Stay within ${limits.max} characters for the body.`,
    '- Do NOT use any placeholder patterns like {firstName}, {{company}}, [NAME], etc.',
    `- Do NOT use spam trigger words or phrases: ${SPAM_TRIGGER_WORDS.join(', ')}.`,
    '- If the previous validation mentioned spam trigger words, remove the listed words entirely and do not replace them with pressure language.',
    `- Use at most ${limits.maxEmoji} emoji${limits.maxEmoji === 1 ? '' : 's'}.`,
    '- For email, write a fresh 2-6 word buyer-readable subject question tied to the prospect context. Do not copy example subjects verbatim.',
    '- Avoid vague feature-only email subjects such as "Milestone payments?" or generic product phrases with no buyer context.',
    '- Avoid alarmist email subjects such as "Failed payments on big deals?", "Lost revenue?", or other negative scare hooks.',
    '- Start with a professional greeting like "Hi Ann," or "Hi LAADS team,".',
    '- Immediately after the greeting, include: "I’m reaching out from Leadzilla. We help businesses turn customer messages into paid, trackable orders."',
    '- Include the low-friction CTA question inside the message body.',
    '- Reference one safe personalization signal when available, not a stack of scraped facts.',
    '- End the message body with exactly: Best, then a new line, then Leadzilla Team.',
    '- Write a professional, natural message.',
  ].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Negative keyword filter — product disqualification signals
// These terms misrepresent Leadzilla's offering and must not appear in outreach.
// ---------------------------------------------------------------------------

export const NEGATIVE_KEYWORDS: string[] = [
  'subscription',
  'recurring billing',
  'lowest fees',
  'cheapest',
  'automated checkout',
  'web checkout',
  'just need a payment link',
  'sku-based',
  'low-ticket ecommerce',
];

export interface NegativeKeywordResult {
  found: boolean;
  matches: string[];
}

/** Check a variant's bodyText for any Leadzilla-disqualifying negative keywords. */
export function checkNegativeKeywords(bodyText: string): NegativeKeywordResult {
  const lower = bodyText.toLowerCase();
  const matches = NEGATIVE_KEYWORDS.filter((kw) => lower.includes(kw.toLowerCase()));
  return { found: matches.length > 0, matches };
}

/** Builds a prompt suffix that explicitly forbids the given negative keywords. */
export function buildNegativeKeywordPromptSuffix(foundKeywords: string[]): string {
  return [
    'CRITICAL — DO NOT mention the following terms or concepts in the message:',
    ...foundKeywords.map((kw) => `- "${kw}"`),
    'These do not represent what Leadzilla offers. Leadzilla is a conversation-first commerce platform,',
    'not a subscription, web-checkout, or low-price competitor.',
  ].join('\n');
}

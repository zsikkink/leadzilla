# LeadFlow Feature Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add message validation, scoring lift analysis, and conversation inbox to the lead-flood pipeline.

**Architecture:** Three independent features integrated into the existing worker job pipeline (message validation + lift analysis) and API/frontend (inbox). No new DB migrations needed — all features use existing models.

**Tech Stack:** TypeScript, Prisma, pg-boss, Fastify, Next.js 15, Zod, shadcn/ui, Tailwind CSS

**Verification after each feature:**
```bash
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:$PATH"
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

---

## Feature 1: Message Validation (Tasks 1-5)

### Task 1: Create validate-message utility

**Files:**
- Create: `apps/worker/src/messaging/validate-message.ts`

**Step 1: Create the validation module**

```typescript
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
  EMAIL: { min: 100, max: 500, maxEmoji: 1 },
};

// Unicode emoji regex (covers most common emojis)
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu;

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

function hasSpamWords(text: string): boolean {
  const lower = text.toLowerCase();
  return SPAM_TRIGGER_WORDS.some((word) => lower.includes(word));
}

const STUB_BODY = 'Message generation pending';

export function validateMessageVariant(
  channel: MessageChannel,
  content: { subject: string | null; bodyText: string; bodyHtml: string | null; ctaText: string | null },
): ValidationResult {
  const reasons: string[] = [];
  let hardReject = false;
  const limits = CHANNEL_LIMITS[channel];

  let { subject, bodyText, bodyHtml, ctaText } = content;

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
  if (hasSpamWords(bodyText) || (subject && hasSpamWords(subject))) {
    hardReject = true;
    reasons.push('Contains spam trigger words');
  }

  // Hard reject: too short
  if (bodyText.length < limits.min) {
    hardReject = true;
    reasons.push(`Body too short: ${bodyText.length} chars (min: ${limits.min})`);
  }

  if (hardReject) {
    return { valid: false, hardReject: true, reasons, cleaned: content };
  }

  // Soft: truncate if too long
  if (bodyText.length > limits.max) {
    reasons.push(`Truncated from ${bodyText.length} to within ${limits.max} chars`);
    bodyText = truncateAtSentenceBoundary(bodyText, limits.max);
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
export function buildStricterPromptSuffix(channel: MessageChannel): string {
  const limits = CHANNEL_LIMITS[channel];
  return [
    'IMPORTANT CONSTRAINTS:',
    `- Stay within ${limits.max} characters for the body.`,
    '- Do NOT use any placeholder patterns like {firstName}, {{company}}, [NAME], etc.',
    '- Do NOT use spam words like FREE, ACT NOW, LIMITED TIME, GUARANTEED, etc.',
    `- Use at most ${limits.maxEmoji} emoji${limits.maxEmoji === 1 ? '' : 's'}.`,
    '- Write a professional, natural message.',
  ].join(' ');
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/worker/tsconfig.json 2>&1 | head -20`

---

### Task 2: Create fallback templates

**Files:**
- Create: `apps/worker/src/messaging/fallback-templates.ts`

**Step 1: Create the fallback templates module**

```typescript
// apps/worker/src/messaging/fallback-templates.ts

export interface FallbackMessage {
  subject: string | null;
  bodyText: string;
  bodyHtml: string | null;
  ctaText: string | null;
}

export function getWhatsAppFallback(leadName: string, companyName: string | null): FallbackMessage {
  const greeting = leadName ? `Hi ${leadName}` : 'Hi there';
  const companyRef = companyName ? ` at ${companyName}` : '';

  return {
    subject: null,
    bodyText: `${greeting}, I came across your business${companyRef} and thought Zbooni could help streamline your sales operations. Would you be open to a quick chat about how we help businesses in the region grow their revenue through conversational commerce?`,
    bodyHtml: null,
    ctaText: null,
  };
}

export function getEmailFallback(leadName: string, companyName: string | null): FallbackMessage {
  const greeting = leadName ? `Hi ${leadName}` : 'Hello';
  const companyRef = companyName ? ` at ${companyName}` : '';

  return {
    subject: `Quick question about your sales process${companyRef}`,
    bodyText: `${greeting},\n\nI noticed your business${companyRef} and wanted to reach out. At Zbooni, we help companies in the MENA region increase their sales through WhatsApp-first commerce solutions.\n\nWould you have 15 minutes this week for a brief call? I would love to share how similar businesses have grown their revenue with our platform.\n\nBest regards`,
    bodyHtml: null,
    ctaText: null,
  };
}

export function getFallbackForChannel(
  channel: 'EMAIL' | 'WHATSAPP',
  leadName: string,
  companyName: string | null,
): FallbackMessage {
  return channel === 'WHATSAPP'
    ? getWhatsAppFallback(leadName, companyName)
    : getEmailFallback(leadName, companyName);
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/worker/tsconfig.json 2>&1 | head -20`

---

### Task 3: Integrate validation into message.generate.job.ts

**Files:**
- Modify: `apps/worker/src/jobs/message.generate.job.ts`

**Step 1: Add imports at top of file (after existing imports)**

Add after line 7:
```typescript
import { validateMessageVariant, buildStricterPromptSuffix, type ValidationResult } from '../messaging/validate-message.js';
import { getFallbackForChannel } from '../messaging/fallback-templates.js';
```

**Step 2: Extract the OpenAI generation into a helper, add validation + retry + fallback**

Replace the block from line 147 (`let generatedByModel = 'stub';`) through line 188 (the closing `}` of the `else` block after `logger.warn`) with:

```typescript
    const resolvedChannel = channel ?? 'WHATSAPP';

    let generatedByModel = 'stub';
    let variantAContent = { subject: null as string | null, bodyText: 'Message generation pending', bodyHtml: null as string | null, ctaText: null as string | null };
    let variantBContent = { ...variantAContent };

    if (deps?.openAiAdapter?.isConfigured) {
      let systemPromptOverride: string | undefined;

      if (followUpNumber > 0 && pitchedFeature) {
        systemPromptOverride = [
          'You are an expert B2B sales copywriter for Zbooni, a UAE fintech company.',
          `This is follow-up message #${followUpNumber} to a lead who has not replied.`,
          `Pitch this specific Zbooni feature: ${pitchedFeature}`,
          previouslyPitchedFeatures.length > 0
            ? `Previous messages pitched: ${previouslyPitchedFeatures.join(', ')}. Do NOT repeat these.`
            : '',
          'Write a natural, conversational follow-up. Do not mention this is automated.',
          'Reference the previous outreach naturally ("I wanted to follow up..." / "One more thing I thought might interest you...").',
          'Generate two variants: variant_a (more direct) and variant_b (more casual).',
          'Each variant must have: subject (null for WhatsApp), bodyText, bodyHtml (null ok), ctaText (null ok).',
        ].filter(Boolean).join(' ');
      }

      const generateContext = systemPromptOverride
        ? { ...groundingContext, icpDescription: systemPromptOverride }
        : groundingContext;

      // First attempt
      const result = await deps.openAiAdapter.generateMessageVariants(generateContext);

      if (result.status === 'success') {
        generatedByModel = result.data.model;
        variantAContent = result.data.variant_a;
        variantBContent = result.data.variant_b;
      } else {
        logger.warn(
          { jobId: job.id, leadId, status: result.status },
          'OpenAI message generation failed, creating stub draft',
        );
      }

      // Validate both variants
      const validationA = validateMessageVariant(resolvedChannel, variantAContent);
      const validationB = validateMessageVariant(resolvedChannel, variantBContent);

      if (validationA.reasons.length > 0 || validationB.reasons.length > 0) {
        logger.info(
          { jobId: job.id, leadId, reasonsA: validationA.reasons, reasonsB: validationB.reasons },
          'Message validation findings',
        );
      }

      // If either has a hard rejection, retry once with stricter prompt
      if (validationA.hardReject || validationB.hardReject) {
        logger.warn(
          { jobId: job.id, leadId, hardRejectA: validationA.hardReject, hardRejectB: validationB.hardReject },
          'Hard rejection detected, retrying with stricter prompt',
        );

        const stricterSuffix = buildStricterPromptSuffix(resolvedChannel);
        const retryContext = {
          ...generateContext,
          icpDescription: `${generateContext.icpDescription}\n\n${stricterSuffix}`,
        };

        const retryResult = await deps.openAiAdapter.generateMessageVariants(retryContext);

        if (retryResult.status === 'success') {
          generatedByModel = retryResult.data.model;
          const retryA = validateMessageVariant(resolvedChannel, retryResult.data.variant_a);
          const retryB = validateMessageVariant(resolvedChannel, retryResult.data.variant_b);

          if (!retryA.hardReject) {
            variantAContent = retryA.cleaned;
          }
          if (!retryB.hardReject) {
            variantBContent = retryB.cleaned;
          }

          // If still hard rejecting after retry, use fallback
          if (retryA.hardReject || retryB.hardReject) {
            logger.warn(
              { jobId: job.id, leadId },
              'Retry still has hard rejections, using fallback templates',
            );
            const fallback = getFallbackForChannel(
              resolvedChannel,
              lead.firstName,
              companyName,
            );
            generatedByModel = 'fallback-template';
            if (retryA.hardReject) {
              variantAContent = fallback;
            }
            if (retryB.hardReject) {
              variantBContent = fallback;
            }
          }
        } else {
          // Retry OpenAI call itself failed — use fallback for both
          logger.warn({ jobId: job.id, leadId }, 'Retry OpenAI failed, using fallback templates');
          const fallback = getFallbackForChannel(resolvedChannel, lead.firstName, companyName);
          generatedByModel = 'fallback-template';
          variantAContent = fallback;
          variantBContent = fallback;
        }
      } else {
        // No hard rejections — apply soft cleaning
        variantAContent = validationA.cleaned;
        variantBContent = validationB.cleaned;
      }
    } else {
      // OpenAI not configured — use fallback
      logger.warn({ jobId: job.id, leadId }, 'OpenAI not configured, using fallback templates');
      const fallback = getFallbackForChannel(resolvedChannel, lead.firstName, companyName);
      generatedByModel = 'fallback-template';
      variantAContent = fallback;
      variantBContent = fallback;
    }
```

**Step 3: Update the `channel` references in the draft creation block**

In the `prisma.messageDraft.create` call (the variants create array), change both occurrences of `channel ?? 'WHATSAPP'` to `resolvedChannel`.

**Step 4: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/worker/tsconfig.json 2>&1 | head -20`

---

### Task 4: Add unit tests for validation

**Files:**
- Create: `apps/worker/src/messaging/validate-message.test.ts`

**Step 1: Write tests**

```typescript
import { describe, expect, it } from 'vitest';

import { validateMessageVariant, buildStricterPromptSuffix } from './validate-message.js';

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
    expect(result.reasons).toContain('Contains spam trigger words');
  });

  it('hard-rejects too-short body', () => {
    const result = validateMessageVariant('EMAIL', { ...base, bodyText: 'Hi there, check us out.' });
    expect(result.valid).toBe(false);
    expect(result.hardReject).toBe(true);
    expect(result.reasons[0]).toMatch(/too short/i);
  });

  it('soft-truncates long WhatsApp messages', () => {
    const longBody = 'This is a sentence about Zbooni. '.repeat(20);
    const result = validateMessageVariant('WHATSAPP', { ...base, bodyText: longBody });
    expect(result.valid).toBe(true);
    expect(result.hardReject).toBe(false);
    expect(result.cleaned.bodyText.length).toBeLessThanOrEqual(300);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('soft-strips excess emojis for WhatsApp', () => {
    const body = 'Great news for your business! 🎉🚀💰🌟🎊 We have something special for you today.';
    const result = validateMessageVariant('WHATSAPP', { ...base, bodyText: body });
    expect(result.valid).toBe(true);
    const cleaned = result.cleaned.bodyText;
    const emojiMatches = cleaned.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu);
    expect((emojiMatches ?? []).length).toBeLessThanOrEqual(3);
  });

  it('passes a clean message through', () => {
    const body = 'Hi Sarah, I came across your business and thought Zbooni could help streamline your sales operations. Would you be open to a quick chat?';
    const result = validateMessageVariant('WHATSAPP', { ...base, bodyText: body });
    expect(result.valid).toBe(true);
    expect(result.hardReject).toBe(false);
    expect(result.cleaned.bodyText).toBe(body);
  });
});

describe('buildStricterPromptSuffix', () => {
  it('returns a string with character limit for WhatsApp', () => {
    const suffix = buildStricterPromptSuffix('WHATSAPP');
    expect(suffix).toContain('300');
    expect(suffix).toContain('placeholder');
  });

  it('returns a string with character limit for Email', () => {
    const suffix = buildStricterPromptSuffix('EMAIL');
    expect(suffix).toContain('500');
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec vitest run apps/worker/src/messaging/validate-message.test.ts`

---

### Task 5: Verify Feature 1 end-to-end

**Step 1: Run full verification**

```bash
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:$PATH"
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

**Step 2: Commit**

```bash
git add apps/worker/src/messaging/validate-message.ts apps/worker/src/messaging/fallback-templates.ts apps/worker/src/messaging/validate-message.test.ts apps/worker/src/jobs/message.generate.job.ts
git commit -m "feat: add message validation with retry + fallback to message.generate

Validates AI-generated messages before persisting as MessageVariant rows:
- Hard reject: placeholder patterns, spam trigger words, stub body, too short
- Soft clean: truncate long messages at sentence boundary, strip excess emojis
- On hard reject: retry once with stricter prompt, then use fallback template
- Fallback templates for WhatsApp and Email channels

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Feature 2: Scoring Lift Analysis (Tasks 6-9)

### Task 6: Create lift-analysis module

**Files:**
- Create: `apps/worker/src/scoring/lift-analysis.ts`

**Step 1: Write the lift analysis functions**

```typescript
// apps/worker/src/scoring/lift-analysis.ts

export interface FactorLift {
  factor: string;
  convertedFreq: number;
  nonConvertedFreq: number;
  lift: number;
  sampleSize: number;
}

export interface LiftAnalysisOptions {
  maxChangePercent?: number | undefined;
  minWeight?: number | undefined;
  maxWeight?: number | undefined;
}

/**
 * Compute lift for each feature by comparing frequency/average
 * in converted vs non-converted snapshots.
 *
 * Lift = (convertedAvg - nonConvertedAvg) / nonConvertedAvg
 * A positive lift means the feature is more common in converted leads.
 */
export function computeFactorLift(
  convertedSnapshots: Array<Record<string, unknown>>,
  nonConvertedSnapshots: Array<Record<string, unknown>>,
): FactorLift[] {
  if (convertedSnapshots.length === 0 || nonConvertedSnapshots.length === 0) {
    return [];
  }

  // Collect all unique numeric feature keys
  const allKeys = new Set<string>();
  for (const snap of [...convertedSnapshots, ...nonConvertedSnapshots]) {
    for (const [key, val] of Object.entries(snap)) {
      if (typeof val === 'number' || typeof val === 'boolean') {
        allKeys.add(key);
      }
    }
  }

  const results: FactorLift[] = [];

  for (const key of allKeys) {
    const convertedValues = convertedSnapshots
      .map((s) => toNumeric(s[key]))
      .filter((v): v is number => v !== null);

    const nonConvertedValues = nonConvertedSnapshots
      .map((s) => toNumeric(s[key]))
      .filter((v): v is number => v !== null);

    if (convertedValues.length === 0 || nonConvertedValues.length === 0) continue;

    const convertedAvg = convertedValues.reduce((a, b) => a + b, 0) / convertedValues.length;
    const nonConvertedAvg = nonConvertedValues.reduce((a, b) => a + b, 0) / nonConvertedValues.length;

    // Avoid division by zero — if non-converted avg is 0, use small epsilon
    const denominator = Math.abs(nonConvertedAvg) < 1e-8 ? 1e-8 : nonConvertedAvg;
    const lift = (convertedAvg - nonConvertedAvg) / denominator;

    results.push({
      factor: key,
      convertedFreq: convertedAvg,
      nonConvertedFreq: nonConvertedAvg,
      lift,
      sampleSize: convertedValues.length + nonConvertedValues.length,
    });
  }

  // Sort by absolute lift descending (most impactful first)
  return results.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
}

/**
 * Adjust deterministic scoring weights based on lift analysis results.
 * Guardrails: max change per cycle (default 30%), weight bounds (default 1-30).
 */
export function adjustDeterministicWeights(
  currentWeights: Record<string, number>,
  liftResults: FactorLift[],
  options?: LiftAnalysisOptions,
): Record<string, number> {
  const maxChange = options?.maxChangePercent ?? 0.3;
  const minWeight = options?.minWeight ?? 1;
  const maxWeight = options?.maxWeight ?? 30;

  const adjusted = { ...currentWeights };

  for (const result of liftResults) {
    const currentWeight = adjusted[result.factor];
    if (currentWeight === undefined) continue; // Skip factors not in current weights

    let adjustment: number;

    if (result.lift > 0.5) {
      // Strong positive predictor
      adjustment = Math.min(result.lift * 0.2, maxChange);
    } else if (result.lift > 0.1) {
      // Moderate positive predictor
      adjustment = Math.min(result.lift * 0.1, 0.15);
    } else if (result.lift < -0.3) {
      // Strong negative predictor
      adjustment = Math.max(result.lift * 0.2, -maxChange);
    } else if (result.lift < -0.1) {
      // Moderate negative predictor
      adjustment = Math.max(result.lift * 0.1, -0.15);
    } else {
      // Insignificant — no change
      continue;
    }

    const newWeight = currentWeight * (1 + adjustment);
    adjusted[result.factor] = Math.min(maxWeight, Math.max(minWeight, newWeight));
  }

  return adjusted;
}

function toNumeric(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'boolean') return val ? 1 : 0;
  return null;
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/worker/tsconfig.json 2>&1 | head -20`

---

### Task 7: Add unit tests for lift analysis

**Files:**
- Create: `apps/worker/src/scoring/lift-analysis.test.ts`

**Step 1: Write tests**

```typescript
import { describe, expect, it } from 'vitest';

import { adjustDeterministicWeights, computeFactorLift } from './lift-analysis.js';

describe('computeFactorLift', () => {
  it('returns empty array for empty inputs', () => {
    expect(computeFactorLift([], [{ has_email: 1 }])).toEqual([]);
    expect(computeFactorLift([{ has_email: 1 }], [])).toEqual([]);
  });

  it('computes positive lift for features more common in converted', () => {
    const converted = [
      { has_email: 1, review_count: 50 },
      { has_email: 1, review_count: 40 },
    ];
    const nonConverted = [
      { has_email: 0, review_count: 10 },
      { has_email: 0, review_count: 5 },
    ];

    const results = computeFactorLift(converted, nonConverted);
    const emailLift = results.find((r) => r.factor === 'has_email');

    expect(emailLift).toBeDefined();
    expect(emailLift!.lift).toBeGreaterThan(0);
    expect(emailLift!.convertedFreq).toBe(1);
    expect(emailLift!.nonConvertedFreq).toBe(0);
  });

  it('computes negative lift for features less common in converted', () => {
    const converted = [
      { review_count: 5 },
      { review_count: 3 },
    ];
    const nonConverted = [
      { review_count: 50 },
      { review_count: 40 },
    ];

    const results = computeFactorLift(converted, nonConverted);
    const reviewLift = results.find((r) => r.factor === 'review_count');

    expect(reviewLift).toBeDefined();
    expect(reviewLift!.lift).toBeLessThan(0);
  });

  it('sorts by absolute lift descending', () => {
    const converted = [{ a: 100, b: 2 }];
    const nonConverted = [{ a: 1, b: 1 }];

    const results = computeFactorLift(converted, nonConverted);
    expect(results[0]!.factor).toBe('a');
  });

  it('handles boolean values', () => {
    const converted = [{ flag: true }, { flag: true }];
    const nonConverted = [{ flag: false }, { flag: false }];

    const results = computeFactorLift(converted, nonConverted);
    const flagLift = results.find((r) => r.factor === 'flag');
    expect(flagLift).toBeDefined();
    expect(flagLift!.convertedFreq).toBe(1);
    expect(flagLift!.nonConvertedFreq).toBe(0);
  });
});

describe('adjustDeterministicWeights', () => {
  it('increases weights for strong positive lift', () => {
    const weights = { has_email: 10, review_count: 5 };
    const lifts = [
      { factor: 'has_email', convertedFreq: 1, nonConvertedFreq: 0.2, lift: 0.8, sampleSize: 100 },
    ];

    const adjusted = adjustDeterministicWeights(weights, lifts);
    expect(adjusted.has_email).toBeGreaterThan(10);
  });

  it('decreases weights for strong negative lift', () => {
    const weights = { has_email: 10, review_count: 15 };
    const lifts = [
      { factor: 'review_count', convertedFreq: 5, nonConvertedFreq: 40, lift: -0.5, sampleSize: 100 },
    ];

    const adjusted = adjustDeterministicWeights(weights, lifts);
    expect(adjusted.review_count).toBeLessThan(15);
  });

  it('respects minWeight and maxWeight bounds', () => {
    const weights = { x: 29, y: 2 };
    const lifts = [
      { factor: 'x', convertedFreq: 100, nonConvertedFreq: 1, lift: 10, sampleSize: 100 },
      { factor: 'y', convertedFreq: 1, nonConvertedFreq: 100, lift: -10, sampleSize: 100 },
    ];

    const adjusted = adjustDeterministicWeights(weights, lifts);
    expect(adjusted.x).toBeLessThanOrEqual(30);
    expect(adjusted.y).toBeGreaterThanOrEqual(1);
  });

  it('does not change weights for insignificant lift', () => {
    const weights = { has_email: 10 };
    const lifts = [
      { factor: 'has_email', convertedFreq: 0.5, nonConvertedFreq: 0.48, lift: 0.04, sampleSize: 100 },
    ];

    const adjusted = adjustDeterministicWeights(weights, lifts);
    expect(adjusted.has_email).toBe(10);
  });

  it('ignores factors not in current weights', () => {
    const weights = { has_email: 10 };
    const lifts = [
      { factor: 'unknown_factor', convertedFreq: 1, nonConvertedFreq: 0, lift: 5, sampleSize: 50 },
    ];

    const adjusted = adjustDeterministicWeights(weights, lifts);
    expect(adjusted.unknown_factor).toBeUndefined();
  });

  it('caps adjustment at maxChangePercent', () => {
    const weights = { x: 20 };
    const lifts = [
      { factor: 'x', convertedFreq: 100, nonConvertedFreq: 1, lift: 99, sampleSize: 100 },
    ];

    const adjusted = adjustDeterministicWeights(weights, lifts, { maxChangePercent: 0.1 });
    // Max increase is 10%, so max new weight is 22
    expect(adjusted.x).toBeLessThanOrEqual(22);
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec vitest run apps/worker/src/scoring/lift-analysis.test.ts`

---

### Task 8: Integrate lift analysis into model.train.job.ts

**Files:**
- Modify: `apps/worker/src/jobs/model.train.job.ts`

**Step 1: Add import at top (after existing imports, around line 7)**

```typescript
import { adjustDeterministicWeights, computeFactorLift } from '../scoring/lift-analysis.js';
```

**Step 2: Add lift analysis after ModelVersion creation (after line 235, before the "Update TrainingRun as SUCCEEDED" comment)**

Insert between the `modelVersion` creation block and the `// 7. Update TrainingRun as SUCCEEDED` comment:

```typescript
    // 6b. Run lift analysis and store adjusted deterministic weights
    const convertedSnapshots: Record<string, unknown>[] = [];
    const nonConvertedSnapshots: Record<string, unknown>[] = [];

    for (const entry of labels) {
      const snapshot = entry.lead.featureSnapshots[0];
      if (!snapshot?.featuresJson || typeof snapshot.featuresJson !== 'object') continue;
      const features = snapshot.featuresJson as Record<string, unknown>;

      if (entry.label === 1) {
        convertedSnapshots.push(features);
      } else {
        nonConvertedSnapshots.push(features);
      }
    }

    if (convertedSnapshots.length > 0 && nonConvertedSnapshots.length > 0) {
      const liftResults = computeFactorLift(convertedSnapshots, nonConvertedSnapshots);

      // Load current deterministic weights from latest active model, or use empty defaults
      const activeModel = await prisma.modelVersion.findFirst({
        where: { stage: 'ACTIVE' },
        orderBy: { activatedAt: 'desc' },
        select: { deterministicWeightsJson: true },
      });

      const currentWeights =
        activeModel?.deterministicWeightsJson &&
        typeof activeModel.deterministicWeightsJson === 'object' &&
        !Array.isArray(activeModel.deterministicWeightsJson)
          ? (activeModel.deterministicWeightsJson as Record<string, number>)
          : {};

      if (Object.keys(currentWeights).length > 0) {
        const adjustedWeights = adjustDeterministicWeights(currentWeights, liftResults);

        await prisma.modelVersion.update({
          where: { id: modelVersion.id },
          data: {
            deterministicWeightsJson: JSON.parse(JSON.stringify(adjustedWeights)) as Prisma.InputJsonValue,
          },
        });

        logger.info(
          {
            jobId: job.id,
            trainingRunId,
            modelVersionId: modelVersion.id,
            liftFactorsAnalyzed: liftResults.length,
            weightsAdjusted: Object.keys(adjustedWeights).length,
          },
          'Lift analysis complete, deterministic weights updated on model version',
        );
      } else {
        logger.info(
          { jobId: job.id, trainingRunId },
          'No active model with deterministic weights found, skipping lift adjustment',
        );
      }
    } else {
      logger.info(
        { jobId: job.id, trainingRunId, converted: convertedSnapshots.length, nonConverted: nonConvertedSnapshots.length },
        'Insufficient cohort data for lift analysis',
      );
    }
```

**Step 3: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/worker/tsconfig.json 2>&1 | head -20`

---

### Task 9: Verify Feature 2 end-to-end and commit

**Step 1: Run full verification**

```bash
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:$PATH"
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

**Step 2: Commit**

```bash
git add apps/worker/src/scoring/lift-analysis.ts apps/worker/src/scoring/lift-analysis.test.ts apps/worker/src/jobs/model.train.job.ts
git commit -m "feat: add scoring lift analysis with deterministic weight adjustment

Computes feature lift (frequency in converted vs non-converted leads)
and auto-adjusts deterministic scoring weights on new ModelVersions.
Guardrails: max 30% change per cycle, weights bounded 1-30.
Runs after logistic regression in model.train job.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Feature 3: Conversation / Reply Viewing (Tasks 10-19)

### Task 10: Update feedback contract to expose replyText + replyClassification

**Files:**
- Modify: `packages/contracts/src/feedback.contract.ts`

**Step 1: Add replyText and replyClassification to FeedbackEventResponseSchema**

In `FeedbackEventResponseSchema` (line 33-46), add two fields after `payloadJson`:

```typescript
    replyText: z.string().nullable(),
    replyClassification: z.string().nullable(),
```

The full schema should read:
```typescript
export const FeedbackEventResponseSchema = z
  .object({
    id: z.string(),
    leadId: z.string(),
    messageSendId: z.string().nullable(),
    eventType: FeedbackEventTypeSchema,
    source: FeedbackSourceSchema,
    providerEventId: z.string().nullable(),
    dedupeKey: z.string(),
    payloadJson: z.unknown().nullable(),
    replyText: z.string().nullable(),
    replyClassification: z.string().nullable(),
    occurredAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  })
  .strict();
```

**Step 2: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p packages/contracts/tsconfig.json 2>&1 | head -20`

---

### Task 11: Update feedback repository mapper

**Files:**
- Modify: `apps/api/src/modules/feedback/feedback.repository.ts`

**Step 1: Add replyText and replyClassification to the mapper input type and output**

Update `mapFeedbackEventToResponse` parameter type (line 34) to include the new fields:

```typescript
function mapFeedbackEventToResponse(event: {
  id: string;
  leadId: string;
  messageSendId: string | null;
  eventType: string;
  source: string;
  providerEventId: string | null;
  dedupeKey: string;
  payloadJson: unknown;
  replyText: string | null;
  replyClassification: string | null;
  occurredAt: Date;
  createdAt: Date;
}): FeedbackEventResponse {
  return {
    id: event.id,
    leadId: event.leadId,
    messageSendId: event.messageSendId,
    eventType: event.eventType as FeedbackEventResponse['eventType'],
    source: event.source as FeedbackEventResponse['source'],
    providerEventId: event.providerEventId,
    dedupeKey: event.dedupeKey,
    payloadJson: event.payloadJson ?? null,
    replyText: event.replyText,
    replyClassification: event.replyClassification,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
  };
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/api/tsconfig.json 2>&1 | head -20`

---

### Task 12: Update messaging contract to expose extra fields + conversation schema

**Files:**
- Modify: `packages/contracts/src/messaging.contract.ts`

**Step 1: Add fields to MessageSendResponseSchema**

Add three fields to `MessageSendResponseSchema` (after `repliedAt`, before `failureCode`):

```typescript
    followUpNumber: z.number().int().nullable(),
    nextFollowUpAfter: z.string().datetime().nullable(),
    providerConversationId: z.string().nullable(),
```

**Step 2: Add conversation schemas at the end of the file (before the type exports)**

```typescript
// ── Conversation thread ──────────────────────────────
export const ConversationLeadIdParamsSchema = z
  .object({
    leadId: z.string().min(1),
  })
  .strict();

export const ConversationEntrySchema = z.object({
  type: z.enum(['sent', 'reply']),
  timestamp: z.string().datetime(),
  channel: MessageChannelSchema,
  bodyText: z.string(),
  subject: z.string().nullable(),
  replyClassification: z.string().nullable(),
  status: MessageSendStatusSchema.nullable(),
  followUpNumber: z.number().int().nullable(),
});

export const ConversationResponseSchema = z.object({
  leadId: z.string(),
  entries: z.array(ConversationEntrySchema),
});
```

**Step 3: Add type exports at the bottom of the file**

```typescript
export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;
export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;
```

**Step 4: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p packages/contracts/tsconfig.json 2>&1 | head -20`

---

### Task 13: Update messaging repository mapper + add getConversation

**Files:**
- Modify: `apps/api/src/modules/messaging/messaging.repository.ts`

**Step 1: Add missing fields to PrismaMessageSend type**

Add these fields to the `PrismaMessageSend` type (after `repliedAt`, before `failureCode`):

```typescript
  followUpNumber: number;
  nextFollowUpAfter: Date | null;
  providerConversationId: string | null;
```

**Step 2: Add the fields to mapSendToResponse**

In `mapSendToResponse`, add after `repliedAt`:

```typescript
    followUpNumber: send.followUpNumber,
    nextFollowUpAfter: send.nextFollowUpAfter?.toISOString() ?? null,
    providerConversationId: send.providerConversationId,
```

**Step 3: Add getConversation to the repository interface and implementations**

Add to `MessagingRepository` interface:

```typescript
  getConversation(leadId: string): Promise<import('@lead-flood/contracts').ConversationResponse>;
```

Add to `StubMessagingRepository`:

```typescript
  async getConversation(_leadId: string): Promise<import('@lead-flood/contracts').ConversationResponse> {
    throw new MessagingNotImplementedError('TODO: get conversation persistence');
  }
```

Add to `PrismaMessagingRepository`:

```typescript
  override async getConversation(leadId: string): Promise<import('@lead-flood/contracts').ConversationResponse> {
    // Sent messages: join MessageSend → MessageVariant (isSelected=true) for body text
    const sends = await prisma.messageSend.findMany({
      where: { leadId },
      include: {
        messageVariant: {
          select: { bodyText: true, subject: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Replies: FeedbackEvents where eventType = REPLIED
    const replies = await prisma.feedbackEvent.findMany({
      where: { leadId, eventType: 'REPLIED' },
      orderBy: { occurredAt: 'asc' },
    });

    const entries: import('@lead-flood/contracts').ConversationEntry[] = [];

    for (const send of sends) {
      entries.push({
        type: 'sent',
        timestamp: (send.sentAt ?? send.createdAt).toISOString(),
        channel: send.channel as 'EMAIL' | 'WHATSAPP',
        bodyText: send.messageVariant.bodyText,
        subject: send.messageVariant.subject ?? null,
        replyClassification: null,
        status: send.status as import('@lead-flood/contracts').MessageSendStatus,
        followUpNumber: send.followUpNumber,
      });
    }

    for (const reply of replies) {
      entries.push({
        type: 'reply',
        timestamp: reply.occurredAt.toISOString(),
        channel: 'WHATSAPP', // Default — we can refine later by looking at the linked MessageSend
        bodyText: reply.replyText ?? '(no text)',
        subject: null,
        replyClassification: reply.replyClassification,
        status: null,
        followUpNumber: null,
      });
    }

    // Sort chronologically
    entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return { leadId, entries };
  }
```

Note: The MessageSend → MessageVariant relationship needs the `messageVariant` relation. Check the Prisma schema — `MessageSend` has `messageVariantId` field. The include should use:

```typescript
include: {
  messageVariant: {
    select: { bodyText: true, subject: true },
  },
},
```

If Prisma doesn't have a `messageVariant` relation on `MessageSend`, use a separate query:
```typescript
const variant = await prisma.messageVariant.findUnique({ where: { id: send.messageVariantId } });
```

**Step 4: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/api/tsconfig.json 2>&1 | head -20`

---

### Task 14: Wire getConversation through service and routes

**Files:**
- Modify: `apps/api/src/modules/messaging/messaging.service.ts`
- Modify: `apps/api/src/modules/messaging/messaging.routes.ts`

**Step 1: Add to service interface and implementation**

In `messaging.service.ts`, add to the `MessagingService` interface:

```typescript
  getConversation(leadId: string): Promise<import('@lead-flood/contracts').ConversationResponse>;
```

Add to the return object in `buildMessagingService`:

```typescript
    async getConversation(leadId) {
      return repository.getConversation(leadId);
    },
```

**Step 2: Add the route in messaging.routes.ts**

Add to the imports from `@lead-flood/contracts`:

```typescript
  ConversationLeadIdParamsSchema,
  ConversationResponseSchema,
```

Add the route handler (before the closing `}` of `registerMessagingRoutes`):

```typescript
  app.get('/v1/messaging/conversations/:leadId', async (request, reply) => {
    const parsedParams = ConversationLeadIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid lead id');
    }

    try {
      const result = await service.getConversation(parsedParams.data.leadId);
      return ConversationResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });
```

**Step 3: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/api/tsconfig.json 2>&1 | head -20`

---

### Task 15: Commit backend changes

**Step 1: Verify full backend**

```bash
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:$PATH"
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

**Step 2: Commit**

```bash
git add packages/contracts/src/feedback.contract.ts packages/contracts/src/messaging.contract.ts apps/api/src/modules/feedback/feedback.repository.ts apps/api/src/modules/messaging/messaging.repository.ts apps/api/src/modules/messaging/messaging.service.ts apps/api/src/modules/messaging/messaging.routes.ts
git commit -m "feat: expose reply text/classification + conversation endpoint

- Add replyText, replyClassification to FeedbackEventResponseSchema
- Add followUpNumber, nextFollowUpAfter, providerConversationId to MessageSendResponseSchema
- New GET /v1/messaging/conversations/:leadId endpoint returning chronological thread
- Update mappers to include new fields

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 16: Add getConversation to API client + add sidebar Inbox link

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/components/sidebar.tsx`

**Step 1: Add getConversation method to ApiClient**

Add to the imports at top:
```typescript
import type {
  // ... existing imports ...
  ConversationResponse,
} from '@lead-flood/contracts';
```

Add method to the ApiClient class (in the Messaging section):
```typescript
  getConversation(leadId: string): Promise<ConversationResponse> {
    return this.request(`/v1/messaging/conversations/${leadId}`);
  }
```

**Step 2: Add Inbox to sidebar navigation**

In `sidebar.tsx`, add `Inbox` import to lucide-react:
```typescript
import {
  BarChart3,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Rocket,
  Target,
  Users,
} from 'lucide-react';
```

Add the Inbox nav item between Messages and ICP Profiles:
```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Pipeline', icon: LayoutDashboard },
  { href: '/dashboard/discover', label: 'Discover', icon: Rocket },
  { href: '/dashboard/leads', label: 'Leads', icon: Users },
  { href: '/dashboard/messages', label: 'Messages', icon: MessageSquare },
  { href: '/dashboard/inbox', label: 'Inbox', icon: Inbox },
  { href: '/dashboard/icps', label: 'ICP Profiles', icon: Target },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
] as const;
```

**Step 3: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -20`

---

### Task 17: Create Inbox page

**Files:**
- Create: `apps/web/app/dashboard/inbox/page.tsx`

**Step 1: Create the inbox page**

This is the largest single file. It has:
- Left panel: lead conversation list with search, channel filter, reply count badges
- Right panel: chat thread with sent (blue, right) and reply (grey, left) bubbles
- Classification badges: INTERESTED=green, NOT_INTERESTED=red, OUT_OF_OFFICE=yellow, UNSUBSCRIBE=red

```typescript
'use client';

import type { ConversationEntry, ConversationResponse, ListMessageSendsResponse, MessageSendResponse } from '@lead-flood/contracts';
import {
  Inbox as InboxIcon,
  Mail,
  MessageSquare,
  Phone,
  Search,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

// ── Classification badge colors ────────────────────
function classificationColor(classification: string | null): string {
  switch (classification) {
    case 'INTERESTED': return 'bg-emerald-500/15 text-emerald-400';
    case 'NOT_INTERESTED': return 'bg-red-500/15 text-red-400';
    case 'OUT_OF_OFFICE': return 'bg-yellow-500/15 text-yellow-400';
    case 'UNSUBSCRIBE': return 'bg-red-500/15 text-red-400';
    default: return 'bg-muted/20 text-muted-foreground';
  }
}

function channelBadge(channel: string): string {
  return channel === 'WHATSAPP'
    ? 'bg-emerald-500/15 text-emerald-400'
    : 'bg-blue-500/15 text-blue-400';
}

// ── Types ────────────────────────────────────────────
interface LeadConversationSummary {
  leadId: string;
  leadName: string;
  leadEmail: string;
  lastMessage: string;
  lastTimestamp: string;
  channel: string;
  replyCount: number;
}

export default function InboxPage() {
  const { apiClient } = useAuth();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');

  // Fetch all recent sends to build conversation list
  const sends = useApiQuery(
    useCallback(() => apiClient.listSends({ page: 1, pageSize: 100 }), [apiClient]),
    [],
  );

  // Fetch conversation for selected lead
  const conversation = useApiQuery(
    useCallback(
      () => (selectedLeadId ? apiClient.getConversation(selectedLeadId) : Promise.resolve({ leadId: '', entries: [] } as ConversationResponse)),
      [apiClient, selectedLeadId],
    ),
    [selectedLeadId],
  );

  // Build conversation summaries grouped by lead
  const summaries = useMemo((): LeadConversationSummary[] => {
    if (!sends.data?.items) return [];

    const byLead = new Map<string, MessageSendResponse[]>();
    for (const send of sends.data.items) {
      const existing = byLead.get(send.leadId) ?? [];
      existing.push(send);
      byLead.set(send.leadId, existing);
    }

    const result: LeadConversationSummary[] = [];
    for (const [leadId, leadSends] of byLead) {
      const sorted = leadSends.sort((a, b) =>
        new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime(),
      );
      const latest = sorted[0];
      if (!latest) continue;

      const replyCount = leadSends.filter((s) => s.status === 'REPLIED').length;

      result.push({
        leadId,
        leadName: leadId.slice(0, 8), // Will be replaced with real lead name when we enrich the data
        leadEmail: '',
        lastMessage: `${latest.channel} — ${latest.status}`,
        lastTimestamp: latest.sentAt ?? latest.createdAt,
        channel: latest.channel,
        replyCount,
      });
    }

    return result.sort((a, b) =>
      new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime(),
    );
  }, [sends.data]);

  // Filter summaries
  const filtered = useMemo(() => {
    let items = summaries;
    if (channelFilter !== 'ALL') {
      items = items.filter((s) => s.channel === channelFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (s) => s.leadName.toLowerCase().includes(q) || s.leadEmail.toLowerCase().includes(q) || s.leadId.toLowerCase().includes(q),
      );
    }
    return items;
  }, [summaries, channelFilter, searchQuery]);

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
      {/* Left panel: conversation list */}
      <div className="flex w-[360px] shrink-0 flex-col border-r border-border/50">
        {/* Search + filter */}
        <div className="space-y-2 border-b border-border/50 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full rounded-lg border border-border/50 bg-zbooni-dark/40 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex gap-1.5">
            {['ALL', 'EMAIL', 'WHATSAPP'].map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter(ch)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                  channelFilter === ch
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/20 text-muted-foreground hover:bg-muted/40'
                }`}
              >
                {ch === 'ALL' ? 'All' : ch === 'EMAIL' ? 'Email' : 'WhatsApp'}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {sends.isLoading ? (
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
              <span className="ml-2">Loading...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <InboxIcon className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground/60">No conversations yet</p>
            </div>
          ) : (
            filtered.map((summary) => (
              <button
                key={summary.leadId}
                type="button"
                onClick={() => setSelectedLeadId(summary.leadId)}
                className={`w-full border-b border-border/30 px-4 py-3 text-left transition-colors hover:bg-muted/10 ${
                  selectedLeadId === summary.leadId ? 'bg-muted/15' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium truncate">{summary.leadName}</p>
                  <div className="flex items-center gap-1.5">
                    {summary.replyCount > 0 ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zbooni-green/20 px-1.5 text-[10px] font-bold text-zbooni-green">
                        {summary.replyCount}
                      </span>
                    ) : null}
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${channelBadge(summary.channel)}`}>
                      {summary.channel === 'WHATSAPP' ? <Phone className="h-2.5 w-2.5" /> : <Mail className="h-2.5 w-2.5" />}
                    </span>
                  </div>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground/60">{summary.lastMessage}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/40">
                  {new Date(summary.lastTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel: conversation thread */}
      <div className="flex flex-1 flex-col">
        {!selectedLeadId ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-12 w-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground/60">Select a conversation to view</p>
            </div>
          </div>
        ) : conversation.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="border-b border-border/50 px-6 py-4">
              <h2 className="text-sm font-semibold">Conversation with {selectedLeadId.slice(0, 8)}</h2>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {conversation.data?.entries.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground/60">No messages in this conversation</p>
              ) : null}

              {conversation.data?.entries.map((entry: ConversationEntry, i: number) => (
                <div
                  key={i}
                  className={`flex ${entry.type === 'sent' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                      entry.type === 'sent'
                        ? 'bg-blue-600/20 text-foreground'
                        : 'bg-muted/30 text-foreground'
                    }`}
                  >
                    {entry.subject ? (
                      <p className="mb-1 text-xs font-semibold text-muted-foreground/70">
                        Subject: {entry.subject}
                      </p>
                    ) : null}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{entry.bodyText}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${channelBadge(entry.channel)}`}>
                        {entry.channel}
                      </span>
                      {entry.replyClassification ? (
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${classificationColor(entry.replyClassification)}`}>
                          {entry.replyClassification}
                        </span>
                      ) : null}
                      {entry.status ? (
                        <span className="text-[10px] text-muted-foreground/50">{entry.status}</span>
                      ) : null}
                      <span className="text-[10px] text-muted-foreground/40">
                        {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -20`

---

### Task 18: Update lead detail page + message draft card

**Files:**
- Modify: `apps/web/app/dashboard/leads/[id]/page.tsx`
- Modify: `apps/web/src/components/message-draft-card.tsx`

**Step 1: Update lead detail Activity Timeline to show message body + reply text**

In `leads/[id]/page.tsx`, update the timeline builder for sends (around line 225-246). Replace the sent message event and reply event sections with enriched versions that show body text.

In the `buildTimeline` function, update the send loop to also fetch variant body if available. Since we don't have the variant body from the sends response alone, we can link to the conversation page instead. Update the Reply Received event to show a note directing to the inbox:

Replace lines 225-246:
```typescript
  for (const send of sends) {
    events.push({
      icon: Send,
      label: `${send.channel} Sent`,
      detail: `Via ${send.provider}${send.status === 'FAILED' ? ' — FAILED' : ''}${send.followUpNumber && send.followUpNumber > 0 ? ` (follow-up #${send.followUpNumber})` : ''}`,
      time: send.sentAt
        ? new Date(send.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Queued',
      color: send.status === 'FAILED' || send.status === 'BOUNCED' ? 'text-red-400 bg-red-500/15'
        : 'text-zbooni-green bg-zbooni-green/15',
    });

    if (send.status === 'REPLIED' && send.repliedAt) {
      events.push({
        icon: MessageSquare,
        label: 'Reply Received',
        detail: 'View full conversation in Inbox',
        time: new Date(send.repliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        color: 'text-emerald-400 bg-emerald-500/15',
      });
    }
  }
```

**Step 2: Add lead info to MessageDraftCard**

In `message-draft-card.tsx`, add a `leadName` prop to the component. Update the `MessageDraftCardProps` interface:

```typescript
interface MessageDraftCardProps {
  draft: MessageDraftResponse;
  leadName?: string | undefined;
  leadEmail?: string | undefined;
  onAction: () => void;
}
```

Update the component signature:
```typescript
export function MessageDraftCard({ draft, leadName, leadEmail, onAction }: MessageDraftCardProps) {
```

Add lead info display in the collapsed header (after the variants count line, around line 257-259):

Replace:
```typescript
          <p className="mt-1 text-xs text-muted-foreground/60">
            {draft.variants.length} variant{draft.variants.length !== 1 ? 's' : ''}
            {' · '}{draft.generatedByModel}
          </p>
```

With:
```typescript
          <p className="mt-1 text-xs text-muted-foreground/60">
            {leadName || leadEmail ? `${leadName ?? ''} ${leadEmail ? `(${leadEmail})` : ''}`.trim() + ' · ' : ''}
            {draft.variants.length} variant{draft.variants.length !== 1 ? 's' : ''}
            {' · '}{draft.generatedByModel}
          </p>
```

**Step 3: Verify it compiles**

Run: `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && pnpm exec tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -20`

---

### Task 19: Verify Feature 3 end-to-end and commit

**Step 1: Run full verification**

```bash
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:$PATH"
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

**Step 2: Commit frontend**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/components/sidebar.tsx apps/web/app/dashboard/inbox/page.tsx apps/web/app/dashboard/leads/\[id\]/page.tsx apps/web/src/components/message-draft-card.tsx
git commit -m "feat: add conversation inbox page + lead detail improvements

- New /dashboard/inbox page with two-panel chat UI
- Left panel: conversation list grouped by lead, search, channel filter
- Right panel: chronological message thread with sent/reply bubbles
- Reply classification badges (INTERESTED/NOT_INTERESTED/OOO/UNSUBSCRIBE)
- Sidebar: added Inbox nav link between Messages and ICP Profiles
- Lead detail: show follow-up number and link to inbox for replies
- Draft card: show lead name/email in collapsed view

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Post-Implementation Checklist

After all 19 tasks are complete:

1. `pnpm typecheck` — all packages pass
2. `pnpm lint` — no linting errors
3. `pnpm build` — all packages build
4. `pnpm test` — all tests pass (including 2 new test files)
5. Three commits on branch:
   - `feat: add message validation with retry + fallback`
   - `feat: add scoring lift analysis with deterministic weight adjustment`
   - `feat: expose reply text/classification + conversation endpoint`
   - `feat: add conversation inbox page + lead detail improvements`

import { z } from 'zod';

// ---------- Public types ----------

export interface OpenAiAdapterConfig {
  apiKey: string | undefined;
  generationModel?: string | undefined;
  scoringModel?: string | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface MessageGenerationContext {
  leadName: string;
  leadEmail: string;
  channel?: 'EMAIL' | 'WHATSAPP' | undefined;
  recipientType?: 'DECISION_MAKER' | 'GENERIC_CONTACT' | undefined;
  recipientName?: string | null | undefined;
  recipientTitle?: string | null | undefined;
  recipientEmailKind?: 'PERSONAL' | 'GENERIC' | 'UNKNOWN' | undefined;
  companyName: string | null;
  industry: string | null;
  country: string | null;
  featuresJson: Record<string, unknown>;
  scoreBand: string;
  blendedScore: number;
  icpDescription: string;
  /** Structured business intelligence from scrape data. Replaces raw featuresJson when present. */
  businessIntelligence?: string | null | undefined;
  /** Custom role/persona override from PipelineSetting. */
  customRole?: string | null | undefined;
  /** Custom system prompt override from PipelineSetting. */
  customSystemPrompt?: string | null | undefined;
  /** Consolidated behavior prompt override from PipelineSetting. */
  customBehaviorPrompt?: string | null | undefined;
  /** Custom instructions from sales team via PipelineSetting. */
  messagingInstructions?: string | null | undefined;
  /** Pre-written sales hook from ICP profile — the sharp opening line. */
  icpHook?: string | null | undefined;
  /** Sales angle from ICP profile — the value proposition framing. */
  icpAngle?: string | null | undefined;
  /** Operator feedback explaining what should change when regenerating a draft. */
  redraftFeedback?: string | null | undefined;
  /** Previous draft subject when regenerating from operator feedback. */
  previousDraftSubject?: string | null | undefined;
  /** Previous draft body when regenerating from operator feedback. */
  previousDraftBody?: string | null | undefined;
}

export interface MessageVariantContent {
  subject: string | null;
  bodyText: string;
  bodyHtml: string | null;
  ctaText: string | null;
}

export interface MessageGenerationResult {
  model: string;
  message: MessageVariantContent;
}

export interface MessageGenerationOptions {
  model?: string | null | undefined;
}

export interface LeadScoringContext {
  featuresJson: Record<string, unknown>;
  icpDescription: string;
  deterministicScore: number;
  /** Custom system prompt override from PipelineSetting. */
  customSystemPrompt?: string | null | undefined;
}

export interface LeadScoringOptions {
  model?: string | null | undefined;
}

export interface AiScoreResult {
  score: number;
  reasoning: string[];
}

export interface ReplyClassificationResult {
  classification: 'INTERESTED' | 'NOT_INTERESTED' | 'OUT_OF_OFFICE';
  confidence: number;
}

export type OpenAiClassificationResult =
  | { status: 'success'; data: ReplyClassificationResult }
  | { status: 'retryable_error'; failure: OpenAiFailure }
  | { status: 'terminal_error'; failure: OpenAiFailure };

export interface OpenAiFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export type OpenAiGenerationResult =
  | { status: 'success'; data: MessageGenerationResult }
  | { status: 'retryable_error'; failure: OpenAiFailure }
  | { status: 'terminal_error'; failure: OpenAiFailure };

export type OpenAiScoringResult =
  | { status: 'success'; data: AiScoreResult }
  | { status: 'retryable_error'; failure: OpenAiFailure }
  | { status: 'terminal_error'; failure: OpenAiFailure };

// ---------- Zod response schemas for structured output ----------

const MessageVariantSchema = z.object({
  subject: z.string().nullable(),
  bodyText: z.string(),
  bodyHtml: z.string().nullable(),
  ctaText: z.string().nullable(),
});

const GenerationResponseSchema = z.object({
  message: MessageVariantSchema,
});

const ScoringResponseSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.array(z.string()),
});

const ClassificationResponseSchema = z.object({
  classification: z.enum(['INTERESTED', 'NOT_INTERESTED', 'OUT_OF_OFFICE']),
  confidence: z.number().min(0).max(1),
});

// ---------- Defaults ----------

const DEFAULT_GENERATION_MODEL = 'gpt-4o-mini';
const DEFAULT_SCORING_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const LEADZILLA_OUTREACH_OPENING =
  'I’m reaching out from Leadzilla. We help businesses turn customer messages into paid, trackable orders.';
const LEADZILLA_OUTREACH_CONTEXT_SENTENCE =
  'When a customer asks about a product, your team can send a cart, collect payment, and track the sale from the same conversation.';

// ---------- Messaging Defaults (exported for UI preview) ----------

/**
 * Default outreach identity and persona. Sent as the opening preamble of the
 * system message.
 */
export const DEFAULT_MESSAGING_ROLE = `You are a senior sales development representative for the B2B company described in the provided context.

The company may sell software, services, payments, logistics, data, operations tooling, professional services, or another B2B product. When geography is missing, write for a generic U.S. East Coast B2B company. Do not assume a specific state, city, buyer, industry, or product category unless the context provides it.

Your job is to write personalized cold outreach to business owners and decision makers. The goal is to open a relevant conversation that can lead to a demo later, not to close the deal in the first message.

Write like a knowledgeable peer who noticed something specific about the prospect's business. The reader should feel: "This person actually looked at my business."

You are professional, warm, concise, and never pushy. You earn the conversation through relevance, not pressure.`;

/**
 * Default outreach instructions. Runtime layers append product positioning, ICP
 * hook, operator instructions, output schema, and re-draft feedback.
 */
export const DEFAULT_MESSAGING_SYSTEM_PROMPT = `## Inputs
You may receive:
- Company or platform name
- Company positioning or product category
- Business name
- Owner or decision-maker name
- Location, if available
- Website data
- Instagram data
- Business intelligence
- ICP name and description
- ICP sales hook
- Message stage
- Feature or features to pitch
- Previous message history or redraft feedback
- Channel: email or WhatsApp
- Required output schema and sign-off

Use only the provided context. Do not use outside knowledge.

## Core Objective
Write one outreach message that:
1. Feels genuinely researched
2. Connects the provided ICP sales hook to the prospect's actual business
3. Focuses on one relevant provided feature or capability
4. Makes the next step easy and low-friction
5. Avoids sounding scripted, generic, or overhyped

## Personalization
Reference one strong, specific detail from the provided website, Instagram, business intelligence, or ICP context. Use two details only when both are clearly relevant.

Good personalization:
- Mentions a specific service, product, audience, location, offer, booking flow, payment process, or visible business model
- Connects that detail to a plausible operational pain
- Feels smoothly integrated into the message

Bad personalization:
- Generic compliments like "I love your brand"
- Vague claims like "you have a strong online presence"
- Invented business facts
- Overloading the first sentence with too many scraped details

If the data is thin, use the strongest available detail and keep the rest of the message problem-led. Never fabricate details to make the message seem more personalized.

## Hook And Feature Discipline
Use the provided ICP sales hook as the core angle. Do not invent a different hook when a hook is provided.

The feature to pitch comes from the runtime context:
- If exactly one feature or capability is provided, pitch that feature only.
- If multiple features are provided, choose the one most relevant to the prospect's business and pitch only that one.
- If no feature is provided, use the ICP hook and company positioning to choose one safe, specific value proposition. Keep it conservative.

Explain why the feature is relevant to this specific business and the likely operational pain it faces. Do not bundle features together. Do not introduce unprovided product capabilities.

## CTA Selection
Choose the CTA from the message stage, channel, prior history, and available evidence.

- First touch: ask a simple relevance question, check whether the pain point matters, or offer to send a short demo/example link.
- Follow-up: reference the prior topic and make the next step easy to accept or decline.
- Re-draft: follow the operator feedback unless it would break the hard rules.

Never ask for a call in a first-touch message. A call-oriented CTA is allowed only when the message stage or operator feedback explicitly asks for it.

## Message Stages
If message stage is first_touch or missing:
- Mention something specific about the business within the first two sentences when enough data is available.
- Use the provided hook.
- Pitch one relevant feature.
- End with a low-friction question or offer to send a short demo link.
- Do not ask for a call.

If message stage is follow_up_1:
- Briefly reference the previous message.
- Shift to the new provided feature or a fresh angle.
- Keep the tone light and useful, not nagging.

If message stage is follow_up_2:
- Use social proof, a benchmark, or a case-study-style angle only if provided.
- Tie the feature to the prospect's business.
- Do not exaggerate results.

If message stage is follow_up_3:
- Use a direct but respectful final-touch tone.
- Make it easy for them to say whether this is relevant or not.

Each follow-up should feel like a fresh angle, not a reminder.

## Message Structure
Use this structure naturally. Do not label the sections.

1. Professional greeting
2. Company or platform positioning from context
3. Specific business observation
4. One-feature pitch tied to likely pain
5. Low-friction CTA
6. Required sign-off from the runtime output schema

## Contact Awareness
Use the contact context from the user message.
- DECISION_MAKER: address the named person if a real name is available. You may use role-aware language, but still write to the team/business.
- GENERIC_CONTACT: address the company team, e.g. "Hi {Company} team,". Do not pretend the inbox is a person.
- For generic contacts, use "your team", "the team", or "whoever handles WhatsApp orders, payments, or operations."
- Never write "Hi Unknown" or "Hi Generic Contact".
- Never use "Dear".

## CTA
End with one clear, low-friction ask before the sign-off.

Good first-touch CTAs:
- "Is this something your team is already trying to improve?"
- "Would it be useful if I sent over a short example?"
- "Would a quick look at how this works for chat-driven orders be useful?"

Bad CTAs:
- "Can we schedule a call this week?"
- "I'd love to jump on a quick call."
- "Are you the decision-maker?"

Every message body must end with:
the exact sign-off required by the runtime output schema

## Format
- Body: 3-5 sentences total, short and specific.
- WhatsApp: 50-110 words. Conversational.
- Email: 70-140 words. Subject line is handled separately by the output schema.
- Email subjects must be calm 2-6 word buyer-readable questions when requested by the output schema.
- Do not put a subject line inside the message body.
- Do not include labels, explanations, metadata, or analysis in the message body.
- Use "you" and "your" naturally, but do not overuse them for generic contacts.
- No emojis. No exclamation marks.

## Tone
- Professional but warm
- Conversational, like a thoughtful WhatsApp message to a business contact
- Clear and specific
- Brief
- No buzzwords
- No hype
- No pressure
- No corporate filler

Avoid phrases like:
- "Hope this finds you well"
- "I wanted to reach out"
- "In today's digital landscape"
- "Leveraging synergies"
- "Revolutionize your business"
- "Unlock your potential"
- "Just checking in"
- "Game-changer"

## Hard Rules
- Never fabricate business details.
- Never mention pricing unless explicitly instructed.
- Never use generic openers.
- Never ask for a call in the first-touch message.
- Never pitch more than one feature.
- Never mention competitor names.
- Never imply guaranteed outcomes.
- Never reduce the company to only one narrow feature if the context positions it more broadly.
- Follow-ups must reference the previous message's specific topic and must not restart from scratch.`;

export const DEFAULT_SCORING_SYSTEM_PROMPT = `You are an expert lead qualification analyst for Leadzilla.

## Goal
Score how good this business is for Leadzilla overall, not merely how closely it matches the ICP search category.

Leadzilla helps businesses turn WhatsApp, Instagram, social, and direct customer conversations into paid, structured, trackable orders.

A strong lead already:
- Acquires customers
- Communicates with customers
- Sells products or services
- Has enough transaction volume or customer engagement for Leadzilla to matter

## How To Use The ICP
Use the ICP description as context, but do not overfit to it.

- If the ICP category is imperfect but the business shows strong Leadzilla-fit signals, score it highly.
- If the ICP category matches but the business lacks Leadzilla-fit signals, score it lower.

## Priority Signals
Prioritize these signals in order:

1. Marketing activity and customer acquisition
   - Active social media
   - Recent posts, campaigns, events, or visible promotions
   - Physical customer engagement or offline sales activity

2. Online presence, chat presence, and reputation
   - WhatsApp, Instagram, website, or app presence
   - Recent activity, ratings, and reviews

3. Online payment readiness
   - Businesses already accepting online payments have lower adoption friction.

4. Fit with Leadzilla-served verticals
   - eCommerce
   - Professional services
   - Food and beverage
   - Sports and fitness
   - Education and training
   - Retail

5. Expected volume
   - Estimate from reviews, social following, branch/location signals, catalog depth, activity level, and repeat customer interactions.

## What Not To Penalize
- Do not score based on whether a named decision-maker was found.
- Contactability is separate from business fit.
- Generic business email, generic forms, or WhatsApp contact information should not reduce fit.
- Do not over-penalize thin website data if the business has strong Instagram, WhatsApp, reviews, or other customer-facing activity.

## Evidence Rules
- Do not invent facts or use outside knowledge.
- If evidence is missing, say so and lower confidence.

## Penalize
Penalize businesses that appear:
- Inactive
- Low-volume
- Irrelevant to Leadzilla's served verticals
- Purely informational
- Government-like
- Non-commercial
- Unlikely to sell through customer conversations

## Score Calibration
- 0.90-1.00 = excellent Leadzilla fit
- 0.75-0.89 = strong fit
- 0.55-0.74 = plausible fit
- 0.40-0.54 = weak fit
- 0.00-0.39 = poor fit

## Output
Return a score between 0 and 1 and a short list of concise reasoning strings tied to observed evidence.`;

/**
 * JSON output format specification — always appended at the end of the system message.
 */
const OUTPUT_FORMAT_SPEC = 'Output JSON with a single "message" object containing: subject (email subject line, 2-6 word question format; null for WhatsApp), bodyText (the complete send-ready plain-text message, including the low-friction question and the exact final sign-off "Best,\\nLeadzilla Team"), bodyHtml (null), ctaText (the low-friction CTA question, or null).';

// ---------- Helpers ----------

function classifyStatus(statusCode: number): 'retryable' | 'terminal' {
  if (statusCode === 429 || statusCode >= 500) {
    return 'retryable';
  }
  return 'terminal';
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

// ---------- Adapter ----------

export class OpenAiAdapter {
  private readonly apiKey: string | undefined;
  private readonly generationModel: string;
  private readonly scoringModel: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAiAdapterConfig) {
    this.apiKey = config.apiKey;
    this.generationModel = config.generationModel ?? DEFAULT_GENERATION_MODEL;
    this.scoringModel = config.scoringModel ?? DEFAULT_SCORING_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async generateMessageVariants(
    context: MessageGenerationContext,
    options?: MessageGenerationOptions | undefined,
  ): Promise<OpenAiGenerationResult> {
    if (!this.apiKey) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'OPENAI_API_KEY is not configured',
          raw: null,
        },
      };
    }

    // Compose system message: [EDITABLE BEHAVIOR] [MANDATORY HOOK] [USER INSTRUCTIONS] [OUTPUT FORMAT]
    const behaviorPrompt = (context.customBehaviorPrompt && context.customBehaviorPrompt.trim()) || null;
    const role = (context.customRole && context.customRole.trim()) || DEFAULT_MESSAGING_ROLE;
    const prompt = (context.customSystemPrompt && context.customSystemPrompt.trim()) || DEFAULT_MESSAGING_SYSTEM_PROMPT;
    const generationModel = options?.model?.trim() || this.generationModel;
    const icpHook = context.icpHook?.trim() || null;
    const redraftFeedback = context.redraftFeedback?.trim() || null;
    const normalizedRedraftFeedback = redraftFeedback?.toLowerCase() ?? '';

    const hookInstruction = icpHook
      ? `You MUST incorporate the following sales hook as the core angle of your message. Do not substitute it with generic statistics or filler. Sales hook: "${icpHook}"`
      : 'No specific sales hook was provided. You MUST derive a concrete, relevant hook from the ICP description and business intelligence. Avoid generic filler.';

    const systemPromptParts = [
      behaviorPrompt ?? [role, '\n---\n', prompt].join('\n'),
      '\n\nPREFERRED INTRO POSITIONING:',
      `The message body must start with a professional greeting, such as "Hi Ann," or "Hi ${context.companyName ?? 'Company'} team,". Immediately after the greeting, include this exact opening before personalization or business-specific observation: "${LEADZILLA_OUTREACH_OPENING}" Continue with this sentence when it reads naturally: "${LEADZILLA_OUTREACH_CONTEXT_SENTENCE}"`,
      '\n\nMANDATORY SUBJECT LINE DISCIPLINE:',
      'For email, write a calm 2-6 word buyer-readable question. Do not use alarmist or scare-hook subjects such as "Failed payments on big deals?", "Lost revenue?", or "Payment problems?". Prefer neutral workflow subjects such as "Track client inquiries?" or "Chat-to-payment flow?".',
      '\n\nMANDATORY ICP HOOK INSTRUCTION:',
      hookInstruction,
    ];

    if (context.messagingInstructions && context.messagingInstructions.trim()) {
      systemPromptParts.push(
        `\n\nAdditional instructions from the user: ${context.messagingInstructions.trim()}`,
      );
    }

    if (redraftFeedback) {
      systemPromptParts.push([
        '\n\nRE-DRAFT INSTRUCTION:',
        'The operator rejected or disliked the previous draft and gave feedback.',
        'Treat this feedback as high priority and use it to change the new draft materially.',
        'Operator feedback overrides default CTA examples and default CTA preferences.',
        'Do not repeat the criticized subject, CTA, opening, personalization angle, or phrasing from the previous draft.',
        'If feedback would break basic message safety such as placeholders, spam, or missing sign-off, use the closest compliant alternative.',
      ].join(' '));

      if (/\b(?:do not|don't|dont|avoid|stop)\b[^.?!]*(?:send|offer|share)?[^.?!]*\bexample\b/.test(normalizedRedraftFeedback)) {
        systemPromptParts.push('The operator specifically rejected offering or sending an example. Do not use the word "example" anywhere in the new draft.');
      }

      if (/\b(?:schedule|meeting|meet)\b/.test(normalizedRedraftFeedback) && /\bright person\b/.test(normalizedRedraftFeedback)) {
        systemPromptParts.push('The operator wants a meeting-oriented right-person CTA. End with a question similar to: "Would you be open to a short conversation, or is someone else on your team the right person to speak with?"');
      }
    }

    systemPromptParts.push(`\n\n${OUTPUT_FORMAT_SPEC}`);

    const systemPrompt = systemPromptParts.join('\n');

    const recipientType = context.recipientType ?? 'DECISION_MAKER';
    const recipientName = context.recipientName?.trim() || null;
    const recipientTitle = context.recipientTitle?.trim() || null;
    const recipientEmailKind = context.recipientEmailKind ?? 'UNKNOWN';
    const channel = context.channel ?? 'EMAIL';

    const userPrompt = [
      `Channel: ${channel}`,
      `Lead: ${context.leadName} (${context.leadEmail})`,
      `Contact type: ${recipientType}`,
      recipientName ? `Recipient name: ${recipientName}` : 'Recipient name: none verified',
      recipientTitle ? `Recipient title: ${recipientTitle}` : null,
      `Recipient email kind: ${recipientEmailKind}`,
      recipientType === 'GENERIC_CONTACT'
        ? 'Recipient guidance: write to the company team, not to an individual person.'
        : 'Recipient guidance: write to the named person while keeping the value framed around their team/business.',
      context.companyName ? `Company: ${context.companyName}` : null,
      context.industry ? `Industry: ${context.industry}` : null,
      context.country ? `Country: ${context.country}` : null,
      `Score band: ${context.scoreBand} (${context.blendedScore.toFixed(2)})`,
      `ICP description: ${context.icpDescription}`,
      context.icpAngle ? `ICP angle (value proposition framing): ${context.icpAngle}` : null,
      context.redraftFeedback?.trim()
        ? `\nOperator re-draft feedback:\n${context.redraftFeedback.trim()}\nApply this feedback to the new draft while still following all system rules.`
        : null,
      context.previousDraftSubject?.trim()
        ? `Previous draft subject:\n${context.previousDraftSubject.trim()}`
        : null,
      context.previousDraftBody?.trim()
        ? `Previous draft body:\n${context.previousDraftBody.trim()}`
        : null,
      context.businessIntelligence
        ? `\nBusiness Intelligence:\n${context.businessIntelligence}`
        : 'No structured business intelligence available.',
      '\nIMPORTANT: Write only natural language in the message body. Never include JSON, code, or raw data structures.',
    ]
      .filter(Boolean)
      .join('\n');

    return this.callChatCompletion<MessageGenerationResult>(
      generationModel,
      systemPrompt,
      userPrompt,
      GenerationResponseSchema,
      (parsed) => ({
        model: generationModel,
        message: parsed.message,
      }),
    );
  }

  async evaluateLeadScore(
    context: LeadScoringContext,
    options?: LeadScoringOptions | undefined,
  ): Promise<OpenAiScoringResult> {
    if (!this.apiKey) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'OPENAI_API_KEY is not configured',
          raw: null,
        },
      };
    }

    const systemPrompt =
      (context.customSystemPrompt && context.customSystemPrompt.trim()) ||
      DEFAULT_SCORING_SYSTEM_PROMPT;
    const scoringModel = options?.model?.trim() || this.scoringModel;

    const userPrompt = [
      `Deterministic baseline score: ${context.deterministicScore.toFixed(4)}`,
      `ICP context: ${context.icpDescription}`,
      `Business feature evidence: ${JSON.stringify(context.featuresJson)}`,
    ].join('\n');

    return this.callChatCompletion<AiScoreResult>(
      scoringModel,
      systemPrompt,
      userPrompt,
      ScoringResponseSchema,
      (parsed) => ({
        score: parsed.score,
        reasoning: parsed.reasoning,
      }),
    );
  }

  async generateBusinessInsights(
    businessData: string,
  ): Promise<
    | { status: 'success'; data: string }
    | { status: 'retryable_error'; failure: OpenAiFailure }
    | { status: 'terminal_error'; failure: OpenAiFailure }
  > {
    if (!this.apiKey) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'OPENAI_API_KEY is not configured',
          raw: null,
        },
      };
    }

    const systemPrompt = [
      'You are a sales intelligence analyst for Leadzilla.',
      'Given business data from web scraping, respond in exactly 2-4 sentences.',
      'Describe what the business does, who they serve, and their key offering.',
      'Be specific and factual — mention concrete services, products, pricing, team members, or technology choices. No filler words.',
      'Format: Return a JSON object with a single "insights" field containing the text.',
    ].join(' ');

    const InsightsSchema = z.object({
      insights: z.string(),
    });

    const result = await this.callChatCompletion<string>(
      this.generationModel,
      systemPrompt,
      businessData,
      InsightsSchema,
      (parsed) => parsed.insights,
      200,
    );

    return result;
  }

  async classifyReply(
    replyText: string,
  ): Promise<OpenAiClassificationResult> {
    if (!this.apiKey) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'OPENAI_API_KEY is not configured',
          raw: null,
        },
      };
    }

    const systemPrompt = [
      'You are a reply classifier for Leadzilla.',
      'Classify the customer reply into exactly one category:',
      '- INTERESTED: The person wants to learn more, asks questions, or shows positive intent.',
      '- NOT_INTERESTED: The person explicitly declines, says no, shows negative intent, or asks to stop receiving messages (e.g. "stop", "remove me", "don\'t contact me").',
      '- OUT_OF_OFFICE: Auto-reply or mention of being away/unavailable/on leave.',
      'The reply may be in any language (English, Arabic, Hindi, etc.). Classify based on intent regardless of language.',
      'Return the classification and a confidence score between 0 and 1.',
    ].join(' ');

    return this.callChatCompletion<ReplyClassificationResult>(
      this.scoringModel,
      systemPrompt,
      `Reply text: "${replyText}"`,
      ClassificationResponseSchema,
      (parsed) => ({
        classification: parsed.classification,
        confidence: parsed.confidence,
      }),
    );
  }

  private async callChatCompletion<T>(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType,
    transform: (parsed: z.infer<typeof schema>) => T,
    maxTokens?: number | undefined,
  ): Promise<
    | { status: 'success'; data: T }
    | { status: 'retryable_error'; failure: OpenAiFailure }
    | { status: 'terminal_error'; failure: OpenAiFailure }
  > {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'response',
              strict: true,
              schema: zodToJsonSchema(schema),
            },
          },
          temperature: 0.7,
          ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'OpenAI request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await response.text();

    if (!response.ok) {
      const classification = classifyStatus(response.status);
      const failure: OpenAiFailure = {
        classification,
        statusCode: response.status,
        message: `OpenAI API returned status ${response.status}`,
        raw: parseJsonSafe(rawText),
      };
      return classification === 'retryable'
        ? { status: 'retryable_error', failure }
        : { status: 'terminal_error', failure };
    }

    try {
      const responseJson = JSON.parse(rawText) as Record<string, unknown>;
      const choices = responseJson.choices as Array<{
        message?: { content?: string };
      }>;
      const content = choices?.[0]?.message?.content;

      if (!content) {
        return {
          status: 'terminal_error',
          failure: {
            classification: 'terminal',
            statusCode: response.status,
            message: 'OpenAI response missing content',
            raw: responseJson,
          },
        };
      }

      const cleaned = stripMarkdownFences(content);
      const parsedContent = JSON.parse(cleaned) as unknown;
      const validated = schema.parse(parsedContent);

      return { status: 'success', data: transform(validated) };
    } catch (error: unknown) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: response.status,
          message: error instanceof Error ? error.message : 'Failed to parse OpenAI response',
          raw: parseJsonSafe(rawText),
        },
      };
    }
  }
}

// ---------- JSON Schema helper (minimal zodToJsonSchema for structured output) ----------
//
// OpenAI strict structured output has specific requirements:
// 1. Nullable types must use `type: ["string", "null"]`, NOT `anyOf`
// 2. ALL properties must be listed in `required` (even nullable ones)
// 3. `additionalProperties: false` is mandatory
//
// The previous implementation used `anyOf` for nullable types and omitted nullable
// properties from `required`. This caused OpenAI to reject the schema with a 400
// error on every call, sending ALL messages to the fallback path.

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const properties: Record<string, unknown> = {};
    // OpenAI strict mode: ALL properties must be required (including nullable ones)
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      // In strict mode, every property must be in required.
      // Optional properties are not used in our schemas, but skip them if present.
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    };
  }

  if (schema instanceof z.ZodString) {
    return { type: 'string' };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: 'number' };
  }

  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: (schema as z.ZodEnum<[string, ...string[]]>).options };
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToJsonSchema(schema.element as z.ZodType),
    };
  }

  // OpenAI strict mode: nullable types must use array type notation, not anyOf.
  // e.g. `type: ["string", "null"]` instead of `anyOf: [{type: "string"}, {type: "null"}]`
  if (schema instanceof z.ZodNullable) {
    const inner = schema.unwrap() as z.ZodType;
    const innerSchema = zodToJsonSchema(inner);
    const innerType = innerSchema.type as string | undefined;
    if (innerType) {
      return { type: [innerType, 'null'] };
    }
    // Fallback for complex inner types: use anyOf (non-strict would still work)
    return { anyOf: [innerSchema, { type: 'null' }] };
  }

  return { type: 'string' };
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

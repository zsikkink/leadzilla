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

export interface LeadScoringContext {
  featuresJson: Record<string, unknown>;
  icpDescription: string;
  deterministicScore: number;
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
const ZBOONI_OUTREACH_OPENING =
  'I’m reaching out from Zbooni. We help businesses turn customer messages into paid, trackable orders.';
const ZBOONI_OUTREACH_CONTEXT_SENTENCE =
  'When a customer asks about a product, your team can send a cart, collect payment, and track the sale from the same conversation.';

// ---------- Messaging Defaults (exported for UI preview) ----------

/**
 * Section 0 from messaging-template-research.md — AI identity and persona.
 * Sent as the opening preamble of the system message.
 */
export const DEFAULT_MESSAGING_ROLE = `You are a senior sales development representative at Zbooni writing to businesses in the MENA region (UAE, Saudi Arabia, Egypt, Jordan).

Your only goal is to start a conversation — not to close a deal or book a call. You write lightly personalized first-touch outreach that sounds relevant without sounding overly researched, familiar, or invasive.

You understand Zbooni as a conversational commerce platform: it helps businesses turn WhatsApp, Instagram, social, and direct-chat conversations into paid, structured, trackable orders.

You are direct, warm, and professional. You respect hierarchy. You never pressure, overclaim, or pretend to know more than the data supports.`;

/**
 * Sections 1-6 from messaging-template-research.md — distilled into actionable AI instructions.
 * Covers positioning, framework, ICP feature map, templates, hard rules, and tone.
 */
export const DEFAULT_MESSAGING_SYSTEM_PROMPT = `## STEP 1: OPEN WITH THE SALES HOOK
Use the ICP sales hook as the core angle, but keep the opening natural. The message should feel like a relevant business note, not a forensic audit.

Default Zbooni angle: "Your customers are already messaging you. Zbooni helps turn those conversations into paid, trackable orders."

Start with a greeting, then immediately include this positioning: "I’m reaching out from Zbooni. We help businesses turn customer messages into paid, trackable orders." Continue with the cart/payment/tracking sentence when it reads naturally.

If a stronger ICP-specific hook is provided, use that hook. If no sales hook is provided, derive one from the ICP description and the safest available business context.

## STEP 2: LIGHT PERSONALIZATION ONLY
Use at most ONE safe personalization signal. Good signals include:
- The company name or business category
- A clear website, Instagram, WhatsApp, ecommerce, catalog, booking, payment, or service signal
- The ICP segment or broad industry when scrape data is thin

Do NOT stack multiple scraped details. Do NOT mention team members, follower counts, technologies, pricing tiers, payment processors, or operational gaps unless they are explicitly provided and directly relevant.
If confidence is low, use category-level language instead of inventing specifics.

## STEP 3: PICK ONE MESSAGE FAMILY
Choose one family that best fits the ICP, industry, and business intelligence:
1. WhatsApp or social-first business: turn chats into paid orders.
2. Retail, boutique, luxury, or multi-agent selling: make WhatsApp sales trackable.
3. Shopify or ecommerce: recover abandoned carts through real WhatsApp conversations.
4. High-ticket rentals, travel, hospitality, or luxury services: reduce payment friction for ready-to-pay customers.
5. Owner, operations, or finance buyer: know which chats become revenue.
6. Existing commerce stack: add conversational checkout without replacing Shopify, WooCommerce, Magento, Salesforce, or an existing payment provider.

## STEP 4: CONNECT TO ONE ZBOONI CAPABILITY
Pick exactly ONE capability and connect it to the message family:
- Create baskets, invoices, payment links, or QR payments from a customer conversation
- Catalogs, collections, cShop, or social storefronts
- Order, payment, customer, receipt, payout, and sales-performance tracking
- WhatsApp campaigns, remarketing, or abandoned-cart recovery
- Flexible payment methods and payment-provider integrations
- Multi-user sales visibility for teams selling through chat

Do NOT position Zbooni as just a payment gateway, just a WhatsApp inbox, or just a payment-link tool.

## STEP 5: CONTACT AWARENESS
Use the contact context from the user message.
- DECISION_MAKER: address the named person if a real name is available. You may use role-aware language, but still write to the team/business.
- GENERIC_CONTACT: address the company team, e.g. "Hi {Company} team,". Do not pretend the inbox is a person. Do not write "Hi Unknown" or "Hi Generic Contact".
- For generic contacts, use "your team", "the team", or "whoever handles WhatsApp orders/payments/operations."
- The first line must be a professional greeting: "Hi {FirstName}," for a decision-maker or "Hi {Company} team," for a generic contact. Never start with only the name, e.g. "Ann,". Do not use "Dear".
- Immediately after the greeting, include the required Zbooni opening sentence.

## STEP 6: PROOF POINTS
Use proof points only when segment-relevant, and frame them as case-study examples, not guarantees:
- Tryano: retail/clienteling teams; AED 3.2M in WhatsApp sales and 70 sales agents onboarded in one week.
- Sand Dollar: Shopify/cart recovery; WhatsApp recovery converted 6x higher than email and reached 30%+ recovery in the case study.
- Elite Rentals: high-ticket rentals/luxury services; useful for payment-friction framing.
- Checkout.com: payment acceptance and checkout-speed credibility.

Most first messages should not need a proof point. Use plain Zbooni value when a proof point would feel forced.

## STEP 7: END WITH A SOFT QUESTION AND SIGN-OFF
End with a single low-commitment question before the sign-off — never ask to schedule a call.
Good: "Is this something you've been thinking about?"
Good: "Would it be useful to compare this with how your team handles chat-driven orders today?"
Bad: "Can we schedule a call this week?"
Bad: "I'd love to jump on a quick call."

Every message body must end with:
Best,
Zbooni Team

## MESSAGE FORMAT
- 3-5 sentences total. Short and punchy.
- WhatsApp: 50-110 words. Conversational. No subject line, no "Dear".
- Email: 70-140 words. Subject line must be a 2-6 word question.
- Email subjects should be clear and buyer-readable. Use sample subject themes only as style guidance; write a fresh 2-6 word question tied to the prospect context. Never reuse example subjects verbatim, and never use vague feature-only subjects like "Milestone payments?".
- Do not use alarmist or scare-hook subjects like "Failed payments on big deals?", "Lost revenue?", or "Payment problems?".
- Use "you/your" naturally, but do not overuse "you" for generic contacts.
- No emojis. No exclamation marks.

## HARD RULES
BANNED phrases: "To be honest with you", "Are you the decision-maker?", "Just checking in", "game-changer", "innovative", "revolutionary", "I'd love to jump on a call", "payment link" used alone, "cheapest/lowest fees", "better than [competitor]", "I hope this finds you well"
NEVER: ask to schedule a call, mention competitor names, use generic openers, list multiple features, invent scraped facts, imply guaranteed outcomes
Follow-ups: reference the previous message's specific topic, do not restart from scratch

## TONE
Direct, warm, confident. You sound like a knowledgeable peer, not a salesperson. Regional awareness (UAE/Saudi/MENA business culture). Hierarchy-respectful. Lightly personalized, not overly familiar. Professional warmth, not corporate formality.`;

/**
 * JSON output format specification — always appended at the end of the system message.
 */
const OUTPUT_FORMAT_SPEC = 'Output JSON with a single "message" object containing: subject (email subject line, 2-6 word question format; null for WhatsApp), bodyText (the complete send-ready plain-text message, including the low-friction question and the exact final sign-off "Best,\\nZbooni Team"), bodyHtml (null), ctaText (the low-friction CTA question, or null).';

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

    // Compose system message: [ROLE] --- [SYSTEM PROMPT] [MANDATORY HOOK] [USER INSTRUCTIONS] [OUTPUT FORMAT]
    const role = (context.customRole && context.customRole.trim()) || DEFAULT_MESSAGING_ROLE;
    const prompt = (context.customSystemPrompt && context.customSystemPrompt.trim()) || DEFAULT_MESSAGING_SYSTEM_PROMPT;
    const icpHook = context.icpHook?.trim() || null;
    const redraftFeedback = context.redraftFeedback?.trim() || null;
    const normalizedRedraftFeedback = redraftFeedback?.toLowerCase() ?? '';

    const hookInstruction = icpHook
      ? `You MUST incorporate the following sales hook as the core angle of your message. Do not substitute it with generic statistics or filler. Sales hook: "${icpHook}"`
      : 'No specific sales hook was provided. You MUST derive a concrete, relevant hook from the ICP description and business intelligence. Avoid generic filler.';

    const systemPromptParts = [
      role,
      '\n---\n',
      prompt,
      '\n\nPREFERRED INTRO POSITIONING:',
      `The message body must start with a professional greeting, such as "Hi Ann," or "Hi ${context.companyName ?? 'Company'} team,". Immediately after the greeting, include this exact opening before personalization or business-specific observation: "${ZBOONI_OUTREACH_OPENING}" Continue with this sentence when it reads naturally: "${ZBOONI_OUTREACH_CONTEXT_SENTENCE}"`,
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
      this.generationModel,
      systemPrompt,
      userPrompt,
      GenerationResponseSchema,
      (parsed) => ({
        model: this.generationModel,
        message: parsed.message,
      }),
    );
  }

  async evaluateLeadScore(
    context: LeadScoringContext,
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

    const systemPrompt = [
      'You are an expert lead qualification analyst for Zbooni.',
      'Score how good this business is for Zbooni overall, not merely how closely it matches the ICP search category.',
      'Zbooni helps businesses turn WhatsApp, Instagram, social, and direct customer conversations into paid, structured, trackable orders.',
      'A strong lead already acquires customers, communicates with customers, sells products or services, and has enough transaction volume or customer engagement for Zbooni to matter.',
      'Use the ICP description as context, but do not overfit to it. If the ICP category is imperfect but the business shows strong Zbooni-fit signals, score it highly. If the ICP category matches but the business lacks Zbooni-fit signals, score it lower.',
      'Prioritize these signals in order: 1) marketing activity and customer acquisition, including active social media, recent posts, campaigns, events, visible promotions, physical customer engagement, or offline/physical-world sales activity; 2) online presence, chat presence, and reputation, especially WhatsApp, Instagram, websites, apps, recent activity, ratings, and reviews; 3) online payment readiness, because businesses already accepting online payments have lower adoption friction; 4) fit with Zbooni-served verticals: eCommerce, professional services, food and beverage, sports and fitness, education and training, and retail; 5) expected volume, estimated from reviews, social following, branch/location signals, catalog depth, activity level, and repeat customer interactions.',
      'Do not score based on whether a named decision-maker was found. Contactability is separate from business fit. Generic business email, generic forms, or WhatsApp contact information should not reduce fit.',
      'Do not over-penalize thin website data if the business has strong Instagram, WhatsApp, reviews, or other customer-facing activity.',
      'Do not invent facts or use outside knowledge. If evidence is missing, say so and lower confidence.',
      'Penalize businesses that appear inactive, low-volume, irrelevant to Zbooni’s served verticals, purely informational, government-like, non-commercial, or unlikely to sell through customer conversations.',
      'Score calibration: 0.90-1.00 = excellent Zbooni fit; 0.75-0.89 = strong fit; 0.55-0.74 = plausible fit; 0.40-0.54 = weak fit; 0.00-0.39 = poor fit.',
      'Return a score between 0 and 1 and a short list of concise reasoning strings tied to observed evidence.',
    ].join(' ');

    const userPrompt = [
      `Deterministic baseline score: ${context.deterministicScore.toFixed(4)}`,
      `ICP context: ${context.icpDescription}`,
      `Business feature evidence: ${JSON.stringify(context.featuresJson)}`,
    ].join('\n');

    return this.callChatCompletion<AiScoreResult>(
      this.scoringModel,
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
      'You are a sales intelligence analyst for Zbooni, a UAE fintech company.',
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
      'You are a reply classifier for Zbooni, a UAE fintech company.',
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

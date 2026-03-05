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
  classification: 'INTERESTED' | 'NOT_INTERESTED' | 'OUT_OF_OFFICE' | 'UNSUBSCRIBE';
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
  classification: z.enum(['INTERESTED', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE']),
  confidence: z.number().min(0).max(1),
});

// ---------- Defaults ----------

const DEFAULT_GENERATION_MODEL = 'gpt-4o';
const DEFAULT_SCORING_MODEL = 'gpt-4o';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------- Messaging Defaults (exported for UI preview) ----------

/**
 * Section 0 from messaging-template-research.md — AI identity and persona.
 * Sent as the opening preamble of the system message.
 */
export const DEFAULT_MESSAGING_ROLE = `You are a senior sales development representative at Zbooni. You write personalized cold outreach messages to business owners and decision makers in the MENA region (UAE, Saudi Arabia, Egypt, Jordan).

Your job is to open conversations that lead to demos — not to close deals in the first message. You understand conversational commerce, high-ticket service businesses, and the operational pain of chasing payments through bank transfers and fragmented tools.

You write like a knowledgeable peer who noticed something specific about the prospect's business — not like a salesperson running through a script. Every message should make the reader think: "This person actually looked at my business."

You are patient, professional, and never pushy. You earn the right to a conversation through relevance and value, not volume and pressure.`;

/**
 * Sections 1-6 from messaging-template-research.md — distilled into actionable AI instructions.
 * Covers positioning, framework, ICP feature map, templates, hard rules, and tone.
 */
export const DEFAULT_MESSAGING_SYSTEM_PROMPT = `## ZBOONI POSITIONING
Zbooni is a chat revenue & operations layer for high-ticket businesses — NOT a payment link tool.
Lead with: (1) speed & certainty (instant confirmation, retries, live support), (2) high-value payment handling (deposits, milestones, partial, up to AED 1M), (3) operational control (tracking, reconciliation, CRM, per-agent reporting), (4) human support when timing matters.
NEVER lead with price. NEVER compete feature-by-feature with Stripe. NEVER position as "just a payment link."

## A-C-A FRAMEWORK
Structure every message as Acknowledge-Compliment-Ask:
1. Acknowledge: Reference something specific from the lead's business intelligence (proves it's not spam)
2. Compliment: Sincere, subtle — focus on brand quality, growth, or client experience. Never flattery
3. Ask: Low-commitment, interest-gated CTA. NEVER ask to schedule a call

Requirements: 40-80 words (WhatsApp) or up to 120 words (email body). Single CTA. Must reference at least ONE specific detail from business intelligence. Must mention at least ONE ICP-relevant feature. Social proof must include a number (e.g. "200+ merchants", "81% conversion rate").

## ICP FEATURE MAP (select based on icpDescription)
A. Luxury & High-Ticket: Hook=payment certainty for high-value deals. Features: AED 1M links, multi-MID retry, live support, Amex/Apple Pay/Google Pay/PayPal, CRM
B. Gifting & Bespoke: Hook=seasonal spikes and multi-agent selling. Features: CShop catalog, promo codes, live link editing, agent tracking, WhatsApp campaigns
C. Events & Weddings: Hook=payment delays kill events. Features: ticketing, QR ordering, master organizer dashboard, POS, customer database, promo codes
D. Home & Contracting: Hook=replace bank transfers with staged payments. Features: milestone links, reconciliation/VAT, partial payments, catalog, CRM
E. Boutique Hospitality: Hook=guests want instant remote payment. Features: large one-off payments, customizable partials, international cards, multi-currency, catalog upsells
F. Premium Wellness: Hook=failed payments waste clinic time. Features: staged/package links, multi-MID retry, BNPL (Tabby/Tamara), patient CRM, promo codes
G. High-Ticket Coaching: Hook=high-ticket closes in conversations not websites. Features: staged payments, international cards, CRM, promo codes, WhatsApp re-engagement
H. Education & Training: Hook=deposits and cohort tracking shouldn't be manual. Features: BNPL, inventory limits, reconciliation, enrollment CRM, early-bird promos, WhatsApp campaigns

## TEMPLATES
WhatsApp first message: "Hi {Name}, I came across {Company} and was impressed by {observation}. {icp_hook_adapted} We've helped {social_proof} businesses like yours {value_statement}. {interest_gate_cta}"
Email first message: Subject (2-6 word question). Body: observation + compliment → icp pain point + hook → social proof + 1-2 features → interest-gate CTA. Sign off: "Best regards, {Sender}"
Follow-up 1 (72h): Value-add content related to ICP. Ask if topic is a priority this quarter
Follow-up 2 (1 week): Respectful breakup. Stop reaching out, leave door open

## HARD RULES
BANNED phrases: "To be honest with you", "Are you the decision-maker?", "Just checking in", "game-changer/innovative/revolutionary", "I'd love to jump on a call", "payment link" in isolation, "cheapest/lowest fees", "better than [competitor]"
NEVER: ask to schedule a call in CTA, mention competitor names, use "I hope this finds you well", use generic openers
Disqualify (soft tone, no hard-sell): pure ecommerce, subscription-only, web-checkout-only, "just need a payment link", price-led mindset
WhatsApp: conversational tone, no subject line, no "Dear", no sign-off block
Email: professional tone, must have subject line (question format), "Best regards" sign-off
Follow-ups: reference previous message's topic, don't restart from scratch

## TONE
Professional warmth with regional awareness. Direct about value (Hormozi influence), courteous, hierarchy-respectful. Peer-level consultant voice. Confident not aggressive, specific not verbose, warm not familiar. No emojis, no exclamation marks. Use "you/your" more than "we/our."`;

/**
 * JSON output format specification — always appended at the end of the system message.
 */
const OUTPUT_FORMAT_SPEC = 'Output JSON with a single "message" object containing: subject (email subject line, 2-6 word question format; null for WhatsApp), bodyText (plain text), bodyHtml (null), ctaText (the CTA text or null).';

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

    // Compose system message: [ROLE] --- [SYSTEM PROMPT] [INSTRUCTIONS] [OUTPUT FORMAT]
    const role = (context.customRole && context.customRole.trim()) || DEFAULT_MESSAGING_ROLE;
    const prompt = (context.customSystemPrompt && context.customSystemPrompt.trim()) || DEFAULT_MESSAGING_SYSTEM_PROMPT;

    const systemPromptParts = [role, '\n---\n', prompt];

    if (context.messagingInstructions && context.messagingInstructions.trim()) {
      systemPromptParts.push(
        '\n\nADDITIONAL INSTRUCTIONS FROM SALES TEAM:',
        context.messagingInstructions,
      );
    }

    systemPromptParts.push('\n\n' + OUTPUT_FORMAT_SPEC);

    const systemPrompt = systemPromptParts.join('\n');

    const userPrompt = [
      `Lead: ${context.leadName} (${context.leadEmail})`,
      context.companyName ? `Company: ${context.companyName}` : null,
      context.industry ? `Industry: ${context.industry}` : null,
      context.country ? `Country: ${context.country}` : null,
      `Score band: ${context.scoreBand} (${context.blendedScore.toFixed(2)})`,
      `ICP description: ${context.icpDescription}`,
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
      'You are an expert lead scoring analyst for Zbooni, a UAE fintech company.',
      'Evaluate the lead quality based on the feature vector and ICP criteria.',
      'Return a score between 0 and 1 (0 = poor fit, 1 = perfect fit) and a list of reasoning strings.',
      'Consider the deterministic score as a baseline and adjust based on qualitative factors.',
    ].join(' ');

    const userPrompt = [
      `Deterministic score: ${context.deterministicScore.toFixed(4)}`,
      `ICP description: ${context.icpDescription}`,
      `Features: ${JSON.stringify(context.featuresJson)}`,
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
      'Given business data from web scraping, write exactly 2 specific, insightful observations a salesperson could reference in outreach.',
      'Be concrete — mention specific services, products, pricing, team members, technology choices, or recent activity.',
      'Keep each observation to 1-2 sentences.',
      'Format: Return a JSON object with a single "insights" field containing the two observations separated by a newline.',
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
      '- NOT_INTERESTED: The person explicitly declines, says no, or shows negative intent.',
      '- OUT_OF_OFFICE: Auto-reply or mention of being away/unavailable/on leave.',
      '- UNSUBSCRIBE: Asks to stop receiving messages, says "stop", "remove me", "don\'t contact me".',
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

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!(value instanceof z.ZodNullable) && !(value instanceof z.ZodOptional)) {
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

  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema.unwrap() as z.ZodType);
    return { anyOf: [inner, { type: 'null' }] };
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

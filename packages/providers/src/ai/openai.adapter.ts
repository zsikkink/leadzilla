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
  /** Pre-written sales hook from ICP profile — the sharp opening line. */
  icpHook?: string | null | undefined;
  /** Sales angle from ICP profile — the value proposition framing. */
  icpAngle?: string | null | undefined;
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

const DEFAULT_GENERATION_MODEL = 'gpt-4o';
const DEFAULT_SCORING_MODEL = 'gpt-4o';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------- Messaging Defaults (exported for UI preview) ----------

/**
 * Section 0 from messaging-template-research.md — AI identity and persona.
 * Sent as the opening preamble of the system message.
 */
export const DEFAULT_MESSAGING_ROLE = `You are a senior sales development representative at Zbooni writing to business owners and decision makers in the MENA region (UAE, Saudi Arabia, Egypt, Jordan).

Your only goal is to start a conversation — not to close a deal or book a call. You sound like someone who spent five minutes researching this specific business, noticed something interesting, and wanted to reach out.

You never sound like a template. Every message must read like it was written for this one person at this one company. If you cannot point to a specific detail from the business intelligence (their website tech stack, Instagram presence, specific services they offer, team members you found), do not write the message — it means you lack the data to be relevant.

You are direct, warm, and professional. You respect hierarchy. You never pressure.`;

/**
 * Sections 1-6 from messaging-template-research.md — distilled into actionable AI instructions.
 * Covers positioning, framework, ICP feature map, templates, hard rules, and tone.
 */
export const DEFAULT_MESSAGING_SYSTEM_PROMPT = `## STEP 1: OPEN WITH THE SALES HOOK
Your FIRST sentence must connect the business's specific situation to the ICP sales hook provided. Do NOT start with a generic greeting or compliment. Start with a sharp observation that makes the hook feel earned.

Example (good): "I noticed {Company} handles high-value interior projects — the kind where a client wiring AED 50K for a deposit and wondering if it went through can stall the whole timeline."
Example (bad): "Hi, I came across {Company} and was impressed by your work."

The sales hook is the reason you are reaching out. It must appear in the first 1-2 sentences, adapted naturally to this specific business. If no sales hook is provided, derive one from the ICP description and the business intelligence.

## STEP 2: PROVE YOU DID YOUR HOMEWORK (MANDATORY)
You MUST reference at least 2-3 specific details from the business intelligence provided. These must be concrete, verifiable facts — not generic observations. Pick from:
- What they sell or what services they offer (from website scrape or Instagram)
- Their tech stack or payment setup (Shopify, no CRM, WhatsApp ordering)
- Their Instagram presence (follower count, engagement, posting themes, verified status)
- Team members found on their website (by name and title)
- Physical location, review count, rating
- Specific gaps (no live chat, no integrated payments, basic analytics)

NEVER write a message that could apply to any business in the same industry. If you can swap in a different company name and the message still makes sense, it is too generic. Rewrite it.

## STEP 3: CONNECT TO ZBOONI VALUE (ONE FEATURE ONLY)
Zbooni is a chat revenue and operations layer for high-ticket businesses — NOT a payment link tool.
Pick exactly ONE Zbooni feature that directly solves a problem you identified in Step 2:
- Payment certainty: instant confirmation, multi-MID retry, live support, up to AED 1M
- Staged payments: deposits, milestones, partial payments
- Operational control: tracking, reconciliation, CRM, per-agent reporting
- Catalog and commerce: CShop catalog, promo codes, WhatsApp campaigns
- BNPL integration: Tabby, Tamara (for wellness, education, coaching)

Do NOT list multiple features. One feature, connected to one specific pain point you observed.

Include social proof with a real number: "200+ merchants", "81% conversion rate on payment links", etc.

## STEP 4: END WITH A SOFT QUESTION
End with a single low-commitment question — never ask to schedule a call.
Good: "Is this something you've been thinking about?"
Good: "Would it help if I showed you how {similar company type} handle this?"
Bad: "Can we schedule a call this week?"
Bad: "I'd love to jump on a quick call."

## MESSAGE FORMAT
- 3-5 sentences total. Short and punchy.
- WhatsApp: 40-80 words. Conversational. No subject line, no "Dear", no sign-off block.
- Email: up to 120 words. Subject line must be a 2-6 word question. Sign off: "Best regards, {Sender}".
- Use "you/your" more than "we/our."
- No emojis. No exclamation marks.

## HARD RULES
BANNED phrases: "To be honest with you", "Are you the decision-maker?", "Just checking in", "game-changer", "innovative", "revolutionary", "I'd love to jump on a call", "payment link" used alone, "cheapest/lowest fees", "better than [competitor]", "I hope this finds you well"
NEVER: ask to schedule a call, mention competitor names, use generic openers, list multiple features
Follow-ups: reference the previous message's specific topic, do not restart from scratch

## TONE
Direct, warm, confident. You sound like a knowledgeable peer, not a salesperson. Regional awareness (UAE/Saudi/MENA business culture). Hierarchy-respectful. Specific not verbose. Professional warmth, not corporate formality.`;

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

    // Compose system message: [ROLE] --- [SYSTEM PROMPT] [MANDATORY HOOK] [USER INSTRUCTIONS] [OUTPUT FORMAT]
    const role = (context.customRole && context.customRole.trim()) || DEFAULT_MESSAGING_ROLE;
    const prompt = (context.customSystemPrompt && context.customSystemPrompt.trim()) || DEFAULT_MESSAGING_SYSTEM_PROMPT;
    const icpHook = context.icpHook?.trim() || null;

    const hookInstruction = icpHook
      ? `You MUST incorporate the following sales hook as the core angle of your message. Do not substitute it with generic statistics or filler. Sales hook: "${icpHook}"`
      : 'No specific sales hook was provided. You MUST derive a concrete, relevant hook from the ICP description and business intelligence. Avoid generic filler.';

    const systemPromptParts = [
      role,
      '\n---\n',
      prompt,
      '\n\nMANDATORY ICP HOOK INSTRUCTION:',
      hookInstruction,
    ];

    if (context.messagingInstructions && context.messagingInstructions.trim()) {
      systemPromptParts.push(
        `\n\nAdditional instructions from the user: ${context.messagingInstructions.trim()}`,
      );
    }

    systemPromptParts.push(`\n\n${OUTPUT_FORMAT_SPEC}`);

    const systemPrompt = systemPromptParts.join('\n');

    const userPrompt = [
      `Lead: ${context.leadName} (${context.leadEmail})`,
      context.companyName ? `Company: ${context.companyName}` : null,
      context.industry ? `Industry: ${context.industry}` : null,
      context.country ? `Country: ${context.country}` : null,
      `Score band: ${context.scoreBand} (${context.blendedScore.toFixed(2)})`,
      `ICP description: ${context.icpDescription}`,
      context.icpAngle ? `ICP angle (value proposition framing): ${context.icpAngle}` : null,
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

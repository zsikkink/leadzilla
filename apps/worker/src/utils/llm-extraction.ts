// ── LLM Decision Maker Extraction & Validation ──────────────────────
// Uses OpenAI (GPT-4o-mini) to extract and validate decision maker contacts
// from website HTML. Only called as a fallback when rule-based extraction
// finds zero valid team members.

export interface ExtractedContact {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}

export interface ValidatedContact {
  name: string;
  title: string | null;
  isRealPerson: boolean;
  reason: string | null;
}

export interface CandidateForAdjudication {
  id: string;
  name: string;
  title: string | null;
  source: string;
  confidence: number;
  matchedSignals: string[];
  supportingUrls: string[];
}

export interface CandidateAdjudicationResult {
  verdict: 'select_candidate' | 'inconclusive' | 'reject_all';
  selectedCandidateId: string | null;
  confidenceBucket: 'high' | 'medium' | 'low' | null;
  rationale: string;
}

/** Config for direct OpenAI API calls when adapter doesn't expose chatCompletion. */
export interface LlmExtractionConfig {
  openAiApiKey: string | undefined;
  openAiBaseUrl?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Make a direct OpenAI chat completion call.
 * Used because the existing OpenAI adapter doesn't expose a generic chatCompletion method.
 */
async function callOpenAiChat(
  config: LlmExtractionConfig,
  messages: Array<{ role: string; content: string }>,
): Promise<string | null> {
  if (!config.openAiApiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const fetchFn = config.fetchImpl ?? fetch;
    const baseUrl = config.openAiBaseUrl ?? DEFAULT_BASE_URL;

    const response = await fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: config.model ?? DEFAULT_MODEL,
        messages,
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) return null;

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.at(0)?.message?.content;
    return content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip HTML tags and normalize whitespace for sending to the LLM.
 * Keeps only text content to reduce token usage.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000); // Limit to ~2000 tokens
}

/**
 * Extract decision makers from website HTML using GPT-4o-mini.
 * Only called when rule-based extraction finds zero valid team members.
 */
export async function extractDecisionMakers(
  html: string,
  businessName: string,
  config: LlmExtractionConfig,
): Promise<ExtractedContact[]> {
  const cleanText = stripHtml(html);
  if (cleanText.length < 50) return [];

  const result = await callOpenAiChat(config, [
    {
      role: 'system',
      content:
        'You extract contact information from website text. Return a JSON object with a "contacts" array. Each contact has: name (string), title (string or null), email (string or null), phone (string or null). Only include real people — ignore role descriptions, company names, service lists, and non-person text. If no people are found, return {"contacts": []}.',
    },
    {
      role: 'user',
      content: `Extract all people mentioned on the ${businessName} website:\n\n${cleanText}`,
    },
  ]);

  if (!result) return [];

  try {
    const parsed = JSON.parse(result) as { contacts?: ExtractedContact[] };
    if (!Array.isArray(parsed.contacts)) return [];
    return parsed.contacts.filter(
      (c) => typeof c.name === 'string' && c.name.length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * Validate extracted contacts using GPT-4o-mini.
 * Filters out company names, role descriptions, and non-person text.
 * Called on EVERY lead to filter garbage from both rule-based and LLM extraction.
 */
export async function validateExtractedContacts(
  contacts: Array<{ name: string; title: string | null }>,
  businessName: string,
  config: LlmExtractionConfig,
): Promise<ValidatedContact[]> {
  if (contacts.length === 0) return [];

  const contactList = contacts
    .map((c, i) => `${i + 1}. Name: "${c.name}", Title: "${c.title ?? 'unknown'}"`)
    .join('\n');

  const result = await callOpenAiChat(config, [
    {
      role: 'system',
      content:
        'You validate whether names represent real people or are company names, role descriptions, or nonsense. Return a JSON object with a "validated" array. Each item has: name (string), title (string or null), isRealPerson (boolean), reason (string or null explaining why not a real person). The business name is provided for context — names matching it are NOT real people.',
    },
    {
      role: 'user',
      content: `Business name: "${businessName}"\n\nValidate these contacts:\n${contactList}`,
    },
  ]);

  if (!result) {
    // If LLM fails, return all as validated (rule-based validation will still catch obvious fakes)
    return contacts.map((c) => ({
      name: c.name,
      title: c.title,
      isRealPerson: true,
      reason: null,
    }));
  }

  try {
    const parsed = JSON.parse(result) as { validated?: ValidatedContact[] };
    if (!Array.isArray(parsed.validated)) {
      return contacts.map((c) => ({
        name: c.name,
        title: c.title,
        isRealPerson: true,
        reason: null,
      }));
    }
    return parsed.validated;
  } catch {
    return contacts.map((c) => ({
      name: c.name,
      title: c.title,
      isRealPerson: true,
      reason: null,
    }));
  }
}

export async function adjudicateDecisionMakerCandidates(
  input: {
    businessName: string;
    locality: string | null;
    category: string | null;
    candidates: CandidateForAdjudication[];
  },
  config: LlmExtractionConfig,
): Promise<CandidateAdjudicationResult | null> {
  if (!config.openAiApiKey || input.candidates.length === 0) {
    return null;
  }

  const compactCandidates = input.candidates.slice(0, 5);
  const payload = compactCandidates.map((candidate, index) => ({
    rank: index + 1,
    id: candidate.id,
    name: candidate.name,
    title: candidate.title,
    source: candidate.source,
    confidence: candidate.confidence,
    matchedSignals: candidate.matchedSignals.slice(0, 8),
    supportingUrls: candidate.supportingUrls.slice(0, 3),
  }));

  const result = await callOpenAiChat(config, [
    {
      role: 'system',
      content: [
        'You adjudicate decision-maker candidates for outbound sales.',
        'Rules:',
        '- You MUST only choose among provided candidate ids.',
        '- Never invent a new person.',
        '- Prefer strongest external evidence, especially Google/SerpAPI corroboration.',
        '- If evidence is conflicting or weak, return inconclusive.',
        '- If all candidates are clearly invalid, return reject_all.',
        'Return JSON with:',
        '{ "verdict": "select_candidate|inconclusive|reject_all", "selectedCandidateId": "id-or-null", "confidenceBucket": "high|medium|low|null", "rationale": "short reason" }',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        businessName: input.businessName,
        locality: input.locality,
        category: input.category,
        candidates: payload,
      }),
    },
  ]);

  if (!result) {
    return null;
  }

  try {
    const parsed = JSON.parse(result) as Partial<CandidateAdjudicationResult>;
    const verdict = parsed.verdict;
    if (verdict !== 'select_candidate' && verdict !== 'inconclusive' && verdict !== 'reject_all') {
      return null;
    }

    const selectedCandidateId = typeof parsed.selectedCandidateId === 'string'
      ? parsed.selectedCandidateId
      : null;

    if (verdict === 'select_candidate' && !compactCandidates.some((candidate) => candidate.id === selectedCandidateId)) {
      return {
        verdict: 'inconclusive',
        selectedCandidateId: null,
        confidenceBucket: null,
        rationale: 'Model returned a candidate id outside the provided shortlist',
      };
    }

    return {
      verdict,
      selectedCandidateId: verdict === 'select_candidate' ? selectedCandidateId : null,
      confidenceBucket:
        parsed.confidenceBucket === 'high'
        || parsed.confidenceBucket === 'medium'
        || parsed.confidenceBucket === 'low'
          ? parsed.confidenceBucket
          : null,
      rationale: typeof parsed.rationale === 'string' && parsed.rationale.trim().length > 0
        ? parsed.rationale.trim().slice(0, 280)
        : 'No rationale returned by model',
    };
  } catch {
    return null;
  }
}

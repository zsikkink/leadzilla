// ── LLM Decision Maker Extraction & Validation ──────────────────────
// Uses OpenAI (GPT-4o-mini) to validate decision maker candidates
// from Google CSE LinkedIn search results and adjudicate among them.

export interface GoogleCseValidatedPerson {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  confidence: number;
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
 * Validate Google CSE LinkedIn search results using GPT-4o-mini.
 * Filters results to LinkedIn profile URLs, asks the LLM to identify
 * CEO/founder/owner-level people at the specified business, and returns
 * the top 3 validated persons sorted by confidence.
 */
export async function validateGoogleCseResults(
  input: {
    businessName: string;
    city: string | null;
    results: Array<{ title: string; snippet: string; link: string }>;
  },
  config: LlmExtractionConfig,
): Promise<GoogleCseValidatedPerson[]> {
  if (!config.openAiApiKey || input.results.length === 0) return [];

  const formatted = input.results
    .map(
      (r, i) =>
        `${i + 1}. Title: "${r.title}"\n   Snippet: "${r.snippet}"\n   URL: ${r.link}`,
    )
    .join('\n\n');

  const result = await callOpenAiChat(config, [
    {
      role: 'system',
      content:
        'You identify the CEO/founder/owner of a business from web search results. Return JSON with a "persons" array. Each item: name (string), title (string or null), linkedinUrl (string or null — only if the URL is a LinkedIn profile), confidence (number 0-1). Include people who appear to be CEO, founder, owner, managing director, president, general manager, or principal of the specified business. Exclude people at other companies. Extract names from LinkedIn profiles, company about pages, news articles, or any credible source.',
    },
    {
      role: 'user',
      content: `Find the CEO/owner of "${input.businessName}" in ${input.city ?? 'unknown city'}:\n\n${formatted}`,
    },
  ]);

  if (!result) return [];

  try {
    const parsed = JSON.parse(result) as {
      persons?: GoogleCseValidatedPerson[];
    };
    if (!Array.isArray(parsed.persons)) return [];

    return parsed.persons
      .filter(
        (p) =>
          typeof p.name === 'string' &&
          p.name.length > 0 &&
          typeof p.confidence === 'number' &&
          p.confidence >= 0.5,
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  } catch {
    return [];
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

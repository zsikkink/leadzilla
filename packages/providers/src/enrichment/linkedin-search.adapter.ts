// ── Contact Discovery Search Adapter (SerpAPI Web Search) ────────────
// Uses a single Google web search query to discover likely decision-makers
// across LinkedIn, company pages, press, and broader public web.

import type { GoogleCustomSearchResponse, GoogleSearchResult } from './google-custom-search.adapter.js';

/** Structural interface — any adapter with isConfigured + search() works here. */
export interface WebSearchAdapter {
  readonly isConfigured: boolean;
  search(query: string, numResults?: number): Promise<GoogleCustomSearchResponse>;
}

export interface LinkedInSearchConfig {
  searchAdapter: WebSearchAdapter;
}

export type ContactDiscoverySourceType =
  | 'linkedin_profile'
  | 'company_team_page'
  | 'company_about_page'
  | 'press_page'
  | 'public_profile';

export type ContactDiscoverySourceFamily =
  | 'linkedin'
  | 'company_page'
  | 'public_web'
  | 'mixed'
  | 'unknown';

export type ContactDiscoveryQueryFamily =
  | 'DISCOVER_ROLES';

export type ContactDiscoveryRoleKeyword =
  | 'founder'
  | 'ceo'
  | 'owner';

export interface LinkedInProfileResult {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  matchedRoleKeyword: ContactDiscoveryRoleKeyword | null;
  sourceType: ContactDiscoverySourceType;
  sourceUrl: string;
  sourceDomain: string | null;
  companyHint: string | null;
  matchSignals: string[];
  relevanceScore: number;
  repeatCount: number;
}

export type DecisionMakerSearchStage = 'DISCOVER';

export interface LinkedInSearchFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export interface ContactDiscoveryDiagnostic {
  stage: DecisionMakerSearchStage;
  query: string;
  sourceFamily: ContactDiscoverySourceFamily;
  queryFamily: ContactDiscoveryQueryFamily;
  rawResultCount: number;
  promotedCount: number;
  verdict: 'verified' | 'not_verified' | 'inconclusive' | 'skipped';
}

export type LinkedInSearchResponse =
  | {
      status: 'success';
      data: LinkedInProfileResult[];
      diagnostics: ContactDiscoveryDiagnostic[];
      topSourceFamily: ContactDiscoverySourceFamily;
      topQueryFamily: ContactDiscoveryQueryFamily | null;
    }
  | { status: 'retryable_error'; failure: LinkedInSearchFailure }
  | { status: 'terminal_error'; failure: LinkedInSearchFailure };

const COMPANY_PAGE_PATH_PATTERNS = [
  '/team',
  '/our-team',
  '/leadership',
  '/leaders',
  '/management',
  '/staff',
  '/people',
];

const ABOUT_PAGE_PATH_PATTERNS = [
  '/about',
  '/about-us',
  '/company',
  '/who-we-are',
  '/our-story',
];

const PRESS_PAGE_PATH_PATTERNS = [
  '/news',
  '/press',
  '/media',
  '/blog',
  '/article',
];

const CORPORATE_SUFFIXES = new Set([
  'llc', 'inc', 'ltd', 'company', 'group', 'management', 'corp', 'corporation',
  'holdings', 'services', 'solutions', 'international', 'clinic', 'center',
]);

const ROLE_PATTERNS = [
  /\b(founder|co[- ]founder|owner|ceo|cto|cfo|coo|president|principal)\b/i,
  /\b(director|vice president|vp|head of|head|chief)\b/i,
  /\b(manager|partner|lead)\b/i,
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizePersonClusterKey(value: string): string {
  const lowered = normalizeWhitespace(value)
    .replace(/\b(dr|mr|mrs|ms|prof)\.?\s+/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .toLowerCase();
  const parts = lowered.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length < 2) return lowered;
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return `${first} ${last}`.trim();
}

function normalizeCompanyKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function titleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim();
}

function isLikelyPersonName(name: string): boolean {
  const normalized = normalizeWhitespace(name);
  if (normalized.length < 5 || normalized.length > 60) {
    return false;
  }

  const words = normalized.split(/\s+/);
  if (words.length < 2 || words.length > 4) {
    return false;
  }

  const lowerWords = words.map((word) => word.toLowerCase());
  if (lowerWords.some((word) => CORPORATE_SUFFIXES.has(word))) {
    return false;
  }

  return words.every((word) => /^[A-Z][A-Za-z'.-]{1,}$/.test(word));
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function isLinkedInProfileUrl(url: string): boolean {
  const domain = extractDomain(url);
  const path = pathOf(url);
  return Boolean(domain?.includes('linkedin.com') && path.startsWith('/in/'));
}

function determineSourceType(url: string, companyDomain?: string | null | undefined): ContactDiscoverySourceType {
  if (isLinkedInProfileUrl(url)) {
    return 'linkedin_profile';
  }

  const domain = extractDomain(url);
  const path = pathOf(url);
  const normalizedCompanyDomain = companyDomain?.toLowerCase() ?? null;
  const isCompanyDomain = Boolean(domain && normalizedCompanyDomain && domain.includes(normalizedCompanyDomain));

  if (isCompanyDomain && COMPANY_PAGE_PATH_PATTERNS.some((pattern) => path.includes(pattern))) {
    return 'company_team_page';
  }

  if (isCompanyDomain && ABOUT_PAGE_PATH_PATTERNS.some((pattern) => path.includes(pattern))) {
    return 'company_about_page';
  }

  if (PRESS_PAGE_PATH_PATTERNS.some((pattern) => path.includes(pattern))) {
    return 'press_page';
  }

  return 'public_profile';
}

function toSourceFamily(sourceType: ContactDiscoverySourceType): ContactDiscoverySourceFamily {
  switch (sourceType) {
    case 'linkedin_profile':
      return 'linkedin';
    case 'company_team_page':
    case 'company_about_page':
      return 'company_page';
    case 'press_page':
    case 'public_profile':
      return 'public_web';
  }
}

function parseLinkedInTitle(title: string): { name: string; title: string | null } {
  const cleaned = title.replace(/\s*[|–-]\s*LinkedIn\s*$/i, '').trim();
  const parts = cleaned.split(/\s*[|–-]\s*/).map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return {
      name: parts[0] ?? '',
      title: parts[1] ?? null,
    };
  }

  return { name: cleaned, title: null };
}

function extractNameFromText(text: string): string | null {
  const directMatch = text.match(/\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})\b/);
  if (!directMatch?.[1]) {
    return null;
  }

  const candidate = titleCaseName(directMatch[1].replace(/^(Meet|About|Team|Our)\s+/i, ''));
  return isLikelyPersonName(candidate) ? candidate : null;
}

function extractRoleFromText(text: string): string | null {
  const normalized = normalizeWhitespace(text);
  const matches = normalized.match(
    /\b(founder|co[- ]founder|owner|chief executive officer|ceo|cto|cfo|coo|president|principal|director|vice president|vp|head of [a-z ]+|head|manager|partner|lead)\b/gi,
  );

  if (!matches || matches.length === 0) {
    return null;
  }

  return titleCaseName(matches[0] ?? '');
}

function detectMatchedRoleKeyword(text: string): ContactDiscoveryRoleKeyword | null {
  const normalized = text.toLowerCase();
  if (normalized.includes('founder')) return 'founder';
  if (normalized.includes('ceo') || normalized.includes('chief executive officer')) return 'ceo';
  if (normalized.includes('owner')) return 'owner';
  return null;
}

function latestMentionedYear(text: string): number | null {
  const matches = [...text.matchAll(/\b(19|20)\d{2}\b/g)];
  if (matches.length === 0) return null;

  const currentYear = new Date().getFullYear();
  let latest: number | null = null;
  for (const match of matches) {
    const raw = match[0];
    if (!raw) continue;
    const year = Number.parseInt(raw, 10);
    if (!Number.isFinite(year) || year < 1990 || year > currentYear + 1) continue;
    if (latest === null || year > latest) latest = year;
  }
  return latest;
}

function sourceTypePriority(sourceType: ContactDiscoverySourceType): number {
  switch (sourceType) {
    case 'company_team_page':
      return 0;
    case 'company_about_page':
      return 1;
    case 'linkedin_profile':
      return 2;
    case 'press_page':
      return 3;
    case 'public_profile':
      return 4;
  }
}

function extractCandidateFromResult(
  result: GoogleSearchResult,
  input: {
    companyName: string;
    companyDomain?: string | null | undefined;
    expectedName?: string | null | undefined;
    locality?: string | null | undefined;
  },
): LinkedInProfileResult | null {
  const sourceType = determineSourceType(result.link, input.companyDomain);
  const combinedText = `${result.title} ${result.snippet}`.trim();
  const sourceDomain = extractDomain(result.link);

  const parsedLinkedIn = sourceType === 'linkedin_profile'
    ? parseLinkedInTitle(result.title)
    : null;

  const name = parsedLinkedIn?.name ?? extractNameFromText(result.title) ?? extractNameFromText(result.snippet);
  if (!name || !isLikelyPersonName(name)) {
    return null;
  }

  const title = parsedLinkedIn?.title ?? extractRoleFromText(combinedText);
  const matchedRoleKeyword = detectMatchedRoleKeyword(combinedText);
  const normalizedCompanyName = normalizeCompanyKey(input.companyName);
  const normalizedText = normalizeCompanyKey(combinedText);
  const normalizedExpectedName = input.expectedName ? normalizeName(input.expectedName) : null;
  const localityKey = input.locality ? normalizeCompanyKey(input.locality) : null;

  const matchSignals: string[] = [];
  let relevanceScore = 0.2;
  const latestYear = latestMentionedYear(combinedText);

  switch (sourceType) {
    case 'linkedin_profile':
      relevanceScore += 0.45;
      matchSignals.push('linkedin_profile');
      break;
    case 'company_team_page':
      relevanceScore += 0.35;
      matchSignals.push('company_page');
      break;
    case 'company_about_page':
      relevanceScore += 0.28;
      matchSignals.push('company_page');
      break;
    case 'press_page':
      relevanceScore += 0.16;
      matchSignals.push('press_page');
      break;
    case 'public_profile':
      relevanceScore += 0.1;
      matchSignals.push('public_profile');
      break;
  }

  if (normalizedExpectedName && normalizeName(name) === normalizedExpectedName) {
    relevanceScore += 0.22;
    matchSignals.push('name_match');
  }

  if (normalizedText.includes(normalizedCompanyName)) {
    relevanceScore += 0.18;
    matchSignals.push('company_match');
  } else if (input.companyDomain && sourceDomain?.includes(input.companyDomain.toLowerCase())) {
    relevanceScore += 0.16;
    matchSignals.push('company_domain_match');
  }

  if (localityKey && normalizedText.includes(localityKey)) {
    relevanceScore += 0.08;
    matchSignals.push('locality_match');
  }

  if (title && ROLE_PATTERNS.some((pattern) => pattern.test(title))) {
    relevanceScore += 0.12;
    matchSignals.push('senior_title');
  }

  if (matchedRoleKeyword) {
    relevanceScore += 0.1;
    matchSignals.push(`role_keyword:${matchedRoleKeyword}`);
  }

  const companyHint = normalizedText.includes(normalizedCompanyName)
    ? titleCaseName(input.companyName)
    : (input.companyDomain && sourceDomain?.includes(input.companyDomain.toLowerCase()) ? titleCaseName(input.companyName) : null);

  if (sourceType === 'public_profile' && !matchSignals.includes('company_match') && !matchSignals.includes('company_domain_match')) {
    return null;
  }

  if (
    !title
    && sourceType === 'public_profile'
    && !matchSignals.includes('name_match')
    && !matchSignals.includes('company_match')
  ) {
    return null;
  }

  if (
    sourceType === 'company_team_page'
    && (matchSignals.includes('company_match') || matchSignals.includes('company_domain_match'))
  ) {
    relevanceScore += 0.16;
    matchSignals.push('first_party_leadership');
  }

  if (
    sourceType === 'company_about_page'
    && (matchSignals.includes('company_match') || matchSignals.includes('company_domain_match'))
  ) {
    relevanceScore += 0.08;
    matchSignals.push('first_party_about');
  }

  if (latestYear !== null) {
    const currentYear = new Date().getFullYear();
    const age = Math.max(0, currentYear - latestYear);
    if (age <= 1) {
      relevanceScore += 0.04;
      matchSignals.push('fresh_content');
    } else if (age >= 5) {
      const penalty = Math.min(0.14, 0.02 * (age - 4));
      relevanceScore -= penalty;
      matchSignals.push('stale_content');
    }
  }

  return {
    name,
    title,
    linkedinUrl: sourceType === 'linkedin_profile' ? result.link : null,
    matchedRoleKeyword,
    sourceType,
    sourceUrl: result.link,
    sourceDomain,
    companyHint,
    matchSignals,
    relevanceScore: Math.min(1, Number(relevanceScore.toFixed(3))),
    repeatCount: 1,
  };
}

function mergeCandidates(
  existing: LinkedInProfileResult[],
  incoming: LinkedInProfileResult[],
): LinkedInProfileResult[] {
  const clustered = new Map<string, LinkedInProfileResult>();

  for (const candidate of [...existing, ...incoming]) {
    const key = normalizePersonClusterKey(candidate.name);
    const current = clustered.get(key);
    if (!current) {
      clustered.set(key, { ...candidate, repeatCount: Math.max(1, candidate.repeatCount) });
      continue;
    }

    const currentPriority = sourceTypePriority(current.sourceType);
    const nextPriority = sourceTypePriority(candidate.sourceType);
    const preferNext = candidate.relevanceScore > current.relevanceScore
      || (candidate.relevanceScore === current.relevanceScore && nextPriority < currentPriority)
      || (
        candidate.relevanceScore === current.relevanceScore
        && nextPriority === currentPriority
        && candidate.name.length > current.name.length
      );

    const mergedSignals = [...new Set([...current.matchSignals, ...candidate.matchSignals])];
    const merged: LinkedInProfileResult = {
      ...(preferNext ? candidate : current),
      repeatCount: current.repeatCount + 1,
      matchSignals: mergedSignals,
      relevanceScore: Math.max(current.relevanceScore, candidate.relevanceScore),
      linkedinUrl: (preferNext ? candidate.linkedinUrl : current.linkedinUrl) ?? current.linkedinUrl ?? candidate.linkedinUrl,
      sourceUrl: preferNext ? candidate.sourceUrl : current.sourceUrl,
    };

    clustered.set(key, merged);
  }

  return [...clustered.values()]
    .map((candidate) => {
      const repeatedBoost = candidate.repeatCount > 1
        ? Math.min(0.2, (candidate.repeatCount - 1) * 0.06)
        : 0;
      return {
        ...candidate,
        relevanceScore: Math.min(1, Number((candidate.relevanceScore + repeatedBoost).toFixed(3))),
      };
    })
    .sort((left, right) => {
      const scoreDiff = right.relevanceScore - left.relevanceScore;
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
      if (right.repeatCount !== left.repeatCount) return right.repeatCount - left.repeatCount;
      const sourceDiff = sourceTypePriority(left.sourceType) - sourceTypePriority(right.sourceType);
      if (sourceDiff !== 0) return sourceDiff;
      return normalizeName(left.name).localeCompare(normalizeName(right.name));
    })
    .slice(0, 10);
}

function buildTopSourceFamily(candidates: LinkedInProfileResult[]): ContactDiscoverySourceFamily {
  if (candidates.length === 0) {
    return 'unknown';
  }

  const counts = new Map<ContactDiscoverySourceFamily, number>();
  for (const candidate of candidates) {
    const family = toSourceFamily(candidate.sourceType);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  if (ranked.length > 1 && ranked[0]?.[1] === ranked[1]?.[1]) {
    return 'mixed';
  }

  return ranked[0]?.[0] ?? 'unknown';
}

interface QueryStep {
  stage: DecisionMakerSearchStage;
  sourceFamily: ContactDiscoverySourceFamily;
  queryFamily: ContactDiscoveryQueryFamily;
  query: string;
}

function buildDiscoverQuery(input: {
  companyName: string;
  cityOrCountry?: string | null | undefined;
}): QueryStep[] {
  const locality = input.cityOrCountry?.trim() ?? '';

  return [
    {
      stage: 'DISCOVER',
      sourceFamily: 'public_web',
      queryFamily: 'DISCOVER_ROLES',
      query: `"${input.companyName}" ${locality} founder OR CEO OR owner`.replace(/\s+/g, ' ').trim(),
    },
  ];
}

function determineDiagnosticVerdict(
  promoted: LinkedInProfileResult[],
  context: { expectedName?: string | null | undefined },
): 'verified' | 'not_verified' | 'inconclusive' | 'skipped' {
  void context;
  return promoted.length > 0 ? 'verified' : 'not_verified';
}

function buildTopQueryFamily(diagnostics: ContactDiscoveryDiagnostic[]): ContactDiscoveryQueryFamily | null {
  if (diagnostics.length === 0) {
    return null;
  }

  const scores = new Map<ContactDiscoveryQueryFamily, number>();
  for (const diagnostic of diagnostics) {
    const score = diagnostic.promotedCount * 10 + diagnostic.rawResultCount;
    scores.set(diagnostic.queryFamily, (scores.get(diagnostic.queryFamily) ?? 0) + score);
  }

  let bestFamily: ContactDiscoveryQueryFamily | null = null;
  let bestScore = -1;
  for (const [family, score] of scores.entries()) {
    if (score > bestScore) {
      bestFamily = family;
      bestScore = score;
    }
  }

  return bestFamily;
}

export class LinkedInSearchAdapter {
  private readonly search: WebSearchAdapter;

  constructor(config: LinkedInSearchConfig) {
    this.search = config.searchAdapter;
  }

  get isConfigured(): boolean {
    return this.search.isConfigured;
  }

  async discoverDecisionMaker(
    input: {
      companyName: string;
      companyDomain?: string | null | undefined;
      cityOrCountry?: string | null | undefined;
      maxResults?: number | undefined;
    },
  ): Promise<LinkedInSearchResponse> {
    return this.runQueryPipeline(
      buildDiscoverQuery(input),
      {
        companyName: input.companyName,
        companyDomain: input.companyDomain,
        locality: input.cityOrCountry,
      },
      input.maxResults ?? 5,
    );
  }

  private async runQueryPipeline(
    queries: QueryStep[],
    context: {
      companyName: string;
      companyDomain?: string | null | undefined;
      expectedName?: string | null | undefined;
      locality?: string | null | undefined;
    },
    maxResults: number,
  ): Promise<LinkedInSearchResponse> {
    const diagnostics: ContactDiscoveryDiagnostic[] = [];
    let candidates: LinkedInProfileResult[] = [];

    for (const step of queries) {
      const result: GoogleCustomSearchResponse = await this.search.search(step.query, Math.min(maxResults, 10));
      if (result.status !== 'success') {
        if (diagnostics.length === 0) {
          return {
            status: result.status,
            failure: result.failure,
          };
        }
        break;
      }

      const promoted = result.data
        .map((item) => extractCandidateFromResult(item, context))
        .filter((candidate): candidate is LinkedInProfileResult => candidate !== null)
        .filter((candidate) => candidate.relevanceScore >= 0.48);

      diagnostics.push({
        stage: step.stage,
        query: step.query,
        sourceFamily: step.sourceFamily,
        queryFamily: step.queryFamily,
        rawResultCount: result.data.length,
        promotedCount: promoted.length,
        verdict: determineDiagnosticVerdict(promoted, context),
      });

      candidates = mergeCandidates(candidates, promoted);
    }

    return {
      status: 'success',
      data: candidates.slice(0, maxResults),
      diagnostics,
      topSourceFamily: buildTopSourceFamily(candidates),
      topQueryFamily: buildTopQueryFamily(diagnostics),
    };
  }
}

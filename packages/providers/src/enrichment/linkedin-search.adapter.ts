// ── Contact Discovery Search Adapter (Google Custom Search) ──────────
// Uses Google Custom Search JSON API across LinkedIn, company pages, press,
// and broader public web to verify and discover decision-makers.

import type { GoogleCustomSearchAdapter, GoogleCustomSearchResponse, GoogleSearchResult } from './google-custom-search.adapter.js';

export interface LinkedInSearchConfig {
  searchAdapter: GoogleCustomSearchAdapter;
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
  | 'V1_linkedin_exact'
  | 'V2_company_domain_exact'
  | 'V3_public_web_exact'
  | 'V4_exact_without_title'
  | 'D1_linkedin_roles'
  | 'D2_company_team_pages'
  | 'D3_company_about_pages'
  | 'D4_press_news_mentions'
  | 'D5_public_web_role_queries'
  | 'D6_locality_first_queries';

export interface LinkedInProfileResult {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  sourceType: ContactDiscoverySourceType;
  sourceUrl: string;
  sourceDomain: string | null;
  companyHint: string | null;
  matchSignals: string[];
  relevanceScore: number;
}

export type DecisionMakerSearchStage =
  | 'VERIFY_V1_PEOPLE_WEB'
  | 'DISCOVER_D1_PEOPLE_WEB'
  | 'DISCOVER_D2_COMPANY_PAGES'
  | 'DISCOVER_D3_PUBLIC_WEB';

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
  const normalizedCompanyName = normalizeCompanyKey(input.companyName);
  const normalizedText = normalizeCompanyKey(combinedText);
  const normalizedExpectedName = input.expectedName ? normalizeName(input.expectedName) : null;
  const localityKey = input.locality ? normalizeCompanyKey(input.locality) : null;

  const matchSignals: string[] = [];
  let relevanceScore = 0.2;

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

  const companyHint = normalizedText.includes(normalizedCompanyName)
    ? titleCaseName(input.companyName)
    : (input.companyDomain && sourceDomain?.includes(input.companyDomain.toLowerCase()) ? titleCaseName(input.companyName) : null);

  if (sourceType === 'public_profile' && !matchSignals.includes('company_match') && !matchSignals.includes('company_domain_match')) {
    return null;
  }

  if (!title && sourceType === 'public_profile' && !matchSignals.includes('name_match')) {
    return null;
  }

  return {
    name,
    title,
    linkedinUrl: sourceType === 'linkedin_profile' ? result.link : null,
    sourceType,
    sourceUrl: result.link,
    sourceDomain,
    companyHint,
    matchSignals,
    relevanceScore: Math.min(1, Number(relevanceScore.toFixed(3))),
  };
}

function mergeCandidates(
  existing: LinkedInProfileResult[],
  incoming: LinkedInProfileResult[],
): LinkedInProfileResult[] {
  const bestByName = new Map<string, LinkedInProfileResult>();

  for (const candidate of [...existing, ...incoming]) {
    const key = normalizeName(candidate.name);
    const current = bestByName.get(key);
    if (!current || candidate.relevanceScore > current.relevanceScore) {
      bestByName.set(key, candidate);
    }
  }

  return [...bestByName.values()]
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
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

function buildVerifyQueries(input: {
  name: string;
  companyName: string;
  companyDomain?: string | null | undefined;
  cityOrCountry?: string | null | undefined;
  titleOrFunction?: string | null | undefined;
}): QueryStep[] {
  const locality = input.cityOrCountry?.trim() ? `"${input.cityOrCountry.trim()}"` : '';
  const exactRoleClause = input.titleOrFunction?.trim()
    ? `"${input.titleOrFunction.trim()}"`
    : '(founder OR owner OR ceo OR director OR head)';
  const queries: QueryStep[] = [
    {
      stage: 'VERIFY_V1_PEOPLE_WEB',
      sourceFamily: 'linkedin',
      queryFamily: 'V1_linkedin_exact',
      query: `"${input.name}" "${input.companyName}" ${locality} site:linkedin.com/in ${exactRoleClause}`.trim(),
    },
  ];

  if (input.companyDomain) {
    queries.push({
      stage: 'VERIFY_V1_PEOPLE_WEB',
      sourceFamily: 'company_page',
      queryFamily: 'V2_company_domain_exact',
      query: `"${input.name}" "${input.companyName}" site:${input.companyDomain} (${exactRoleClause} OR team OR leadership OR about)`.trim(),
    });
  }

  queries.push({
    stage: 'VERIFY_V1_PEOPLE_WEB',
    sourceFamily: 'public_web',
    queryFamily: 'V3_public_web_exact',
    query: `"${input.name}" "${input.companyName}" ${locality} (${exactRoleClause} OR bio OR profile OR interview)`.trim(),
  });

  queries.push({
    stage: 'VERIFY_V1_PEOPLE_WEB',
    sourceFamily: 'public_web',
    queryFamily: 'V4_exact_without_title',
    query: `"${input.name}" "${input.companyName}" ${locality} (profile OR biography OR leadership OR team)`.trim(),
  });

  return queries;
}

function buildDiscoverQueries(input: {
  companyName: string;
  companyDomain?: string | null | undefined;
  cityOrCountry?: string | null | undefined;
}): QueryStep[] {
  const locality = input.cityOrCountry?.trim() ? `"${input.cityOrCountry.trim()}"` : '';
  const companyQuoted = `"${input.companyName}"`;
  const queries: QueryStep[] = [
    {
      stage: 'DISCOVER_D1_PEOPLE_WEB',
      sourceFamily: 'linkedin',
      queryFamily: 'D1_linkedin_roles',
      query: `${companyQuoted} ${locality} site:linkedin.com/in (founder OR owner OR ceo OR director OR head OR leadership OR managing director OR medical director OR clinic manager OR salon owner)`.trim(),
    },
  ];

  if (input.companyDomain) {
    queries.push({
      stage: 'DISCOVER_D2_COMPANY_PAGES',
      sourceFamily: 'company_page',
      queryFamily: 'D2_company_team_pages',
      query: `site:${input.companyDomain} (${companyQuoted} OR "/team" OR "/our-team" OR "/leadership" OR "/staff" OR founder OR owner OR ceo OR director OR management)`.trim(),
    });
    queries.push({
      stage: 'DISCOVER_D2_COMPANY_PAGES',
      sourceFamily: 'company_page',
      queryFamily: 'D3_company_about_pages',
      query: `site:${input.companyDomain} (${companyQuoted} OR "/about" OR "/about-us" OR founder OR owner OR ceo OR director OR medical director)`.trim(),
    });
  }

  queries.push({
    stage: 'DISCOVER_D3_PUBLIC_WEB',
    sourceFamily: 'public_web',
    queryFamily: 'D4_press_news_mentions',
    query: `${companyQuoted} ${locality} (press OR news OR interview OR announced OR leadership OR founder OR owner OR ceo OR director)`.trim(),
  });

  queries.push({
    stage: 'DISCOVER_D3_PUBLIC_WEB',
    sourceFamily: 'public_web',
    queryFamily: 'D5_public_web_role_queries',
    query: `${companyQuoted} ${locality} (founder OR owner OR ceo OR director OR managing director OR medical director OR clinic manager OR salon owner)`.trim(),
  });

  queries.push({
    stage: 'DISCOVER_D3_PUBLIC_WEB',
    sourceFamily: 'public_web',
    queryFamily: 'D6_locality_first_queries',
    query: `${locality} ${companyQuoted} (founder OR owner OR ceo OR director OR management OR leadership)`.trim(),
  });

  return queries;
}

function determineDiagnosticVerdict(
  promoted: LinkedInProfileResult[],
  context: { expectedName?: string | null | undefined },
): 'verified' | 'not_verified' | 'inconclusive' | 'skipped' {
  if (promoted.length === 0) {
    return context.expectedName ? 'not_verified' : 'inconclusive';
  }

  if (!context.expectedName) {
    return 'verified';
  }

  const expected = normalizeName(context.expectedName);
  return promoted.some((candidate) => normalizeName(candidate.name) === expected)
    ? 'verified'
    : 'not_verified';
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
  private readonly search: GoogleCustomSearchAdapter;

  constructor(config: LinkedInSearchConfig) {
    this.search = config.searchAdapter;
  }

  get isConfigured(): boolean {
    return this.search.isConfigured;
  }

  async searchPersonVerification(input: {
    name: string;
    companyName: string;
    companyDomain?: string | null | undefined;
    cityOrCountry?: string | null | undefined;
    titleOrFunction?: string | null | undefined;
    maxResults?: number | undefined;
  }): Promise<LinkedInSearchResponse> {
    return this.runQueryPipeline(
      buildVerifyQueries(input),
      {
        companyName: input.companyName,
        companyDomain: input.companyDomain,
        expectedName: input.name,
        locality: input.cityOrCountry,
      },
      input.maxResults ?? 5,
    );
  }

  async searchCompanyPeople(
    input: {
      companyName: string;
      companyDomain?: string | null | undefined;
      cityOrCountry?: string | null | undefined;
      maxResults?: number | undefined;
    },
  ): Promise<LinkedInSearchResponse> {
    return this.runQueryPipeline(
      buildDiscoverQueries(input),
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
        .filter((candidate) => candidate.relevanceScore >= 0.55);

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

// ── LinkedIn Search Adapter (Google Custom Search) ───────────────────
// Uses Google Custom Search JSON API for both broad people discovery
// and LinkedIn profile verification.
// Recovery mode: finds contacts for qualified companies with no usable personal contact.
// Verification mode: corroborates name/title/company/socials for already-found contacts.

import type { GoogleCustomSearchAdapter, GoogleCustomSearchResponse } from './google-custom-search.adapter.js';

export interface LinkedInSearchConfig {
  searchAdapter: GoogleCustomSearchAdapter;
}

export interface LinkedInProfileResult {
  name: string;
  title: string | null;
  linkedinUrl: string;
}

export type DecisionMakerSearchStage =
  | 'VERIFY_V1_PEOPLE_WEB'
  | 'VERIFY_V2_LINKEDIN'
  | 'DISCOVER_D1_PEOPLE_WEB'
  | 'DISCOVER_D2_LINKEDIN';

export interface LinkedInSearchFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export type LinkedInSearchResponse =
  | { status: 'success'; data: LinkedInProfileResult[]; query: string; stage: DecisionMakerSearchStage }
  | { status: 'retryable_error'; failure: LinkedInSearchFailure }
  | { status: 'terminal_error'; failure: LinkedInSearchFailure };

/**
 * Parse a LinkedIn search result title to extract person name and title.
 * LinkedIn titles are typically: "John Smith - CEO - Company | LinkedIn"
 * or "John Smith – Sales Director – Acme Corp | LinkedIn"
 */
function parseLinkedInTitle(title: string): { name: string; title: string | null } {
  // Remove " | LinkedIn" or " - LinkedIn" suffix
  const cleaned = title.replace(/\s*[|–-]\s*LinkedIn\s*$/i, '').trim();

  // Split on " - " or " – " (em dash)
  const parts = cleaned.split(/\s*[–-]\s*/);

  if (parts.length >= 2) {
    return {
      name: parts[0]?.trim() ?? '',
      title: parts[1]?.trim() ?? null,
    };
  }

  return { name: cleaned, title: null };
}

/**
 * Filter results to only valid LinkedIn profile URLs (/in/ path).
 */
function isLinkedInProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes('linkedin.com') &&
      parsed.pathname.startsWith('/in/')
    );
  } catch {
    return false;
  }
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
    cityOrCountry?: string | null | undefined;
    titleOrFunction?: string | null | undefined;
    maxResults?: number | undefined;
  }): Promise<LinkedInSearchResponse> {
    const locality = input.cityOrCountry?.trim() ? `"${input.cityOrCountry.trim()}"` : '';
    const queryV1 = `"${input.name}" "${input.companyName}" ${locality} (founder OR ceo OR cmo OR head OR director OR leadership OR team)`.trim();
    const v1 = await this.searchViaGoogle(queryV1, 'VERIFY_V1_PEOPLE_WEB', input.maxResults ?? 5);
    if (v1.status !== 'success') return v1;

    const title = input.titleOrFunction?.trim() ? `"${input.titleOrFunction.trim()}"` : '';
    const queryV2 = `site:linkedin.com/in "${input.name}" "${input.companyName}" ${title}`.trim();
    const v2 = await this.searchViaGoogle(queryV2, 'VERIFY_V2_LINKEDIN', input.maxResults ?? 5);
    if (v2.status === 'success') {
      return {
        ...v2,
        data: this.mergeProfiles(v1.data, v2.data),
      };
    }
    return {
      status: 'success',
      data: v1.data,
      query: queryV1,
      stage: 'VERIFY_V1_PEOPLE_WEB',
    };
  }

  async searchCompanyPeople(
    companyName: string,
    cityOrCountry?: string | null | undefined,
    maxResults = 3,
  ): Promise<LinkedInSearchResponse> {
    const locality = cityOrCountry?.trim() ? `"${cityOrCountry.trim()}"` : '';
    const queryD1 = `"${companyName}" ${locality} (team OR leadership OR c-suite OR management OR executives OR about us)`.trim();
    const d1 = await this.searchViaGoogle(queryD1, 'DISCOVER_D1_PEOPLE_WEB', maxResults);
    if (d1.status !== 'success') return d1;

    const queryD2 = `site:linkedin.com/in "${companyName}" ("ceo" OR "founder" OR "head of" OR "director")`;
    const d2 = await this.searchViaGoogle(queryD2, 'DISCOVER_D2_LINKEDIN', maxResults);
    if (d2.status === 'success') {
      return {
        ...d2,
        data: this.mergeProfiles(d1.data, d2.data),
      };
    }
    return {
      status: 'success',
      data: d1.data,
      query: queryD1,
      stage: 'DISCOVER_D1_PEOPLE_WEB',
    };
  }

  private async searchViaGoogle(
    query: string,
    stage: DecisionMakerSearchStage,
    maxResults: number,
  ): Promise<LinkedInSearchResponse> {
    const result: GoogleCustomSearchResponse = await this.search.search(query, Math.min(maxResults, 10));

    if (result.status !== 'success') {
      return {
        status: result.status,
        failure: result.failure,
      };
    }

    const profiles = result.data
      .filter((item) => isLinkedInProfileUrl(item.link))
      .slice(0, maxResults)
      .map((item) => {
        const parsed = parseLinkedInTitle(item.title);
        return {
          name: parsed.name,
          title: parsed.title ?? (item.snippet ? item.snippet.split(/[.–-]/).at(0)?.trim() ?? null : null),
          linkedinUrl: item.link,
        };
      })
      .filter((r) => r.name.length > 0);

    return {
      status: 'success',
      data: profiles,
      query,
      stage,
    };
  }

  private mergeProfiles(
    first: LinkedInProfileResult[],
    second: LinkedInProfileResult[],
  ): LinkedInProfileResult[] {
    const merged = [...first];
    for (const item of second) {
      const key = item.linkedinUrl.toLowerCase();
      if (!merged.some((m) => m.linkedinUrl.toLowerCase() === key)) {
        merged.push(item);
      }
    }
    return merged;
  }
}

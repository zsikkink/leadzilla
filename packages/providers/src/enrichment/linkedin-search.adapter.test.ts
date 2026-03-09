import { describe, expect, it, vi } from 'vitest';

import { LinkedInSearchAdapter } from './linkedin-search.adapter.js';

describe('LinkedInSearchAdapter', () => {
  it('uses a single discover query and classifies decision-maker results', async () => {
    const search = vi.fn().mockResolvedValue({
      status: 'success',
      data: [
        {
          title: 'Jane Doe - CEO - Atlas Clinic | LinkedIn',
          snippet: 'Jane Doe CEO at Atlas Clinic in Amman',
          link: 'https://www.linkedin.com/in/jane-doe',
        },
      ],
    });

    const adapter = new LinkedInSearchAdapter({
      searchAdapter: {
        isConfigured: true,
        search,
      },
    });

    const result = await adapter.discoverDecisionMaker({
      companyName: 'Atlas Clinic',
      companyDomain: 'atlasclinic.example',
      cityOrCountry: 'Amman, JO',
      maxResults: 5,
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('"Atlas Clinic" Amman, JO founder OR CEO OR owner', 5);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.data[0]).toMatchObject({
      name: 'Jane Doe',
      sourceType: 'linkedin_profile',
      matchedRoleKeyword: 'ceo',
      repeatCount: 1,
    });
    expect(result.topQueryFamily).toBe('DISCOVER_ROLES');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        stage: 'DISCOVER',
        queryFamily: 'DISCOVER_ROLES',
        rawResultCount: 1,
        promotedCount: 1,
        verdict: 'verified',
      }),
    ]);
  });

  it('filters weak public-web noise without company alignment', async () => {
    const search = vi.fn().mockResolvedValue({
      status: 'success',
      data: [
        {
          title: 'John Smith - Marketing Coach',
          snippet: 'John Smith writes about growth systems.',
          link: 'https://example-blog.test/john-smith',
        },
      ],
    });

    const adapter = new LinkedInSearchAdapter({
      searchAdapter: {
        isConfigured: true,
        search,
      },
    });

    const result = await adapter.discoverDecisionMaker({
      companyName: 'Atlas Clinic',
      companyDomain: 'atlasclinic.example',
      cityOrCountry: 'Amman, JO',
      maxResults: 5,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.data).toHaveLength(0);
    expect(result.diagnostics[0]).toMatchObject({
      queryFamily: 'DISCOVER_ROLES',
      promotedCount: 0,
      verdict: 'not_verified',
    });
  });

  it('clusters repeated person variants and boosts repeated-presence confidence', async () => {
    const search = vi.fn().mockResolvedValue({
      status: 'success',
      data: [
        {
          title: 'Dr. John Smith - Founder - Atlas Clinic',
          snippet: 'Dr. John Smith leads Atlas Clinic in Amman',
          link: 'https://atlasclinic.example/team/dr-john-smith',
        },
        {
          title: 'John A. Smith | LinkedIn',
          snippet: 'Founder at Atlas Clinic',
          link: 'https://linkedin.com/in/john-smith',
        },
      ],
    });

    const adapter = new LinkedInSearchAdapter({
      searchAdapter: {
        isConfigured: true,
        search,
      },
    });

    const result = await adapter.discoverDecisionMaker({
      companyName: 'Atlas Clinic',
      companyDomain: 'atlasclinic.example',
      cityOrCountry: 'Amman, JO',
      maxResults: 5,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      repeatCount: 2,
      sourceType: 'company_team_page',
    });
    expect(result.data[0]!.relevanceScore).toBeGreaterThan(0.7);
  });

  it('prefers first-party leadership pages over weaker stale public profiles in ties', async () => {
    const search = vi.fn().mockResolvedValue({
      status: 'success',
      data: [
        {
          title: 'Jane Malik - Leadership Team',
          snippet: 'Jane Malik leads Atlas Clinic operations in Amman.',
          link: 'https://atlasclinic.example/leadership/jane-malik',
        },
        {
          title: 'Jane Malik profile',
          snippet: 'Jane Malik mentioned in 2012 public listing',
          link: 'https://directory.example/jane-malik',
        },
      ],
    });

    const adapter = new LinkedInSearchAdapter({
      searchAdapter: {
        isConfigured: true,
        search,
      },
    });

    const result = await adapter.discoverDecisionMaker({
      companyName: 'Atlas Clinic',
      companyDomain: 'atlasclinic.example',
      cityOrCountry: 'Amman, JO',
      maxResults: 5,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.data[0]).toMatchObject({
      sourceType: 'company_team_page',
    });
  });

  it('returns adapter failures unchanged', async () => {
    const adapter = new LinkedInSearchAdapter({
      searchAdapter: {
        isConfigured: true,
        search: vi.fn().mockResolvedValue({
          status: 'terminal_error',
          failure: {
            classification: 'terminal',
            statusCode: 402,
            message: 'SerpAPI credits exhausted',
            raw: null,
          },
        }),
      },
    });

    const result = await adapter.discoverDecisionMaker({
      companyName: 'Atlas Clinic',
      cityOrCountry: 'Amman, JO',
    });

    expect(result).toEqual({
      status: 'terminal_error',
      failure: {
        classification: 'terminal',
        statusCode: 402,
        message: 'SerpAPI credits exhausted',
        raw: null,
      },
    });
  });
});

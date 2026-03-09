import { describe, expect, it, vi } from 'vitest';

import { LinkedInSearchAdapter } from './linkedin-search.adapter.js';

describe('LinkedInSearchAdapter', () => {
  it('prefers exact person/company verification matches on LinkedIn', async () => {
    const search = vi.fn().mockResolvedValue({
      status: 'success',
      data: [
        {
          title: 'Jane Doe - CEO - Atlas Clinic | LinkedIn',
          snippet: 'Jane Doe CEO at Atlas Clinic in Amman',
          link: 'https://www.linkedin.com/in/jane-doe',
        },
        {
          title: 'Atlas Clinic Leadership',
          snippet: 'Meet the Atlas Clinic team',
          link: 'https://atlasclinic.example/team',
        },
      ],
    });

    const adapter = new LinkedInSearchAdapter({
      searchAdapter: {
        isConfigured: true,
        search,
      } as never,
    });

    const result = await adapter.searchPersonVerification({
      name: 'Jane Doe',
      companyName: 'Atlas Clinic',
      companyDomain: 'atlasclinic.example',
      cityOrCountry: 'Amman, JO',
      maxResults: 3,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.data[0]).toMatchObject({
      name: 'Jane Doe',
      sourceType: 'linkedin_profile',
    });
    expect(result.topSourceFamily).toBe('linkedin');
    expect(result.topQueryFamily).toBe('V1_linkedin_exact');
    expect(result.diagnostics.some((item) => item.queryFamily === 'V1_linkedin_exact')).toBe(true);
  });

  it('falls back to company pages when LinkedIn discovery is empty', async () => {
    const search = vi
      .fn()
      .mockResolvedValue({
        status: 'success',
        data: [],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: [],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: [
          {
            title: 'Meet Sarah Malik, Founder of Atlas Clinic',
            snippet: 'Sarah Malik leads Atlas Clinic in Amman.',
            link: 'https://atlasclinic.example/team/sarah-malik',
          },
        ],
      });

    const adapter = new LinkedInSearchAdapter({
      searchAdapter: {
        isConfigured: true,
        search,
      } as never,
    });

    const result = await adapter.searchCompanyPeople({
      companyName: 'Atlas Clinic',
      companyDomain: 'atlasclinic.example',
      cityOrCountry: 'Amman, JO',
      maxResults: 5,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.data[0]).toMatchObject({
      name: 'Sarah Malik',
      sourceType: 'company_team_page',
    });
    expect(result.topSourceFamily).toBe('company_page');
    expect(result.diagnostics.some((item) => item.queryFamily === 'D2_company_team_pages')).toBe(true);
  });

  it('filters weak public web noise when company alignment is missing', async () => {
    const search = vi
      .fn()
      .mockResolvedValue({
        status: 'success',
        data: [],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: [],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: [],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: [
          {
            title: 'John Smith - Marketing Coach',
            snippet: 'John Smith writes about marketing systems.',
            link: 'https://example-blog.test/john-smith',
          },
        ],
      });

    const adapter = new LinkedInSearchAdapter({
      searchAdapter: {
        isConfigured: true,
        search,
      } as never,
    });

    const result = await adapter.searchCompanyPeople({
      companyName: 'Atlas Clinic',
      companyDomain: 'atlasclinic.example',
      cityOrCountry: 'Amman, JO',
      maxResults: 5,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.data).toHaveLength(0);
    expect(result.diagnostics.at(-1)?.queryFamily).toBe('D6_locality_first_queries');
  });

  it('records every query family for live evaluation instead of stopping early', async () => {
    const search = vi.fn().mockResolvedValue({
      status: 'success',
      data: [
        {
          title: 'Amina Noor - Founder - Atlas Clinic | LinkedIn',
          snippet: 'Founder at Atlas Clinic in Amman',
          link: 'https://www.linkedin.com/in/amina-noor',
        },
      ],
    });

    const adapter = new LinkedInSearchAdapter({
      searchAdapter: {
        isConfigured: true,
        search,
      } as never,
    });

    const result = await adapter.searchCompanyPeople({
      companyName: 'Atlas Clinic',
      companyDomain: 'atlasclinic.example',
      cityOrCountry: 'Amman, JO',
      maxResults: 5,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(search).toHaveBeenCalledTimes(6);
    expect(result.diagnostics.map((item) => item.queryFamily)).toEqual([
      'D1_linkedin_roles',
      'D2_company_team_pages',
      'D3_company_about_pages',
      'D4_press_news_mentions',
      'D5_public_web_role_queries',
      'D6_locality_first_queries',
    ]);
  });
});

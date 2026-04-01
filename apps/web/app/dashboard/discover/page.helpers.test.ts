import { describe, expect, it } from 'vitest';

import {
  buildSingleIcpDiscoveryRequest,
  getNextSelectedIcpId,
} from './page.helpers.js';

describe('discover page helpers', () => {
  it('keeps ICP selection single-choice', () => {
    expect(getNextSelectedIcpId(null, 'icp_1')).toBe('icp_1');
    expect(getNextSelectedIcpId('icp_1', 'icp_2')).toBe('icp_2');
    expect(getNextSelectedIcpId('icp_2', 'icp_2')).toBeNull();
  });

  it('builds a single-ICP discovery request payload', () => {
    expect(
      buildSingleIcpDiscoveryRequest({
        selectedIcpId: 'icp_1',
        countries: ['AE'],
        cities: ['Dubai'],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: false,
        limit: 25,
        requestedByUserId: 'user_1',
      }),
    ).toEqual({
      icpProfileIds: ['icp_1'],
      countries: ['AE'],
      cities: ['Dubai'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: false,
      limit: 25,
      requestedByUserId: 'user_1',
    });
  });

  it('refuses to build a request without exactly one selectable ICP and country set', () => {
    expect(
      buildSingleIcpDiscoveryRequest({
        selectedIcpId: null,
        countries: ['AE'],
        cities: [],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        limit: 25,
      }),
    ).toBeNull();

    expect(
      buildSingleIcpDiscoveryRequest({
        selectedIcpId: 'icp_1',
        countries: [],
        cities: [],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        limit: 25,
      }),
    ).toBeNull();
  });
});

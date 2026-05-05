import { describe, expect, it } from 'vitest';

import {
  buildDiscoveryRequest,
  getNextSelectedIcpId,
} from './page.helpers.js';

describe('discover page helpers', () => {
  it('toggles ICP selection for multi-select', () => {
    expect(getNextSelectedIcpId([], 'icp_1')).toEqual(['icp_1']);
    expect(getNextSelectedIcpId(['icp_1'], 'icp_2')).toEqual(['icp_1', 'icp_2']);
    expect(getNextSelectedIcpId(['icp_1', 'icp_2'], 'icp_2')).toEqual(['icp_1']);
  });

  it('builds a multi-ICP discovery request payload', () => {
    expect(
      buildDiscoveryRequest({
        selectedIcpIds: ['icp_1', 'icp_2'],
        countries: ['AE'],
        cities: ['Dubai'],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: false,
        searchTaskLimit: 25,
        requestedByUserId: 'user_1',
      }),
    ).toEqual({
      icpProfileIds: ['icp_1', 'icp_2'],
      countries: ['AE'],
      cities: ['Dubai'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: false,
      limit: 25,
      requestedByUserId: 'user_1',
    });
  });

  it('refuses to build a request without ICPs and country set', () => {
    expect(
      buildDiscoveryRequest({
        selectedIcpIds: [],
        countries: ['AE'],
        cities: [],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        searchTaskLimit: 25,
      }),
    ).toBeNull();

    expect(
      buildDiscoveryRequest({
        selectedIcpIds: ['icp_1'],
        countries: [],
        cities: [],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        searchTaskLimit: 25,
      }),
    ).toBeNull();
  });
});

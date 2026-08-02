import { describe, expect, it } from 'vitest';

import {
  buildDiscoveryRequest,
  getNextSelectedIcpId,
  isPublicDemoSearchTaskLimit,
  shouldShowDiscoveryRun,
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
        searchTaskLimit: 5,
        requestedByUserId: 'user_1',
      }),
    ).toEqual({
      icpProfileIds: ['icp_1', 'icp_2'],
      countries: ['AE'],
      cities: ['Dubai'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: false,
      limit: 5,
      requestedByUserId: 'user_1',
    });
  });

  it('accepts only the fixed public demo task budget of five', () => {
    expect(isPublicDemoSearchTaskLimit(5)).toBe(true);
    expect(isPublicDemoSearchTaskLimit(1)).toBe(false);
    expect(isPublicDemoSearchTaskLimit(4)).toBe(false);
    expect(isPublicDemoSearchTaskLimit(0)).toBe(false);
    expect(isPublicDemoSearchTaskLimit(6)).toBe(false);
    expect(isPublicDemoSearchTaskLimit(1.5)).toBe(false);
  });

  it('shows active runs and completed runs with processed output', () => {
    expect(shouldShowDiscoveryRun('QUEUED', 0, 5)).toBe(true);
    expect(shouldShowDiscoveryRun('RUNNING', 0, 5)).toBe(true);
    expect(shouldShowDiscoveryRun('SUCCEEDED', 10, 5)).toBe(true);
    expect(shouldShowDiscoveryRun('SUCCEEDED', 10, 5, true)).toBe(false);
    expect(shouldShowDiscoveryRun('SUCCEEDED', 0, 5)).toBe(false);
    expect(shouldShowDiscoveryRun('SUCCEEDED', 100, 25)).toBe(false);
    expect(shouldShowDiscoveryRun('PARTIAL', 8, 5)).toBe(false);
    expect(shouldShowDiscoveryRun('FAILED', 0, 5)).toBe(false);
  });

  it('refuses to build a request without ICPs and country set', () => {
    expect(
      buildDiscoveryRequest({
        selectedIcpIds: [],
        countries: ['AE'],
        cities: [],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        searchTaskLimit: 5,
      }),
    ).toBeNull();

    expect(
      buildDiscoveryRequest({
        selectedIcpIds: ['icp_1'],
        countries: [],
        cities: [],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        searchTaskLimit: 5,
      }),
    ).toBeNull();
  });

  it('refuses to build a request outside the fixed public demo task budget', () => {
    expect(
      buildDiscoveryRequest({
        selectedIcpIds: ['icp_1'],
        countries: ['AE'],
        cities: ['Dubai'],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        searchTaskLimit: 4,
      }),
    ).toBeNull();
  });
});

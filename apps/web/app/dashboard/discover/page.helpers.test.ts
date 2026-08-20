import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISCOVERY_COUNTRY_CODES,
  buildDiscoveryRequest,
  getDefaultSelectedIcpIds,
  getNextSelectedIcpId,
  isPublicDemoSearchTaskLimit,
  shouldShowDiscoveryRun,
} from './page.helpers.js';

describe('discover page helpers', () => {
  it('defaults recruiter demo targeting to the United States only', () => {
    expect(DEFAULT_DISCOVERY_COUNTRY_CODES).toEqual(['US']);
  });

  it('toggles ICP selection for multi-select', () => {
    expect(getNextSelectedIcpId([], 'icp_1')).toEqual(['icp_1']);
    expect(getNextSelectedIcpId(['icp_1'], 'icp_2')).toEqual(['icp_1', 'icp_2']);
    expect(getNextSelectedIcpId(['icp_1', 'icp_2'], 'icp_2')).toEqual(['icp_1']);
  });

  it('selects every available ICP by default', () => {
    expect(getDefaultSelectedIcpIds([
      { id: 'icp_1' },
      { id: 'icp_2' },
      { id: 'icp_3' },
      { id: 'icp_4' },
    ])).toEqual(['icp_1', 'icp_2', 'icp_3', 'icp_4']);
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

  it('keeps every bounded public run visible through terminal status', () => {
    expect(shouldShowDiscoveryRun('QUEUED', 0, 5)).toBe(true);
    expect(shouldShowDiscoveryRun('RUNNING', 0, 5)).toBe(true);
    expect(shouldShowDiscoveryRun('SUCCEEDED', 10, 5)).toBe(true);
    expect(shouldShowDiscoveryRun('SUCCEEDED', 10, 5, true)).toBe(true);
    expect(shouldShowDiscoveryRun('SUCCEEDED', 0, 5)).toBe(true);
    expect(shouldShowDiscoveryRun('SUCCEEDED', 100, 25)).toBe(false);
    expect(shouldShowDiscoveryRun('PARTIAL', 8, 5)).toBe(true);
    expect(shouldShowDiscoveryRun('FAILED', 0, 5)).toBe(true);
  });

  it('keeps grouped public runs visible when each individual run is within budget', () => {
    const groupedRunLimits = [5, 5];

    expect(
      shouldShowDiscoveryRun('SUCCEEDED', 20, Math.max(...groupedRunLimits)),
    ).toBe(true);
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

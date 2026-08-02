import { describe, expect, it } from 'vitest';

import { getDemoPreviewPageKind } from './demo-preview-pages.js';

describe('demo preview page routing', () => {
  it('leaves the bundled dashboard on the normal dashboard route', () => {
    expect(getDemoPreviewPageKind('/dashboard')).toBeNull();
    expect(getDemoPreviewPageKind('/dashboard/analytics')).toBeNull();
  });

  it.each([
    ['/dashboard/discover', 'discover'],
    ['/dashboard/jobs/run-1', 'discover'],
    ['/dashboard/leads', 'leads'],
    ['/dashboard/leads/lead-1', 'leads'],
    ['/dashboard/prompts', 'prompts'],
    ['/dashboard/inbox', 'inbox'],
    ['/dashboard/messages', 'inbox'],
    ['/dashboard/icps', 'icps'],
    ['/dashboard/icps/icp-1', 'icps'],
    ['/discovery', 'settings'],
  ] as const)('maps %s to the %s bundled page', (pathname, expected) => {
    expect(getDemoPreviewPageKind(pathname)).toBe(expected);
  });

  it('exposes the bundled settings snapshot only on the exact Settings route', () => {
    expect(getDemoPreviewPageKind('/discovery')).toBe('settings');
    expect(getDemoPreviewPageKind('/discovery/rules')).toBe('unavailable');
    expect(getDemoPreviewPageKind('/discovery/jobs')).toBe('unavailable');
  });

  it('uses a safe bundled fallback for unknown authenticated routes', () => {
    expect(getDemoPreviewPageKind('/dashboard/unknown')).toBe('unavailable');
  });
});

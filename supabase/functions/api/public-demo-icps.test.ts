import {
  getPublicDemoIcpPresentation,
  PUBLIC_DEMO_ICP_PRESENTATIONS,
} from './public-demo-icps.ts';

Deno.test('public demo exposes four visibly distinct ICP markets', () => {
  if (PUBLIC_DEMO_ICP_PRESENTATIONS.length !== 4) {
    throw new Error('Expected exactly four public demo ICPs');
  }

  const names = new Set(PUBLIC_DEMO_ICP_PRESENTATIONS.map((icp) => icp.name));
  const industries = PUBLIC_DEMO_ICP_PRESENTATIONS.flatMap((icp) => icp.targetIndustries);
  if (names.size !== 4 || new Set(industries).size !== industries.length) {
    throw new Error('Expected unique ICP names and non-overlapping industry examples');
  }
});

Deno.test('public demo ICP presentation resolves from durable source names', () => {
  const presentation = getPublicDemoIcpPresentation('Enterprise Workflow & Data Platforms');
  if (presentation?.name !== 'Enterprise Workflow & Data Platforms') {
    throw new Error('Expected the public presentation to preserve the durable scoring profile');
  }
  if (getPublicDemoIcpPresentation('Unknown profile') !== null) {
    throw new Error('Expected unknown profiles to remain unmapped');
  }
});

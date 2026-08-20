import { describe, expect, it } from 'vitest';

import { DEMO_ICP_PLAYBOOKS } from './demo-icp-playbooks.js';

describe('demo ICP playbooks', () => {
  it('defines four distinct, fully described ICPs', () => {
    expect(DEMO_ICP_PLAYBOOKS).toHaveLength(4);
    expect(new Set(DEMO_ICP_PLAYBOOKS.map((icp) => icp.name)).size).toBe(4);
    expect(DEMO_ICP_PLAYBOOKS.every((icp) => icp.description.length > 60)).toBe(true);
    expect(DEMO_ICP_PLAYBOOKS.every((icp) => icp.industries.length >= 3)).toBe(true);
  });

  it('gives every ICP a distinct sales approach and CTA', () => {
    expect(new Set(DEMO_ICP_PLAYBOOKS.map((icp) => icp.salesApproach)).size).toBe(4);
    expect(new Set(DEMO_ICP_PLAYBOOKS.map((icp) => icp.primaryCta)).size).toBe(4);
    expect(DEMO_ICP_PLAYBOOKS.every((icp) => icp.primaryBuyers.length > 0)).toBe(true);
    expect(DEMO_ICP_PLAYBOOKS.every((icp) => icp.buyingSignals.length > 0)).toBe(true);
  });
});

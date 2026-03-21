import { describe, expect, it } from 'vitest';

import { resolveOutboxDispatchPlan } from './outbox-dispatcher.js';

describe('resolveOutboxDispatchPlan', () => {
  it('supports persisted features.compute outbox payloads', () => {
    const payload = {
      runId: 'job_123',
      leadId: 'lead_123',
      icpProfileId: 'icp_123',
      snapshotVersion: 1,
    };

    expect(resolveOutboxDispatchPlan('features.compute', payload)).toEqual({
      jobExecutionId: 'job_123',
      bossPayload: payload,
      singletonKey: 'features.compute:lead_123:icp_123:1',
    });
  });

  it('separates features.compute dispatch identities across icp profiles', () => {
    const payloadA = {
      runId: 'job_a',
      leadId: 'lead_shared',
      icpProfileId: 'icp_a',
      snapshotVersion: 2,
    };
    const payloadB = {
      runId: 'job_b',
      leadId: 'lead_shared',
      icpProfileId: 'icp_b',
      snapshotVersion: 2,
    };

    const planA = resolveOutboxDispatchPlan('features.compute', payloadA);
    const planB = resolveOutboxDispatchPlan('features.compute', payloadB);

    expect(planA?.singletonKey).toBe('features.compute:lead_shared:icp_a:2');
    expect(planB?.singletonKey).toBe('features.compute:lead_shared:icp_b:2');
    expect(planA?.singletonKey).not.toBe(planB?.singletonKey);
  });

  it('supports legacy jobExecutionId payloads', () => {
    const payload = {
      leadId: 'lead_legacy',
      jobExecutionId: 'job_legacy',
      source: 'test',
    };

    expect(resolveOutboxDispatchPlan('legacy.job', payload)).toEqual({
      jobExecutionId: 'job_legacy',
      bossPayload: payload,
    });
  });

  it('rejects invalid payloads for features.compute', () => {
    expect(
      resolveOutboxDispatchPlan('features.compute', {
        leadId: 'lead_123',
        jobExecutionId: 'job_123',
        source: 'test',
      }),
    ).toBeNull();
  });
});

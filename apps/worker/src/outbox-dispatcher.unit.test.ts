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

  it('supports persisted scoring.compute outbox payloads', () => {
    const payload = {
      runId: 'score_run_123',
      mode: 'BY_ICP',
      icpProfileId: 'icp_123',
      leadIds: ['lead_1', 'lead_2'],
      modelVersionId: 'model_123',
      requestedByUserId: 'user_123',
    };

    expect(resolveOutboxDispatchPlan('scoring.compute', payload)).toEqual({
      jobExecutionId: 'score_run_123',
      bossPayload: payload,
      singletonKey: 'scoring.compute:score_run_123',
    });
  });

  it('supports worker-generated scoring.compute outbox payloads with a distinct job execution id', () => {
    const payload = {
      runId: 'discovery_run_123',
      mode: 'BY_LEAD_IDS',
      icpProfileId: 'icp_123',
      leadIds: ['lead_1'],
      correlationId: 'corr_123',
      jobExecutionId: 'score_job_123',
    };

    expect(resolveOutboxDispatchPlan('scoring.compute', payload)).toEqual({
      jobExecutionId: 'score_job_123',
      bossPayload: {
        runId: 'discovery_run_123',
        mode: 'BY_LEAD_IDS',
        icpProfileId: 'icp_123',
        leadIds: ['lead_1'],
        correlationId: 'corr_123',
      },
      singletonKey: 'scoring.compute:discovery_run_123:lead_1:icp_123',
    });
  });

  it('supports persisted discovery.seed outbox payloads with shard-level dispatch identity', () => {
    const payload = {
      reason: 'api',
      correlationId: 'run_123',
      discoveryRunId: 'run_123',
      jobExecutionId: 'seed_job_123',
      icpProfileId: 'icp_123',
      countries: ['AE'],
      enqueueRunTasks: true,
    };

    expect(resolveOutboxDispatchPlan('discovery.seed', payload)).toEqual({
      jobExecutionId: 'seed_job_123',
      bossPayload: payload,
      singletonKey: 'discovery.seed:run_123:icp_123',
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

  it('rejects invalid payloads for scoring.compute', () => {
    expect(
      resolveOutboxDispatchPlan('scoring.compute', {
        mode: 'BY_ICP',
        icpProfileId: 'icp_123',
      }),
    ).toBeNull();
  });
});

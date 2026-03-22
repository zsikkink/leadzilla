import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  jobExecution: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  business: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  contactRecoveryItem: {
    findMany: vi.fn(),
  },
  businessConversion: {
    findMany: vi.fn(),
  },
  leadDiscoveryRecord: {
    findMany: vi.fn(),
  },
  lead: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  messageDraft: {
    findMany: vi.fn(),
  },
  leadScorePrediction: {
    findMany: vi.fn(),
  },
  $queryRawUnsafe: vi.fn(),
};

const pipelineSettingsMock = {
  getPipelineSetting: vi.fn(),
  upsertPipelineSetting: vi.fn(),
};

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
  getPipelineSetting: pipelineSettingsMock.getPipelineSetting,
  upsertPipelineSetting: pipelineSettingsMock.upsertPipelineSetting,
  toInputJson: (value: unknown) => value,
}));

vi.mock('../scoring/shared.js', () => ({
  getQualificationThreshold: vi.fn(async () => 0.5),
}));

describe('tryFinalizeDiscoveryRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineSettingsMock.getPipelineSetting.mockResolvedValue(null);
    pipelineSettingsMock.upsertPipelineSetting.mockResolvedValue({
      key: 'mock',
      valueJson: null,
      updatedAt: new Date(),
    });
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.run',
      status: 'running',
      payload: {
        icpProfileId: 'icp_1',
      },
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 23,
        totalFound: 49,
      },
    });
    prismaMock.business.findMany.mockResolvedValue(
      Array.from({ length: 23 }, (_, index) => ({
        id: `biz_${index + 1}`,
        discoveryRunId: 'run_1',
        preQualified: true,
        disqualificationReason: null,
      })),
    );
    prismaMock.business.findUnique.mockResolvedValue({
      id: 'biz_1',
      preQualified: true,
    });
    prismaMock.contactRecoveryItem.findMany.mockResolvedValue([]);
    prismaMock.businessConversion.findMany.mockResolvedValue([]);
    prismaMock.leadDiscoveryRecord.findMany.mockResolvedValue([]);
    prismaMock.lead.findMany.mockResolvedValue([]);
    prismaMock.messageDraft.findMany.mockResolvedValue([]);
    prismaMock.leadScorePrediction.findMany.mockResolvedValue([]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      { name: 'business.convert', state: 'created', count: 23 },
    ]);
    prismaMock.jobExecution.update.mockResolvedValue({});
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.lead.deleteMany.mockResolvedValue({ count: 0 });
  });

  it('does not finalize while qualified businesses are still waiting for conversion', async () => {
    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(prismaMock.jobExecution.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.jobExecution.update).not.toHaveBeenCalled();
  });

  it('does not finalize while pg-boss still has queued pipeline jobs for the run', async () => {
    prismaMock.business.findMany.mockResolvedValue([
      {
        id: 'biz_1',
        discoveryRunId: 'run_1',
        preQualified: false,
        disqualificationReason: 'NO_WEBSITE_DOMAIN',
      },
    ]);

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalled();
    expect(prismaMock.jobExecution.updateMany).not.toHaveBeenCalled();
  });

  it('finalizes discovery.seed runs when all businesses are terminal', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.seed',
      status: 'running',
      payload: {
        icpProfileId: 'icp_1',
      },
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 1,
        totalFound: 1,
      },
    });
    prismaMock.business.findMany.mockResolvedValue([
      {
        id: 'biz_1',
        discoveryRunId: 'run_1',
        preQualified: false,
        disqualificationReason: 'NO_WEBSITE_DOMAIN',
      },
    ]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalled();
  });

  it('finalizes existing observed businesses as disqualified after current-run prequalify fails', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.run',
      status: 'running',
      payload: {
        icpProfileId: 'icp_1',
      },
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 0,
        totalFound: 1,
      },
    });
    prismaMock.business.findMany.mockResolvedValue([
      {
        id: 'biz_1',
        discoveryRunId: 'run_old',
        preQualified: false,
        disqualificationReason: 'PARKED_DOMAIN',
      },
    ]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          result: expect.objectContaining({
            totalFound: 1,
            alreadyKnown: 1,
            disqualified: 1,
            converted: 0,
          }),
        }),
      }),
    );
  });

  it('excludes rejected leads from converted counts while still finalizing a lead-target run', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.run',
      status: 'running',
      payload: {
        icpProfileId: 'icp_1',
      },
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 3,
        totalFound: 3,
        leadTargetReached: true,
        leadTargetCount: 2,
      },
    });
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', discoveryRunId: 'run_1', preQualified: true, disqualificationReason: null },
      { id: 'biz_2', discoveryRunId: 'run_1', preQualified: true, disqualificationReason: null },
      { id: 'biz_3', discoveryRunId: 'run_1', preQualified: true, disqualificationReason: null },
    ]);
    prismaMock.businessConversion.findMany.mockResolvedValue([
      { businessId: 'biz_1', leadId: 'lead_1', metadata: { discoveryRunId: 'run_1' } },
      { businessId: 'biz_2', leadId: 'lead_2', metadata: { discoveryRunId: 'run_1' } },
      { businessId: 'biz_3', leadId: 'lead_3', metadata: { discoveryRunId: 'run_1' } },
    ]);
    prismaMock.contactRecoveryItem.findMany.mockResolvedValue([]);
    prismaMock.lead.findMany.mockResolvedValue([
      {
        id: 'lead_1',
        status: 'qualified',
        deletedAt: null,
        messageDrafts: [],
        scorePredictions: [{ scoreBand: 'HIGH', blendedScore: 0.72 }],
      },
      {
        id: 'lead_2',
        status: 'drafted',
        deletedAt: null,
        messageDrafts: [{ id: 'draft_1' }],
        scorePredictions: [{ scoreBand: 'HIGH', blendedScore: 0.81 }],
      },
      {
        id: 'lead_3',
        status: 'rejected',
        deletedAt: null,
        messageDrafts: [],
        scorePredictions: [{ scoreBand: 'LOW', blendedScore: 0.22 }],
      },
    ]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ count: 5 }]);
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          result: expect.objectContaining({
            converted: 2,
            rejectedLeads: 1,
            outcome: expect.objectContaining({
              leadsCreated: 2,
              rejectedLeads: 1,
            }),
          }),
        }),
      }),
    );
  });

  it('counts contact recovery as terminal without inflating converted leads', async () => {
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', discoveryRunId: 'run_1', preQualified: true, disqualificationReason: null },
      { id: 'biz_2', discoveryRunId: 'run_1', preQualified: false, disqualificationReason: 'NO_WEBSITE_DOMAIN' },
    ]);
    prismaMock.businessConversion.findMany.mockResolvedValue([]);
    prismaMock.contactRecoveryItem.findMany.mockResolvedValue([
      { businessId: 'biz_1', reason: 'NO_EMAIL' },
    ]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: expect.objectContaining({
            converted: 0,
            outcome: expect.objectContaining({
              leadsCreated: 0,
            }),
          }),
        }),
      }),
    );
  });

  it('finalizes overlapping same-ICP runs from shared existing-business recovery state', async () => {
    prismaMock.jobExecution.findUnique.mockImplementation(async (args: { where: { id: string } }) => ({
      id: args.where.id,
      type: 'discovery.run',
      status: 'running',
      payload: {
        icpProfileId: 'icp_1',
      },
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 0,
        totalFound: 1,
      },
    }));
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', discoveryRunId: 'run_old', preQualified: true, disqualificationReason: null },
    ]);
    prismaMock.contactRecoveryItem.findMany.mockResolvedValue([
      { businessId: 'biz_1', reason: 'NO_EMAIL' },
    ]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', { info: vi.fn(), warn: vi.fn() });
    await tryFinalizeDiscoveryRun('run_2', { info: vi.fn(), warn: vi.fn() });

    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.contactRecoveryItem.findMany).toHaveBeenCalledWith({
      where: {
        businessId: { in: ['biz_1'] },
        icpProfileId: 'icp_1',
      },
      select: { businessId: true, reason: true },
    });
  });

  it('finalizes already-known-only runs from immutable business observation plus current-ICP state', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.run',
      status: 'running',
      payload: {
        icpProfileId: 'icp_1',
      },
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 0,
        totalFound: 1,
      },
    });
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', discoveryRunId: 'run_old', preQualified: true, disqualificationReason: null },
    ]);
    prismaMock.businessConversion.findMany.mockResolvedValue([]);
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'lead_1', businessId: 'biz_1' },
    ]);
    prismaMock.messageDraft.findMany.mockResolvedValue([]);
    prismaMock.leadScorePrediction.findMany.mockResolvedValue([
      {
        leadId: 'lead_1',
        scoreBand: 'HIGH',
        blendedScore: 0.78,
        predictedAt: new Date('2026-03-20T10:00:00.000Z'),
        createdAt: new Date('2026-03-20T10:00:00.000Z'),
      },
    ]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          result: expect.objectContaining({
            totalFound: 1,
            alreadyKnown: 1,
            newFound: 0,
            converted: 0,
          }),
        }),
      }),
    );
    expect(prismaMock.leadDiscoveryRecord.findMany).not.toHaveBeenCalled();
  });

  it('keeps rediscovery re-entry runs open while the current ICP still has no score', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.run',
      status: 'running',
      payload: {
        icpProfileId: 'icp_2',
      },
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 0,
        totalFound: 1,
      },
    });
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', discoveryRunId: 'run_old', preQualified: true, disqualificationReason: null },
    ]);
    prismaMock.businessConversion.findMany.mockResolvedValue([]);
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'lead_1', businessId: 'biz_1' },
    ]);
    prismaMock.messageDraft.findMany.mockResolvedValue([]);
    prismaMock.leadScorePrediction.findMany.mockResolvedValue([]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(prismaMock.jobExecution.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.jobExecution.update).not.toHaveBeenCalled();
  });

  it('finalizes two overlapping runs after shared current-ICP scoring appears without using mutable lead provenance', async () => {
    prismaMock.jobExecution.findUnique.mockImplementation(async (args: { where: { id: string } }) => ({
      id: args.where.id,
      type: 'discovery.run',
      status: 'running',
      payload: {
        icpProfileId: 'icp_1',
      },
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 0,
        totalFound: 1,
      },
    }));
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', discoveryRunId: 'run_old', preQualified: true, disqualificationReason: null },
    ]);
    prismaMock.businessConversion.findMany.mockResolvedValue([]);
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'lead_1', businessId: 'biz_1' },
    ]);
    prismaMock.messageDraft.findMany.mockResolvedValue([]);
    prismaMock.leadScorePrediction.findMany.mockResolvedValue([]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', { info: vi.fn(), warn: vi.fn() });
    await tryFinalizeDiscoveryRun('run_2', { info: vi.fn(), warn: vi.fn() });

    expect(prismaMock.jobExecution.updateMany).not.toHaveBeenCalled();

    prismaMock.leadScorePrediction.findMany.mockResolvedValue([
      {
        leadId: 'lead_1',
        scoreBand: 'HIGH',
        blendedScore: 0.79,
        predictedAt: new Date('2026-03-20T10:00:00.000Z'),
        createdAt: new Date('2026-03-20T10:00:00.000Z'),
      },
    ]);
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    await tryFinalizeDiscoveryRun('run_1', { info: vi.fn(), warn: vi.fn() });
    await tryFinalizeDiscoveryRun('run_2', { info: vi.fn(), warn: vi.fn() });

    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.leadDiscoveryRecord.findMany).not.toHaveBeenCalled();
  });

  it('finalizes multi-lead existing businesses as terminal already-known no-ops', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.run',
      status: 'running',
      payload: {
        icpProfileId: 'icp_1',
      },
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 0,
        totalFound: 1,
      },
    });
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', discoveryRunId: 'run_old', preQualified: true, disqualificationReason: null },
    ]);
    prismaMock.businessConversion.findMany.mockResolvedValue([]);
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'lead_1', businessId: 'biz_1' },
      { id: 'lead_2', businessId: 'biz_1' },
    ]);
    prismaMock.messageDraft.findMany.mockResolvedValue([]);
    prismaMock.leadScorePrediction.findMany.mockResolvedValue([]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun('run_1', {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          result: expect.objectContaining({
            totalFound: 1,
            alreadyKnown: 1,
            newFound: 0,
            converted: 0,
          }),
        }),
      }),
    );
  });

  it('ignores only the active business.convert caller when checking pending pipeline jobs', async () => {
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', discoveryRunId: 'run_1', preQualified: true, disqualificationReason: null },
    ]);
    prismaMock.contactRecoveryItem.findMany.mockResolvedValue([
      { businessId: 'biz_1', reason: 'NO_EMAIL' },
    ]);
    prismaMock.$queryRawUnsafe.mockImplementation(async (_sql: string, _runId: string, excludeJobId?: string) => (
      excludeJobId === 'job_convert_1'
        ? []
        : [{ name: 'business.convert', state: 'active', count: 1 }]
    ));
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun(
      'run_1',
      { info: vi.fn(), warn: vi.fn() },
      { excludeActiveJobId: 'job_convert_1' },
    );

    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("state in ('created', 'retry', 'active')"),
      'run_1',
      'job_convert_1',
    );
    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
        }),
      }),
    );
  });

  it('ignores only the active business.prequalify caller when checking pending pipeline jobs', async () => {
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', discoveryRunId: 'run_1', preQualified: false, disqualificationReason: 'PARKED_DOMAIN' },
    ]);
    prismaMock.$queryRawUnsafe.mockImplementation(async (_sql: string, _runId: string, excludeJobId?: string) => (
      excludeJobId === 'job_prequalify_1'
        ? []
        : [{ name: 'business.prequalify', state: 'active', count: 1 }]
    ));
    prismaMock.jobExecution.updateMany.mockResolvedValue({ count: 1 });

    const { tryFinalizeDiscoveryRun } = await import('./discovery-run-tracker.js');

    await tryFinalizeDiscoveryRun(
      'run_1',
      { info: vi.fn(), warn: vi.fn() },
      { excludeActiveJobId: 'job_prequalify_1' },
    );

    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("state in ('created', 'retry', 'active')"),
      'run_1',
      'job_prequalify_1',
    );
    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
        }),
      }),
    );
  });

  it('requeues stale created business.convert jobs only for active valid runs', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: 'job_1',
        name: 'business.convert',
        data: {
          businessId: 'biz_1',
          discoveryRunId: 'run_1',
          icpProfileId: 'icp_1',
        },
      },
    ]);
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.run',
      status: 'running',
    });
    prismaMock.business.findUnique.mockResolvedValue({
      id: 'biz_1',
      preQualified: true,
    });

    const boss = {
      cancel: vi.fn(async () => undefined),
      send: vi.fn(async () => 'job_2'),
    };

    const { sweepStaleBusinessConvertJobs } = await import('./discovery-run-tracker.js');

    const result = await sweepStaleBusinessConvertJobs({
      boss,
      logger: { info: vi.fn(), warn: vi.fn() },
      retryOptions: { retryLimit: 3 },
    });

    expect(result).toEqual({
      scanned: 1,
      requeued: 1,
      cancelled: 1,
    });
    expect(boss.cancel).toHaveBeenCalledWith('business.convert', 'job_1');
    expect(boss.send).toHaveBeenCalledWith(
      'business.convert',
      expect.objectContaining({
        businessId: 'biz_1',
      }),
      expect.objectContaining({
        singletonKey: 'business.convert:biz_1',
      }),
    );
  });

  it('enforces a minimum 10-minute threshold for stale discovery sweeps', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([]);
    const boss = {
      cancel: vi.fn(async () => undefined),
      send: vi.fn(async () => 'job_2'),
    };

    const { sweepStaleDiscoveryPipelineJobs } = await import('./discovery-run-tracker.js');

    await sweepStaleDiscoveryPipelineJobs({
      boss,
      logger: { info: vi.fn(), warn: vi.fn() },
      staleMinutes: 1,
      retryOptionsByQueue: {},
    });

    const staleMinutesArg = prismaMock.$queryRawUnsafe.mock.calls[0]?.[1];
    expect(staleMinutesArg).toBe(10);
  });
});

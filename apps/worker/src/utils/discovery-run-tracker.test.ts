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
  lead: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  $queryRawUnsafe: vi.fn(),
};

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
  toInputJson: (value: unknown) => value,
}));

vi.mock('../scoring/shared.js', () => ({
  getQualificationThreshold: vi.fn(async () => 0.5),
}));

describe('tryFinalizeDiscoveryRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.run',
      status: 'running',
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
    prismaMock.lead.findMany.mockResolvedValue([]);
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
      { id: 'biz_1', preQualified: false, disqualificationReason: 'NO_WEBSITE_DOMAIN' },
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
      result: {
        searchTasksComplete: true,
        searchTasksCompletedAt: new Date().toISOString(),
        newBusinesses: 1,
        totalFound: 1,
      },
    });
    prismaMock.business.findMany.mockResolvedValue([
      { id: 'biz_1', preQualified: false, disqualificationReason: 'NO_WEBSITE_DOMAIN' },
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

  it('excludes rejected leads from converted counts while still finalizing a lead-target run', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_1',
      type: 'discovery.run',
      status: 'running',
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
      { id: 'biz_1', preQualified: true, disqualificationReason: null },
      { id: 'biz_2', preQualified: true, disqualificationReason: null },
      { id: 'biz_3', preQualified: true, disqualificationReason: null },
    ]);
    prismaMock.businessConversion.findMany.mockResolvedValue([
      { businessId: 'biz_1', leadId: 'lead_1', metadata: { discoveryRunId: 'run_1' } },
      { businessId: 'biz_2', leadId: 'lead_2', metadata: { discoveryRunId: 'run_1' } },
      { businessId: 'biz_3', leadId: 'lead_3', metadata: { discoveryRunId: 'run_1' } },
    ]);
    prismaMock.contactRecoveryItem.findMany.mockResolvedValue([]);
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'lead_1', status: 'qualified', deletedAt: null, messageDrafts: [], scorePredictions: [{ scoreBand: 'HIGH', blendedScore: 0.72 }] },
      { id: 'lead_2', status: 'drafted', deletedAt: null, messageDrafts: [{ id: 'draft_1' }], scorePredictions: [{ scoreBand: 'HIGH', blendedScore: 0.81 }] },
      { id: 'lead_3', status: 'rejected', deletedAt: null, messageDrafts: [], scorePredictions: [{ scoreBand: 'LOW', blendedScore: 0.22 }] },
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
      { id: 'biz_1', preQualified: true, disqualificationReason: null },
      { id: 'biz_2', preQualified: false, disqualificationReason: 'NO_WEBSITE_DOMAIN' },
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

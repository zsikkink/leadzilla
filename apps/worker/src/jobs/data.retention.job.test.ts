import type { Job } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SearchTaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

interface MockSearchTaskRecord {
  id: string;
  status: SearchTaskStatus;
  updatedAt: Date;
  hasAssignment: boolean;
}

const {
  searchTaskFindManyMock,
  searchTaskDeleteManyMock,
  businessEvidenceFindManyMock,
  businessEvidenceUpdateManyMock,
  leadFeatureSnapshotFindManyMock,
  leadFeatureSnapshotDeleteManyMock,
  leadFeatureSnapshotCountMock,
  leadEnrichmentRecordFindManyMock,
  leadEnrichmentRecordDeleteManyMock,
  leadEnrichmentRecordCountMock,
  getPipelineSettingsMock,
} = vi.hoisted(() => ({
  searchTaskFindManyMock: vi.fn(),
  searchTaskDeleteManyMock: vi.fn(),
  businessEvidenceFindManyMock: vi.fn(),
  businessEvidenceUpdateManyMock: vi.fn(),
  leadFeatureSnapshotFindManyMock: vi.fn(),
  leadFeatureSnapshotDeleteManyMock: vi.fn(),
  leadFeatureSnapshotCountMock: vi.fn(),
  leadEnrichmentRecordFindManyMock: vi.fn(),
  leadEnrichmentRecordDeleteManyMock: vi.fn(),
  leadEnrichmentRecordCountMock: vi.fn(),
  getPipelineSettingsMock: vi.fn(),
}));

vi.mock('@lead-flood/db', () => ({
  prisma: {
    searchTask: {
      findMany: searchTaskFindManyMock,
      deleteMany: searchTaskDeleteManyMock,
    },
    businessEvidence: {
      findMany: businessEvidenceFindManyMock,
      updateMany: businessEvidenceUpdateManyMock,
    },
    leadFeatureSnapshot: {
      findMany: leadFeatureSnapshotFindManyMock,
      deleteMany: leadFeatureSnapshotDeleteManyMock,
      count: leadFeatureSnapshotCountMock,
    },
    leadEnrichmentRecord: {
      findMany: leadEnrichmentRecordFindManyMock,
      deleteMany: leadEnrichmentRecordDeleteManyMock,
      count: leadEnrichmentRecordCountMock,
    },
  },
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  getPipelineSettings: getPipelineSettingsMock,
}));

import {
  handleDataRetentionJob,
  type DataRetentionJobPayload,
} from './data.retention.job.js';

function makeJob(data: DataRetentionJobPayload): Job<DataRetentionJobPayload> {
  return {
    id: 'job-retention-test',
    name: 'data.retention',
    data,
  } as Job<DataRetentionJobPayload>;
}

function installSearchTaskStore(records: MockSearchTaskRecord[]): {
  remainingIds: () => string[];
} {
  let searchTasks = records.map((task) => ({ ...task }));

  searchTaskFindManyMock.mockImplementation(async (args?: {
    where?: {
      status?: { in?: SearchTaskStatus[] };
      updatedAt?: { lt?: Date };
      discoveryAttributionAssignments?: { none?: Record<string, never> };
    };
    take?: number;
  }) => {
    const eligibleStatuses = args?.where?.status?.in ?? [];
    const cutoff = args?.where?.updatedAt?.lt ?? new Date(0);
    const requireNoAssignments =
      args?.where?.discoveryAttributionAssignments !== undefined;

    return searchTasks
      .filter((task) => eligibleStatuses.includes(task.status))
      .filter((task) => task.updatedAt < cutoff)
      .filter((task) => !requireNoAssignments || !task.hasAssignment)
      .slice(0, args?.take ?? searchTasks.length)
      .map((task) => ({ id: task.id }));
  });

  searchTaskDeleteManyMock.mockImplementation(async (args: {
    where: { id: { in: string[] } };
  }) => {
    const idsToDelete = new Set(args.where.id.in);
    const before = searchTasks.length;
    searchTasks = searchTasks.filter((task) => !idsToDelete.has(task.id));
    return { count: before - searchTasks.length };
  });

  return {
    remainingIds: () => searchTasks.map((task) => task.id).sort(),
  };
}

describe('data.retention search task purge guard', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-06T12:00:00.000Z'));

    getPipelineSettingsMock.mockResolvedValue({ outboxRetentionDays: 30 });
    businessEvidenceFindManyMock.mockResolvedValue([]);
    businessEvidenceUpdateManyMock.mockResolvedValue({ count: 0 });
    leadFeatureSnapshotFindManyMock.mockResolvedValue([]);
    leadFeatureSnapshotDeleteManyMock.mockResolvedValue({ count: 0 });
    leadFeatureSnapshotCountMock.mockResolvedValue(0);
    leadEnrichmentRecordFindManyMock.mockResolvedValue([]);
    leadEnrichmentRecordDeleteManyMock.mockResolvedValue({ count: 0 });
    leadEnrichmentRecordCountMock.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('purges completed unattributed search tasks', async () => {
    const store = installSearchTaskStore([
      {
        id: 'done-unattributed',
        status: 'DONE',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: false,
      },
      {
        id: 'failed-unattributed',
        status: 'FAILED',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: false,
      },
      {
        id: 'skipped-unattributed',
        status: 'SKIPPED',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: false,
      },
    ]);

    await handleDataRetentionJob(logger, makeJob({ retentionDays: 30 }));

    expect(searchTaskDeleteManyMock).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['done-unattributed', 'failed-unattributed', 'skipped-unattributed'],
        },
      },
    });
    expect(store.remainingIds()).toEqual([]);
  });

  it('preserves completed search tasks that are already attributed', async () => {
    const store = installSearchTaskStore([
      {
        id: 'done-attributed',
        status: 'DONE',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: true,
      },
      {
        id: 'failed-attributed',
        status: 'FAILED',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: true,
      },
      {
        id: 'skipped-attributed',
        status: 'SKIPPED',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: true,
      },
    ]);

    await handleDataRetentionJob(logger, makeJob({ retentionDays: 30 }));

    expect(searchTaskDeleteManyMock).not.toHaveBeenCalled();
    expect(store.remainingIds()).toEqual([
      'done-attributed',
      'failed-attributed',
      'skipped-attributed',
    ]);
  });

  it('does not broaden search task retention beyond the attribution guard', async () => {
    const store = installSearchTaskStore([
      {
        id: 'done-unattributed-old',
        status: 'DONE',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: false,
      },
      {
        id: 'done-attributed-old',
        status: 'DONE',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: true,
      },
      {
        id: 'pending-old',
        status: 'PENDING',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: false,
      },
      {
        id: 'running-old',
        status: 'RUNNING',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        hasAssignment: false,
      },
      {
        id: 'done-recent',
        status: 'DONE',
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        hasAssignment: false,
      },
      {
        id: 'failed-recent',
        status: 'FAILED',
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        hasAssignment: false,
      },
      {
        id: 'skipped-recent',
        status: 'SKIPPED',
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        hasAssignment: false,
      },
    ]);

    await handleDataRetentionJob(logger, makeJob({ retentionDays: 30 }));

    expect(searchTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['DONE', 'FAILED', 'SKIPPED'] },
          discoveryAttributionAssignments: { none: {} },
        }),
      }),
    );
    expect(store.remainingIds()).toEqual([
      'done-attributed-old',
      'done-recent',
      'failed-recent',
      'pending-old',
      'running-old',
      'skipped-recent',
    ]);
  });
});

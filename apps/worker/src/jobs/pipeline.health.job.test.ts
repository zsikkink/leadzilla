import type { Job } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryRawUnsafeMock,
  leadCountMock,
  messageSendCountMock,
  leadScorePredictionGroupByMock,
  leadEnrichmentRecordGroupByMock,
  getPipelineSettingsMock,
} = vi.hoisted(() => ({
  queryRawUnsafeMock: vi.fn(),
  leadCountMock: vi.fn(),
  messageSendCountMock: vi.fn(),
  leadScorePredictionGroupByMock: vi.fn(),
  leadEnrichmentRecordGroupByMock: vi.fn(),
  getPipelineSettingsMock: vi.fn(),
}));

vi.mock('@lead-flood/db', () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
    lead: { count: leadCountMock },
    messageSend: { count: messageSendCountMock },
    leadScorePrediction: { groupBy: leadScorePredictionGroupByMock },
    leadEnrichmentRecord: { groupBy: leadEnrichmentRecordGroupByMock },
  },
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  getPipelineSettings: getPipelineSettingsMock,
}));

import {
  handlePipelineHealthJob,
  type PipelineHealthJobPayload,
} from './pipeline.health.job.js';

function makeJob(data: PipelineHealthJobPayload): Job<PipelineHealthJobPayload> {
  return {
    id: 'job-health-test',
    name: 'pipeline.health',
    data,
  } as Job<PipelineHealthJobPayload>;
}

describe('pipeline.health stale job checks', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getPipelineSettingsMock.mockResolvedValue({
      healthDlqDepthThreshold: 10,
      healthStaleJobMinutes: 15,
    });
    queryRawUnsafeMock.mockResolvedValue([]);
    leadCountMock.mockResolvedValue(0);
    messageSendCountMock.mockResolvedValue(0);
    leadScorePredictionGroupByMock.mockResolvedValue([]);
    leadEnrichmentRecordGroupByMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries pg-boss stale jobs using started_on', async () => {
    await handlePipelineHealthJob(logger, makeJob({ correlationId: 'corr-health-test' }));

    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(2);
    expect(queryRawUnsafeMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("started_on < NOW() - INTERVAL '15 minutes'"),
    );
    expect(queryRawUnsafeMock).not.toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('startedon'),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ check: 'stale_jobs' }),
      'Failed to check stale jobs — pgboss schema may not exist',
    );
  });
});

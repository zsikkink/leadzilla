import { describe, expect, it, vi } from 'vitest';

const { getPipelineSettingMock } = vi.hoisted(() => ({
  getPipelineSettingMock: vi.fn(),
}));

vi.mock('@lead-flood/db', () => ({
  getPipelineSetting: getPipelineSettingMock,
}));

import {
  DiscoveryInvalidRequestError,
  DiscoveryWorkerUnavailableError,
} from './discovery.errors.js';
import { buildDiscoveryService } from './discovery.service.js';
import type { DiscoveryRepository } from './discovery.repository.js';

function buildRepositoryMock(): DiscoveryRepository {
  return {
    assertDiscoveryWorkerAvailable: vi.fn(async () => undefined),
    createDiscoveryRun: vi.fn(async () => undefined),
    markDiscoveryRunFailed: vi.fn(async () => undefined),
    getDiscoveryRunStatus: vi.fn(),
    listDiscoveryRecords: vi.fn(),
    listDiscoveryRuns: vi.fn(),
  };
}

describe('buildDiscoveryService', () => {
  it('rejects discovery runs when a valid country has no city coverage configured', async () => {
    const repository = buildRepositoryMock();
    const enqueueDiscoveryRun = vi.fn(async () => undefined);
    getPipelineSettingMock.mockResolvedValue({
      key: 'countryCities',
      valueJson: {
        AE: ['Dubai'],
      },
    });

    const service = buildDiscoveryService(repository, {
      enqueueDiscoveryRun,
    });

    await expect(
      service.createDiscoveryRun({
        icpProfileId: 'icp_1',
        countries: ['DE'],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        limit: 10,
        requestedByUserId: 'user_1',
      }),
    ).rejects.toThrow(DiscoveryInvalidRequestError);

    expect(repository.createDiscoveryRun).not.toHaveBeenCalled();
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
  });

  it('allows discovery runs with explicit cities even when no default city coverage exists', async () => {
    const repository = buildRepositoryMock();
    const enqueueDiscoveryRun = vi.fn(async () => undefined);
    getPipelineSettingMock.mockResolvedValue({
      key: 'countryCities',
      valueJson: {},
    });

    const service = buildDiscoveryService(repository, {
      enqueueDiscoveryRun,
    });

    await expect(
      service.createDiscoveryRun({
        icpProfileId: 'icp_1',
        countries: ['DE'],
        cities: ['Berlin'],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        limit: 10,
        requestedByUserId: 'user_1',
      }),
    ).resolves.toEqual({
      runId: expect.any(String),
      status: 'QUEUED',
    });

    expect(repository.createDiscoveryRun).toHaveBeenCalledTimes(1);
  });

  it('fails fast when the discovery worker heartbeat is missing', async () => {
    const repository = buildRepositoryMock();
    const enqueueDiscoveryRun = vi.fn(async () => undefined);
    getPipelineSettingMock.mockResolvedValue({
      key: 'countryCities',
      valueJson: {
        AE: ['Dubai'],
      },
    });
    vi.mocked(repository.assertDiscoveryWorkerAvailable).mockRejectedValue(
      new DiscoveryWorkerUnavailableError(),
    );

    const service = buildDiscoveryService(repository, {
      enqueueDiscoveryRun,
    });

    await expect(
      service.createDiscoveryRun({
        icpProfileId: 'icp_1',
        countries: ['AE'],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        limit: 10,
        requestedByUserId: 'user_1',
      }),
    ).rejects.toThrow(DiscoveryWorkerUnavailableError);

    expect(repository.createDiscoveryRun).not.toHaveBeenCalled();
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
  });

  it('persists only positive-budget discovery.seed shards and does not use immediate enqueue', async () => {
    const repository = buildRepositoryMock();
    const enqueueDiscoveryRun = vi.fn(async () => undefined);
    getPipelineSettingMock.mockResolvedValue({
      key: 'countryCities',
      valueJson: {
        AE: ['Dubai'],
      },
    });

    const service = buildDiscoveryService(repository, {
      enqueueDiscoveryRun,
    });

    const response = await service.createDiscoveryRun({
      icpProfileIds: ['icp_1', 'icp_2', 'icp_3'],
      countries: ['AE'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: true,
      limit: 2,
      requestedByUserId: 'user_1',
    });

    expect(response).toEqual({
      runId: expect.any(String),
      status: 'QUEUED',
    });

    expect(repository.createDiscoveryRun).toHaveBeenCalledTimes(1);
    const [runId, input, payload, seedPayloads] = vi.mocked(repository.createDiscoveryRun).mock.calls[0]!;

    expect(runId).toBe(response.runId);
    expect(input).toEqual(
      expect.objectContaining({
        icpProfileIds: ['icp_1', 'icp_2', 'icp_3'],
        requestedByUserId: 'user_1',
      }),
    );
    expect(payload).toEqual(
      expect.objectContaining({
        runId: response.runId,
        icpProfileId: 'icp_1',
        requestedByUserId: 'user_1',
      }),
    );
    expect(seedPayloads).toEqual([
      expect.objectContaining({
        reason: 'api',
        correlationId: response.runId,
        discoveryRunId: response.runId,
        icpProfileId: 'icp_1',
        countries: ['AE'],
        maxTasks: 1,
        validationMode: true,
        enqueueRunTasks: true,
        jobExecutionId: expect.any(String),
      }),
      expect.objectContaining({
        reason: 'api',
        correlationId: response.runId,
        discoveryRunId: response.runId,
        icpProfileId: 'icp_2',
        countries: ['AE'],
        maxTasks: 1,
        validationMode: true,
        enqueueRunTasks: true,
        jobExecutionId: expect.any(String),
      }),
    ]);
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
  });
});

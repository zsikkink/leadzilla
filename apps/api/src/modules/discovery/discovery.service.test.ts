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

  it('persists non-empty request searchCategories onto the discovery run and seed shard payloads', async () => {
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
      icpProfileId: 'icp_1',
      countries: ['AE'],
      cities: ['Dubai'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: true,
      limit: 10,
      advancedSettings: {
        minReviewCount: 15,
        searchCategories: ['bakery', 'gym'],
      },
      requestedByUserId: 'user_1',
    });

    expect(response).toEqual({
      runId: expect.any(String),
      status: 'QUEUED',
    });

    expect(repository.createDiscoveryRun).toHaveBeenCalledTimes(1);
    const [, , payload, seedPayloads] = vi.mocked(repository.createDiscoveryRun).mock.calls[0]!;

    expect(payload).toEqual(
      expect.objectContaining({
        runId: response.runId,
        icpProfileId: 'icp_1',
        requestedByUserId: 'user_1',
        minReviewCount: 15,
        searchCategories: ['bakery', 'gym'],
      }),
    );
    expect(seedPayloads).toEqual([
      expect.objectContaining({
        discoveryRunId: response.runId,
        icpProfileId: 'icp_1',
        searchCategories: ['bakery', 'gym'],
        minReviewCount: 15,
      }),
    ]);
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
  });

  it('normalizes empty request searchCategories to the same persisted payload behavior as the absent case', async () => {
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

    await service.createDiscoveryRun({
      icpProfileIds: ['icp_1', 'icp_2'],
      countries: ['AE'],
      cities: ['Dubai'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: true,
      limit: 2,
      advancedSettings: {
        minReviewCount: 15,
      },
      requestedByUserId: 'user_1',
    });

    await service.createDiscoveryRun({
      icpProfileIds: ['icp_1', 'icp_2'],
      countries: ['AE'],
      cities: ['Dubai'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: true,
      limit: 2,
      advancedSettings: {
        minReviewCount: 15,
        searchCategories: [],
      },
      requestedByUserId: 'user_1',
    });

    expect(repository.createDiscoveryRun).toHaveBeenCalledTimes(2);

    const [, , absentPayload, absentSeedPayloads] =
      vi.mocked(repository.createDiscoveryRun).mock.calls[0]!;
    const [, , emptyPayload, emptySeedPayloads] =
      vi.mocked(repository.createDiscoveryRun).mock.calls[1]!;

    const projectPayload = (payload: typeof absentPayload) => ({
      icpProfileId: payload.icpProfileId,
      countries: payload.countries,
      cities: payload.cities,
      includeWebsiteAnalysis: payload.includeWebsiteAnalysis,
      includeSocialMediaAnalysis: payload.includeSocialMediaAnalysis,
      limit: payload.limit,
      minReviewCount: payload.minReviewCount,
      requestedByUserId: payload.requestedByUserId,
      searchCategories: payload.searchCategories,
    });
    const projectSeedPayloads = (seedPayloads: typeof absentSeedPayloads) =>
      seedPayloads.map((seedPayload) => ({
        icpProfileId: seedPayload.icpProfileId,
        countries: seedPayload.countries,
        cities: seedPayload.cities,
        includeWebsiteAnalysis: seedPayload.includeWebsiteAnalysis,
        includeSocialMediaAnalysis: seedPayload.includeSocialMediaAnalysis,
        maxTasks: seedPayload.maxTasks,
        validationMode: seedPayload.validationMode,
        minReviewCount: seedPayload.minReviewCount,
        enqueueRunTasks: seedPayload.enqueueRunTasks,
        searchCategories: seedPayload.searchCategories,
      }));

    expect(projectPayload(emptyPayload)).toEqual(projectPayload(absentPayload));
    expect(projectPayload(emptyPayload)).toEqual({
      icpProfileId: 'icp_1',
      countries: ['AE'],
      cities: ['Dubai'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: true,
      limit: 2,
      minReviewCount: 15,
      requestedByUserId: 'user_1',
      searchCategories: undefined,
    });

    expect(projectSeedPayloads(emptySeedPayloads)).toEqual(projectSeedPayloads(absentSeedPayloads));
    expect(projectSeedPayloads(emptySeedPayloads)).toEqual([
      {
        icpProfileId: 'icp_1',
        countries: ['AE'],
        cities: ['Dubai'],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        maxTasks: 1,
        validationMode: true,
        minReviewCount: 15,
        enqueueRunTasks: true,
        searchCategories: undefined,
      },
      {
        icpProfileId: 'icp_2',
        countries: ['AE'],
        cities: ['Dubai'],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        maxTasks: 1,
        validationMode: true,
        minReviewCount: 15,
        enqueueRunTasks: true,
        searchCategories: undefined,
      },
    ]);

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
    expect(payload.searchCategories).toBeUndefined();
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
    expect(seedPayloads.map((seedPayload) => seedPayload.searchCategories)).toEqual([
      undefined,
      undefined,
    ]);
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
  });
});

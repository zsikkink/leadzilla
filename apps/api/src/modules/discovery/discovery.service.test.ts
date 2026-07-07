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
    cancelDiscoveryRun: vi.fn(),
  };
}

describe('buildDiscoveryService', () => {
  it('allows discovery runs when city coverage comes from SerpAPI-safe country defaults', async () => {
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
        countries: ['EG'],
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
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
  });

  it('rejects explicit cities that are not SerpAPI discovery locations', async () => {
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
    ).rejects.toThrow(DiscoveryInvalidRequestError);

    expect(repository.createDiscoveryRun).not.toHaveBeenCalled();
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
      cities: ['Dubai', 'not-serpapi-location'],
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
        cities: ['Dubai'],
        minReviewCount: 15,
        maxPages: 1,
        taskTypes: ['SERP_MAPS_LOCAL'],
        languages: ['en', 'ar'],
        searchCategories: ['bakery', 'gym'],
      }),
    );
    expect(seedPayloads).toEqual([
      expect.objectContaining({
        discoveryRunId: response.runId,
        icpProfileId: 'icp_1',
        cities: ['Dubai'],
        searchCategories: ['bakery', 'gym'],
        minReviewCount: 15,
        maxPages: 1,
        taskTypes: ['SERP_MAPS_LOCAL'],
        languages: ['en', 'ar'],
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

    const [, , absentPayload, absentSeedPayloads] = vi.mocked(repository.createDiscoveryRun).mock
      .calls[0]!;
    const [, , emptyPayload, emptySeedPayloads] = vi.mocked(repository.createDiscoveryRun).mock
      .calls[1]!;

    const projectPayload = (payload: typeof absentPayload) => ({
      icpProfileId: payload.icpProfileId,
      countries: payload.countries,
      cities: payload.cities,
      includeWebsiteAnalysis: payload.includeWebsiteAnalysis,
      includeSocialMediaAnalysis: payload.includeSocialMediaAnalysis,
      limit: payload.limit,
      minReviewCount: payload.minReviewCount,
      maxPages: payload.maxPages,
      taskTypes: payload.taskTypes,
      languages: payload.languages,
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
        runMaxTasks: seedPayload.runMaxTasks,
        validationMode: seedPayload.validationMode,
        minReviewCount: seedPayload.minReviewCount,
        maxPages: seedPayload.maxPages,
        taskTypes: seedPayload.taskTypes,
        languages: seedPayload.languages,
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
      maxPages: 1,
      taskTypes: ['SERP_MAPS_LOCAL'],
      languages: ['en', 'ar'],
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
        runMaxTasks: 2,
        validationMode: true,
        minReviewCount: 15,
        maxPages: 1,
        taskTypes: ['SERP_MAPS_LOCAL'],
        languages: ['en', 'ar'],
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
        runMaxTasks: 2,
        validationMode: true,
        minReviewCount: 15,
        maxPages: 1,
        taskTypes: ['SERP_MAPS_LOCAL'],
        languages: ['en', 'ar'],
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
    const [runId, input, payload, seedPayloads] = vi.mocked(repository.createDiscoveryRun).mock
      .calls[0]!;

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
        minReviewCount: 0,
        maxPages: 1,
        taskTypes: ['SERP_MAPS_LOCAL'],
        languages: ['en', 'ar'],
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
        runMaxTasks: 2,
        minReviewCount: 0,
        maxPages: 1,
        taskTypes: ['SERP_MAPS_LOCAL'],
        languages: ['en', 'ar'],
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
        runMaxTasks: 2,
        minReviewCount: 0,
        maxPages: 1,
        taskTypes: ['SERP_MAPS_LOCAL'],
        languages: ['en', 'ar'],
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

  it('treats limit as the total search-task budget for an April 12 style bulk run', async () => {
    const repository = buildRepositoryMock();
    const enqueueDiscoveryRun = vi.fn(async () => undefined);
    const icpProfileIds = Array.from({ length: 8 }, (_, index) => `icp_${index + 1}`);
    getPipelineSettingMock.mockResolvedValue({
      key: 'countryCities',
      valueJson: {
        AE: ['Dubai'],
        SA: ['Riyadh'],
        JO: ['Amman'],
        EG: ['Cairo'],
      },
    });

    const service = buildDiscoveryService(repository, {
      enqueueDiscoveryRun,
    });

    const response = await service.createDiscoveryRun({
      icpProfileIds,
      countries: ['JO', 'SA', 'AE', 'EG'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: true,
      limit: 200,
      requestedByUserId: 'user_1',
    });

    expect(repository.createDiscoveryRun).toHaveBeenCalledTimes(1);
    const [, , payload, seedPayloads] = vi.mocked(repository.createDiscoveryRun).mock.calls[0]!;

    expect(payload).toEqual(
      expect.objectContaining({
        runId: response.runId,
        limit: 200,
        minReviewCount: 0,
        maxPages: 1,
        taskTypes: ['SERP_MAPS_LOCAL'],
        languages: ['en', 'ar'],
        requestedByUserId: 'user_1',
      }),
    );
    expect(seedPayloads).toHaveLength(8);
    expect(seedPayloads.map((seedPayload) => seedPayload.maxTasks)).toEqual([
      25, 25, 25, 25, 25, 25, 25, 25,
    ]);
    expect(seedPayloads.every((seedPayload) => seedPayload.runMaxTasks === 200)).toBe(true);
    expect(seedPayloads.every((seedPayload) => seedPayload.minReviewCount === 0)).toBe(true);
    expect(seedPayloads.every((seedPayload) => seedPayload.maxPages === 1)).toBe(true);
    expect(
      seedPayloads.every((seedPayload) => seedPayload.taskTypes?.join(',') === 'SERP_MAPS_LOCAL'),
    ).toBe(true);
    expect(seedPayloads.every((seedPayload) => seedPayload.languages?.join(',') === 'en,ar')).toBe(
      true,
    );
    expect(seedPayloads.reduce((sum, seedPayload) => sum + (seedPayload.maxTasks ?? 0), 0)).toBe(
      200,
    );
    expect(seedPayloads.every((seedPayload) => seedPayload.enqueueRunTasks)).toBe(true);
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
  });
});

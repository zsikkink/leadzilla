import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DiscoveryModule from '@lead-flood/discovery';

const {
  getTaskCapForLeadTargetMock,
  loadConversionRateMock,
  loadSearchEfficiencyMock,
  prismaMock,
  seedSearchTasksMock,
} = vi.hoisted(() => ({
  getTaskCapForLeadTargetMock: vi.fn(),
  loadConversionRateMock: vi.fn(),
  loadSearchEfficiencyMock: vi.fn(),
  prismaMock: {
    icpProfile: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    jobExecution: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    jobRun: {
      update: vi.fn(),
    },
  },
  seedSearchTasksMock: vi.fn(),
}));

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
  toInputJson: <T>(value: T) => value,
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  loadConversionRate: loadConversionRateMock,
  loadSearchEfficiency: loadSearchEfficiencyMock,
}));

vi.mock('@lead-flood/discovery', async () => {
  const actual = await vi.importActual<typeof DiscoveryModule>(
    '@lead-flood/discovery',
  );

  return {
    ...actual,
    getTaskCapForLeadTarget: getTaskCapForLeadTargetMock,
    seedSearchTasks: seedSearchTasksMock,
  };
});

import {
  ICP_INDUSTRY_CATEGORY_MAP,
  mapIcpIndustriesWithOverrides,
  type DiscoveryRuntimeConfig,
} from '@lead-flood/discovery';

import { handleDiscoverySeedJob } from './discovery.seed.job.js';

const baseConfig: DiscoveryRuntimeConfig = {
  countries: ['AE'],
  languages: ['en'],
  maxPagesPerQuery: 2,
  refreshBucket: 'weekly',
  seedProfile: 'default',
  maxTasks: 6,
  taskTypes: ['SERP_MAPS_LOCAL'],
  seedBucket: 'test-bucket',
  searchProvider: 'GOOGLE_PLACES',
  serpApiKey: null,
  googlePlacesApiKey: 'test-key',
  rps: 1,
  concurrency: 1,
  enableCache: false,
  maxTaskAttempts: 3,
  backoffBaseSeconds: 10,
  mapsZoom: 13,
  mapsZoomWarning: null,
};

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('handleDiscoverySeedJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSearchTasksMock.mockResolvedValue({
      generated: 2,
      inserted: 2,
    });
    getTaskCapForLeadTargetMock.mockReturnValue(75);
    loadConversionRateMock.mockResolvedValue(null);
    loadSearchEfficiencyMock.mockResolvedValue(null);
    prismaMock.jobExecution.count.mockResolvedValue(0);
  });

  it('uses request searchCategories to override the generated categories for that run only', async () => {
    prismaMock.icpProfile.findUnique.mockResolvedValue({
      targetIndustries: ['food_beverage'],
      targetCountries: ['AE'],
      metadataJson: {
        categoryOverrides: {
          food_beverage: {
            add: ['restaurant'],
          },
        },
      },
    });

    await handleDiscoverySeedJob(
      buildLogger(),
      {
        id: 'job_1',
        name: 'discovery.seed',
        data: {
          reason: 'repair-test',
          correlationId: 'corr_1',
          icpProfileId: 'icp_1',
          countries: ['AE'],
          cities: ['Dubai'],
          searchCategories: ['bakery', 'gym'],
          enqueueRunTasks: false,
        },
      } as never,
      {
        boss: {
          send: vi.fn(),
        },
        config: baseConfig,
      },
    );

    expect(seedSearchTasksMock).toHaveBeenCalledTimes(1);
    const [seedConfig, , icpSeedConfig] = seedSearchTasksMock.mock.calls[0]!;

    expect(seedConfig).toEqual({
      countries: ['AE'],
      languages: ['en'],
      maxPagesPerQuery: 2,
      refreshBucket: 'weekly',
      seedProfile: 'default',
      maxTasks: 6,
      taskTypes: ['SERP_MAPS_LOCAL'],
      seedBucket: 'test-bucket',
    });
    expect(icpSeedConfig).toEqual(
      expect.objectContaining({
        targetIndustries: ['food_beverage'],
        targetCountries: ['AE'],
        cities: ['Dubai'],
      }),
    );
    expect(
      mapIcpIndustriesWithOverrides(
        icpSeedConfig.targetIndustries,
        icpSeedConfig.categoryOverrides,
      ),
    ).toEqual(['bakery', 'gym']);
  });

  it('preserves the existing ICP-derived category path when request searchCategories are absent', async () => {
    const categoryOverrides = {
      food_beverage: {
        remove: ['ice cream shop'],
        add: ['smoothie bar'],
      },
    };
    prismaMock.icpProfile.findUnique.mockResolvedValue({
      targetIndustries: ['food_beverage'],
      targetCountries: ['AE'],
      metadataJson: {
        categoryOverrides,
      },
    });

    await handleDiscoverySeedJob(
      buildLogger(),
      {
        id: 'job_2',
        name: 'discovery.seed',
        data: {
          reason: 'repair-test',
          correlationId: 'corr_2',
          icpProfileId: 'icp_1',
          countries: ['AE'],
          cities: ['Dubai'],
          enqueueRunTasks: false,
        },
      } as never,
      {
        boss: {
          send: vi.fn(),
        },
        config: baseConfig,
      },
    );

    expect(seedSearchTasksMock).toHaveBeenCalledTimes(1);
    const [, , icpSeedConfig] = seedSearchTasksMock.mock.calls[0]!;

    expect(icpSeedConfig.categoryOverrides).toEqual(categoryOverrides);
    expect(
      mapIcpIndustriesWithOverrides(
        icpSeedConfig.targetIndustries,
        icpSeedConfig.categoryOverrides,
      ),
    ).toEqual([
      ...ICP_INDUSTRY_CATEGORY_MAP['food_beverage']!.filter(
        (category) => category !== 'ice cream shop',
      ),
      'smoothie bar',
    ]);
  });

  it('treats empty request searchCategories the same as the absent case and keeps ICP-derived categories', async () => {
    const categoryOverrides = {
      food_beverage: {
        remove: ['ice cream shop'],
        add: ['smoothie bar'],
      },
    };
    const expectedCategories = [
      ...ICP_INDUSTRY_CATEGORY_MAP['food_beverage']!.filter(
        (category) => category !== 'ice cream shop',
      ),
      'smoothie bar',
    ];

    prismaMock.icpProfile.findUnique.mockResolvedValue({
      targetIndustries: ['food_beverage'],
      targetCountries: ['AE'],
      metadataJson: {
        categoryOverrides,
      },
    });

    await handleDiscoverySeedJob(
      buildLogger(),
      {
        id: 'job_3',
        name: 'discovery.seed',
        data: {
          reason: 'repair-test',
          correlationId: 'corr_3',
          icpProfileId: 'icp_1',
          countries: ['AE'],
          cities: ['Dubai'],
          enqueueRunTasks: false,
        },
      } as never,
      {
        boss: {
          send: vi.fn(),
        },
        config: baseConfig,
      },
    );

    await handleDiscoverySeedJob(
      buildLogger(),
      {
        id: 'job_4',
        name: 'discovery.seed',
        data: {
          reason: 'repair-test',
          correlationId: 'corr_4',
          icpProfileId: 'icp_1',
          countries: ['AE'],
          cities: ['Dubai'],
          searchCategories: [],
          enqueueRunTasks: false,
        },
      } as never,
      {
        boss: {
          send: vi.fn(),
        },
        config: baseConfig,
      },
    );

    expect(seedSearchTasksMock).toHaveBeenCalledTimes(2);

    const [, , absentIcpSeedConfig] = seedSearchTasksMock.mock.calls[0]!;
    const [, , emptyIcpSeedConfig] = seedSearchTasksMock.mock.calls[1]!;

    expect(emptyIcpSeedConfig).toEqual(absentIcpSeedConfig);
    expect(emptyIcpSeedConfig.categoryOverrides).toEqual(categoryOverrides);
    expect(
      mapIcpIndustriesWithOverrides(
        absentIcpSeedConfig.targetIndustries,
        absentIcpSeedConfig.categoryOverrides,
      ),
    ).toEqual(expectedCategories);
    expect(
      mapIcpIndustriesWithOverrides(
        emptyIcpSeedConfig.targetIndustries,
        emptyIcpSeedConfig.categoryOverrides,
      ),
    ).toEqual(expectedCategories);
  });

  it('keeps API maxTasks as the shard seed cap and uses runMaxTasks as the whole-run search budget', async () => {
    prismaMock.icpProfile.findUnique.mockResolvedValue({
      targetIndustries: ['food_beverage'],
      targetCountries: ['AE'],
      metadataJson: {},
    });
    const send = vi.fn();

    await handleDiscoverySeedJob(
      buildLogger(),
      {
        id: 'job_bulk_8',
        name: 'discovery.seed',
        data: {
          reason: 'api',
          correlationId: 'run_april_12',
          jobExecutionId: 'seed_run_april_12_icp_8',
          discoveryRunId: 'run_april_12',
          icpProfileId: 'icp_8',
          countries: ['AE'],
          includeWebsiteAnalysis: true,
          includeSocialMediaAnalysis: true,
          maxTasks: 25,
          runMaxTasks: 200,
          enqueueRunTasks: true,
        },
      } as never,
      {
        boss: {
          send,
        },
        config: baseConfig,
      },
    );

    expect(loadConversionRateMock).not.toHaveBeenCalled();
    expect(loadSearchEfficiencyMock).not.toHaveBeenCalled();
    expect(getTaskCapForLeadTargetMock).not.toHaveBeenCalled();
    expect(seedSearchTasksMock).toHaveBeenCalledTimes(1);
    expect(seedSearchTasksMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        maxTasks: 25,
      }),
    );
    expect(seedSearchTasksMock.mock.calls[0]?.[3]).toBe('run_april_12');
    expect(seedSearchTasksMock.mock.calls[0]?.[4]).toBe('icp_8');

    expect(send).toHaveBeenCalledTimes(baseConfig.concurrency);
    expect(send).toHaveBeenCalledWith(
      'discovery.run_search_task',
      expect.objectContaining({
        reason: 'seed',
        correlationId: 'run_april_12',
        discoveryRunId: 'run_april_12',
        icpProfileId: 'icp_8',
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        maxTasks: 200,
      }),
      expect.objectContaining({
        singletonKey: 'discovery.run_search_task:run_april_12:slot-0',
      }),
    );
  });
});

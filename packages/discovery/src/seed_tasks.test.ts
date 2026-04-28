import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GenerateTasksModule from './queries/generate_tasks.js';
import { ICP_INDUSTRY_CATEGORY_MAP } from './queries/icp-category-map.js';

type GeneratedSearchTask = GenerateTasksModule.GeneratedSearchTask;

const { executeRawMock, generateTasksV2Mock } = vi.hoisted(() => ({
  executeRawMock: vi.fn(),
  generateTasksV2Mock: vi.fn(),
}));

vi.mock('@lead-flood/db', () => ({
  prisma: {
    $executeRaw: executeRawMock,
  },
}));

vi.mock('./queries/generate_tasks.js', async () => {
  const actual = await vi.importActual<typeof GenerateTasksModule>(
    './queries/generate_tasks.js',
  );

  return {
    ...actual,
    generateTasksV2: generateTasksV2Mock,
  };
});

import { seedSearchTasks } from './seed_tasks.js';

const FIXED_NOW = new Date('2026-04-06T12:00:00.000Z');
const ID_ARG_INDEX = 1;
const QUERY_HASH_ARG_INDEX = 8;

type SeedConfig = Parameters<typeof seedSearchTasks>[0];
type SeedIcpConfig = NonNullable<Parameters<typeof seedSearchTasks>[2]>;

const baseConfig: SeedConfig = {
  countries: ['AE'],
  languages: ['en'],
  maxPagesPerQuery: 2,
  refreshBucket: 'weekly',
  seedProfile: 'default',
  maxTasks: 4,
  taskTypes: ['SERP_MAPS_LOCAL'],
  seedBucket: null,
};

const icpConfig: SeedIcpConfig = {
  targetIndustries: ['bakery', 'gym'],
  targetCountries: ['AE'],
  cities: ['Dubai', 'Abu Dhabi'],
};

type SortableTaskLike = {
  id?: string;
  task?: {
    id?: string;
  };
};

function createTask(
  queryHash: string,
  city: string,
  queryText: string,
  page: number,
): GeneratedSearchTask {
  return {
    id: `${queryHash}-id`,
    taskType: 'SERP_MAPS_LOCAL',
    countryCode: 'AE',
    city,
    language: 'en',
    queryText,
    normalizedQueryKey: `${city.toLowerCase()}|${queryText.toLowerCase()}|${page}`,
    queryHash,
    paramsJson: {
      q: queryText,
      location: city,
      start: (page - 1) * 10,
    },
    page,
    timeBucket: '2026-W15:v2',
  };
}

function insertedValues(argIndex: number): string[] {
  return executeRawMock.mock.calls.map((call) => call[argIndex] as string);
}

async function seedAndCollect(
  candidates: GeneratedSearchTask[],
  maxTasks: number,
  argIndex: number = QUERY_HASH_ARG_INDEX,
): Promise<string[]> {
  generateTasksV2Mock.mockImplementation(() => candidates);
  await seedSearchTasks(
    {
      ...baseConfig,
      maxTasks,
    },
    FIXED_NOW,
    icpConfig,
  );

  return insertedValues(argIndex);
}

function installUnstableEqualTieBreakSort() {
  const originalSort = Array.prototype.sort;

  return vi.spyOn(Array.prototype, 'sort').mockImplementation(function (
    this: unknown[],
    compareFn?: (left: unknown, right: unknown) => number,
  ) {
    if (!compareFn) {
      return originalSort.call(this);
    }

    return originalSort.call(this, (left, right) => {
      const result = compareFn(left, right);

      if (result !== 0) {
        return result;
      }

      const leftId = String(
        ((left as SortableTaskLike | undefined)?.task?.id ??
          (left as SortableTaskLike | undefined)?.id) ??
          '',
      );
      const rightId = String(
        ((right as SortableTaskLike | undefined)?.task?.id ??
          (right as SortableTaskLike | undefined)?.id) ??
          '',
      );

      return leftId.localeCompare(rightId);
    });
  });
}

beforeEach(() => {
  executeRawMock.mockReset();
  executeRawMock.mockResolvedValue(1);

  generateTasksV2Mock.mockReset();
});

describe('seedSearchTasks', () => {
  it('forwards explicit category overrides to generation without changing other generation knobs', async () => {
    generateTasksV2Mock.mockReturnValue([]);

    await seedSearchTasks(
      baseConfig,
      FIXED_NOW,
      {
        targetIndustries: ['food_beverage'],
        targetCountries: ['AE'],
        cities: ['Dubai'],
        categoryOverrides: {
          food_beverage: {
            remove: ICP_INDUSTRY_CATEGORY_MAP['food_beverage'],
            add: ['bakery', 'gym'],
          },
        },
      },
    );

    expect(generateTasksV2Mock).toHaveBeenCalledWith(
      {
        categories: ['bakery', 'gym'],
        countries: ['AE'],
        cities: ['Dubai'],
        maxPagesPerQuery: baseConfig.maxPagesPerQuery,
        taskTypes: baseConfig.taskTypes,
        searchProvider: undefined,
      },
      { now: FIXED_NOW },
    );
  });

  it('selects one task per stratum before any same-stratum leftovers when budget can fit every stratum', async () => {
    const candidates = [
      createTask('c1', 'Abu Dhabi', 'plumber in Abu Dhabi', 1),
      createTask('a2', 'Dubai', 'bakery in Dubai', 2),
      createTask('d1', 'Sharjah', 'florist in Sharjah', 1),
      createTask('b1', 'Dubai', 'gym in Dubai', 1),
      createTask('a3', 'Dubai', 'bakery in Dubai', 3),
      createTask('a1', 'Dubai', 'bakery in Dubai', 1),
    ];

    const selected = await seedAndCollect(candidates, 4);

    expect(selected).toEqual(['a1', 'b1', 'c1', 'd1']);
  });

  it('falls back to the stable global ordering when budget is smaller than stratum count', async () => {
    const candidates = [
      createTask('d1', 'Sharjah', 'florist in Sharjah', 1),
      createTask('b1', 'Dubai', 'gym in Dubai', 1),
      createTask('a2', 'Dubai', 'bakery in Dubai', 2),
      createTask('c1', 'Abu Dhabi', 'plumber in Abu Dhabi', 1),
      createTask('a1', 'Dubai', 'bakery in Dubai', 1),
    ];

    const selected = await seedAndCollect(candidates, 3);

    expect(selected).toEqual(['a1', 'a2', 'b1']);
  });

  it('uses originalIndex as the final deterministic tie-breaker when all comparator fields collide', async () => {
    const candidates = [
      { ...createTask('same-hash', 'Dubai', 'bakery in Dubai', 1), id: 'z-last-lexically' },
      { ...createTask('same-hash', 'Dubai', 'bakery in Dubai', 1), id: 'a-first-lexically' },
      { ...createTask('same-hash', 'Dubai', 'bakery in Dubai', 1), id: 'm-middle-lexically' },
      { ...createTask('same-hash', 'Dubai', 'bakery in Dubai', 1), id: 'b-second-lexically' },
    ];

    const sortSpy = installUnstableEqualTieBreakSort();

    try {
      const selectedIds = await seedAndCollect(candidates, 3, ID_ARG_INDEX);

      expect(selectedIds).toEqual([
        'z-last-lexically',
        'a-first-lexically',
        'm-middle-lexically',
      ]);
    } finally {
      sortSpy.mockRestore();
    }
  });
});

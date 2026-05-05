import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GenerateTasksModule from './queries/generate_tasks.js';
import { ICP_INDUSTRY_CATEGORY_MAP } from './queries/icp-category-map.js';

type GeneratedSearchTask = GenerateTasksModule.GeneratedSearchTask;

const { executeRawMock, findManyMock, generateTasksV2Mock } = vi.hoisted(() => ({
  executeRawMock: vi.fn(),
  findManyMock: vi.fn(),
  generateTasksV2Mock: vi.fn(),
}));

vi.mock('@lead-flood/db', () => ({
  prisma: {
    $executeRaw: executeRawMock,
    searchTask: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('./queries/generate_tasks.js', async () => {
  const actual = await vi.importActual<typeof GenerateTasksModule>('./queries/generate_tasks.js');

  return {
    ...actual,
    generateTasksV2: generateTasksV2Mock,
  };
});

import { seedSearchTasks } from './seed_tasks.js';

const FIXED_NOW = new Date('2026-04-06T12:00:00.000Z');
const ID_ARG_INDEX = 1;
const QUERY_HASH_ARG_INDEX = 8;
const PARAMS_JSON_ARG_INDEX = 9;

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
    normalizedQueryKey: `${city.toLowerCase()}|${queryText.toLowerCase()}`,
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
  discoveryRunId?: string | undefined,
): Promise<string[]> {
  generateTasksV2Mock.mockImplementation(() => candidates);
  await seedSearchTasks(
    {
      ...baseConfig,
      maxTasks,
    },
    FIXED_NOW,
    icpConfig,
    discoveryRunId,
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
        (left as SortableTaskLike | undefined)?.task?.id ??
          (left as SortableTaskLike | undefined)?.id ??
          '',
      );
      const rightId = String(
        (right as SortableTaskLike | undefined)?.task?.id ??
          (right as SortableTaskLike | undefined)?.id ??
          '',
      );

      return leftId.localeCompare(rightId);
    });
  });
}

beforeEach(() => {
  executeRawMock.mockReset();
  executeRawMock.mockResolvedValue(1);

  findManyMock.mockReset();
  findManyMock.mockResolvedValue([]);

  generateTasksV2Mock.mockReset();
});

describe('seedSearchTasks', () => {
  it('forwards explicit category overrides to generation without changing other generation knobs', async () => {
    generateTasksV2Mock.mockReturnValue([]);

    await seedSearchTasks(baseConfig, FIXED_NOW, {
      targetIndustries: ['food_beverage'],
      targetCountries: ['AE'],
      cities: ['Dubai'],
      categoryOverrides: {
        food_beverage: {
          remove: ICP_INDUSTRY_CATEGORY_MAP['food_beverage'],
          add: ['bakery', 'gym'],
        },
      },
    });

    expect(generateTasksV2Mock).toHaveBeenCalledWith(
      {
        categories: ['bakery', 'gym'],
        countries: ['AE'],
        cities: ['Dubai'],
        maxPagesPerQuery: baseConfig.maxPagesPerQuery,
        taskTypes: baseConfig.taskTypes,
        languages: baseConfig.languages,
        searchProvider: undefined,
      },
      { now: FIXED_NOW },
    );
  });

  it('selects one page-1 task per query family before any same-family leftovers', async () => {
    const candidates = [
      createTask('c1', 'Abu Dhabi', 'plumber in Abu Dhabi', 1),
      createTask('a2', 'Dubai', 'bakery in Dubai', 2),
      createTask('d1', 'Sharjah', 'florist in Sharjah', 1),
      createTask('b1', 'Dubai', 'gym in Dubai', 1),
      createTask('a3', 'Dubai', 'bakery in Dubai', 3),
      createTask('a1', 'Dubai', 'bakery in Dubai', 1),
    ];

    const selected = await seedAndCollect(candidates, 4);

    expect(new Set(selected)).toEqual(new Set(['a1', 'b1', 'c1', 'd1']));
    expect(selected).not.toContain('a2');
    expect(selected).not.toContain('a3');
  });

  it('persists the seed ICP profile id in search task params for downstream handoff attribution', async () => {
    generateTasksV2Mock.mockReturnValue([createTask('a1', 'Dubai', 'bakery in Dubai', 1)]);

    await seedSearchTasks(baseConfig, FIXED_NOW, icpConfig, 'discovery_run_1', 'icp_1');

    expect(JSON.parse(insertedValues(PARAMS_JSON_ARG_INDEX)[0]!)).toEqual(
      expect.objectContaining({
        icpProfileId: 'icp_1',
      }),
    );
  });

  it('hash-randomizes family heads when budget is smaller than the query family count', async () => {
    const candidates = [
      createTask('d1', 'Sharjah', 'florist in Sharjah', 1),
      createTask('b1', 'Dubai', 'gym in Dubai', 1),
      createTask('a2', 'Dubai', 'bakery in Dubai', 2),
      createTask('c1', 'Abu Dhabi', 'plumber in Abu Dhabi', 1),
      createTask('a1', 'Dubai', 'bakery in Dubai', 1),
    ];

    const selected = await seedAndCollect(candidates, 3, QUERY_HASH_ARG_INDEX, 'run_seed_1');

    expect(selected).toHaveLength(3);
    expect(new Set(selected).size).toBe(3);
    expect(selected).not.toContain('a2');

    executeRawMock.mockClear();
    const repeated = await seedAndCollect(candidates, 3, QUERY_HASH_ARG_INDEX, 'run_seed_1');

    expect(repeated).toEqual(selected);
  });

  it('prefers never-executed queries over recently executed queries', async () => {
    const candidates = [
      createTask('a1', 'Dubai', 'bakery in Dubai', 1),
      createTask('b1', 'Dubai', 'gym in Dubai', 1),
    ];
    findManyMock.mockResolvedValueOnce([
      {
        taskType: 'SERP_MAPS_LOCAL',
        normalizedQueryKey: 'dubai|bakery in dubai',
        page: 1,
        updatedAt: new Date('2026-04-06T11:59:00.000Z'),
      },
    ]);

    const selected = await seedAndCollect(candidates, 1);

    expect(selected).toEqual(['b1']);
  });

  it('skips query hashes that already exist for the discovery run', async () => {
    const candidates = [
      createTask('a1', 'Dubai', 'bakery in Dubai', 1),
      createTask('b1', 'Dubai', 'gym in Dubai', 1),
    ];
    findManyMock.mockResolvedValueOnce([{ queryHash: 'a1' }]);
    findManyMock.mockResolvedValueOnce([]);

    const selected = await seedAndCollect(candidates, 2, QUERY_HASH_ARG_INDEX, 'run_1');

    expect(selected).toEqual(['b1']);
  });

  it('backfills same-run insert conflicts with the next ranked task until the shard cap is met', async () => {
    const candidates = [
      createTask('a1', 'Dubai', 'bakery in Dubai', 1),
      createTask('b1', 'Dubai', 'gym in Dubai', 1),
      createTask('c1', 'Dubai', 'florist in Dubai', 1),
    ];
    generateTasksV2Mock.mockImplementation(() => candidates);
    executeRawMock.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const result = await seedSearchTasks(
      {
        ...baseConfig,
        maxTasks: 1,
      },
      FIXED_NOW,
      icpConfig,
      'run_1',
    );

    expect(result).toEqual({ generated: 1, inserted: 1 });
    expect(insertedValues(QUERY_HASH_ARG_INDEX)).toHaveLength(2);
    expect(new Set(insertedValues(QUERY_HASH_ARG_INDEX)).size).toBe(2);
  });

  it('keeps deterministic results under unstable equal-tie sort implementations', async () => {
    const candidates = [
      { ...createTask('same-hash', 'Dubai', 'bakery in Dubai', 1), id: 'z-last-lexically' },
      { ...createTask('same-hash', 'Dubai', 'bakery in Dubai', 1), id: 'a-first-lexically' },
      { ...createTask('same-hash', 'Dubai', 'bakery in Dubai', 1), id: 'm-middle-lexically' },
      { ...createTask('same-hash', 'Dubai', 'bakery in Dubai', 1), id: 'b-second-lexically' },
    ];

    const sortSpy = installUnstableEqualTieBreakSort();

    try {
      const selectedIds = await seedAndCollect(candidates, 3, ID_ARG_INDEX, 'run_seed_2');

      executeRawMock.mockClear();
      const repeatedIds = await seedAndCollect(candidates, 3, ID_ARG_INDEX, 'run_seed_2');

      expect(repeatedIds).toEqual(selectedIds);
      expect(new Set(selectedIds).size).toBe(3);
    } finally {
      sortSpy.mockRestore();
    }
  });
});

import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_ATTRIBUTION_ASSIGNMENT_MODE_SEARCH_TASK_FIRST_TOUCH,
  persistDiscoveryAttributionAssignments,
  shouldFinalizeAfterEmptyPoll,
  shouldStopForTerminalRunStatus,
  shouldStopOrphanLoop,
} from './discovery.run_search_task.job.js';

interface DiscoveryAttributionAssignmentRow {
  id: string;
  discoveryRunId: string;
  icpProfileId: string;
  businessId: string;
  searchTaskId: string;
  assignmentMode: string;
  assignedAt: Date;
}

function createDiscoveryAttributionAssignmentStore() {
  const rows = new Map<string, DiscoveryAttributionAssignmentRow>();

  return {
    rows,
    delegate: {
      async createMany(args: {
        data: DiscoveryAttributionAssignmentRow[];
        skipDuplicates?: boolean;
      }): Promise<{ count: number }> {
        let count = 0;

        for (const row of args.data) {
          const key = `${row.discoveryRunId}:${row.icpProfileId}:${row.businessId}`;
          if (rows.has(key)) {
            if (!args.skipDuplicates) {
              rows.set(key, row);
            }
            continue;
          }
          rows.set(key, row);
          count += 1;
        }

        return { count };
      },
    },
  };
}

describe('shouldFinalizeAfterEmptyPoll', () => {
  it('does not finalize when sibling slots are still active', () => {
    expect(shouldFinalizeAfterEmptyPoll({ activeSlots: 2 })).toBe(false);
  });

  it('finalizes when this is the last active slot', () => {
    expect(shouldFinalizeAfterEmptyPoll({ activeSlots: 1 })).toBe(true);
  });
});

describe('shouldStopOrphanLoop', () => {
  it('stops loop when no run identifiers are present and poll is empty', () => {
    expect(
      shouldStopOrphanLoop(
        { discoveryRunId: undefined },
        'EMPTY',
      ),
    ).toBe(true);
  });

  it('does not stop loop when linked to a discovery run', () => {
    expect(
      shouldStopOrphanLoop(
        { discoveryRunId: 'run_1' },
        'EMPTY',
      ),
    ).toBe(false);
  });
});

describe('shouldStopForTerminalRunStatus', () => {
  it('returns true for terminal discovery run statuses', () => {
    expect(shouldStopForTerminalRunStatus('completed')).toBe(true);
    expect(shouldStopForTerminalRunStatus('failed')).toBe(true);
    expect(shouldStopForTerminalRunStatus('cancelled')).toBe(true);
  });

  it('returns false for running or missing status', () => {
    expect(shouldStopForTerminalRunStatus('running')).toBe(false);
    expect(shouldStopForTerminalRunStatus(null)).toBe(false);
    expect(shouldStopForTerminalRunStatus(undefined)).toBe(false);
  });
});

describe('persistDiscoveryAttributionAssignments', () => {
  it('creates assignment rows for both new and observed businesses', async () => {
    const store = createDiscoveryAttributionAssignmentStore();
    const assignedAt = new Date('2026-04-05T12:00:00.000Z');

    const result = await persistDiscoveryAttributionAssignments(
      store.delegate,
      {
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        searchTaskId: 'task_1',
        newBusinessIds: ['business_new'],
        observedBusinessIds: ['business_new', 'business_existing'],
        assignedAt,
      },
    );

    expect(result).toEqual({
      attemptedCount: 2,
      insertedCount: 2,
      businessIds: ['business_new', 'business_existing'],
    });
    expect([...store.rows.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          discoveryRunId: 'run_1',
          icpProfileId: 'icp_1',
          businessId: 'business_new',
          searchTaskId: 'task_1',
          assignmentMode: DISCOVERY_ATTRIBUTION_ASSIGNMENT_MODE_SEARCH_TASK_FIRST_TOUCH,
          assignedAt,
        }),
        expect.objectContaining({
          discoveryRunId: 'run_1',
          icpProfileId: 'icp_1',
          businessId: 'business_existing',
          searchTaskId: 'task_1',
          assignmentMode: DISCOVERY_ATTRIBUTION_ASSIGNMENT_MODE_SEARCH_TASK_FIRST_TOUCH,
          assignedAt,
        }),
      ]),
    );
  });

  it('does not overwrite the first same-run assignment when later writes conflict', async () => {
    const store = createDiscoveryAttributionAssignmentStore();

    await persistDiscoveryAttributionAssignments(
      store.delegate,
      {
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        searchTaskId: 'task_1',
        newBusinessIds: ['business_1'],
      },
    );

    const result = await persistDiscoveryAttributionAssignments(
      store.delegate,
      {
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        searchTaskId: 'task_2',
        newBusinessIds: [],
        observedBusinessIds: ['business_1'],
      },
    );

    expect(result.insertedCount).toBe(0);
    expect(store.rows.get('run_1:icp_1:business_1')).toEqual(
      expect.objectContaining({
        searchTaskId: 'task_1',
      }),
    );
  });

  it('allows separate assignment rows for the same business across runs and ICPs', async () => {
    const store = createDiscoveryAttributionAssignmentStore();

    await persistDiscoveryAttributionAssignments(
      store.delegate,
      {
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_1',
        searchTaskId: 'task_1',
        newBusinessIds: ['business_1'],
      },
    );
    await persistDiscoveryAttributionAssignments(
      store.delegate,
      {
        discoveryRunId: 'run_2',
        icpProfileId: 'icp_1',
        searchTaskId: 'task_2',
        newBusinessIds: ['business_1'],
      },
    );
    await persistDiscoveryAttributionAssignments(
      store.delegate,
      {
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_2',
        searchTaskId: 'task_3',
        newBusinessIds: ['business_1'],
      },
    );

    expect([...store.rows.keys()].sort()).toEqual([
      'run_1:icp_1:business_1',
      'run_1:icp_2:business_1',
      'run_2:icp_1:business_1',
    ]);
  });
});

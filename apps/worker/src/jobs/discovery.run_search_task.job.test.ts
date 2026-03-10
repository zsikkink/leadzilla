import { describe, expect, it } from 'vitest';

import {
  shouldFinalizeAfterEmptyPoll,
  shouldStopForTerminalRunStatus,
  shouldStopOrphanLoop,
} from './discovery.run_search_task.job.js';

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

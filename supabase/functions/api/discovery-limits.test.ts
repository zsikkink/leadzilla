import {
  canCreateEdgeSearchTask,
  canInspectEdgeDiscoveryResult,
  EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS,
  EDGE_DISCOVERY_MAX_RESULTS,
  EDGE_DISCOVERY_MAX_SEARCH_TASKS,
  isEdgeDiscoverySearchTaskLimit,
  resolveDiscoveryProgressTotal,
  resolveEdgeDiscoveryTerminalStatus,
} from './discovery-limits.ts';

Deno.test('duplicate-heavy discovery cannot inspect more than the result cap', () => {
  let inspectedResultCount = 0;
  let taskCount = 0;

  while (
    canCreateEdgeSearchTask({
      taskCount,
      searchTaskLimit: 5,
      inspectedResultCount,
    })
  ) {
    taskCount += 1;
    for (let providerResult = 0; providerResult < 20; providerResult += 1) {
      if (!canInspectEdgeDiscoveryResult(inspectedResultCount)) {
        break;
      }
      inspectedResultCount += 1;
    }
  }

  if (inspectedResultCount !== EDGE_DISCOVERY_MAX_RESULTS) {
    throw new Error(`Expected ${EDGE_DISCOVERY_MAX_RESULTS} inspected results`);
  }
  if (taskCount !== 1) {
    throw new Error('The result cap should stop additional provider tasks');
  }
});

Deno.test('task budget remains the limiting factor for sparse results', () => {
  let inspectedResultCount = 0;
  let taskCount = 0;

  while (
    canCreateEdgeSearchTask({
      taskCount,
      searchTaskLimit: 5,
      inspectedResultCount,
    })
  ) {
    taskCount += 1;
    inspectedResultCount += 1;
  }

  if (taskCount !== 5 || inspectedResultCount !== 5) {
    throw new Error('Expected the five-task budget to stop sparse discovery');
  }
});

Deno.test('public demo discovery uses exactly five search tasks', () => {
  if (EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS !== 5 || EDGE_DISCOVERY_MAX_SEARCH_TASKS !== 5) {
    throw new Error('Expected the default and maximum task budgets to stay aligned at five');
  }
  if (!isEdgeDiscoverySearchTaskLimit(5)) {
    throw new Error('Expected five search tasks to be allowed');
  }
  if (isEdgeDiscoverySearchTaskLimit(4) || isEdgeDiscoverySearchTaskLimit(6)) {
    throw new Error('Expected non-demo search-task budgets to be rejected');
  }
});

Deno.test('successful zero-result discovery is completed rather than failed', () => {
  if (
    resolveEdgeDiscoveryTerminalStatus({
      taskCount: 1,
      failedTaskCount: 0,
      persistedResultCount: 0,
    }) !== 'completed'
  ) {
    throw new Error('Expected a successful zero-result task to complete');
  }
});

Deno.test('discovery fails only when every attempted task fails', () => {
  if (
    resolveEdgeDiscoveryTerminalStatus({
      taskCount: 2,
      failedTaskCount: 2,
      persistedResultCount: 0,
    }) !== 'failed'
  ) {
    throw new Error('Expected all failed tasks to fail the run');
  }
  if (
    resolveEdgeDiscoveryTerminalStatus({
      taskCount: 2,
      failedTaskCount: 1,
      persistedResultCount: 0,
    }) !== 'completed'
  ) {
    throw new Error('Expected a mixed run to retain completed durable status');
  }
  if (
    resolveEdgeDiscoveryTerminalStatus({
      taskCount: 1,
      failedTaskCount: 1,
      persistedResultCount: 1,
    }) !== 'completed'
  ) {
    throw new Error('Expected persisted results to prevent a wholly failed run');
  }
});

Deno.test('edge discovery progress uses inspected totals instead of only new businesses', () => {
  const total = resolveDiscoveryProgressTotal({
    edgeMode: true,
    totalItems: 10,
    newFound: 1,
    newBusinesses: 1,
    processedItems: 10,
  });
  if (total !== 10) {
    throw new Error('Expected duplicate-heavy edge progress to remain 10 out of 10');
  }

  const legacyTotal = resolveDiscoveryProgressTotal({
    edgeMode: false,
    totalItems: 25,
    newFound: 7,
    newBusinesses: 7,
    processedItems: 7,
  });
  if (legacyTotal !== 7) {
    throw new Error('Expected historical worker progress semantics to remain unchanged');
  }

  const inconsistentLegacyTotal = resolveDiscoveryProgressTotal({
    edgeMode: false,
    totalItems: 58,
    newFound: 58,
    newBusinesses: 58,
    processedItems: 103,
  });
  if (inconsistentLegacyTotal !== 103) {
    throw new Error('Expected displayed progress totals to never trail completed work');
  }
});

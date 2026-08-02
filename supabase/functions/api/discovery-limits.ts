export const EDGE_DISCOVERY_MAX_RESULTS = 10;
export const EDGE_DISCOVERY_MAX_SEARCH_TASKS = 5;
export const EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS = 5;

export function isEdgeDiscoverySearchTaskLimit(value: number): boolean {
  return Number.isInteger(value) && value === EDGE_DISCOVERY_MAX_SEARCH_TASKS;
}

export function canCreateEdgeSearchTask(input: {
  taskCount: number;
  searchTaskLimit: number;
  inspectedResultCount: number;
}): boolean {
  return (
    input.taskCount < input.searchTaskLimit &&
    input.inspectedResultCount < EDGE_DISCOVERY_MAX_RESULTS
  );
}

export function canInspectEdgeDiscoveryResult(inspectedResultCount: number): boolean {
  return inspectedResultCount < EDGE_DISCOVERY_MAX_RESULTS;
}

export function resolveEdgeDiscoveryTerminalStatus(input: {
  taskCount: number;
  failedTaskCount: number;
  persistedResultCount: number;
}): 'completed' | 'failed' {
  if (
    input.persistedResultCount === 0 &&
    input.failedTaskCount > 0 &&
    input.failedTaskCount >= input.taskCount
  ) {
    return 'failed';
  }

  return 'completed';
}

export function resolveDiscoveryProgressTotal(input: {
  edgeMode: boolean;
  totalItems: number;
  newFound: number;
  newBusinesses: number;
  processedItems: number;
}): number {
  let total: number;
  if (input.edgeMode) {
    total = input.totalItems;
  } else if (input.newFound > 0) {
    total = input.newFound;
  } else if (input.newBusinesses > 0) {
    total = input.newBusinesses;
  } else {
    total = input.totalItems;
  }

  return Math.max(total, input.processedItems);
}

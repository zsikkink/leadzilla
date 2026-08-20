export const EDGE_DISCOVERY_MAX_RESULTS = 10;
export const EDGE_DISCOVERY_MAX_SEARCH_TASKS = 5;
export const EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS = 5;
export const EDGE_PUBLIC_DEMO_MAX_CONCURRENT_RUNS = 2;
export const EDGE_PUBLIC_DEMO_MAX_SEARCH_TASKS_PER_DAY = 50;
export const EDGE_PUBLIC_DEMO_MAX_SEARCH_TASKS_PER_SESSION_PER_DAY = 25;
export const EDGE_PUBLIC_DEMO_US_CITIES = [
  "New York",
  "Los Angeles",
  "Chicago",
  "Houston",
  "Phoenix",
  "Philadelphia",
  "San Antonio",
  "San Diego",
  "Dallas",
  "Austin",
  "San Francisco",
  "Seattle",
  "Denver",
  "Boston",
  "Washington",
  "Miami",
  "Atlanta",
  "Charlotte",
  "Nashville",
  "Portland",
] as const;

export interface EdgeDiscoveryTaskTarget {
  icpIndex: number;
  countryCode: string;
  city: string | null;
}

export function distributeEdgeDiscoveryTaskBudget(
  searchTaskLimit: number,
  icpCount: number,
): number[] {
  if (searchTaskLimit < 1 || icpCount < 1) {
    return [];
  }

  const shardCount = Math.min(searchTaskLimit, icpCount);
  const baseBudget = Math.floor(searchTaskLimit / shardCount);
  const remainder = searchTaskLimit - baseBudget * shardCount;

  return Array.from(
    { length: shardCount },
    (_, index) => baseBudget + (index < remainder ? 1 : 0),
  );
}

export function resolveWorkerDiscoveryBusinessCounts(
  businesses: readonly Record<string, unknown>[],
  discoveryRunId: string,
): { newBusinesses: number; alreadyKnown: number } {
  const newBusinesses = businesses.filter((business) => {
    const owner = business.discovery_run_id ?? business.discoveryRunId;
    return owner === discoveryRunId;
  }).length;

  return {
    newBusinesses,
    alreadyKnown: Math.max(0, businesses.length - newBusinesses),
  };
}

export function planEdgeDiscoveryTaskTargets(input: {
  icpCount: number;
  countries: readonly string[];
  cities: readonly string[];
  searchTaskLimit: number;
}): EdgeDiscoveryTaskTarget[] {
  if (
    input.icpCount < 1 || input.countries.length === 0 ||
    input.searchTaskLimit < 1
  ) {
    return [];
  }

  const locations: Array<{ countryCode: string; city: string | null }> = [];
  for (const countryCode of input.countries) {
    if (input.cities.length > 0) {
      locations.push(...input.cities.map((city) => ({ countryCode, city })));
    } else {
      locations.push({ countryCode, city: null });
    }
  }
  const targets: EdgeDiscoveryTaskTarget[] = [];
  const seen = new Set<string>();
  const totalCombinations = input.icpCount * locations.length;

  for (
    let cursor = 0;
    cursor < totalCombinations && targets.length < input.searchTaskLimit;
    cursor += 1
  ) {
    const icpIndex = cursor % input.icpCount;
    const locationIndex = cursor % locations.length;
    const location = locations[locationIndex]!;
    const key = `${icpIndex}:${locationIndex}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({ icpIndex, ...location });
  }

  if (targets.length < Math.min(input.searchTaskLimit, totalCombinations)) {
    for (let icpIndex = 0; icpIndex < input.icpCount; icpIndex += 1) {
      for (
        let locationIndex = 0;
        locationIndex < locations.length;
        locationIndex += 1
      ) {
        if (targets.length >= input.searchTaskLimit) {
          return targets;
        }
        const key = `${icpIndex}:${locationIndex}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        targets.push({ icpIndex, ...locations[locationIndex]! });
      }
    }
  }

  return targets;
}

export function edgeDiscoveryTaskResultAllowance(input: {
  inspectedResultCount: number;
  taskIndex: number;
  plannedTaskCount: number;
}): number {
  const remainingCapacity = Math.max(
    0,
    EDGE_DISCOVERY_MAX_RESULTS - input.inspectedResultCount,
  );
  const remainingTasks = Math.max(1, input.plannedTaskCount - input.taskIndex);
  return Math.ceil(remainingCapacity / remainingTasks);
}

export function isEdgeDiscoverySearchTaskLimit(value: number): boolean {
  return Number.isInteger(value) && value === EDGE_DISCOVERY_MAX_SEARCH_TASKS;
}

export type EdgePublicDemoQuotaOutcome =
  | "allowed"
  | "concurrent_limit"
  | "global_daily_limit"
  | "session_daily_limit";

export function evaluateEdgePublicDemoQuota(input: {
  concurrentRuns: number;
  globalSearchTasksToday: number;
  sessionSearchTasksToday: number;
}): EdgePublicDemoQuotaOutcome {
  if (input.concurrentRuns >= EDGE_PUBLIC_DEMO_MAX_CONCURRENT_RUNS) {
    return "concurrent_limit";
  }
  if (
    input.globalSearchTasksToday >= EDGE_PUBLIC_DEMO_MAX_SEARCH_TASKS_PER_DAY
  ) {
    return "global_daily_limit";
  }
  if (
    input.sessionSearchTasksToday >=
      EDGE_PUBLIC_DEMO_MAX_SEARCH_TASKS_PER_SESSION_PER_DAY
  ) {
    return "session_daily_limit";
  }
  return "allowed";
}

export function canCreateEdgeSearchTask(input: {
  taskCount: number;
  searchTaskLimit: number;
}): boolean {
  return input.taskCount < input.searchTaskLimit;
}

export function canInspectEdgeDiscoveryResult(
  inspectedResultCount: number,
): boolean {
  return inspectedResultCount < EDGE_DISCOVERY_MAX_RESULTS;
}

export function resolveEdgeDiscoveryTerminalStatus(input: {
  taskCount: number;
  failedTaskCount: number;
  persistedResultCount: number;
}): "completed" | "failed" {
  if (
    input.persistedResultCount === 0 &&
    input.failedTaskCount > 0 &&
    input.failedTaskCount >= input.taskCount
  ) {
    return "failed";
  }

  return "completed";
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

import {
  canCreateEdgeSearchTask,
  canInspectEdgeDiscoveryResult,
  distributeEdgeDiscoveryTaskBudget,
  EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS,
  EDGE_DISCOVERY_MAX_RESULTS,
  EDGE_DISCOVERY_MAX_SEARCH_TASKS,
  EDGE_PUBLIC_DEMO_MAX_CONCURRENT_RUNS,
  EDGE_PUBLIC_DEMO_MAX_SEARCH_TASKS_PER_DAY,
  EDGE_PUBLIC_DEMO_MAX_SEARCH_TASKS_PER_SESSION_PER_DAY,
  EDGE_PUBLIC_DEMO_US_CITIES,
  edgeDiscoveryTaskResultAllowance,
  evaluateEdgePublicDemoQuota,
  isEdgeDiscoverySearchTaskLimit,
  planEdgeDiscoveryTaskTargets,
  resolveDiscoveryProgressTotal,
  resolveEdgeDiscoveryTerminalStatus,
  resolveWorkerDiscoveryBusinessCounts,
} from "./discovery-limits.ts";

Deno.test("duplicate-heavy discovery cannot inspect more than the result cap", () => {
  let inspectedResultCount = 0;
  let taskCount = 0;

  while (
    canCreateEdgeSearchTask({
      taskCount,
      searchTaskLimit: 5,
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
  if (taskCount !== 5) {
    throw new Error(
      "The result cap should not prevent the remaining bounded provider tasks",
    );
  }
});

Deno.test("task budget remains the limiting factor for sparse results", () => {
  let inspectedResultCount = 0;
  let taskCount = 0;

  while (
    canCreateEdgeSearchTask({
      taskCount,
      searchTaskLimit: 5,
    })
  ) {
    taskCount += 1;
    inspectedResultCount += 1;
  }

  if (taskCount !== 5 || inspectedResultCount !== 5) {
    throw new Error("Expected the five-task budget to stop sparse discovery");
  }
});

Deno.test("public demo discovery uses exactly five search tasks", () => {
  if (
    EDGE_DISCOVERY_DEFAULT_SEARCH_TASKS !== 5 ||
    EDGE_DISCOVERY_MAX_SEARCH_TASKS !== 5
  ) {
    throw new Error(
      "Expected the default and maximum task budgets to stay aligned at five",
    );
  }
  if (!isEdgeDiscoverySearchTaskLimit(5)) {
    throw new Error("Expected five search tasks to be allowed");
  }
  if (isEdgeDiscoverySearchTaskLimit(4) || isEdgeDiscoverySearchTaskLimit(6)) {
    throw new Error("Expected non-demo search-task budgets to be rejected");
  }
});

Deno.test("public demo discovery exposes the complete major US city set", () => {
  const expected = [
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
  ];
  if (JSON.stringify(EDGE_PUBLIC_DEMO_US_CITIES) !== JSON.stringify(expected)) {
    throw new Error(
      "Expected the public demo to expose every supported major US city",
    );
  }
});

Deno.test("full discovery distributes five tasks across ICPs and cities", () => {
  const targets = planEdgeDiscoveryTaskTargets({
    icpCount: 4,
    countries: ["US"],
    cities: [...EDGE_PUBLIC_DEMO_US_CITIES],
    searchTaskLimit: 5,
  });
  if (targets.length !== 5) {
    throw new Error("Expected all five provider tasks to be planned");
  }
  if (new Set(targets.map((target) => target.icpIndex)).size !== 4) {
    throw new Error("Expected every selected ICP to receive a provider task");
  }
  if (new Set(targets.map((target) => target.city)).size !== 5) {
    throw new Error("Expected each task to target a different city");
  }
});

Deno.test("worker discovery shards preserve the complete five-task budget", () => {
  const budgets = distributeEdgeDiscoveryTaskBudget(5, 4);
  if (JSON.stringify(budgets) !== JSON.stringify([2, 1, 1, 1])) {
    throw new Error(
      "Expected five tasks to be distributed across all four ICP shards",
    );
  }
  if (budgets.reduce((total, value) => total + value, 0) !== 5) {
    throw new Error(
      "Expected the shard budgets to sum to the public run budget",
    );
  }
});

Deno.test("same-run cross-task deduplication is not reported as already known", () => {
  const counts = resolveWorkerDiscoveryBusinessCounts([
    { id: "business_1", discovery_run_id: "run_1" },
    { id: "business_2", discovery_run_id: "run_1" },
    { id: "business_3", discovery_run_id: "run_older" },
  ], "run_1");

  if (counts.newBusinesses !== 2 || counts.alreadyKnown !== 1) {
    throw new Error(
      "Expected ownership to distinguish new and preexisting businesses",
    );
  }
});

Deno.test("result inspection capacity is distributed across every planned task", () => {
  let inspectedResultCount = 0;
  const allowances: number[] = [];
  for (let taskIndex = 0; taskIndex < 5; taskIndex += 1) {
    const allowance = edgeDiscoveryTaskResultAllowance({
      inspectedResultCount,
      taskIndex,
      plannedTaskCount: 5,
    });
    allowances.push(allowance);
    inspectedResultCount += allowance;
  }
  if (JSON.stringify(allowances) !== JSON.stringify([2, 2, 2, 2, 2])) {
    throw new Error(
      "Expected the ten-result safety cap to allocate two results per task",
    );
  }
});

Deno.test("public demo discovery quotas bound concurrent and reserved search-task usage", () => {
  if (
    evaluateEdgePublicDemoQuota({
      concurrentRuns: 0,
      globalSearchTasksToday: 0,
      sessionSearchTasksToday: 0,
    }) !== "allowed"
  ) {
    throw new Error("Expected an unused public quota to allow a run");
  }
  if (
    evaluateEdgePublicDemoQuota({
      concurrentRuns: EDGE_PUBLIC_DEMO_MAX_CONCURRENT_RUNS,
      globalSearchTasksToday: 0,
      sessionSearchTasksToday: 0,
    }) !== "concurrent_limit"
  ) {
    throw new Error("Expected the concurrent public quota to block a run");
  }
  if (
    evaluateEdgePublicDemoQuota({
      concurrentRuns: 0,
      globalSearchTasksToday: EDGE_PUBLIC_DEMO_MAX_SEARCH_TASKS_PER_DAY,
      sessionSearchTasksToday: 0,
    }) !== "global_daily_limit"
  ) {
    throw new Error("Expected the global daily public quota to block a run");
  }
  if (
    evaluateEdgePublicDemoQuota({
      concurrentRuns: 0,
      globalSearchTasksToday: 0,
      sessionSearchTasksToday:
        EDGE_PUBLIC_DEMO_MAX_SEARCH_TASKS_PER_SESSION_PER_DAY,
    }) !== "session_daily_limit"
  ) {
    throw new Error("Expected the session daily public quota to block a run");
  }
});

Deno.test("successful zero-result discovery is completed rather than failed", () => {
  if (
    resolveEdgeDiscoveryTerminalStatus({
      taskCount: 1,
      failedTaskCount: 0,
      persistedResultCount: 0,
    }) !== "completed"
  ) {
    throw new Error("Expected a successful zero-result task to complete");
  }
});

Deno.test("discovery fails only when every attempted task fails", () => {
  if (
    resolveEdgeDiscoveryTerminalStatus({
      taskCount: 2,
      failedTaskCount: 2,
      persistedResultCount: 0,
    }) !== "failed"
  ) {
    throw new Error("Expected all failed tasks to fail the run");
  }
  if (
    resolveEdgeDiscoveryTerminalStatus({
      taskCount: 2,
      failedTaskCount: 1,
      persistedResultCount: 0,
    }) !== "completed"
  ) {
    throw new Error("Expected a mixed run to retain completed durable status");
  }
  if (
    resolveEdgeDiscoveryTerminalStatus({
      taskCount: 1,
      failedTaskCount: 1,
      persistedResultCount: 1,
    }) !== "completed"
  ) {
    throw new Error(
      "Expected persisted results to prevent a wholly failed run",
    );
  }
});

Deno.test("edge discovery progress uses inspected totals instead of only new businesses", () => {
  const total = resolveDiscoveryProgressTotal({
    edgeMode: true,
    totalItems: 10,
    newFound: 1,
    newBusinesses: 1,
    processedItems: 10,
  });
  if (total !== 10) {
    throw new Error(
      "Expected duplicate-heavy edge progress to remain 10 out of 10",
    );
  }

  const legacyTotal = resolveDiscoveryProgressTotal({
    edgeMode: false,
    totalItems: 25,
    newFound: 7,
    newBusinesses: 7,
    processedItems: 7,
  });
  if (legacyTotal !== 7) {
    throw new Error(
      "Expected historical worker progress semantics to remain unchanged",
    );
  }

  const inconsistentLegacyTotal = resolveDiscoveryProgressTotal({
    edgeMode: false,
    totalItems: 58,
    newFound: 58,
    newBusinesses: 58,
    processedItems: 103,
  });
  if (inconsistentLegacyTotal !== 103) {
    throw new Error(
      "Expected displayed progress totals to never trail completed work",
    );
  }
});

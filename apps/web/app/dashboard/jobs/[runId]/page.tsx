'use client';

import type {
  DiscoveryRunStatusResponse,
  IcpProfileResponse,
  PipelineRunStatus,
} from '@lead-flood/contracts';
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Globe,
  Layers,
  Search,
  Target,
  Users,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';

// ── Status badge (reused from list page) ─────────────────────────────────
const STATUS_CONFIG: Record<
  PipelineRunStatus,
  { label: string; dotClass: string; bgClass: string; textClass: string }
> = {
  QUEUED: {
    label: 'Queued',
    dotClass: 'bg-muted-foreground/50',
    bgClass: 'bg-muted-foreground/10',
    textClass: 'text-muted-foreground',
  },
  RUNNING: {
    label: 'Running',
    dotClass: 'bg-blue-400 animate-pulse',
    bgClass: 'bg-blue-500/10',
    textClass: 'text-blue-400',
  },
  SUCCEEDED: {
    label: 'Completed',
    dotClass: 'bg-zbooni-green',
    bgClass: 'bg-zbooni-green/10',
    textClass: 'text-zbooni-green',
  },
  FAILED: {
    label: 'Failed',
    dotClass: 'bg-red-400',
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-400',
  },
  PARTIAL: {
    label: 'Partial',
    dotClass: 'bg-yellow-400',
    bgClass: 'bg-yellow-500/10',
    textClass: 'text-yellow-400',
  },
};

function StatusBadge({ status }: { status: PipelineRunStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${cfg.bgClass} ${cfg.textClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotClass}`} />
      {cfg.label}
    </span>
  );
}

// ── Mock data types for drill-down (Contract 5 — endpoint pending) ───────
interface MockSearchTask {
  id: string;
  query: string;
  country: string;
  city: string | null;
  provider: string;
  status: 'completed' | 'failed' | 'running';
  resultsCount: number;
  businesses: MockBusiness[];
  errorMessage: string | null;
}

interface MockBusiness {
  id: string;
  name: string;
  domain: string | null;
  score: number | null;
  preQualified: boolean;
  convertedToLead: boolean;
  leadId: string | null;
  disqualificationReason: string | null;
}

interface MockCostEntry {
  provider: string;
  calls: number;
  costCents: number;
}

// ── Generate mock data based on run info ─────────────────────────────────
function generateMockData(run: DiscoveryRunStatusResponse) {
  const tasks: MockSearchTask[] = [];
  const taskCount = Math.min(run.totalItems, 5);

  for (let i = 0; i < taskCount; i++) {
    const isCompleted = i < run.processedItems;
    const isFailed = !isCompleted && i < run.processedItems + run.failedItems;
    const bizCount = isCompleted ? Math.floor(Math.random() * 8) + 2 : 0;

    const businesses: MockBusiness[] = [];
    for (let j = 0; j < bizCount; j++) {
      const converted = Math.random() > 0.4;
      businesses.push({
        id: `biz-${i}-${j}`,
        name: `Business ${i + 1}.${j + 1}`,
        domain: `example-${i}-${j}.com`,
        score: converted ? Math.round(Math.random() * 70 + 20) / 100 : null,
        preQualified: Math.random() > 0.2,
        convertedToLead: converted,
        leadId: converted ? `lead-${i}-${j}` : null,
        disqualificationReason: !converted && Math.random() > 0.5 ? 'No valid email found' : null,
      });
    }

    tasks.push({
      id: `task-${i}`,
      query: `"payment solutions" OR "fintech" in UAE region ${i + 1}`,
      country: 'AE',
      city: i % 2 === 0 ? 'Dubai' : 'Abu Dhabi',
      provider: i % 3 === 0 ? 'SERPAPI' : 'GOOGLE_PLACES',
      status: isCompleted ? 'completed' : isFailed ? 'failed' : 'running',
      resultsCount: bizCount,
      businesses,
      errorMessage: isFailed ? 'Provider rate limit exceeded' : null,
    });
  }

  const costs: MockCostEntry[] = [
    { provider: 'SerpAPI', calls: Math.max(1, taskCount), costCents: taskCount * 50 },
    { provider: 'Hunter', calls: Math.floor(taskCount * 0.6), costCents: Math.floor(taskCount * 0.6) * 20 },
    { provider: 'Apify (Website)', calls: Math.floor(taskCount * 0.8), costCents: Math.floor(taskCount * 0.8) * 10 },
  ];

  return { tasks, costs };
}

// ── Metric card ──────────────────────────────────────────────────────────
function MetricCard({
  label,
  value,
  icon: Icon,
  iconColor,
  bgColor,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  bgColor: string;
}) {
  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
      <div className="flex items-center gap-2">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${bgColor}`}
        >
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
      </div>
      <p className="mt-2 text-2xl font-extrabold tracking-tight">{value}</p>
    </div>
  );
}

// ── Search task accordion item ───────────────────────────────────────────
function SearchTaskItem({ task }: { task: MockSearchTask }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusColor =
    task.status === 'completed'
      ? 'text-zbooni-green'
      : task.status === 'failed'
        ? 'text-red-400'
        : 'text-blue-400';

  return (
    <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 overflow-hidden">
      {/* Task header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{task.query}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/40">
              {task.country}
              {task.city ? ` / ${task.city}` : ''}
            </span>
            <span className="text-[10px] text-muted-foreground/25">|</span>
            <span className="text-[10px] text-muted-foreground/40">
              {task.provider}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-xs font-bold capitalize ${statusColor}`}>
            {task.status}
          </span>
          <span className="rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums">
            {task.resultsCount}
          </span>
        </div>
      </button>

      {/* Expanded: business list */}
      {isExpanded && (
        <div className="border-t border-border/15 bg-zbooni-dark/10 px-4 py-3">
          {task.businesses.length > 0 ? (
            <div className="space-y-2">
              {task.businesses.map((biz) => (
                <div
                  key={biz.id}
                  className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{biz.name}</p>
                    {biz.domain && (
                      <p className="text-[10px] text-muted-foreground/40">
                        {biz.domain}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {biz.score !== null && (
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          biz.score >= 0.67
                            ? 'bg-zbooni-green/10 text-zbooni-green'
                            : biz.score >= 0.34
                              ? 'bg-yellow-500/10 text-yellow-400'
                              : 'bg-red-500/10 text-red-400'
                        }`}
                      >
                        {biz.score.toFixed(2)}
                      </span>
                    )}
                    {biz.convertedToLead && biz.leadId ? (
                      <span className="rounded-md bg-zbooni-teal/10 px-2 py-0.5 text-[10px] font-bold text-zbooni-teal">
                        Converted
                      </span>
                    ) : biz.disqualificationReason ? (
                      <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400/60">
                        Disqualified
                      </span>
                    ) : biz.preQualified ? (
                      <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400/60">
                        Pre-qualified
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : task.errorMessage ? (
            <p className="text-xs text-red-400/70">{task.errorMessage}</p>
          ) : (
            <p className="text-xs text-muted-foreground/40">
              No businesses discovered yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Duration formatter ───────────────────────────────────────────────────
function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return 'Not started';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return '<1s';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

// ── Main page ────────────────────────────────────────────────────────────
export default function DiscoveryRunDetailPage() {
  const { apiClient } = useAuth();
  const router = useRouter();
  const params = useParams();
  const runId = params.runId as string;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [errorsExpanded, setErrorsExpanded] = useState(false);

  // Fetch run status
  const run = useApiQuery<DiscoveryRunStatusResponse>(
    useCallback(
      () => apiClient.getDiscoveryRunStatus(runId),
      [apiClient, runId],
    ),
    [runId],
  );

  // Fetch ICP profile if available
  const icpProfileId = (run.data as { icpProfileId?: string | undefined } | null)
    ?.icpProfileId;

  const icp = useApiQuery<IcpProfileResponse>(
    useCallback(() => {
      if (!icpProfileId) return Promise.resolve(null as unknown as IcpProfileResponse);
      return apiClient.getIcp(icpProfileId);
    }, [apiClient, icpProfileId]),
    [icpProfileId],
  );

  // Auto-refresh while running
  const isActive =
    run.data?.status === 'RUNNING' || run.data?.status === 'QUEUED';

  useEffect(() => {
    if (isActive) {
      intervalRef.current = setInterval(() => {
        run.refetch();
      }, 10_000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, run.refetch]);

  // Generate mock drill-down data
  const mockData = useMemo(() => {
    if (!run.data) return null;
    return generateMockData(run.data);
  }, [run.data]);

  const failedTasks = mockData?.tasks.filter((t) => t.status === 'failed') ?? [];
  const totalBizCount = mockData?.tasks.reduce((sum, t) => sum + t.businesses.length, 0) ?? 0;
  const totalLeadCount =
    mockData?.tasks.reduce(
      (sum, t) => sum + t.businesses.filter((b) => b.convertedToLead).length,
      0,
    ) ?? 0;
  const totalCostCents =
    mockData?.costs.reduce((sum, c) => sum + c.costCents, 0) ?? 0;

  // Not found state
  if (run.error && !run.isLoading) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => router.push('/dashboard/jobs')}
          className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Discovery Runs
        </button>
        <div className="rounded-2xl border border-border/50 bg-card p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-bold text-foreground/80">Run not found</p>
          <p className="mt-1 text-[11px] text-muted-foreground/50">
            The run ID &ldquo;{runId.slice(0, 8)}...&rdquo; could not be loaded.
          </p>
          <p className="mt-0.5 text-[11px] text-red-400/60">{run.error}</p>
        </div>
      </div>
    );
  }

  // Loading state
  if (run.isLoading && !run.data) {
    return (
      <div className="space-y-6">
        <div className="h-5 w-40 animate-pulse rounded bg-border/20" />
        <div className="h-20 animate-pulse rounded-2xl bg-zbooni-dark/30" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-zbooni-dark/30" />
          ))}
        </div>
      </div>
    );
  }

  if (!run.data) return null;

  const shortId = run.data.runId.slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        type="button"
        onClick={() => router.push('/dashboard/jobs')}
        className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Discovery Runs
      </button>

      {/* Header */}
      <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-extrabold tracking-tight">
                Run {shortId}
              </h1>
              <StatusBadge status={run.data.status} />
            </div>
            <div className="mt-1.5 flex items-center gap-4 text-[11px] text-muted-foreground/50">
              {icp.data?.name && (
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  {icp.data.name}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Started{' '}
                {run.data.startedAt
                  ? new Date(run.data.startedAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Pending'}
              </span>
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                Duration: {formatDuration(run.data.startedAt, run.data.endedAt ?? null)}
              </span>
            </div>
          </div>
          {isActive && (
            <div className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1.5">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                Live
              </span>
            </div>
          )}
        </div>

        {/* Progress bar for active runs */}
        {isActive && run.data.totalItems > 0 && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-border/30">
              <div
                className="h-full rounded-full bg-blue-400 transition-all duration-700 ease-out"
                style={{
                  width: `${Math.max(
                    Math.round(
                      (run.data.processedItems / run.data.totalItems) * 100,
                    ),
                    run.data.processedItems > 0 ? 3 : 0,
                  )}%`,
                }}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/40">
              {run.data.processedItems} of {run.data.totalItems} tasks processed
            </p>
          </div>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Search Tasks"
          value={run.data.totalItems}
          icon={Search}
          iconColor="text-blue-400"
          bgColor="bg-blue-500/10"
        />
        <MetricCard
          label="Businesses Found"
          value={totalBizCount}
          icon={Globe}
          iconColor="text-zbooni-teal"
          bgColor="bg-zbooni-teal/10"
        />
        <MetricCard
          label="Leads Converted"
          value={totalLeadCount}
          icon={Users}
          iconColor="text-zbooni-green"
          bgColor="bg-zbooni-green/10"
        />
        <MetricCard
          label="Total Cost"
          value={`$${(totalCostCents / 100).toFixed(2)}`}
          icon={DollarSign}
          iconColor="text-yellow-400"
          bgColor="bg-yellow-500/10"
        />
      </div>

      {/* Mock data notice */}
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-2.5">
        <p className="text-[11px] text-yellow-400/70">
          Detailed drill-down data is simulated. The details API (Contract 5) will
          provide real search task and business data post-integration.
        </p>
      </div>

      {/* Search Tasks accordion */}
      {mockData && mockData.tasks.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Search className="h-4 w-4 text-blue-400" />
            <h2 className="text-base font-bold tracking-tight">Search Tasks</h2>
            <span className="ml-auto rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-muted-foreground/60">
              {mockData.tasks.length}
            </span>
          </div>
          <div className="space-y-2">
            {mockData.tasks.map((task) => (
              <SearchTaskItem key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}

      {/* Errors section (collapsed by default) */}
      {failedTasks.length > 0 && (
        <div className="rounded-2xl border border-red-500/20 bg-card p-5 shadow-sm">
          <button
            type="button"
            onClick={() => setErrorsExpanded(!errorsExpanded)}
            className="flex w-full items-center gap-2 text-left"
          >
            <AlertCircle className="h-4 w-4 text-red-400" />
            <h2 className="text-base font-bold tracking-tight">
              Errors
            </h2>
            <span className="rounded-md bg-red-500/10 px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-red-400">
              {failedTasks.length}
            </span>
            <ChevronDown
              className={`ml-auto h-4 w-4 text-muted-foreground/40 transition-transform ${errorsExpanded ? 'rotate-180' : ''}`}
            />
          </button>
          {errorsExpanded && (
            <div className="mt-3 space-y-2">
              {failedTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg bg-red-500/5 px-3 py-2"
                >
                  <p className="text-xs font-semibold text-foreground/80">
                    {task.query}
                  </p>
                  <p className="mt-0.5 text-[11px] text-red-400/70">
                    {task.errorMessage ?? 'Unknown error'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cost breakdown */}
      {mockData && mockData.costs.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-yellow-400" />
            <h2 className="text-base font-bold tracking-tight">
              Cost Breakdown
            </h2>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/20">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/20 bg-zbooni-dark/20">
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
                    Provider
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
                    API Calls
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {mockData.costs.map((cost) => (
                  <tr
                    key={cost.provider}
                    className="border-b border-border/10 last:border-0"
                  >
                    <td className="px-4 py-2.5 text-xs font-semibold">
                      {cost.provider}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {cost.calls}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-bold tabular-nums">
                      ${(cost.costCents / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-zbooni-dark/10">
                  <td className="px-4 py-2.5 text-xs font-bold">Total</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {mockData.costs.reduce((s, c) => s + c.calls, 0)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-extrabold tabular-nums text-yellow-400">
                    ${(totalCostCents / 100).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Error message for the run itself */}
      {run.data.errorMessage && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3">
          <p className="text-xs font-bold text-red-400">Run Error</p>
          <p className="mt-0.5 text-[11px] text-red-400/70">
            {run.data.errorMessage}
          </p>
        </div>
      )}
    </div>
  );
}

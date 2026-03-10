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
  RefreshCw,
  Search,
  Target,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';
import { countryName } from '../../../../src/lib/countries.js';
import { getWebEnv } from '../../../../src/lib/env.js';
import { getSupabaseBrowserClient } from '../../../../src/lib/supabase-client.js';

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
    label: 'Successful',
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
  CANCELLED: {
    label: 'Cancelled',
    dotClass: 'bg-muted-foreground/50',
    bgClass: 'bg-muted-foreground/10',
    textClass: 'text-muted-foreground',
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

// ── Types for real API data ──────────────────────────────────────────────
interface SearchTaskData {
  id: string;
  queryText: string;
  countryCode: string;
  city: string | null;
  status: string;
  resultsCount: number;
  provider: string;
  error?: string | null;
}

interface BusinessData {
  id: string;
  name: string;
  websiteDomain: string | null;
  deterministicScore: number | null;
  scoreBand: string | null;
  preQualified: boolean;
  disqualificationReason: string | null;
  searchTaskId: string | null;
}

interface CostEventData {
  id: string;
  provider: string;
  action: string;
  creditCost: number;
  createdAt: string;
}

const KNOWN_COST_PROVIDERS = [
  'GOOGLE_PLACES',
  'GOOGLE_CUSTOM_SEARCH',
  'HUNTER',
  'APOLLO',
] as const;

interface OutcomeData {
  businessesFound: number;
  businessesDisqualified: number;
  leadsCreated: number;
  messagesDrafted: number;
  disqualificationReasons?: Record<string, number>;
}

interface RunDetailsResponse {
  run: Record<string, unknown> & {
    errorMessage?: string | null;
    outcome?: OutcomeData | null;
  };
  searchTasks: SearchTaskData[];
  businesses: BusinessData[];
  leads: Array<Record<string, unknown>>;
  costEvents: CostEventData[];
}

interface CancelRunResponse {
  success: boolean;
  outcome: 'cancelled' | 'already_cancelled' | 'already_terminal';
  terminalStatus: 'cancelled' | 'completed' | 'failed';
  cancelledPendingJobsCount: number;
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
function SearchTaskItem({
  task,
  businesses,
}: {
  task: SearchTaskData;
  businesses: BusinessData[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const normalizedStatus = task.status === 'DONE' ? 'completed' : task.status === 'FAILED' ? 'failed' : 'running';
  const statusColor =
    normalizedStatus === 'completed'
      ? 'text-zbooni-green'
      : normalizedStatus === 'failed'
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
          <p className="truncate text-xs font-semibold">{task.queryText}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/40">
              {countryName(task.countryCode)}
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
            {normalizedStatus}
          </span>
          <span className="rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums">
            {businesses.length}
          </span>
        </div>
      </button>

      {/* Expanded: business list */}
      {isExpanded && (
        <div className="border-t border-border/15 bg-zbooni-dark/10 px-4 py-3">
          {businesses.length > 0 ? (
            <div className="space-y-2">
              {businesses.map((biz) => (
                <div
                  key={biz.id}
                  className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{biz.name}</p>
                    {biz.websiteDomain && (
                      <p className="text-[10px] text-muted-foreground/40">
                        {biz.websiteDomain}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {biz.deterministicScore !== null && (
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          biz.deterministicScore >= 0.67
                            ? 'bg-zbooni-green/10 text-zbooni-green'
                            : biz.deterministicScore >= 0.34
                              ? 'bg-yellow-500/10 text-yellow-400'
                              : 'bg-red-500/10 text-red-400'
                        }`}
                      >
                        {biz.deterministicScore.toFixed(2)}
                      </span>
                    )}
                    {biz.scoreBand ? (
                      <span className="rounded-md bg-zbooni-teal/10 px-2 py-0.5 text-[10px] font-bold text-zbooni-teal">
                        {biz.scoreBand}
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

// ── Aggregate cost events by provider ────────────────────────────────────
function aggregateCosts(events: CostEventData[]) {
  const map = new Map<string, { calls: number; costCents: number }>();
  for (const provider of KNOWN_COST_PROVIDERS) {
    map.set(provider, { calls: 0, costCents: 0 });
  }
  for (const e of events) {
    const existing = map.get(e.provider) ?? { calls: 0, costCents: 0 };
    existing.calls += 1;
    existing.costCents += e.creditCost;
    map.set(e.provider, existing);
  }
  return Array.from(map.entries()).map(([provider, data]) => ({
    provider,
    ...data,
  }));
}

function formatProviderName(provider: string): string {
  if (provider === 'SERPAPI') return 'GOOGLE_PLACES';
  return provider;
}

// ── Main page ────────────────────────────────────────────────────────────
export default function DiscoveryRunDetailPage() {
  const { apiClient, token } = useAuth();
  const router = useRouter();
  const params = useParams();
  const runId = params.runId as string;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Fetch run status
  const run = useApiQuery<DiscoveryRunStatusResponse>(
    useCallback(
      () => apiClient.getDiscoveryRunStatus(runId),
      [apiClient, runId],
    ),
    [runId],
  );

  // Fetch run details (real data from API)
  const details = useApiQuery<RunDetailsResponse>(
    useCallback(
      () => apiClient.getDiscoveryRunDetails(runId),
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
        details.refetch();
      }, 10_000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, run.refetch, details.refetch]);

  const handleCancelRun = async () => {
    setCancelPending(true);
    setCancelError(null);
    setCancelNotice(null);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`${getWebEnv().NEXT_PUBLIC_API_BASE_URL}/v1/discovery-admin/runs/${runId}/cancel`, {
        method: 'POST',
        headers,
      });

      const responseBody = await res.json().catch(() => null) as CancelRunResponse | { error?: string; message?: string } | null;

      if (!res.ok) {
        // Guard against raw backend errors: if cancel actually succeeded, show success.
        const latestRun = await apiClient.getDiscoveryRunStatus(runId).catch(() => null);
        if (latestRun?.status === 'CANCELLED') {
          setCancelNotice('Run Cancelled');
          setShowCancelConfirm(false);
          run.refetch();
          details.refetch();
          return;
        }

        const errorMessage =
          responseBody && 'error' in responseBody
            ? (responseBody.error ?? responseBody.message)
            : undefined;
        throw new Error(errorMessage ?? `Cancel failed (${res.status})`);
      }

      const cancelResult =
        responseBody && 'success' in responseBody
          ? responseBody as CancelRunResponse
          : null;

      if (cancelResult?.outcome === 'already_terminal') {
        setCancelNotice(
          cancelResult.terminalStatus === 'completed'
            ? 'Run already completed'
            : cancelResult.terminalStatus === 'failed'
              ? 'Run already failed'
              : 'Run already cancelled',
        );
      } else {
        setCancelNotice('Run Cancelled');
      }

      run.refetch();
      details.refetch();
      setShowCancelConfirm(false);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Failed to cancel run');
    } finally {
      setCancelPending(false);
    }
  };

  // Derived data from real API response
  const searchTasks = (details.data?.searchTasks ?? []) as SearchTaskData[];
  const businesses = (details.data?.businesses ?? []) as BusinessData[];
  const costEvents = (details.data?.costEvents ?? []) as CostEventData[];
  const leads = details.data?.leads ?? [];

  const failedTasks = searchTasks.filter((t) => t.status === 'FAILED');
  const aggregatedCosts = useMemo(() => aggregateCosts(costEvents).filter((c) => c.calls > 0), [costEvents]);
  const totalCostCents = aggregatedCosts.reduce((sum, c) => sum + c.costCents, 0);

  // Fetch contact recovery items for businesses in this run
  const [recoveryItems, setRecoveryItems] = useState<Array<{ business_id: string; business_name: string; reason: string; status: string }>>([]);
  useEffect(() => {
    if (businesses.length === 0) return;
    let cancelled = false;
    async function fetchRecoveryItems() {
      try {
        const supabase = getSupabaseBrowserClient();
        const bizIds = businesses.map((b) => b.id);
        const { data } = await supabase
          .from('contact_recovery_items')
          .select('business_id, reason, status')
          .in('business_id', bizIds);
        if (cancelled || !data) return;
        const seen = new Set<string>();
        const items: Array<{ business_id: string; business_name: string; reason: string; status: string }> = [];
        for (const row of data as Array<{ business_id: string; reason: string; status: string }>) {
          if (!seen.has(row.business_id)) {
            seen.add(row.business_id);
            const biz = businesses.find((b) => b.id === row.business_id);
            items.push({
              business_id: row.business_id,
              business_name: biz?.name ?? 'Unknown',
              reason: row.reason,
              status: row.status,
            });
          }
        }
        setRecoveryItems(items);
      } catch {
        // Non-critical — fallback to showing all leads in single section
      }
    }
    void fetchRecoveryItems();
    return () => { cancelled = true; };
  }, [businesses]);

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
          <div className="flex items-center gap-2">
            {isActive && (
              <div className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                  Live
                </span>
              </div>
            )}
            {(run.data.status === 'RUNNING' || run.data.status === 'QUEUED') && !showCancelConfirm && (
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-400 transition-colors hover:bg-red-500/20"
              >
                Cancel Run
              </button>
            )}
            {showCancelConfirm && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5">
                <span className="text-[11px] text-red-400">Cancel this run?</span>
                <button
                  type="button"
                  onClick={() => void handleCancelRun()}
                  disabled={cancelPending}
                  className="rounded-md bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                >
                  {cancelPending ? 'Cancelling...' : 'Yes, Cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCancelConfirm(false); setCancelError(null); setCancelNotice(null); }}
                  className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                >
                  No
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Cancel error */}
        {cancelError && (
          <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
            {cancelError}
          </div>
        )}
        {cancelNotice && (
          <div className="mt-3 rounded-lg bg-zbooni-green/10 px-3 py-2 text-[11px] text-zbooni-green">
            {cancelNotice}
          </div>
        )}

        {/* Progress bar for active runs */}
        {isActive && (() => {
          const runConfig = (details.data?.run as Record<string, unknown> | undefined)?.config as Record<string, unknown> | undefined;
          const targetLeads = typeof runConfig?.limit === 'number' ? runConfig.limit : null;

          if (targetLeads !== null) {
            const leadsFound = leads.length;
            const progressPct = Math.max(
              Math.round((leadsFound / targetLeads) * 100),
              leadsFound > 0 ? 3 : 0,
            );
            return (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-border/30">
                  <div
                    className="h-full rounded-full bg-blue-400 transition-all duration-700 ease-out"
                    style={{ width: `${Math.min(progressPct, 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground/40">
                  {leadsFound} of {targetLeads} leads found
                </p>
              </div>
            );
          }

          if (run.data && run.data.totalItems > 0) {
            return (
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
            );
          }

          return null;
        })()}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Search Tasks"
          value={searchTasks.length || run.data.totalItems}
          icon={Search}
          iconColor="text-blue-400"
          bgColor="bg-blue-500/10"
        />
        <MetricCard
          label="Businesses Found"
          value={businesses.length}
          icon={Globe}
          iconColor="text-zbooni-teal"
          bgColor="bg-zbooni-teal/10"
        />
        <MetricCard
          label="Leads Converted"
          value={leads.length}
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

      {/* Outcome funnel — reads from resultJson (v2 fields or legacy outcome) */}
      {details.data && (() => {
        const runData = details.data.run as Record<string, unknown>;
        const outcome = runData.outcome as OutcomeData | null;
        // v2 resultJson fields (from Session A)
        const totalFound = typeof runData.totalFound === 'number' ? runData.totalFound : null;
        const alreadyKnown = typeof runData.alreadyKnown === 'number' ? runData.alreadyKnown : null;
        const newFound = typeof runData.newFound === 'number' ? runData.newFound : null;
        const disqualified = typeof runData.disqualified === 'number' ? runData.disqualified : null;
        const converted = typeof runData.converted === 'number' ? runData.converted : null;
        const hasV2 = totalFound !== null;

        // If neither v2 nor legacy outcome exists, skip
        if (!hasV2 && !outcome) return null;

        const REASON_LABELS: Record<string, string> = {
          ICP_INDUSTRY_MISMATCH: 'Wrong industry',
          NO_WEBSITE_DOMAIN: 'No website',
          DOMAIN_NOT_RESOLVING: 'Website unreachable',
          PARKED_DOMAIN: 'Parked domain',
          INSUFFICIENT_REVIEWS: 'Too few reviews',
          DNS_RESOLUTION_FAILED: 'DNS failed',
          NO_CONTACTS_FOUND: 'No contacts found',
          BUSINESS_NOT_FOUND: 'Business not found',
        };
        const reasons = outcome?.disqualificationReasons ?? {};
        const hasReasons = Object.keys(reasons).length > 0;

        // Build funnel steps: v2 format first, fallback to legacy
        const funnelSteps = hasV2
          ? [
              { label: 'Found', value: totalFound!, color: 'text-blue-400' },
              { label: 'Already Known', value: alreadyKnown ?? 0, color: 'text-muted-foreground' },
              { label: 'New', value: newFound ?? 0, color: 'text-zbooni-teal' },
              { label: 'Disqualified', value: disqualified ?? 0, color: 'text-red-400' },
              { label: 'Leads', value: converted ?? leads.length, color: 'text-zbooni-green' },
            ]
          : [
              { label: 'Businesses', value: outcome!.businessesFound, color: 'text-blue-400' },
              { label: 'Qualified', value: outcome!.businessesFound - outcome!.businessesDisqualified, color: 'text-zbooni-teal' },
              { label: 'Leads', value: outcome!.leadsCreated, color: 'text-zbooni-green' },
              { label: 'Messages', value: outcome!.messagesDrafted, color: 'text-yellow-400' },
            ];

        return (
          <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-base font-bold tracking-tight">Pipeline Funnel</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {funnelSteps.map((step, i) => (
                <div key={step.label} className="flex items-center gap-2">
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/20" />}
                  <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 px-3 py-2 text-center">
                    <p className={`text-lg font-extrabold tabular-nums ${step.color}`}>{step.value}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{step.label}</p>
                  </div>
                </div>
              ))}
            </div>
            {hasReasons && (
              <div className="mt-4 rounded-lg border border-border/20 bg-zbooni-dark/10 px-4 py-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/50">
                  Disqualification Reasons
                </p>
                <div className="space-y-1">
                  {Object.entries(reasons).map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between">
                      <span className="text-xs text-foreground/70">
                        {REASON_LABELS[reason] ?? reason}
                      </span>
                      <span className="font-mono text-xs font-bold tabular-nums text-red-400/70">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Converted Leads */}
      {leads.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-zbooni-green" />
            <h2 className="text-base font-bold tracking-tight">Converted Leads</h2>
            <span className="ml-auto rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-muted-foreground/60">
              {leads.length}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {leads.map((lead) => {
              const leadId = (lead as Record<string, unknown>).id as string | undefined;
              const firstName = (lead as Record<string, unknown>).firstName as string | undefined;
              const lastName = (lead as Record<string, unknown>).lastName as string | undefined;
              const companyName = (lead as Record<string, unknown>).companyName as string | null | undefined;
              const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

              return (
                <Link
                  key={leadId ?? Math.random().toString()}
                  href={leadId ? `/dashboard/leads/${leadId}` : '#'}
                  className="flex items-center gap-3 rounded-lg border border-border/20 bg-zbooni-dark/20 px-3 py-2.5 transition-colors hover:border-border/40 hover:bg-zbooni-dark/30"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zbooni-green/10">
                    <Users className="h-3.5 w-3.5 text-zbooni-green" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{displayName}</p>
                    {companyName ? (
                      <p className="truncate text-[10px] text-muted-foreground/50">{companyName}</p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {details.data && leads.length === 0 && recoveryItems.length === 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground/40" />
            <h2 className="text-base font-bold tracking-tight">Converted Leads</h2>
          </div>
          <p className="text-[11px] text-muted-foreground/40">No leads converted yet</p>
        </div>
      )}

      {/* Sent to Contact Recovery */}
      {recoveryItems.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-amber-400" />
            <h2 className="text-base font-bold tracking-tight">Sent to Contact Recovery</h2>
            <span className="ml-auto rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-muted-foreground/60">
              {recoveryItems.length}
            </span>
          </div>
          <p className="mb-3 text-[11px] text-muted-foreground/50">
            These businesses had potential but no verified contact was found. They were sent to the contact recovery pipeline for further processing.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recoveryItems.map((item) => (
              <Link
                key={item.business_id}
                href="/dashboard/leads/recovery"
                className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 transition-colors hover:border-amber-500/30 hover:bg-amber-500/10"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                  <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{item.business_name}</p>
                  <p className="truncate text-[10px] text-muted-foreground/50">
                    {item.reason.replace(/_/g, ' ')}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                  item.status === 'OPEN'
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-muted/20 text-muted-foreground/50'
                }`}>
                  {item.status}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Details loading indicator */}
      {details.isLoading && !details.data && (
        <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 px-4 py-3">
          <p className="text-[11px] text-muted-foreground/50">Loading run details...</p>
        </div>
      )}

      {/* Details error */}
      {details.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2.5">
          <p className="text-[11px] text-red-400/70">
            Failed to load run details: {details.error}
          </p>
        </div>
      )}

      {/* Search Tasks accordion */}
      {searchTasks.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Search className="h-4 w-4 text-blue-400" />
            <h2 className="text-base font-bold tracking-tight">Search Tasks</h2>
            <span className="ml-auto rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-muted-foreground/60">
              {searchTasks.length}
            </span>
          </div>
          <div className="space-y-2">
            {searchTasks.map((task) => (
              <SearchTaskItem
                key={task.id}
                task={task}
                businesses={businesses.filter((b) => b.searchTaskId === task.id)}
              />
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
                    {task.queryText}
                  </p>
                  <p className="mt-0.5 text-[11px] text-red-400/70">
                    {task.error || 'Task failed'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cost breakdown */}
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
                {aggregatedCosts.map((cost) => (
                  <tr
                    key={cost.provider}
                    className="border-b border-border/10 last:border-0"
                  >
                    <td className="px-4 py-2.5 text-xs font-semibold">
                      {formatProviderName(cost.provider)}
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
                    {aggregatedCosts.reduce((s, c) => s + c.calls, 0)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-extrabold tabular-nums text-yellow-400">
                    ${(totalCostCents / 100).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

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

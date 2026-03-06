'use client';

import type {
  DiscoveryRunSummary,
  ListDiscoveryRunsResponse,
  ListIcpProfilesResponse,
  PipelineRunStatus,
} from '@lead-flood/contracts';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  MapPin,
  Play,
  RefreshCw,
  Search,
  Target,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

// ── Constants ────────────────────────────────────────────────────────────
const AUTO_REFRESH_MS = 10_000;
const PAGE_SIZE = 12;

// ── Status config ────────────────────────────────────────────────────────
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
  CANCELLED: {
    label: 'Cancelled',
    dotClass: 'bg-muted-foreground/50',
    bgClass: 'bg-muted-foreground/10',
    textClass: 'text-muted-foreground',
  },
};

// ── Status badge ─────────────────────────────────────────────────────────
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

// ── Run card ─────────────────────────────────────────────────────────────
function RunCard({
  run,
  icpName,
  onClick,
}: {
  run: DiscoveryRunSummary;
  icpName: string;
  onClick: () => void;
}) {
  const createdDate = new Date(run.createdAt);
  const isActive = run.status === 'RUNNING' || run.status === 'QUEUED';
  const progressPct =
    run.totalItems > 0
      ? Math.round((run.processedItems / run.totalItems) * 100)
      : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 text-left transition-all hover:border-border/60 hover:bg-zbooni-dark/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {/* Top row: ICP + Status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tracking-tight group-hover:text-foreground">
            {icpName}
          </p>
          <p className="mt-0.5 text-[10px] font-medium text-muted-foreground/40">
            {createdDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}{' '}
            at{' '}
            {createdDate.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        <StatusBadge status={run.status} />
      </div>

      {/* Countries */}
      {run.countries.length > 0 && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <Globe className="h-3 w-3 shrink-0 text-muted-foreground/30" />
          <p className="truncate text-[11px] text-muted-foreground/50">
            {run.countries.join(', ')}
          </p>
        </div>
      )}

      {/* Progress bar for active runs */}
      {isActive && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/30">
            <div
              className="h-full rounded-full bg-blue-400 transition-all duration-500 ease-out"
              style={{
                width: `${Math.max(progressPct, run.processedItems > 0 ? 3 : 0)}%`,
              }}
            />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground/40">
            {progressPct}% complete
          </p>
        </div>
      )}

      {/* Metrics row */}
      <div className="mt-3 flex items-center gap-4 border-t border-border/20 pt-3">
        <div className="flex items-center gap-1.5">
          <Search className="h-3 w-3 text-blue-400/60" />
          <span className="text-[11px] text-muted-foreground/50">Tasks</span>
          <span className="font-mono text-xs font-bold tabular-nums">
            {run.totalItems}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Target className="h-3 w-3 text-zbooni-green/60" />
          <span className="text-[11px] text-muted-foreground/50">Done</span>
          <span className="font-mono text-xs font-bold tabular-nums text-zbooni-green">
            {run.processedItems}
          </span>
        </div>
        {run.failedItems > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3 text-red-400/60" />
            <span className="text-[11px] text-muted-foreground/50">Failed</span>
            <span className="font-mono text-xs font-bold tabular-nums text-red-400">
              {run.failedItems}
            </span>
          </div>
        )}
        {run.limit > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <MapPin className="h-3 w-3 text-muted-foreground/25" />
            <span className="text-[10px] text-muted-foreground/35">
              limit {run.limit}
            </span>
          </div>
        )}
      </div>

      {/* Error message for failed runs */}
      {run.errorMessage && run.status === 'FAILED' && (
        <div className="mt-2 rounded-lg bg-red-500/5 px-2.5 py-1.5">
          <p className="line-clamp-2 text-[11px] text-red-400/70">
            {run.errorMessage}
          </p>
        </div>
      )}
    </button>
  );
}

// ── Card skeleton ────────────────────────────────────────────────────────
function RunCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <div className="h-4 w-32 rounded bg-border/20" />
          <div className="h-2.5 w-24 rounded bg-border/15" />
        </div>
        <div className="h-5 w-16 rounded-full bg-border/15" />
      </div>
      <div className="mt-4 flex items-center gap-4 border-t border-border/20 pt-3">
        <div className="h-3 w-16 rounded bg-border/15" />
        <div className="h-3 w-16 rounded bg-border/15" />
      </div>
    </div>
  );
}

// ── Multi-ICP label builder ──────────────────────────────────────────────
function buildIcpLabel(run: DiscoveryRunSummary, nameMap: Map<string, string>): string {
  const ids = run.icpProfileIds?.length ? run.icpProfileIds : (run.icpProfileId ? [run.icpProfileId] : []);
  if (ids.length === 0) return 'All Profiles';
  const firstWords = ids.map((id) => {
    const name = nameMap.get(id) ?? 'Unknown';
    return name.split(/\s+/)[0] ?? name;
  });
  if (firstWords.length <= 3) return firstWords.join(' & ');
  return `${firstWords.slice(0, 2).join(' & ')} +${firstWords.length - 2}`;
}

// ── Main page ────────────────────────────────────────────────────────────
export default function DiscoveryRunsPage() {
  const { apiClient } = useAuth();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch discovery runs
  const runs = useApiQuery<ListDiscoveryRunsResponse>(
    useCallback(
      () => apiClient.listDiscoveryRuns({ page, pageSize: PAGE_SIZE }),
      [apiClient, page],
    ),
    [page],
  );

  // Fetch ICP profiles for name mapping
  const icps = useApiQuery<ListIcpProfilesResponse>(
    useCallback(
      () => apiClient.listIcps({ page: 1, pageSize: 100 }),
      [apiClient],
    ),
  );

  // Build ICP id → name map
  const icpNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (icps.data) {
      for (const icp of icps.data.items) {
        map.set(icp.id, icp.name);
      }
    }
    return map;
  }, [icps.data]);

  // Check if any run is still active (needs auto-refresh)
  const hasActiveRun = useMemo(
    () =>
      runs.data?.runs.some(
        (r) => r.status === 'RUNNING' || r.status === 'QUEUED',
      ) ?? false,
    [runs.data],
  );

  // Auto-refresh every 10s while any run is active
  useEffect(() => {
    if (hasActiveRun) {
      intervalRef.current = setInterval(() => {
        runs.refetch();
      }, AUTO_REFRESH_MS);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasActiveRun, runs.refetch]);

  const handleManualRefresh = useCallback(() => {
    setIsRefreshing(true);
    runs.refetch();
    setTimeout(() => setIsRefreshing(false), 800);
  }, [runs.refetch]);

  // Pagination
  const totalPages = runs.data
    ? Math.max(1, Math.ceil(runs.data.total / PAGE_SIZE))
    : 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Discovery Runs
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Track and monitor your automated lead discovery campaigns
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {hasActiveRun && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Live
            </span>
          )}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={runs.isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/30 bg-zbooni-dark/40 text-muted-foreground/60 transition-colors hover:border-border/50 hover:text-foreground disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing || runs.isLoading ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Error state */}
      {runs.error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {runs.error}
        </div>
      )}

      {/* Run cards grid */}
      {runs.data && runs.data.runs.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {runs.data.runs.map((run) => (
              <RunCard
                key={run.runId}
                run={run}
                icpName={buildIcpLabel(run, icpNameMap)}
                onClick={() => router.push(`/dashboard/jobs/${run.runId}`)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/30 bg-zbooni-dark/40 text-muted-foreground/60 transition-colors hover:border-border/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/30 bg-zbooni-dark/40 text-muted-foreground/60 transition-colors hover:border-border/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      ) : runs.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <RunCardSkeleton key={i} />
          ))}
        </div>
      ) : null}

      {/* Empty state */}
      {runs.data && runs.data.runs.length === 0 && !runs.isLoading && (
        <div className="rounded-2xl border border-border/50 bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zbooni-dark/60">
            <Play className="h-5 w-5 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-bold text-foreground/80">
            No discovery runs yet
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/50">
            Start one from the{' '}
            <button
              type="button"
              onClick={() => router.push('/discovery')}
              className="font-semibold text-zbooni-teal hover:underline"
            >
              Discover
            </button>{' '}
            page to begin finding leads automatically.
          </p>
        </div>
      )}

      {/* Summary footer */}
      {runs.data && runs.data.total > 0 && (
        <div className="flex items-center justify-between border-t border-border/20 pt-3">
          <p className="text-[11px] text-muted-foreground/40">
            {runs.data.total} total run{runs.data.total !== 1 ? 's' : ''}
          </p>
          {hasActiveRun && (
            <p className="flex items-center gap-1.5 text-[11px] text-blue-400/60">
              <Clock className="h-3 w-3" />
              Auto-refreshing every 10s
            </p>
          )}
        </div>
      )}
    </div>
  );
}

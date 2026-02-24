'use client';

import type { FunnelResponse } from '@lead-flood/contracts';
import {
  ArrowRight,
  Cpu,
  Database,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

// ── Types ───────────────────────────────────────────────────────────
interface PipelineStage {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  colorClass: string;
  bgClass: string;
  barClass: string;
  getProcessed: (d: FunnelResponse) => number;
  getPending: (d: FunnelResponse) => number;
}

// ── Pipeline stage definitions ──────────────────────────────────────
const PIPELINE_STAGES: PipelineStage[] = [
  {
    key: 'discovery',
    label: 'Discovery',
    icon: Search,
    colorClass: 'text-blue-400',
    bgClass: 'bg-blue-500/15',
    barClass: 'bg-blue-400',
    getProcessed: (d) => d.discoveredCount,
    getPending: () => 0,
  },
  {
    key: 'enrichment',
    label: 'Enrichment',
    icon: Database,
    colorClass: 'text-zbooni-teal',
    bgClass: 'bg-zbooni-teal/15',
    barClass: 'bg-zbooni-teal',
    getProcessed: (d) => d.enrichedCount,
    getPending: (d) => Math.max(0, d.discoveredCount - d.enrichedCount),
  },
  {
    key: 'features',
    label: 'Feature Extraction',
    icon: Cpu,
    colorClass: 'text-purple-400',
    bgClass: 'bg-purple-500/15',
    barClass: 'bg-purple-400',
    getProcessed: (d) => d.qualifiedCount,
    getPending: (d) => Math.max(0, d.enrichedCount - d.qualifiedCount),
  },
  {
    key: 'scoring',
    label: 'Scoring',
    icon: TrendingUp,
    colorClass: 'text-yellow-400',
    bgClass: 'bg-yellow-500/15',
    barClass: 'bg-yellow-400',
    getProcessed: (d) => d.scoredCount,
    getPending: (d) => Math.max(0, d.enrichedCount - d.scoredCount),
  },
  {
    key: 'messaging',
    label: 'Messaging',
    icon: Send,
    colorClass: 'text-zbooni-green',
    bgClass: 'bg-zbooni-green/15',
    barClass: 'bg-zbooni-green',
    getProcessed: (d) => d.messagesSentCount,
    getPending: (d) => Math.max(0, d.scoredCount - d.messagesSentCount),
  },
  {
    key: 'followups',
    label: 'Follow-ups',
    icon: MessageSquare,
    colorClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/15',
    barClass: 'bg-emerald-400',
    getProcessed: (d) => d.repliesCount,
    getPending: (d) => Math.max(0, d.messagesSentCount - d.repliesCount),
  },
];

// ── Auto-refresh interval (ms) ─────────────────────────────────────
const REFRESH_INTERVAL_MS = 30_000;

// ── Pipeline Flow Strip ─────────────────────────────────────────────
function PipelineFlowStrip({ data }: { data: FunnelResponse }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="h-1.5 w-1.5 rounded-full bg-zbooni-green animate-pulse" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Pipeline Flow
        </p>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {PIPELINE_STAGES.map((stage, i) => {
          const processed = stage.getProcessed(data);
          const Icon = stage.icon;
          return (
            <div key={stage.key} className="flex items-center gap-1 shrink-0">
              <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-zbooni-dark/40 px-3 py-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-md ${stage.bgClass}`}>
                  <Icon className={`h-3.5 w-3.5 ${stage.colorClass}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-muted-foreground/50 leading-none">
                    {stage.label}
                  </p>
                  <p className={`text-sm font-extrabold tracking-tight ${stage.colorClass}`}>
                    {processed.toLocaleString()}
                  </p>
                </div>
              </div>
              {i < PIPELINE_STAGES.length - 1 ? (
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stage Card ──────────────────────────────────────────────────────
function StageCard({ stage, data }: { stage: PipelineStage; data: FunnelResponse }) {
  const Icon = stage.icon;
  const processed = stage.getProcessed(data);
  const pending = stage.getPending(data);
  const total = processed + pending;
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 100;
  const isComplete = pending === 0;

  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 transition-colors hover:border-border/50">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stage.bgClass}`}>
            <Icon className={`h-5 w-5 ${stage.colorClass}`} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight">{stage.label}</p>
            <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium">
              Stage
            </p>
          </div>
        </div>
        <div
          className={`h-2 w-2 rounded-full ${isComplete ? 'bg-zbooni-green' : 'bg-yellow-400 animate-pulse'}`}
          title={isComplete ? 'All caught up' : `${pending} pending`}
        />
      </div>

      {/* Metrics row */}
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Processed
          </p>
          <p className={`text-2xl font-extrabold tracking-tight ${stage.colorClass}`}>
            {processed.toLocaleString()}
          </p>
        </div>
        {pending > 0 ? (
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Pending
            </p>
            <p className="text-lg font-bold tracking-tight text-yellow-400">
              {pending.toLocaleString()}
            </p>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Pending
            </p>
            <p className="text-lg font-bold tracking-tight text-muted-foreground/30">0</p>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border/30">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${stage.barClass}`}
          style={{ width: `${Math.max(progressPct, processed > 0 ? 3 : 0)}%` }}
        />
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground/40 font-medium">
        {progressPct}% complete
      </p>
    </div>
  );
}

// ── Skeleton loader ─────────────────────────────────────────────────
function StageCardSkeleton() {
  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 animate-pulse">
      <div className="flex items-center gap-2.5">
        <div className="h-10 w-10 rounded-lg bg-border/20" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-24 rounded bg-border/20" />
          <div className="h-2.5 w-12 rounded bg-border/15" />
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div className="space-y-1">
          <div className="h-2.5 w-16 rounded bg-border/15" />
          <div className="h-6 w-12 rounded bg-border/20" />
        </div>
        <div className="space-y-1">
          <div className="h-2.5 w-14 rounded bg-border/15" />
          <div className="h-5 w-8 rounded bg-border/20" />
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full rounded-full bg-border/20" />
      <div className="mt-1.5 h-2 w-20 rounded bg-border/15" />
    </div>
  );
}

function FlowStripSkeleton() {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm animate-pulse">
      <div className="mb-4 flex items-center gap-2">
        <div className="h-1.5 w-1.5 rounded-full bg-border/20" />
        <div className="h-2.5 w-24 rounded bg-border/15" />
      </div>
      <div className="flex items-center gap-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1 shrink-0">
            <div className="h-11 w-32 rounded-lg bg-zbooni-dark/40" />
            {i < 5 ? <div className="h-3.5 w-3.5 rounded bg-border/15" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────
export default function JobsPage() {
  const { apiClient } = useAuth();
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const funnel = useApiQuery(
    useCallback(() => apiClient.getFunnel(), [apiClient]),
  );

  // Track refresh timestamps
  useEffect(() => {
    if (!funnel.isLoading && funnel.data) {
      setLastRefreshed(new Date());
    }
  }, [funnel.isLoading, funnel.data]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      funnel.refetch();
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [funnel.refetch]);

  const handleManualRefresh = useCallback(() => {
    setIsRefreshing(true);
    funnel.refetch();
    // Reset spinning after a brief delay so the animation is visible
    setTimeout(() => setIsRefreshing(false), 800);
  }, [funnel.refetch]);

  // Derive summary stats
  const totalProcessed = funnel.data
    ? PIPELINE_STAGES.reduce((sum, s) => sum + s.getProcessed(funnel.data!), 0)
    : 0;
  const totalPending = funnel.data
    ? PIPELINE_STAGES.reduce((sum, s) => sum + s.getPending(funnel.data!), 0)
    : 0;
  const healthyStages = funnel.data
    ? PIPELINE_STAGES.filter((s) => s.getPending(funnel.data!) === 0).length
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Pipeline Jobs</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Monitor pipeline stage health and throughput
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <p className="text-[11px] text-muted-foreground/50 tabular-nums">
            Last updated:{' '}
            <span className="text-muted-foreground/70 font-medium">
              {lastRefreshed.toLocaleTimeString()}
            </span>
          </p>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={funnel.isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/30 bg-zbooni-dark/40 text-muted-foreground/60 transition-colors hover:border-border/50 hover:text-foreground disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing || funnel.isLoading ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Error state */}
      {funnel.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {funnel.error}
        </div>
      ) : null}

      {/* Summary strip */}
      {funnel.data ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Total Processed
            </p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">
              {totalProcessed.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Total Pending
            </p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight text-yellow-400">
              {totalPending.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Healthy Stages
            </p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight text-zbooni-green">
              {healthyStages}
              <span className="text-sm font-bold text-muted-foreground/40">
                {' '}
                / {PIPELINE_STAGES.length}
              </span>
            </p>
          </div>
        </div>
      ) : null}

      {/* Pipeline flow visualization */}
      {funnel.data ? (
        <PipelineFlowStrip data={funnel.data} />
      ) : funnel.isLoading ? (
        <FlowStripSkeleton />
      ) : null}

      {/* Stage cards grid */}
      {funnel.data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {PIPELINE_STAGES.map((stage) => (
            <StageCard key={stage.key} stage={stage} data={funnel.data!} />
          ))}
        </div>
      ) : funnel.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StageCardSkeleton key={i} />
          ))}
        </div>
      ) : null}

      {/* Empty state */}
      {!funnel.data && !funnel.isLoading && !funnel.error ? (
        <div className="rounded-2xl border border-border/50 bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zbooni-dark/60">
            <Search className="h-5 w-5 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-muted-foreground/60">
            No pipeline data found. Start a discovery run to see job status here.
          </p>
        </div>
      ) : null}
    </div>
  );
}

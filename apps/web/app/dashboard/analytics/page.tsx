'use client';

import type { FunnelResponse, ListDiscoveryRunsResponse } from '@lead-flood/contracts';
import {
  AlertTriangle,
  BarChart3,
  CalendarCheck,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  MessageSquare,
  Search,
  Send,
  Tag,
  Target,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Unplug,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '../../../src/lib/utils.js';
import { CustomSelect } from '../../../src/components/custom-select.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';
import { getSupabaseBrowserClient } from '../../../src/lib/supabase-client.js';

type DateRange = '7d' | '30d' | '90d' | 'all';

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '7d': '7 Days',
  '30d': '30 Days',
  '90d': '90 Days',
  all: 'All Time',
};

const DATE_RANGE_OPTIONS: readonly DateRange[] = ['7d', '30d', '90d', 'all'] as const;

const LABEL_CARDS = [
  { key: 'repliedCount' as const, label: 'Replied', Icon: ThumbsUp, color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  { key: 'meetingBookedCount' as const, label: 'Meeting Booked', Icon: CalendarCheck, color: 'text-zbooni-teal', bg: 'bg-zbooni-teal/15', border: 'border-zbooni-teal/25' },
  { key: 'dealWonCount' as const, label: 'Deal Won', Icon: ThumbsUp, color: 'text-zbooni-green', bg: 'bg-zbooni-green/15', border: 'border-zbooni-green/25' },
  { key: 'dealLostCount' as const, label: 'Deal Lost', Icon: ThumbsDown, color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/25' },
  { key: 'unsubscribedCount' as const, label: 'Unsubscribed', Icon: Unplug, color: 'text-slate-400', bg: 'bg-slate-500/15', border: 'border-slate-500/25' },
  { key: 'bouncedCount' as const, label: 'Bounced', Icon: AlertTriangle, color: 'text-slate-500', bg: 'bg-slate-600/15', border: 'border-slate-600/25' },
];

const EVENT_TYPE_BADGES: Record<string, { className: string; label: string }> = {
  REPLIED: { className: 'bg-emerald-500/15 text-emerald-400', label: 'Replied' },
  MEETING_BOOKED: { className: 'bg-zbooni-teal/15 text-zbooni-teal', label: 'Meeting' },
  DEAL_WON: { className: 'bg-zbooni-green/15 text-zbooni-green', label: 'Won' },
  DEAL_LOST: { className: 'bg-red-500/15 text-red-400', label: 'Lost' },
  UNSUBSCRIBED: { className: 'bg-slate-500/15 text-slate-400', label: 'Unsub' },
  BOUNCED: { className: 'bg-slate-600/15 text-slate-500', label: 'Bounced' },
};

// ── Sub-components ───────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tracking-tight ${accent}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground/50">{sub}</p> : null}
    </div>
  );
}

// ── Pipeline stage definitions ──────────────────────────────────────────
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

function PipelineStageCard({ stage, data }: { stage: PipelineStage; data: FunnelResponse }) {
  const Icon = stage.icon;
  const processed = stage.getProcessed(data);
  const pending = stage.getPending(data);
  const total = processed + pending;
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 100;
  const isComplete = pending === 0;

  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 px-5 py-6 transition-colors hover:border-border/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${stage.bgClass}`}>
            <Icon className={`h-6 w-6 ${stage.colorClass}`} />
          </div>
          <div>
            <p className="text-base font-bold tracking-tight">{stage.label}</p>
            <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium">Stage</p>
          </div>
        </div>
        <div
          className={`h-2.5 w-2.5 rounded-full ${isComplete ? 'bg-zbooni-green' : 'bg-yellow-400 animate-pulse'}`}
          title={isComplete ? 'All caught up' : `${pending} pending`}
        />
      </div>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Processed</p>
          <p className={`text-3xl font-extrabold tracking-tight ${stage.colorClass}`}>{processed.toLocaleString()}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Pending</p>
          <p className={`text-2xl font-bold tracking-tight ${pending > 0 ? 'text-yellow-400' : 'text-muted-foreground/30'}`}>
            {pending.toLocaleString()}
          </p>
        </div>
      </div>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-border/30">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${stage.barClass}`}
          style={{ width: `${Math.max(progressPct, processed > 0 ? 3 : 0)}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground/40 font-medium">{progressPct}% complete</p>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { apiClient } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [icpFilter, setIcpFilter] = useState<string | undefined>(undefined);

  // Discovery runs for yield display
  const icps = useApiQuery(
    useCallback(() => apiClient.listIcps({ page: 1, pageSize: 50 }), [apiClient]),
  );
  const discoveryRuns = useApiQuery<ListDiscoveryRunsResponse>(
    useCallback(() => apiClient.listDiscoveryRuns({ page: 1, pageSize: 200 }), [apiClient]),
  );

  const icpOptions = [
    { value: '', label: 'All ICPs' },
    ...(icps.data?.items.map((icp) => ({ value: icp.id, label: icp.name })) ?? []),
  ];

  const dateFilter = useMemo(() => {
    const base: Record<string, string> = {};
    if (dateRange !== 'all') {
      const now = new Date();
      const from = new Date();
      if (dateRange === '7d') from.setDate(now.getDate() - 7);
      if (dateRange === '30d') from.setDate(now.getDate() - 30);
      if (dateRange === '90d') from.setDate(now.getDate() - 90);
      base.from = from.toISOString();
      base.to = now.toISOString();
    }
    if (icpFilter) {
      base.icpProfileId = icpFilter;
    }
    return base;
  }, [dateRange, icpFilter]);

  const funnel = useApiQuery(
    useCallback(() => apiClient.getFunnel(dateFilter), [apiClient, dateFilter]),
    [dateFilter],
  );

  const feedback = useApiQuery(
    useCallback(() => apiClient.getFeedbackSummary(dateFilter), [apiClient, dateFilter]),
    [dateFilter],
  );

  const scoreDistribution = useApiQuery(
    useCallback(() => apiClient.getScoreDistribution(dateFilter), [apiClient, dateFilter]),
    [dateFilter],
  );

  const feedbackEvents = useApiQuery(
    useCallback(() => apiClient.listFeedbackEvents({ page: 1, pageSize: 10 }), [apiClient]),
  );

  // D8: Fetch rejected lead count via direct Supabase query
  // The funnel API doesn't include rejected leads, so we query directly
  const [rejectedCount, setRejectedCount] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    async function fetchRejectedCount() {
      try {
        const supabase = getSupabaseBrowserClient();
        let query = supabase
          .from('Lead')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'rejected')
          .is('deletedAt', null);

        // ICP filtering: join through business_conversions
        if (icpFilter) {
          const { data: conversions } = await supabase
            .from('business_conversions')
            .select('leadId')
            .eq('icpProfileId', icpFilter);
          const leadIds = conversions?.map((c: { leadId: string }) => c.leadId) ?? [];
          if (leadIds.length > 0) {
            query = query.in('id', leadIds);
          } else {
            if (!cancelled) setRejectedCount(0);
            return;
          }
        }

        // Date filtering on rejectedAt via LeadRejection table is complex;
        // for simplicity we count all rejected leads matching the ICP filter
        // (status='rejected' already means they were rejected).
        const { count } = await query;
        if (!cancelled) {
          setRejectedCount(count ?? 0);
        }
      } catch (err) {
        console.error('Failed to fetch rejected count:', err);
      }
    }
    void fetchRejectedCount();
    return () => { cancelled = true; };
  }, [icpFilter, dateFilter]);

  // D7: Fetch total scored leads count via Supabase for independent verification
  const [totalScoredLeads, setTotalScoredLeads] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    async function fetchTotalScored() {
      try {
        const supabase = getSupabaseBrowserClient();
        let query = supabase
          .from('LeadScorePrediction')
          .select('id', { count: 'exact', head: true });

        if (icpFilter) {
          query = query.eq('icpProfileId', icpFilter);
        }

        const { count } = await query;
        if (!cancelled) {
          setTotalScoredLeads(count ?? 0);
        }
      } catch (err) {
        console.error('Failed to fetch total scored:', err);
      }
    }
    void fetchTotalScored();
    return () => { cancelled = true; };
  }, [icpFilter]);

  const totalMessaged = funnel.data?.messagesSentCount ?? 0;
  const totalReplied = funnel.data?.repliesCount ?? 0;
  const overallReplyRate = totalMessaged > 0 ? Math.round((totalReplied / totalMessaged) * 100) : 0;
  const totalMeetings = funnel.data?.meetingsCount ?? 0;
  const meetingRate = totalReplied > 0 ? Math.round((totalMeetings / totalReplied) * 100) : 0;

  const distributionMax = Math.max(...(scoreDistribution.data?.bands.map((band) => band.count) ?? [0]), 1);

  // D10: Score distribution summary stats
  const totalScored = scoreDistribution.data?.bands.reduce((sum, b) => sum + b.count, 0) ?? 0;
  const rejectionRate = totalScored > 0 ? Math.round((rejectedCount / (totalScored + rejectedCount)) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* ── Page header + filters ──────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Agent Analytics</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Live analytics from your current database state
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <CustomSelect
              value={icpFilter ?? ''}
              onChange={(v) => setIcpFilter(v || undefined)}
              options={icpOptions}
              placeholder="All ICPs"
              className="[&>div:last-child]:right-0 [&>div:last-child]:left-auto"
            />
          </div>
          <div className="flex gap-1.5">
            {DATE_RANGE_OPTIONS.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setDateRange(range)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  dateRange === range
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/20 text-muted-foreground hover:bg-muted/40'
                }`}
              >
                {DATE_RANGE_LABELS[range]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Error banner ──────────────────────────────────────────── */}
      {funnel.error || feedback.error || scoreDistribution.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {funnel.error ?? feedback.error ?? scoreDistribution.error}
        </div>
      ) : null}

      {/* ── Pipeline Overview ───────────────────────────────────────── */}
      {funnel.data ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-zbooni-green animate-pulse" />
              <h2 className="text-base font-bold tracking-tight">Pipeline Overview</h2>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground/50">
              <span>
                Total Processed:{' '}
                <strong className="text-foreground">
                  {PIPELINE_STAGES.reduce((sum, s) => sum + s.getProcessed(funnel.data!), 0).toLocaleString()}
                </strong>
              </span>
              <span>
                Total Pending:{' '}
                <strong className="text-yellow-400">
                  {PIPELINE_STAGES.reduce((sum, s) => sum + s.getPending(funnel.data!), 0).toLocaleString()}
                </strong>
              </span>
              <span>
                Healthy:{' '}
                <strong className="text-zbooni-green">
                  {PIPELINE_STAGES.filter((s) => s.getPending(funnel.data!) === 0).length}/{PIPELINE_STAGES.length}
                </strong>
              </span>
            </div>
          </div>

          {/* Stage cards grid */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {PIPELINE_STAGES.map((stage) => (
              <PipelineStageCard key={stage.key} stage={stage} data={funnel.data!} />
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Discovery Yield — All Runs ────────────────────────────── */}
      {(() => {
        const runs = discoveryRuns.data?.runs ?? [];
        const sortedRuns = [...runs].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        if (sortedRuns.length === 0) {
          return (
            <div className="rounded-2xl border border-border/30 bg-card/50 px-4 py-6 text-center">
              <Target className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-medium text-muted-foreground/60">No discovery runs yet</p>
              <p className="mt-1 text-xs text-muted-foreground/40">
                Start a discovery run to track yield rates.
              </p>
            </div>
          );
        }

        return (
          <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Target className="h-4 w-4 text-zbooni-green" />
              <h2 className="text-base font-bold tracking-tight">Discovery Yield</h2>
              <span className="ml-auto text-xs text-muted-foreground/50">
                {sortedRuns.length} run{sortedRuns.length !== 1 ? 's' : ''} — leads / businesses
              </span>
            </div>
            <div className="max-h-[320px] overflow-y-auto pr-1 space-y-2">
              {sortedRuns.map((run) => {
                const yieldRate =
                  run.totalItems > 0
                    ? Math.round((run.processedItems / run.totalItems) * 100)
                    : 0;
                const icpNames = (run.icpProfileIds ?? (run.icpProfileId ? [run.icpProfileId] : []))
                  .map((id) => icps.data?.items.find((i) => i.id === id)?.name ?? id.slice(0, 8))
                  .join(', ');

                return (
                  <Link
                    key={run.runId}
                    href={`/dashboard/jobs/${run.runId}`}
                    className="flex items-center gap-4 rounded-xl border border-border/30 bg-zbooni-dark/40 px-4 py-3 transition-colors hover:border-zbooni-teal/40 hover:bg-zbooni-dark/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground/60">
                          {run.runId.slice(0, 8)}
                        </span>
                        {icpNames ? (
                          <span className="truncate text-xs font-medium text-zbooni-teal">
                            {icpNames}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                            run.status === 'SUCCEEDED'
                              ? 'bg-zbooni-green/15 text-zbooni-green'
                              : run.status === 'FAILED'
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-yellow-500/15 text-yellow-400',
                          )}
                        >
                          {run.status}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground/50">
                        <span>
                          {new Date(run.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span>
                          {run.totalItems} businesses &rarr; {run.processedItems} leads
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xl font-extrabold tabular-nums text-zbooni-green">
                        {yieldRate}%
                      </p>
                      <p className="text-[10px] text-muted-foreground/40">yield</p>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Top-level KPI cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Messaged" value={String(totalMessaged)} accent="text-foreground" />
        <StatCard label="Total Replies" value={String(totalReplied)} accent="text-zbooni-green" />
        <StatCard label="Reply Rate" value={`${overallReplyRate}%`} accent="text-zbooni-teal" />
        <StatCard label="Meeting Rate" value={`${meetingRate}%`} sub="of replies -> meetings" accent="text-purple-400" />
      </div>

      {/* ── Funnel Stages ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Funnel Stages</h2>
        </div>
        {funnel.data ? (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            <StatCard label="Discovered" value={String(funnel.data.discoveredCount)} accent="text-foreground" />
            <StatCard label="Feature Extraction" value={String(funnel.data.qualifiedCount)} accent="text-zbooni-teal" />
            <StatCard label="Enriched" value={String(funnel.data.enrichedCount)} accent="text-zbooni-green" />
            <StatCard label="Scored" value={String(funnel.data.scoredCount)} accent="text-yellow-400" />
            <StatCard label="Rejected" value={String(rejectedCount)} accent="text-red-400" sub="Lead.status = rejected" />
            <StatCard label="Deals Won" value={String(funnel.data.dealsWonCount)} accent="text-purple-400" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/60">Loading funnel metrics...</p>
        )}
      </div>

      {/* ── Score Distribution ────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-zbooni-green" />
            <h2 className="text-base font-bold tracking-tight">Score Distribution</h2>
          </div>
          {totalScoredLeads > 0 ? (
            <span className="text-xs text-muted-foreground/50">
              {totalScoredLeads} total scored leads (all time)
            </span>
          ) : null}
        </div>
        {scoreDistribution.data && scoreDistribution.data.bands.length > 0 ? (
          <>
            <div className="space-y-3">
              {scoreDistribution.data.bands.map((band) => {
                const pct = Math.round((band.count / distributionMax) * 100);
                const bandPct = totalScored > 0 ? Math.round((band.count / totalScored) * 100) : 0;
                return (
                  <div key={band.scoreBand} className="flex items-center gap-3">
                    <p className="w-16 text-xs font-semibold text-muted-foreground">{band.scoreBand}</p>
                    <div className="h-6 flex-1 overflow-hidden rounded-full bg-zbooni-dark/60">
                      <div
                        className="h-full rounded-full bg-zbooni-teal/70"
                        style={{ width: `${Math.max(pct, band.count > 0 ? 5 : 0)}%` }}
                      />
                    </div>
                    <p className="w-20 text-right text-sm">
                      <span className="font-bold">{band.count}</span>
                      <span className="ml-1 text-muted-foreground/50 text-xs">({bandPct}%)</span>
                    </p>
                  </div>
                );
              })}
            </div>
            {/* D10: Summary row to reduce whitespace */}
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-border/20 bg-zbooni-dark/30 p-3">
              <div className="text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Total Scored</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">{totalScored}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Rejected</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-red-400">
                  {rejectedCount}
                  {rejectionRate > 0 ? <span className="ml-1 text-xs text-muted-foreground/50">({rejectionRate}%)</span> : null}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Pass Rate</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-zbooni-green">
                  {totalScored + rejectedCount > 0 ? 100 - rejectionRate : 0}%
                </p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground/60">No score distribution rows yet.</p>
        )}
      </div>

      {/* ── Training Label Summaries ──────────────────────────────── */}
      {feedback.data ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Tag className="h-4 w-4 text-zbooni-teal" />
            <h2 className="text-base font-bold tracking-tight">Training Label Summaries</h2>
            <span className="ml-auto text-xs text-muted-foreground/50">
              {feedback.data.totalEvents} total events
            </span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {LABEL_CARDS.map((item) => {
              const count = feedback.data![item.key];
              return (
                <div
                  key={item.key}
                  className={cn(
                    'rounded-xl border px-4 py-4 transition-colors',
                    item.bg,
                    item.border,
                  )}
                >
                  <div className="flex items-center gap-2">
                    <item.Icon className={cn('h-4 w-4', item.color)} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {item.label}
                    </span>
                  </div>
                  <p className={cn('mt-2 text-3xl font-extrabold tabular-nums tracking-tight', item.color)}>
                    {count}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── Recent Feedback Events ────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Recent Feedback Events</h2>
        </div>
        {feedbackEvents.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
            Loading events...
          </div>
        ) : feedbackEvents.data && feedbackEvents.data.items.length > 0 ? (
          <div className="space-y-2">
            {feedbackEvents.data.items.map((event) => {
              const badge = EVENT_TYPE_BADGES[event.eventType] ?? { className: 'bg-slate-700/40 text-slate-300', label: event.eventType };
              return (
                <div
                  key={event.id}
                  className="flex items-center gap-3 rounded-lg border border-border/20 bg-zbooni-dark/30 px-4 py-2.5"
                >
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {event.leadId.slice(0, 16)}...
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground/50">
                    {new Date(event.occurredAt).toLocaleDateString('en-AE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <Clock className="h-6 w-6 text-muted-foreground/20" />
            <p className="mt-2 text-sm text-muted-foreground/50">No feedback events yet</p>
          </div>
        )}
      </div>

      {/* Auto-Approve Settings moved to /dashboard/settings */}

      {/* ── Loading state ─────────────────────────────────────────── */}
      {funnel.isLoading && !funnel.data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          Loading analytics data...
        </div>
      ) : null}

      {/* ── Empty state ───────────────────────────────────────────── */}
      {!funnel.data && !funnel.isLoading && !funnel.error ? (
        <div className="rounded-xl border border-border/30 bg-card px-4 py-3 text-sm text-muted-foreground/70">
          No analytics data found in the current database.
        </div>
      ) : null}
    </div>
  );
}

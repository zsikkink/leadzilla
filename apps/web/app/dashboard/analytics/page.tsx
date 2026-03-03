'use client';

import {
  BarChart3,
  Users,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

type DateRange = '7d' | '30d' | '90d' | 'all';

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '7d': '7 Days',
  '30d': '30 Days',
  '90d': '90 Days',
  all: 'All Time',
};

const DATE_RANGE_OPTIONS: readonly DateRange[] = ['7d', '30d', '90d', 'all'] as const;


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

// ── Main page ────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { apiClient } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>('all');

  const dateFilter = useMemo(() => {
    if (dateRange === 'all') return {};
    const now = new Date();
    const from = new Date();
    if (dateRange === '7d') from.setDate(now.getDate() - 7);
    if (dateRange === '30d') from.setDate(now.getDate() - 30);
    if (dateRange === '90d') from.setDate(now.getDate() - 90);
    return { from: from.toISOString(), to: now.toISOString() };
  }, [dateRange]);

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

  const totalMessaged = funnel.data?.messagesSentCount ?? 0;
  const totalReplied = funnel.data?.repliesCount ?? 0;
  const overallReplyRate = totalMessaged > 0 ? Math.round((totalReplied / totalMessaged) * 100) : 0;
  const totalMeetings = funnel.data?.meetingsCount ?? 0;
  const meetingRate = totalReplied > 0 ? Math.round((totalMeetings / totalReplied) * 100) : 0;

  const distributionMax = Math.max(...(scoreDistribution.data?.bands.map((band) => band.count) ?? [0]), 1);

  return (
    <div className="space-y-6">
      {/* ── Page header + date range ──────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Agent Analytics</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Live analytics from your current database state
          </p>
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

      {/* ── Error banner ──────────────────────────────────────────── */}
      {funnel.error || feedback.error || scoreDistribution.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {funnel.error ?? feedback.error ?? scoreDistribution.error}
        </div>
      ) : null}

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
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <StatCard label="Discovered" value={String(funnel.data.discoveredCount)} accent="text-foreground" />
            <StatCard label="Qualified" value={String(funnel.data.qualifiedCount)} accent="text-zbooni-teal" />
            <StatCard label="Enriched" value={String(funnel.data.enrichedCount)} accent="text-zbooni-green" />
            <StatCard label="Scored" value={String(funnel.data.scoredCount)} accent="text-yellow-400" />
            <StatCard label="Deals Won" value={String(funnel.data.dealsWonCount)} accent="text-purple-400" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/60">Loading funnel metrics...</p>
        )}
      </div>

      {/* ── Score Distribution ────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-zbooni-green" />
          <h2 className="text-base font-bold tracking-tight">Score Distribution</h2>
        </div>
        {scoreDistribution.data && scoreDistribution.data.bands.length > 0 ? (
          <div className="space-y-3">
            {scoreDistribution.data.bands.map((band) => {
              const pct = Math.round((band.count / distributionMax) * 100);
              return (
                <div key={band.scoreBand} className="flex items-center gap-3">
                  <p className="w-16 text-xs font-semibold text-muted-foreground">{band.scoreBand}</p>
                  <div className="h-6 flex-1 overflow-hidden rounded-full bg-zbooni-dark/60">
                    <div
                      className="h-full rounded-full bg-zbooni-teal/70"
                      style={{ width: `${Math.max(pct, band.count > 0 ? 5 : 0)}%` }}
                    />
                  </div>
                  <p className="w-12 text-right text-sm font-bold">{band.count}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/60">No score distribution rows yet.</p>
        )}
      </div>

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

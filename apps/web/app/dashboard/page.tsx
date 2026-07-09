'use client';

import type {
  DailyQualityTrendsResponse,
  FeedbackSummaryResponse,
  FunnelResponse,
  IcpPerformanceResponse,
  ListDiscoveryRunsResponse,
  ScoreDistributionResponse,
} from '@lead-flood/contracts';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock3,
  DollarSign,
  ExternalLink,
  Layers3,
  MessageSquare,
  Search,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CustomSelect } from '../../src/components/custom-select.js';
import { LeadFlowSankey } from '../../src/components/lead-flow-sankey.js';
import type { LeadFlowSankeyData } from '../../src/components/lead-flow-sankey.js';
import { useAuth } from '../../src/hooks/use-auth.js';
import { useApiQuery } from '../../src/hooks/use-api-query.js';
import {
  dashboardQueryKeys,
  getCachedDashboardQuery,
} from '../../src/lib/dashboard-preload.js';
import { cn } from '../../src/lib/utils.js';

type DateRange = '7d' | '30d' | '90d' | 'all';

type AnalyticsFilter = {
  from?: string | undefined;
  to?: string | undefined;
  icpProfileId?: string | undefined;
};

type IcpPerformanceRow = IcpPerformanceResponse['items'][number];
type DiscoveryRun = ListDiscoveryRunsResponse['runs'][number];
type QualityTrend = DailyQualityTrendsResponse['items'][number];

const DATE_RANGE_OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: 'all', label: 'All Time' },
];

const DASHBOARD_ICPS_QUERY = { page: 1, pageSize: 50 } as const;
const DASHBOARD_DISCOVERY_RUNS_QUERY = { page: 1, pageSize: 6 } as const;
const DASHBOARD_PENDING_DRAFTS_QUERY = { approvalStatus: 'PENDING', page: 1, pageSize: 1 } as const;

function getDateFilter(range: DateRange): Omit<AnalyticsFilter, 'icpProfileId'> {
  if (range === 'all') return {};

  const now = new Date();
  const from = new Date(now);
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  from.setDate(now.getDate() - days);

  return { from: from.toISOString(), to: now.toISOString() };
}

function formatCount(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${Math.round(value)}%`;
}

function ratioPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--';
  return `$${value.toFixed(2)}`;
}

function clampCount(value: number): number {
  return Math.max(0, Math.round(value));
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-white/[0.025] p-5 shadow-xl shadow-black/20',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-zbooni-teal/[0.035] via-transparent to-zbooni-green/[0.025]" />
      <div className="relative">{children}</div>
    </section>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ComponentType<{ className?: string | undefined }>;
  title: string;
  subtitle?: string | undefined;
  action?: React.ReactNode | undefined;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.06]">
          <Icon className="h-4 w-4 text-zbooni-teal" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-sm text-white">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {action ?? null}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
  progress,
}: {
  icon: React.ComponentType<{ className?: string | undefined }>;
  label: string;
  value: string;
  detail: string;
  accent: string;
  progress?: number | undefined;
}) {
  const normalizedProgress =
    progress === undefined ? undefined : Math.min(Math.max(progress, 0), 100);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.045] p-3 shadow-lg shadow-black/15 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.065]">
      <div className={cn('pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl', accent)} />
      <div className="relative flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-white" />
        <p className="text-[11px] font-bold uppercase tracking-wider text-white">{label}</p>
      </div>
      <p className="relative mt-2 text-2xl font-extrabold tracking-tight text-white">{value}</p>
      <p className="relative mt-1 text-xs font-medium text-white">{detail}</p>
      {normalizedProgress !== undefined ? (
        <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className={cn('h-full rounded-full', accent)}
            style={{ width: `${normalizedProgress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function getScoreBandCount(
  scoreDistribution: ScoreDistributionResponse | null | undefined,
  scoreBand: 'LOW' | 'MEDIUM' | 'HIGH',
): number {
  return scoreDistribution?.bands.find((band) => band.scoreBand === scoreBand)?.count ?? 0;
}

function scaleCountsToTotal(counts: number[], targetTotal: number): number[] {
  const sourceTotal = counts.reduce((total, count) => total + count, 0);
  if (targetTotal <= 0 || sourceTotal <= 0) return counts.map(() => 0);

  const scaled = counts.map((count) => {
    const exact = (count / sourceTotal) * targetTotal;
    return {
      fractional: exact - Math.floor(exact),
      value: Math.floor(exact),
    };
  });
  let remainder = targetTotal - scaled.reduce((total, item) => total + item.value, 0);

  scaled
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => b.fractional - a.fractional)
    .forEach((item) => {
      if (remainder <= 0) return;
      scaled[item.index]!.value += 1;
      remainder -= 1;
    });

  return scaled.map((item) => item.value);
}

function buildLeadFlowData(
  funnel: FunnelResponse | null,
  scoreDistribution: ScoreDistributionResponse | null | undefined,
  totalBusinesses: number | null | undefined,
): LeadFlowSankeyData {
  const discoveredCount = funnel?.discoveredCount ?? 0;
  const totalBusinessCount = Math.max(clampCount(totalBusinesses ?? 0), discoveredCount);
  const evaluatedCount = Math.min(discoveredCount, totalBusinessCount);
  const outsideFlowCount = clampCount(totalBusinessCount - evaluatedCount);
  const qualifiedCount = Math.min(funnel?.qualifiedCount ?? 0, discoveredCount);
  const notQualifiedCount = clampCount(discoveredCount - qualifiedCount);
  const targetScoredCount = Math.min(funnel?.scoredCount ?? 0, qualifiedCount);
  const rawHighCount = getScoreBandCount(scoreDistribution, 'HIGH');
  const rawMediumCount = getScoreBandCount(scoreDistribution, 'MEDIUM');
  const rawLowCount = getScoreBandCount(scoreDistribution, 'LOW');
  const rawScoredBandTotal = rawHighCount + rawMediumCount + rawLowCount;
  const scaledScoreBands =
    rawScoredBandTotal > 0
      ? scaleCountsToTotal([rawHighCount, rawMediumCount, rawLowCount], targetScoredCount)
      : [0, 0, 0];
  const highCount = scaledScoreBands[0] ?? 0;
  const mediumCount = scaledScoreBands[1] ?? 0;
  const lowCount = scaledScoreBands[2] ?? 0;
  const scoredBandTotal = highCount + mediumCount + lowCount;
  const unbandedCount = clampCount(qualifiedCount - scoredBandTotal);

  return {
    totalBusinesses: totalBusinessCount,
    evaluated: evaluatedCount,
    outsideFlow: outsideFlowCount,
    qualified: qualifiedCount,
    notQualified: notQualifiedCount,
    high: highCount,
    medium: mediumCount,
    low: lowCount,
    unbanded: unbandedCount,
  };
}

async function fetchDashboardBusinessCount(accessToken: string): Promise<number> {
  const response = await fetch('/api/dashboard/business-count', {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const body = (await response.json().catch(() => null)) as { total?: unknown; error?: string } | null;

  if (!response.ok) {
    throw new Error(body?.error ?? 'Failed to load business count');
  }

  if (typeof body?.total !== 'number') {
    throw new Error('Business count unavailable');
  }

  return body.total;
}

function QualityTrendsChart({ data }: { data: QualityTrend[] }) {
  if (data.length < 2) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
        <TrendingUp className="h-8 w-8 text-white" />
        <p className="mt-3 text-sm font-semibold text-white">Not enough trend data yet</p>
      </div>
    );
  }

  const chartData = data.map((item) => ({
    day: new Date(`${item.day}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    score: Math.round(item.avgScore * 100),
    rejected:
      item.totalCreated > 0 ? Math.round((item.rejectedCount / item.totalCreated) * 100) : 0,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="overview-score" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3CC8E0" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#3CC8E0" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="overview-rejected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F87171" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: '#FFFFFF' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#FFFFFF' }}
            axisLine={false}
            tickLine={false}
            width={32}
            tickFormatter={(value: number) => `${value}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(24,24,38,0.95)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '12px',
              color: '#FFFFFF',
            }}
            labelStyle={{ color: '#FFFFFF', fontWeight: 700 }}
          />
          <Area
            type="monotone"
            dataKey="score"
            name="Avg score"
            stroke="#3CC8E0"
            fill="url(#overview-score)"
            strokeWidth={2.5}
          />
          <Area
            type="monotone"
            dataKey="rejected"
            name="Rejected"
            stroke="#F87171"
            fill="url(#overview-rejected)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-white">
        <span className="flex items-center gap-2">
          <span className="h-2 w-6 rounded-full bg-zbooni-teal" />
          Avg score
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-6 rounded-full bg-red-400" />
          Rejected
        </span>
      </div>
    </div>
  );
}

function LeadQualityPie({
  discoveredCount,
  qualifiedCount,
  averageScore,
}: {
  discoveredCount: number;
  qualifiedCount: number;
  averageScore: number | null;
}) {
  const remainingCount = Math.max(discoveredCount - qualifiedCount, 0);
  const qualifiedPercent = ratioPercent(qualifiedCount, discoveredCount);
  const pieBackground =
    discoveredCount > 0
      ? `conic-gradient(#3CC8E0 0deg ${qualifiedPercent * 3.6}deg, rgba(255,255,255,0.09) ${qualifiedPercent * 3.6}deg 360deg)`
      : 'rgba(255,255,255,0.09)';

  return (
    <div className="grid items-center gap-4 rounded-xl border border-white/[0.07] bg-black/[0.12] p-4 sm:grid-cols-[150px_1fr]">
      <div className="relative mx-auto h-36 w-36 rounded-full" style={{ background: pieBackground }}>
        <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-[#171721] text-center">
          <p className="text-3xl font-extrabold tabular-nums text-white">{qualifiedPercent}%</p>
          <p className="text-[11px] font-bold uppercase tracking-wider text-white">qualified</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="h-2.5 w-2.5 rounded-full bg-zbooni-teal" />
            Qualified
          </span>
          <span className="text-sm font-bold tabular-nums text-white">{qualifiedCount.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="h-2.5 w-2.5 rounded-full bg-white/[0.32]" />
            Remaining
          </span>
          <span className="text-sm font-bold tabular-nums text-white">{remainingCount.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2">
          <span className="text-sm font-semibold text-white">Average score</span>
          <span className="text-sm font-bold tabular-nums text-white">
            {averageScore !== null ? averageScore.toFixed(2) : '--'}
          </span>
        </div>
      </div>
    </div>
  );
}

function IcpPerformance({
  rows,
  icpNames,
}: {
  rows: IcpPerformanceRow[];
  icpNames: Map<string, string>;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm font-medium text-white">No ICP data yet</p>;
  }

  const topRows = rows
    .slice()
    .sort((a, b) => b.leadCount - a.leadCount)
    .slice(0, 5);
  const maxLeads = Math.max(...topRows.map((row) => row.leadCount), 1);

  return (
    <div className="space-y-3">
      {topRows.map((row) => {
        const name = icpNames.get(row.icpProfileId) ?? row.icpProfileId.slice(0, 12);
        const qualifiedRate = ratioPercent(row.qualifiedCount, row.leadCount);
        const width = Math.max((row.leadCount / maxLeads) * 100, row.leadCount > 0 ? 6 : 0);

        return (
          <div key={row.icpProfileId} className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="truncate text-sm font-bold text-white">{name}</span>
              <span className="shrink-0 text-xs font-semibold text-white">
                {row.leadCount.toLocaleString()} leads
              </span>
            </div>
            <div className="mb-2.5 h-2 overflow-hidden rounded-full bg-white/[0.055]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-zbooni-teal to-zbooni-green"
                style={{ width: `${width}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-white">
              <span>Score {row.avgScore !== null ? row.avgScore.toFixed(2) : '--'}</span>
              <span>{qualifiedRate}% qualified</span>
              <span>{row.rejectedCount} rejected</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OutreachOutcomes({ feedback }: { feedback: FeedbackSummaryResponse | null }) {
  const outcomes = [
    { label: 'Replies', count: feedback?.repliedCount ?? 0, color: 'bg-emerald-400' },
    { label: 'Meetings', count: feedback?.meetingBookedCount ?? 0, color: 'bg-zbooni-teal' },
    { label: 'Won', count: feedback?.dealWonCount ?? 0, color: 'bg-zbooni-green' },
    { label: 'Lost', count: feedback?.dealLostCount ?? 0, color: 'bg-red-400' },
    { label: 'Bounced', count: feedback?.bouncedCount ?? 0, color: 'bg-slate-400' },
  ];
  const max = Math.max(...outcomes.map((item) => item.count), 1);

  return (
    <div className="space-y-3">
      {outcomes.map((item) => {
        const width = Math.max((item.count / max) * 100, item.count > 0 ? 6 : 0);
        return (
          <div key={item.label}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{item.label}</span>
              <span className="text-sm font-bold tabular-nums text-white">
                {item.count.toLocaleString()}
              </span>
            </div>
            <div className="h-7 overflow-hidden rounded-xl bg-white/[0.055]">
              <div className={cn('h-full rounded-xl', item.color)} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiscoveryYield({
  runs,
  icpNames,
}: {
  runs: DiscoveryRun[];
  icpNames: Map<string, string>;
}) {
  if (runs.length === 0) {
    return <p className="py-8 text-center text-sm font-medium text-white">No discovery runs yet</p>;
  }

  return (
    <div className="space-y-2">
      {runs.slice(0, 5).map((run) => {
        const icpLabel = (
          run.icpProfileIds ??
          (run.icpProfileId ? [run.icpProfileId] : [])
        )
          .map((id) => icpNames.get(id) ?? id.slice(0, 8))
          .join(', ');

        return (
          <Link
            key={run.runId}
            href={`/dashboard/jobs/${run.runId}`}
            className="flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.035] px-4 py-3 transition-colors hover:border-zbooni-teal/40 hover:bg-white/[0.06]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-white">{run.runId.slice(0, 8)}</span>
                {icpLabel ? <span className="truncate text-xs font-semibold text-white">{icpLabel}</span> : null}
              </div>
              <p className="mt-1 text-xs font-medium text-white">
                {run.totalItems.toLocaleString()} found
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-lg font-extrabold tabular-nums text-white">
                {run.processedItems.toLocaleString()}
              </p>
              <p className="text-xs font-semibold text-white">processed</p>
            </div>
            <ExternalLink className="h-4 w-4 shrink-0 text-white" />
          </Link>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const { apiClient, token } = useAuth();
  const [icpFilter, setIcpFilter] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [businessCountFallback, setBusinessCountFallback] = useState<number | null>(null);

  const dateFilter = useMemo(() => getDateFilter(dateRange), [dateRange]);
  const analyticsFilter = useMemo<AnalyticsFilter>(
    () => ({
      ...dateFilter,
      ...(icpFilter ? { icpProfileId: icpFilter } : {}),
    }),
    [dateFilter, icpFilter],
  );

  const icps = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.icps(DASHBOARD_ICPS_QUERY), () =>
          apiClient.listIcps(DASHBOARD_ICPS_QUERY),
        ),
      [apiClient],
    ),
    [apiClient],
  );

  const funnel = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.funnel(analyticsFilter), () =>
          apiClient.getFunnel(analyticsFilter),
        ),
      [apiClient, analyticsFilter],
    ),
    [apiClient, analyticsFilter],
  );

  const scoreDistribution = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.scoreDistribution(analyticsFilter), () =>
          apiClient.getScoreDistribution(analyticsFilter),
        ),
      [apiClient, analyticsFilter],
    ),
    [apiClient, analyticsFilter],
  );

  const feedback = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.feedback(analyticsFilter), () =>
          apiClient.getFeedbackSummary(analyticsFilter),
        ),
      [apiClient, analyticsFilter],
    ),
    [apiClient, analyticsFilter],
  );

  const qualityTrends = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.qualityTrends(dateFilter), () =>
          apiClient.getDailyQualityTrends(dateFilter),
        ),
      [apiClient, dateFilter],
    ),
    [apiClient, dateFilter],
  );

  const icpPerformance = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.icpPerformance(analyticsFilter), () =>
          apiClient.getIcpPerformance(analyticsFilter),
        ),
      [apiClient, analyticsFilter],
    ),
    [apiClient, analyticsFilter],
  );

  const avgScore = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.avgScore(analyticsFilter), () =>
          apiClient.getAvgScore(analyticsFilter),
        ),
      [apiClient, analyticsFilter],
    ),
    [apiClient, analyticsFilter],
  );

  const discoveryRuns = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.discoveryRuns(DASHBOARD_DISCOVERY_RUNS_QUERY), () =>
          apiClient.listDiscoveryRuns(DASHBOARD_DISCOVERY_RUNS_QUERY),
        ),
      [apiClient],
    ),
    [apiClient],
  );

  const drafts = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.drafts(DASHBOARD_PENDING_DRAFTS_QUERY), () =>
          apiClient.listDrafts(DASHBOARD_PENDING_DRAFTS_QUERY),
        ),
      [apiClient],
    ),
    [apiClient],
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void fetchDashboardBusinessCount(token)
      .then((total) => {
        if (!cancelled) {
          setBusinessCountFallback(total);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBusinessCountFallback(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [funnel.data?.businessCount, token]);

  const icpOptions = [
    { value: '', label: 'All ICPs' },
    ...(icps.data?.items.map((icp) => ({ value: icp.id, label: icp.name })) ?? []),
  ];

  const icpNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const icp of icps.data?.items ?? []) {
      map.set(icp.id, icp.name);
    }
    return map;
  }, [icps.data]);

  const sortedRuns = useMemo(() => {
    return [...(discoveryRuns.data?.runs ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [discoveryRuns.data]);

  const discovered = funnel.data?.discoveredCount ?? 0;
  const qualified = funnel.data?.qualifiedCount ?? 0;
  const sent = funnel.data?.messagesSentCount ?? 0;
  const replies = funnel.data?.repliesCount ?? 0;
  const replyRate = ratioPercent(replies, sent);
  const qualifiedRate = ratioPercent(qualified, discovered);
  const averageScore = avgScore.data?.avgScore ?? null;
  const costPerLead =
    discovered > 0 && funnel.data ? funnel.data.costPerLead : null;
  const totalCost =
    funnel.data && funnel.data.totalCostCents > 0
      ? funnel.data.totalCostCents / 100
      : null;
  const loadError =
    funnel.error ??
    scoreDistribution.error ??
    feedback.error ??
    qualityTrends.error ??
    icpPerformance.error ??
    discoveryRuns.error ??
    null;
  const leadFlowBusinessCount = Math.max(funnel.data?.businessCount ?? 0, businessCountFallback ?? 0);
  const leadFlowData = useMemo(
    () => buildLeadFlowData(funnel.data, scoreDistribution.data, leadFlowBusinessCount),
    [funnel.data, leadFlowBusinessCount, scoreDistribution.data],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.04] p-1">
            {DATE_RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDateRange(option.value)}
                className={cn(
                  'rounded-lg px-3 py-2 text-xs font-bold transition-all',
                  dateRange === option.value
                    ? 'bg-gradient-to-r from-zbooni-teal to-zbooni-green text-black shadow-lg shadow-zbooni-teal/20'
                    : 'text-white hover:bg-white/[0.07]',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="w-full sm:w-[240px]">
            <CustomSelect
              value={icpFilter ?? ''}
              onChange={(value) => setIcpFilter(value || undefined)}
              options={icpOptions}
              placeholder="All ICPs"
              className="[&>div:last-child]:right-0 [&>div:last-child]:left-auto"
            />
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-white">
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          icon={Target}
          label="Qualified rate"
          value={formatPercent(qualifiedRate)}
          detail={`${formatCount(qualified)} qualified`}
          accent="bg-zbooni-teal"
          progress={qualifiedRate}
        />
        <MetricCard
          icon={MessageSquare}
          label="Reply rate"
          value={formatPercent(replyRate)}
          detail={`${formatCount(replies)} replies from ${formatCount(sent)} sent`}
          accent="bg-emerald-400"
          progress={replyRate}
        />
        <MetricCard
          icon={TrendingUp}
          label="Avg score"
          value={averageScore !== null ? averageScore.toFixed(2) : '--'}
          detail="Lead-fit quality"
          accent="bg-purple-400"
          progress={averageScore !== null ? averageScore * 100 : 0}
        />
        <MetricCard
          icon={DollarSign}
          label="Cost / lead"
          value={formatMoney(costPerLead)}
          detail={totalCost !== null ? `${formatMoney(totalCost)} total spend` : 'No completed spend'}
          accent="bg-zbooni-green"
        />
        <MetricCard
          icon={Clock3}
          label="Pending review"
          value={formatCount(drafts.data?.total)}
          detail="Drafts awaiting operator approval"
          accent="bg-yellow-400"
        />
      </div>

      <Card className="p-4">
        <SectionHeading
          icon={Layers3}
          title="Lead Flow"
          subtitle="Database records through qualification and lead-fit bands."
        />
        {(funnel.isLoading && !funnel.data) ||
        (scoreDistribution.isLoading && !scoreDistribution.data) ? (
          <div className="flex min-h-[220px] items-center justify-center text-sm font-semibold text-white">
            Loading lead flow...
          </div>
        ) : (
          <LeadFlowSankey data={leadFlowData} />
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <SectionHeading
            icon={Activity}
            title="Lead Quality"
            subtitle="Qualified share of discovered leads."
          />
          <LeadQualityPie
            discoveredCount={discovered}
            qualifiedCount={qualified}
            averageScore={averageScore}
          />
        </Card>

        <Card>
          <SectionHeading
            icon={Users}
            title="ICP Performance"
            subtitle="Top segments by lead volume and quality."
          />
          {icpPerformance.isLoading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm font-semibold text-white">
              Loading ICP performance...
            </div>
          ) : (
            <IcpPerformance rows={icpPerformance.data?.items ?? []} icpNames={icpNameMap} />
          )}
        </Card>

        <Card>
          <SectionHeading
            icon={BarChart3}
            title="Quality Trend"
            subtitle="Average score and rejection rate over time."
          />
          {qualityTrends.isLoading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm font-semibold text-white">
              Loading quality trend...
            </div>
          ) : (
            <QualityTrendsChart data={qualityTrends.data?.items ?? []} />
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeading
            icon={Zap}
            title="Outreach Outcomes"
            subtitle="Recorded replies, meetings, deals, and bounces."
            action={
              feedback.data ? (
                <span className="rounded-full border border-white/[0.1] bg-white/[0.06] px-3 py-1 text-xs font-bold text-white">
                  {feedback.data.totalEvents.toLocaleString()} events
                </span>
              ) : undefined
            }
          />
          <OutreachOutcomes feedback={feedback.data} />
        </Card>

        <Card>
          <SectionHeading
            icon={Search}
            title="Discovery Runs"
            subtitle="Recent runs by found and processed leads."
            action={
              <Link
                href="/dashboard/discover"
                className="rounded-lg border border-white/[0.1] bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/[0.1]"
              >
                Open Discover
              </Link>
            }
          />
          {discoveryRuns.isLoading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm font-semibold text-white">
              Loading discovery runs...
            </div>
          ) : (
            <DiscoveryYield runs={sortedRuns} icpNames={icpNameMap} />
          )}
        </Card>
      </div>

      {!funnel.data && !funnel.isLoading && !loadError ? (
        <Card>
          <div className="flex items-center gap-3 text-white">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-sm font-semibold">No overview data found for the selected filters.</p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

'use client';

import type {
  FeedbackSummaryResponse,
  FunnelResponse,
  ListDiscoveryRunsResponse,
  ListIcpProfilesResponse,
  ScoreDistributionResponse,
} from '@lead-flood/contracts';
import {
  Activity,
  BarChart3,
  Clock,
  DollarSign,
  ExternalLink,
  Layers,
  MessageSquare,
  RefreshCcw,
  Search,
  Send,
  Shield,
  Target,
  ThumbsDown,
  TrendingUp,
  Users,
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

import { cn } from '../../../src/lib/utils.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

// ── Types ────────────────────────────────────────────────────────────────

type DateRange = '7d' | '30d' | '90d' | 'all';

interface LeadStatusRow {
  status: string;
  count: number;
}

interface IcpLeadRow {
  icpProfileId: string;
  leadCount: number;
  avgScore: number | null;
  qualifiedCount: number;
  rejectedCount: number;
}

interface DailyQualityRow {
  day: string;
  avgScore: number;
  totalCreated: number;
  rejectedCount: number;
}

interface RecoverySummary {
  totalCandidates: number;
  openCount: number;
  rejectedCount: number;
}

interface FollowUpSummary {
  totalFollowUps: number;
}

// ── Constants ────────────────────────────────────────────────────────────

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '7d': '7 Days',
  '30d': '30 Days',
  '90d': '90 Days',
  all: 'All Time',
};

const DATE_RANGE_OPTIONS: readonly DateRange[] = ['7d', '30d', '90d', 'all'] as const;

const EVENT_TYPE_BADGES: Record<string, { className: string; label: string }> = {
  REPLIED: { className: 'bg-emerald-500/15 text-emerald-400', label: 'Replied' },
  MEETING_BOOKED: { className: 'bg-zbooni-teal/15 text-zbooni-teal', label: 'Meeting' },
  DEAL_WON: { className: 'bg-zbooni-green/15 text-zbooni-green', label: 'Won' },
  DEAL_LOST: { className: 'bg-red-500/15 text-red-400', label: 'Lost' },
  UNSUBSCRIBED: { className: 'bg-slate-500/15 text-slate-400', label: 'Unsub' },
  BOUNCED: { className: 'bg-slate-600/15 text-slate-500', label: 'Bounced' },
};

// ── Glass card wrapper ───────────────────────────────────────────────────

function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-6 shadow-xl shadow-black/20 backdrop-blur-xl',
        className,
      )}
    >
      {/* Subtle inner glow */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-zbooni-teal/[0.04] to-zbooni-green/[0.02]" />
      <div className="relative">{children}</div>
    </div>
  );
}

// ── Section header ───────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  trailing,
}: {
  icon: React.ComponentType<{ className?: string | undefined }>;
  title: string;
  subtitle?: string | undefined;
  trailing?: React.ReactNode | undefined;
}) {
  return (
    <div className="mb-5 flex items-start justify-between">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-zbooni-teal/20 to-zbooni-green/10 ring-1 ring-white/[0.08]">
          <Icon className="h-4 w-4 text-zbooni-teal" />
        </div>
        <div>
          <h2 className="text-sm font-bold tracking-tight">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground/50">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {trailing ?? null}
    </div>
  );
}

// ── KPI Metric card ──────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'text-foreground',
  gradient,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  icon: React.ComponentType<{ className?: string | undefined }>;
  accent?: string | undefined;
  gradient?: string | undefined;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-4 shadow-lg shadow-black/15 backdrop-blur-lg transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.12] hover:shadow-xl hover:shadow-black/25">
      {gradient ? (
        <div
          className={cn(
            'pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-30',
            gradient,
          )}
        />
      ) : null}
      <div className="relative flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
      </div>
      <p className={cn('relative mt-2 text-2xl font-extrabold tracking-tight', accent)}>
        {value}
      </p>
      {sub ? (
        <p className="relative mt-0.5 text-[11px] text-muted-foreground/40">{sub}</p>
      ) : null}
    </div>
  );
}

// ── Pipeline Funnel ──────────────────────────────────────────────────────

interface FunnelStage {
  key: string;
  label: string;
  count: number;
  color: string;
}

function PipelineFunnel({
  stages,
  rejectedCount,
}: {
  stages: FunnelStage[];
  rejectedCount: number;
}) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const prevCount = i > 0 ? stages[i - 1]!.count : 0;
        const conversionPct =
          i > 0 && prevCount > 0 ? Math.round((stage.count / prevCount) * 100) : null;
        const barWidthPct = Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 4 : 0);

        return (
          <div key={stage.key} className="group">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 rounded-full ring-2 ring-black/20"
                  style={{ backgroundColor: stage.color }}
                />
                <span className="text-xs font-semibold text-foreground/90">{stage.label}</span>
              </div>
              <div className="flex items-center gap-3">
                {conversionPct !== null ? (
                  <span className="text-[10px] font-medium text-muted-foreground/50">
                    {conversionPct}% from prev
                  </span>
                ) : null}
                <span
                  className="text-sm font-bold tabular-nums"
                  style={{ color: stage.color }}
                >
                  {stage.count.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="h-7 w-full overflow-hidden rounded-lg bg-white/[0.04]">
              <div
                className="h-full rounded-lg transition-all duration-700 ease-out"
                style={{
                  width: `${barWidthPct}%`,
                  background: `linear-gradient(90deg, ${stage.color}50, ${stage.color}90)`,
                  boxShadow: `0 0 12px ${stage.color}30`,
                }}
              />
            </div>
          </div>
        );
      })}

      {/* Rejected branch */}
      {rejectedCount > 0 ? (
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-red-500/15 bg-red-500/[0.05] px-3 py-2">
          <ThumbsDown className="h-3.5 w-3.5 text-red-400/70" />
          <span className="text-xs font-medium text-red-400/70">Rejected</span>
          <span className="ml-auto text-sm font-bold tabular-nums text-red-400">
            {rejectedCount.toLocaleString()}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── Quality Trends Chart ─────────────────────────────────────────────────

function QualityTrendsChart({ data }: { data: DailyQualityRow[] }) {
  if (data.length < 2) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <TrendingUp className="h-8 w-8 text-muted-foreground/20" />
        <p className="mt-3 text-sm font-medium text-muted-foreground/50">Not enough data yet</p>
        <p className="mt-1 text-[11px] text-muted-foreground/30">
          Quality trends will appear after a few days of lead creation
        </p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    avgScore: Math.round(d.avgScore * 100) / 100,
    rejectionRate:
      d.totalCreated > 0 ? Math.round((d.rejectedCount / d.totalCreated) * 100) : 0,
  }));

  return (
    <div>
      <style>{`
        .recharts-wrapper { outline: none !important; }
        .recharts-surface { outline: none !important; }
        .recharts-surface:focus { outline: none !important; }
      `}</style>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3CC8E0" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3CC8E0" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="rejGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 8% 16%)" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 50%)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="score"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 50%)' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 1]}
            width={35}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            tick={{ fontSize: 10, fill: 'hsl(240 5% 50%)' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
            width={35}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(240 15% 12%)',
              border: '1px solid hsl(240 8% 22%)',
              borderRadius: '0.75rem',
              padding: '10px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              fontSize: '12px',
            }}
            labelStyle={{ color: 'hsl(0 0% 80%)', fontWeight: 600, marginBottom: '4px' }}
            itemStyle={{ padding: '2px 0' }}
          />
          <Area
            yAxisId="score"
            type="monotone"
            dataKey="avgScore"
            name="Avg Score"
            stroke="#3CC8E0"
            fill="url(#scoreGrad)"
            strokeWidth={2}
          />
          <Area
            yAxisId="rate"
            type="monotone"
            dataKey="rejectionRate"
            name="Rejection %"
            stroke="#f87171"
            fill="url(#rejGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-3 flex items-center justify-center gap-6">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-6 rounded-full bg-zbooni-teal" />
          <span className="text-[10px] font-medium text-muted-foreground/50">Avg Score (left)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-6 rounded-full bg-red-400" />
          <span className="text-[10px] font-medium text-muted-foreground/50">
            Rejection % (right)
          </span>
        </div>
      </div>
    </div>
  );
}

// ── ICP Performance table ────────────────────────────────────────────────

function IcpPerformanceTable({
  rows,
  icpNames,
}: {
  rows: IcpLeadRow[];
  icpNames: Map<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <Users className="h-6 w-6 text-muted-foreground/20" />
        <p className="mt-2 text-sm text-muted-foreground/50">No ICP data yet</p>
      </div>
    );
  }

  const maxLeads = Math.max(...rows.map((r) => r.leadCount), 1);

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const name = icpNames.get(row.icpProfileId) ?? row.icpProfileId.slice(0, 12);
        const convRate =
          row.leadCount > 0
            ? Math.round((row.qualifiedCount / row.leadCount) * 100)
            : 0;
        const barPct = Math.max((row.leadCount / maxLeads) * 100, row.leadCount > 0 ? 5 : 0);

        return (
          <div key={row.icpProfileId} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3.5 transition-colors hover:border-white/[0.1]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-zbooni-teal">{name}</span>
              <span className="text-[10px] font-medium text-muted-foreground/40">
                {row.leadCount} lead{row.leadCount !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="mb-2.5 h-2 w-full overflow-hidden rounded-full bg-white/[0.04]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-zbooni-teal/60 to-zbooni-green/60"
                style={{ width: `${barPct}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground/40">Avg Score</p>
                <p className="text-xs font-bold tabular-nums text-foreground/80">
                  {row.avgScore !== null ? row.avgScore.toFixed(2) : '--'}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/40">Conversion</p>
                <p className="text-xs font-bold tabular-nums text-zbooni-green">{convRate}%</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/40">Rejected</p>
                <p className="text-xs font-bold tabular-nums text-red-400">{row.rejectedCount}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Supabase data hooks ──────────────────────────────────────────────────

function useLeadStatusCounts(): { data: LeadStatusRow[] | null; isLoading: boolean } {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [data, setData] = useState<LeadStatusRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (isAuthLoading) {
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated) {
      setData(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    async function fetchData() {
      try {
        const counts = new Map<string, number>();
        let page = 1;
        let fetched = 0;
        let total = 0;

        do {
          const response = await apiClient.listLeads({
            page,
            pageSize: 100,
            includeRejected: true,
            includeQualityMetrics: false,
          });

          if (cancelled) return;

          for (const item of response.items) {
            counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
          }

          fetched += response.items.length;
          total = response.total;

          if (response.items.length < response.pageSize) {
            break;
          }

          page += 1;
        } while (fetched < total);

        setData(
          Array.from(counts.entries()).map(([status, count]) => ({ status, count })),
        );
      } catch {
        // Supabase query failed — leave data null
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [apiClient, isAuthenticated, isAuthLoading]);

  return { data, isLoading };
}

function useIcpPerformance(): { data: IcpLeadRow[] | null; isLoading: boolean } {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [data, setData] = useState<IcpLeadRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (isAuthLoading) {
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated) {
      setData(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    async function fetchData() {
      try {
        const result = await apiClient.getIcpPerformance();
        if (!cancelled) setData(result.items);
      } catch {
        // leave null
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [apiClient, isAuthenticated, isAuthLoading]);

  return { data, isLoading };
}

function useDailyQualityTrends(days: number): {
  data: DailyQualityRow[] | null;
  isLoading: boolean;
} {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [data, setData] = useState<DailyQualityRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (isAuthLoading) {
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated) {
      setData(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    async function fetchData() {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const result = await apiClient.getDailyQualityTrends({
          from: cutoff.toISOString(),
        });

        if (!cancelled) setData(result.items);
      } catch {
        // leave null
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [apiClient, days, isAuthenticated, isAuthLoading]);

  return { data, isLoading };
}

function useRecoverySummary(dateFilter: { from?: string; to?: string }): {
  data: RecoverySummary | null;
  isLoading: boolean;
} {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [data, setData] = useState<RecoverySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (isAuthLoading) {
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated) {
      setData(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    async function fetchData() {
      try {
        const query = {
          page: 1,
          pageSize: 1,
          ...dateFilter,
        };
        const [allItems, openItems, rejectedItems] = await Promise.all([
          apiClient.listContactRecoveryItems(query),
          apiClient.listContactRecoveryItems({ ...query, status: 'OPEN' }),
          apiClient.listContactRecoveryItems({ ...query, status: 'REJECTED' }),
        ]);

        if (cancelled) return;

        setData({
          totalCandidates: allItems.total,
          openCount: openItems.total,
          rejectedCount: rejectedItems.total,
        });
      } catch {
        // leave null
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [apiClient, dateFilter, isAuthenticated, isAuthLoading]);

  return { data, isLoading };
}

function useFollowUpSummary(): { data: FollowUpSummary | null; isLoading: boolean } {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [data, setData] = useState<FollowUpSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (isAuthLoading) {
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated) {
      setData(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    async function fetchData() {
      try {
        const result = await apiClient.listDrafts({
          followUpOnly: true,
          page: 1,
          pageSize: 1,
        });

        if (cancelled) return;

        setData({
          totalFollowUps: result.total,
        });
      } catch {
        // leave null
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [apiClient, isAuthenticated, isAuthLoading]);

  return { data, isLoading };
}

function useAvgScore(): { data: number | null; isLoading: boolean } {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [data, setData] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (isAuthLoading) {
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated) {
      setData(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    async function fetchData() {
      try {
        const result = await apiClient.getAvgScore();

        if (!cancelled) {
          setData(result.avgScore);
        }
      } catch {
        // leave null
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [apiClient, isAuthenticated, isAuthLoading]);

  return { data, isLoading };
}

// ── Main page ────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { apiClient } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>('all');

  // ── API queries ────────────────────────────────────────
  const icps = useApiQuery<ListIcpProfilesResponse>(
    useCallback(() => apiClient.listIcps({ page: 1, pageSize: 50 }), [apiClient]),
  );

  // B1 FIX: pageSize was 200 but the API contract (ListDiscoveryRunsQuerySchema)
  // caps pageSize at max(50). The request was failing validation server-side, so
  // discoveryRuns.data was always null, which triggered the "No discovery runs yet"
  // empty state. Fixed by requesting pageSize: 50.
  const discoveryRuns = useApiQuery<ListDiscoveryRunsResponse>(
    useCallback(
      () => apiClient.listDiscoveryRuns({ page: 1, pageSize: 50 }),
      [apiClient],
    ),
  );

  const dateFilter = useMemo(() => {
    if (dateRange === 'all') return {};
    const now = new Date();
    const from = new Date();
    if (dateRange === '7d') from.setDate(now.getDate() - 7);
    if (dateRange === '30d') from.setDate(now.getDate() - 30);
    if (dateRange === '90d') from.setDate(now.getDate() - 90);
    return { from: from.toISOString(), to: now.toISOString() };
  }, [dateRange]);

  const funnel = useApiQuery<FunnelResponse>(
    useCallback(() => apiClient.getFunnel(dateFilter), [apiClient, dateFilter]),
    [dateFilter],
  );

  const feedback = useApiQuery<FeedbackSummaryResponse>(
    useCallback(
      () => apiClient.getFeedbackSummary(dateFilter),
      [apiClient, dateFilter],
    ),
    [dateFilter],
  );

  const scoreDistribution = useApiQuery<ScoreDistributionResponse>(
    useCallback(
      () => apiClient.getScoreDistribution(dateFilter),
      [apiClient, dateFilter],
    ),
    [dateFilter],
  );

  const feedbackEvents = useApiQuery(
    useCallback(
      () => apiClient.listFeedbackEvents({ page: 1, pageSize: 10 }),
      [apiClient],
    ),
  );

  // ── Supabase queries ───────────────────────────────────
  const leadStatuses = useLeadStatusCounts();
  const icpPerformance = useIcpPerformance();
  const qualityTrends = useDailyQualityTrends(30);
  const recoverySummary = useRecoverySummary(dateFilter);
  const followUpSummary = useFollowUpSummary();
  const avgScore = useAvgScore();

  // ── Derived values ─────────────────────────────────────
  const icpNameMap = useMemo(() => {
    const m = new Map<string, string>();
    if (icps.data?.items) {
      for (const icp of icps.data.items) {
        m.set(icp.id, icp.name);
      }
    }
    return m;
  }, [icps.data]);

  // Build funnel stages from lead status counts + API funnel data
  const funnelStages = useMemo((): FunnelStage[] => {
    const statusMap = new Map<string, number>();
    if (leadStatuses.data) {
      for (const row of leadStatuses.data) {
        statusMap.set(row.status, row.count);
      }
    }

    const allLeadCount = Array.from(statusMap.values()).reduce((a, b) => a + b, 0);
    const discoveredFromApi = funnel.data?.discoveredCount ?? allLeadCount;

    const qualifiedCount = (statusMap.get('qualified') ?? 0) +
      (statusMap.get('drafted') ?? 0) +
      (statusMap.get('messaged') ?? 0) +
      (statusMap.get('replied') ?? 0) +
      (statusMap.get('cold') ?? 0);

    const messagedCount = funnel.data?.messagesSentCount ??
      ((statusMap.get('messaged') ?? 0) + (statusMap.get('replied') ?? 0) + (statusMap.get('cold') ?? 0));
    const repliedCount = funnel.data?.repliesCount ?? (statusMap.get('replied') ?? 0);
    const wonCount = funnel.data?.dealsWonCount ?? 0;

    // Pre-qualified = all leads that passed pre-qualification (not rejected)
    const preQualifiedCount = allLeadCount;

    return [
      { key: 'discovered', label: 'Discovered', count: discoveredFromApi, color: '#60A5FA' },
      { key: 'prequalified', label: 'Pre-qualified', count: preQualifiedCount, color: '#A78BFA' },
      { key: 'qualified', label: 'Qualified', count: qualifiedCount, color: '#3CC8E0' },
      { key: 'messaged', label: 'Messaged', count: messagedCount, color: '#7BFF6B' },
      { key: 'replied', label: 'Replied', count: repliedCount, color: '#34D399' },
      { key: 'won', label: 'Won', count: wonCount, color: '#FACC15' },
    ];
  }, [leadStatuses.data, funnel.data]);

  const rejectedCount = useMemo(() => {
    if (!leadStatuses.data) return 0;
    return leadStatuses.data.find((r) => r.status === 'rejected')?.count ?? 0;
  }, [leadStatuses.data]);

  // Key metrics
  const totalMessaged = funnel.data?.messagesSentCount ?? 0;
  const totalReplied = funnel.data?.repliesCount ?? 0;
  const overallReplyRate =
    totalMessaged > 0 ? Math.round((totalReplied / totalMessaged) * 100) : 0;

  const discoveredCount = funnel.data?.discoveredCount ?? 0;
  const qualifiedFromFunnel = funnel.data?.qualifiedCount ?? 0;
  const pipelineConversion =
    discoveredCount > 0
      ? Math.round((qualifiedFromFunnel / discoveredCount) * 100)
      : 0;

  const totalCostCents = funnel.data?.totalCostCents ?? null;
  const costPerLead = useMemo(() => {
    if (totalCostCents === null) return null;
    if (discoveredCount === 0) return 0;
    return totalCostCents / discoveredCount / 100;
  }, [discoveredCount, totalCostCents]);

  const distributionMax = Math.max(
    ...(scoreDistribution.data?.bands.map((b) => b.count) ?? [0]),
    1,
  );

  const sortedRuns = useMemo(() => {
    const runs = discoveryRuns.data?.runs ?? [];
    return [...runs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [discoveryRuns.data]);

  return (
    <div className="space-y-6">
      {/* ── Page header + date range ────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Agent Analytics</h1>
          <p className="mt-0.5 text-sm text-muted-foreground/70">
            Pipeline performance, lead quality, and cost intelligence
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/45">
            Pipeline-state views below are directional unless labeled otherwise. Outreach and feedback sections use recorded sends, replies, and feedback events.
          </p>
        </div>
        <div className="flex gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1 backdrop-blur-sm">
          {DATE_RANGE_OPTIONS.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDateRange(range)}
              className={cn(
                'rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-200',
                dateRange === range
                  ? 'bg-gradient-to-r from-zbooni-teal to-zbooni-green text-black shadow-lg shadow-zbooni-teal/20'
                  : 'text-muted-foreground/60 hover:text-foreground/80',
              )}
            >
              {DATE_RANGE_LABELS[range]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error banner ────────────────────────────────────────── */}
      {funnel.error || feedback.error || scoreDistribution.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive backdrop-blur-sm">
          {funnel.error ?? feedback.error ?? scoreDistribution.error}
        </div>
      ) : null}

      {/* ── B3: Key Metrics Row ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Cost per Lead"
          value={costPerLead !== null ? `$${costPerLead.toFixed(2)}` : '--'}
          sub={
            totalCostCents !== null
              ? `$${(totalCostCents / 100).toFixed(2)} total`
              : undefined
          }
          icon={DollarSign}
          accent="text-zbooni-green"
          gradient="bg-zbooni-green"
        />
        <MetricCard
          label="Avg Lead Score"
          value={avgScore.data !== null ? avgScore.data.toFixed(2) : '--'}
          sub={
            scoreDistribution.data
              ? `${scoreDistribution.data.bands.reduce((s, b) => s + b.count, 0)} scored`
              : undefined
          }
          icon={TrendingUp}
          accent="text-zbooni-teal"
          gradient="bg-zbooni-teal"
        />
        <MetricCard
          label="Reply Rate"
          value={`${overallReplyRate}%`}
          sub={`${totalReplied} of ${totalMessaged} messaged`}
          icon={MessageSquare}
          accent="text-emerald-400"
          gradient="bg-emerald-400"
        />
        <MetricCard
          label="Pipeline Conversion"
          value={`${pipelineConversion}%`}
          sub={`${qualifiedFromFunnel} qualified of ${discoveredCount} (directional view)`}
          icon={Target}
          accent="text-purple-400"
          gradient="bg-purple-400"
        />
      </div>

      {/* ── B2: Pipeline Funnel ─────────────────────────────────── */}
      <GlassCard>
        <SectionHeader
          icon={Layers}
          title="Pipeline Funnel"
          subtitle="Directional progression reconstructed from current lead status plus outreach totals"
          trailing={
            <span className="rounded-full border border-yellow-400/20 bg-yellow-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-yellow-300">
              Directional
            </span>
          }
        />
        {funnel.data || leadStatuses.data ? (
          <PipelineFunnel stages={funnelStages} rejectedCount={rejectedCount} />
        ) : funnel.isLoading || leadStatuses.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground/50">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-zbooni-teal" />
            Loading funnel...
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground/50">
            No pipeline data yet
          </p>
        )}
      </GlassCard>

      {/* ── Two-column layout: ICP Performance + Quality Trends ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* B4: ICP Performance Comparison */}
        <GlassCard>
          <SectionHeader
            icon={Users}
            title="ICP Performance"
            subtitle="Lead count, scores, and conversion by segment"
          />
          {icpPerformance.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground/50">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-zbooni-teal" />
              Loading...
            </div>
          ) : (
            <IcpPerformanceTable
              rows={icpPerformance.data ?? []}
              icpNames={icpNameMap}
            />
          )}
        </GlassCard>

        {/* B5: Quality Trends */}
        <GlassCard>
          <SectionHeader
            icon={Activity}
            title="Quality Trends"
            subtitle="30-day lead score and rejection rate"
          />
          {qualityTrends.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground/50">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-zbooni-teal" />
              Loading...
            </div>
          ) : (
            <QualityTrendsChart data={qualityTrends.data ?? []} />
          )}
        </GlassCard>
      </div>

      {/* ── B7: Recovery & Follow-up Summary ────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-4 shadow-lg shadow-black/15 backdrop-blur-lg transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.12]">
          <div className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-orange-400 opacity-15 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-orange-400/70" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Recovery Candidates
            </p>
          </div>
          <p className="relative mt-2 text-2xl font-extrabold tabular-nums tracking-tight text-orange-400">
            {recoverySummary.data?.totalCandidates ?? '--'}
          </p>
          <p className="relative mt-0.5 text-[11px] text-muted-foreground/40">
            {recoverySummary.data
              ? `${recoverySummary.data.openCount} open, ${recoverySummary.data.rejectedCount} rejected`
              : 'Loading...'}
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-4 shadow-lg shadow-black/15 backdrop-blur-lg transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.12]">
          <div className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-blue-400 opacity-15 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <RefreshCcw className="h-3.5 w-3.5 text-blue-400/70" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Follow-ups Sent
            </p>
          </div>
          <p className="relative mt-2 text-2xl font-extrabold tabular-nums tracking-tight text-blue-400">
            {followUpSummary.data?.totalFollowUps ?? '--'}
          </p>
          <p className="relative mt-0.5 text-[11px] text-muted-foreground/40">
            Total follow-up drafts generated
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-4 shadow-lg shadow-black/15 backdrop-blur-lg transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.12]">
          <div className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-emerald-400 opacity-15 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <Send className="h-3.5 w-3.5 text-emerald-400/70" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Follow-up Response
            </p>
          </div>
          <p className="relative mt-2 text-2xl font-extrabold tabular-nums tracking-tight text-emerald-400">
            {totalMessaged > 0 ? `${overallReplyRate}%` : '--'}
          </p>
          <p className="relative mt-0.5 text-[11px] text-muted-foreground/40">
            Overall response rate across outreach
          </p>
        </div>
      </div>

      {/* ── Two-column: Score Distribution + Discovery Yield ───── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Score Distribution */}
        <GlassCard>
          <SectionHeader
            icon={BarChart3}
            title="Score Distribution"
            subtitle="Lead scores grouped by band"
          />
          {scoreDistribution.data && scoreDistribution.data.bands.length > 0 ? (
            <div className="space-y-3">
              {scoreDistribution.data.bands.map((band) => {
                const pct = Math.round((band.count / distributionMax) * 100);
                const bandColor =
                  band.scoreBand === 'HIGH'
                    ? '#7BFF6B'
                    : band.scoreBand === 'MEDIUM'
                      ? '#FACC15'
                      : '#f87171';
                return (
                  <div key={band.scoreBand} className="flex items-center gap-3">
                    <p className="w-16 text-xs font-semibold text-muted-foreground/70">
                      {band.scoreBand}
                    </p>
                    <div className="h-6 flex-1 overflow-hidden rounded-lg bg-white/[0.04]">
                      <div
                        className="h-full rounded-lg transition-all duration-500 ease-out"
                        style={{
                          width: `${Math.max(pct, band.count > 0 ? 5 : 0)}%`,
                          background: `linear-gradient(90deg, ${bandColor}50, ${bandColor}90)`,
                          boxShadow: `0 0 8px ${bandColor}25`,
                        }}
                      />
                    </div>
                    <p className="w-12 text-right text-sm font-bold tabular-nums">
                      {band.count}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground/50">
              No score data yet
            </p>
          )}
        </GlassCard>

        {/* B1 FIX: Discovery Yield — now shows runs correctly */}
        <GlassCard>
          <SectionHeader
            icon={Search}
            title="Discovery Yield"
            subtitle="Leads generated per discovery run"
            trailing={
              sortedRuns.length > 0 ? (
                <span className="text-[10px] text-muted-foreground/40">
                  {sortedRuns.length} run{sortedRuns.length !== 1 ? 's' : ''}
                </span>
              ) : undefined
            }
          />
          {discoveryRuns.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground/50">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-zbooni-teal" />
              Loading runs...
            </div>
          ) : sortedRuns.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Target className="h-8 w-8 text-muted-foreground/20" />
              <p className="mt-3 text-sm font-medium text-muted-foreground/50">
                No discovery runs yet
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/30">
                Start a discovery run to track yield rates
              </p>
            </div>
          ) : (
            <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
              {sortedRuns.map((run) => {
                const yieldRate =
                  run.totalItems > 0
                    ? Math.round((run.processedItems / run.totalItems) * 100)
                    : 0;
                const icpNames = (
                  run.icpProfileIds ??
                  (run.icpProfileId ? [run.icpProfileId] : [])
                )
                  .map(
                    (id) =>
                      icps.data?.items.find((i) => i.id === id)?.name ??
                      id.slice(0, 8),
                  )
                  .join(', ');

                return (
                  <Link
                    key={run.runId}
                    href={`/dashboard/jobs/${run.runId}`}
                    className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition-all duration-200 hover:border-zbooni-teal/30 hover:bg-white/[0.06]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground/50">
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
                      <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground/40">
                        <span>
                          {new Date(run.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span>
                          {run.totalItems} businesses &rarr; {run.processedItems}{' '}
                          leads
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-extrabold tabular-nums text-zbooni-green">
                        {yieldRate}%
                      </p>
                      <p className="text-[10px] text-muted-foreground/30">yield</p>
                    </div>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/25" />
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>

      {/* ── Recent Feedback Events ──────────────────────────────── */}
      <GlassCard>
        <SectionHeader
          icon={Clock}
          title="Recent Feedback Events"
          subtitle="Recorded outreach outcomes and user interactions"
          trailing={
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                Event-backed
              </span>
              {feedback.data ? (
                <span className="text-[10px] text-muted-foreground/40">
                  {feedback.data.totalEvents} total events
                </span>
              ) : null}
            </div>
          }
        />
        {feedbackEvents.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground/50">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-zbooni-teal" />
            Loading events...
          </div>
        ) : feedbackEvents.data && feedbackEvents.data.items.length > 0 ? (
          <div className="space-y-2">
            {feedbackEvents.data.items.map((event) => {
              const badge = EVENT_TYPE_BADGES[event.eventType] ?? {
                className: 'bg-slate-700/40 text-slate-300',
                label: event.eventType,
              };
              return (
                <div
                  key={event.id}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 transition-colors hover:border-white/[0.08]"
                >
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground/50">
                    {event.leadId.slice(0, 16)}...
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground/40">
                    {new Date(event.occurredAt).toLocaleDateString('en-AE', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <Clock className="h-6 w-6 text-muted-foreground/15" />
            <p className="mt-2 text-sm text-muted-foreground/40">No feedback events yet</p>
          </div>
        )}
      </GlassCard>

      {/* ── Loading state ───────────────────────────────────────── */}
      {funnel.isLoading && !funnel.data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-zbooni-teal" />
          Loading analytics data...
        </div>
      ) : null}

      {/* ── Empty state ─────────────────────────────────────────── */}
      {!funnel.data && !funnel.isLoading && !funnel.error ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground/50 backdrop-blur-sm">
          No analytics data found in the current database.
        </div>
      ) : null}
    </div>
  );
}

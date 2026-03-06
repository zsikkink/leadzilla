'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JobRunListQuery, ListJobRunsResponse } from '@lead-flood/contracts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Layers,
  Loader2,
  MessageSquare,
  Play,
  Radar,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth.js';
import { useApiQuery } from '@/hooks/use-api-query.js';
import { cn } from '@/lib/utils.js';

import {
  fetchJobRequests,
  fetchJobRuns,
  queryFromJobRequestFilters,
  queryFromJobRunFilters,
  triggerDiscoveryRun,
  triggerDiscoverySeed,
  type JobRequestListResponse,
} from '../../../src/lib/discovery-admin';

// ── Pipeline category definitions ───────────────────────────────────────

interface CategoryDef {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  bgColor: string;
  jobNames: string[];
}

const PIPELINE_CATEGORIES: CategoryDef[] = [
  {
    id: 'discovery',
    title: 'Discovery',
    icon: Radar,
    iconColor: 'text-zbooni-teal',
    bgColor: 'bg-zbooni-teal/10',
    jobNames: ['discovery.seed', 'discovery.run_search_task', 'business.prequalify'],
  },
  {
    id: 'qualification',
    title: 'Qualification',
    icon: Layers,
    iconColor: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    jobNames: ['business.convert', 'apollo.enrich'],
  },
  {
    id: 'intelligence',
    title: 'Intelligence / Scoring',
    icon: Sparkles,
    iconColor: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    jobNames: ['features.compute', 'scoring.batch', 'scoring.compute'],
  },
  {
    id: 'outreach',
    title: 'Outreach',
    icon: MessageSquare,
    iconColor: 'text-zbooni-green',
    bgColor: 'bg-zbooni-green/10',
    jobNames: ['message.generate', 'message.send', 'followup.check'],
  },
  {
    id: 'learning',
    title: 'Learning Loops',
    icon: TrendingUp,
    iconColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    jobNames: [
      'reply.classify', 'labels.generate', 'model.train', 'model.evaluate',
      'manager.analyze', 'analytics.rollup',
      'notify.sales', 'model.drift', 'data.retention', 'lead.recovery', 'pipeline.health',
    ],
  },
];

const JOB_NAME_TO_CATEGORY = new Map<string, string>();
for (const cat of PIPELINE_CATEGORIES) {
  for (const name of cat.jobNames) {
    JOB_NAME_TO_CATEGORY.set(name, cat.id);
  }
}

// ── Types ─────────────────────────────────────────────────────────

interface JobRunItem {
  id: string;
  jobName: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: string;
  countersJson: unknown;
  errorText: string | null;
}

interface CategoryMetrics {
  totalRuns: number;
  successCount: number;
  failedCount: number;
  runningCount: number;
  avgDurationMs: number | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  jobBreakdown: Map<string, { total: number; success: number; failed: number; avgMs: number | null; lastRun: string | null }>;
}

function computeCategoryMetrics(runs: JobRunItem[]): CategoryMetrics {
  const totalRuns = runs.length;
  const successCount = runs.filter((r) => r.status === 'SUCCESS').length;
  const failedCount = runs.filter((r) => r.status === 'FAILED').length;
  const runningCount = runs.filter((r) => r.status === 'RUNNING').length;

  const durations = runs.filter((r) => r.durationMs != null).map((r) => r.durationMs!);
  const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const sorted = [...runs].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const lastRunAt = sorted[0]?.startedAt ?? null;
  const lastStatus = sorted[0]?.status ?? null;

  const jobBreakdown = new Map<string, { total: number; success: number; failed: number; avgMs: number | null; lastRun: string | null }>();
  for (const run of runs) {
    const existing = jobBreakdown.get(run.jobName) ?? { total: 0, success: 0, failed: 0, avgMs: null, lastRun: null };
    existing.total++;
    if (run.status === 'SUCCESS') existing.success++;
    if (run.status === 'FAILED') existing.failed++;
    if (!existing.lastRun || new Date(run.startedAt) > new Date(existing.lastRun)) {
      existing.lastRun = run.startedAt;
    }
    jobBreakdown.set(run.jobName, existing);
  }

  // Compute avg duration per job
  for (const [name, stats] of jobBreakdown) {
    const jobDurations = runs.filter((r) => r.jobName === name && r.durationMs != null).map((r) => r.durationMs!);
    stats.avgMs = jobDurations.length > 0 ? jobDurations.reduce((a, b) => a + b, 0) / jobDurations.length : null;
  }

  return { totalRuns, successCount, failedCount, runningCount, avgDurationMs, lastRunAt, lastStatus, jobBreakdown };
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'SUCCESS': return 'text-zbooni-green bg-zbooni-green/10';
    case 'RUNNING': return 'text-blue-400 bg-blue-400/10';
    case 'FAILED': return 'text-red-400 bg-red-400/10';
    case 'CANCELED': return 'text-muted-foreground bg-muted/10';
    default: return 'text-yellow-400 bg-yellow-400/10';
  }
}

// ── Category card component ─────────────────────────────────────────

function CategoryCard({ category, metrics }: { category: CategoryDef; metrics: CategoryMetrics }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = category.icon;
  const successRate = metrics.totalRuns > 0 ? ((metrics.successCount / metrics.totalRuns) * 100).toFixed(0) : '-';

  return (
    <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', category.bgColor)}>
          <Icon className={cn('h-4 w-4', category.iconColor)} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold tracking-tight">{category.title}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground/40">
            {category.jobNames.length} job type{category.jobNames.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Quick metrics */}
          <div className="flex items-center gap-3 text-[11px]">
            <div className="text-center">
              <p className="font-mono font-bold tabular-nums">{metrics.totalRuns}</p>
              <p className="text-[9px] text-muted-foreground/40">Runs</p>
            </div>
            <div className="text-center">
              <p className={cn('font-mono font-bold tabular-nums', metrics.totalRuns > 0 && Number(successRate) >= 90 ? 'text-zbooni-green' : metrics.totalRuns > 0 && Number(successRate) < 50 ? 'text-red-400' : '')}>
                {successRate}%
              </p>
              <p className="text-[9px] text-muted-foreground/40">Success</p>
            </div>
            <div className="text-center">
              <p className="font-mono font-bold tabular-nums text-[11px]">{formatDuration(metrics.avgDurationMs)}</p>
              <p className="text-[9px] text-muted-foreground/40">Avg</p>
            </div>
            <div className="text-center">
              <p className="text-[11px] font-medium">{formatTimeAgo(metrics.lastRunAt)}</p>
              <p className="text-[9px] text-muted-foreground/40">Last run</p>
            </div>
          </div>
          {/* Status indicators */}
          <div className="flex items-center gap-1">
            {metrics.runningCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-blue-400/10 px-2 py-0.5 text-[10px] font-bold text-blue-400">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                {metrics.runningCount}
              </span>
            )}
            {metrics.failedCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-red-400/10 px-2 py-0.5 text-[10px] font-bold text-red-400">
                <AlertTriangle className="h-2.5 w-2.5" />
                {metrics.failedCount}
              </span>
            )}
            {metrics.totalRuns > 0 && metrics.failedCount === 0 && metrics.runningCount === 0 && (
              <CheckCircle2 className="h-4 w-4 text-zbooni-green/60" />
            )}
          </div>
          <span className="text-muted-foreground/30">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/20">
          {metrics.jobBreakdown.size > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/20 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    <th className="px-4 py-2.5">Job Name</th>
                    <th className="px-4 py-2.5 text-right">Runs</th>
                    <th className="px-4 py-2.5 text-right">Success</th>
                    <th className="px-4 py-2.5 text-right">Failed</th>
                    <th className="px-4 py-2.5 text-right">Avg Duration</th>
                    <th className="px-4 py-2.5">Last Run</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(metrics.jobBreakdown.entries())
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([name, stats]) => {
                      const rate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(0) : '-';
                      return (
                        <tr key={name} className="border-b border-border/10 last:border-0 hover:bg-white/[0.01]">
                          <td className="px-4 py-2.5 font-mono text-xs font-medium">{name}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{stats.total}</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={cn('font-mono text-xs tabular-nums', Number(rate) >= 90 ? 'text-zbooni-green' : Number(rate) < 50 ? 'text-red-400' : '')}>
                              {stats.success} ({rate}%)
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={cn('font-mono text-xs tabular-nums', stats.failed > 0 ? 'text-red-400' : 'text-muted-foreground/40')}>
                              {stats.failed}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{formatDuration(stats.avgMs)}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground/50">{stats.lastRun ? new Date(stats.lastRun).toLocaleString() : '-'}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-[11px] text-muted-foreground/40">No job runs in this category</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Default state ─────────────────────────────────────────────────

const DEFAULT_JOBS_QUERY: JobRunListQuery = {
  page: 1,
  pageSize: 200,
};

const DEFAULT_REQUESTS_QUERY = {
  page: 1,
  pageSize: 20,
};

// ── Main page ─────────────────────────────────────────────────────

export default function JobsPage() {
  const { apiClient } = useAuth();

  const funnelQuery = useApiQuery(
    useCallback(() => apiClient.getFunnel(), [apiClient]),
  );

  const pendingDraftsQuery = useApiQuery(
    useCallback(() => apiClient.listDrafts({ approvalStatus: 'PENDING', page: 1, pageSize: 1 }), [apiClient]),
  );

  const [jobsQuery] = useState<JobRunListQuery>(DEFAULT_JOBS_QUERY);
  const [jobsData, setJobsData] = useState<ListJobRunsResponse | null>(null);
  const [requestsData, setRequestsData] = useState<JobRequestListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastTriggeredRequestId, setLastTriggeredRequestId] = useState<number | null>(null);

  const [seedProfile, setSeedProfile] = useState<'default' | 'small'>('small');
  const [seedMaxTasks, setSeedMaxTasks] = useState(40);
  const [seedMaxPages, setSeedMaxPages] = useState(1);
  const [seedBucket, setSeedBucket] = useState('');
  const [seedTaskTypes, setSeedTaskTypes] = useState('SERP_MAPS_LOCAL,SERP_GOOGLE_LOCAL');
  const [seedCountries, setSeedCountries] = useState('AE,SA,JO,EG');
  const [seedLanguages, setSeedLanguages] = useState('en,ar');

  const [runMaxTasks, setRunMaxTasks] = useState(40);
  const [runConcurrency, setRunConcurrency] = useState(1);
  const [runTimeBucket, setRunTimeBucket] = useState('');

  const [autoRefreshIntervalMs, setAutoRefreshIntervalMs] = useState<number>(0);
  const [showRequests, setShowRequests] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runsResult, requestsResult] = await Promise.all([
        fetchJobRuns(queryFromJobRunFilters(jobsQuery)),
        fetchJobRequests(queryFromJobRequestFilters(DEFAULT_REQUESTS_QUERY)),
      ]);
      setJobsData(runsResult);
      setRequestsData(requestsResult);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [jobsQuery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (autoRefreshIntervalMs <= 0) return;
    const timer = setInterval(() => { void loadData(); }, autoRefreshIntervalMs);
    return () => clearInterval(timer);
  }, [autoRefreshIntervalMs, loadData]);

  // Group job runs by pipeline category
  const categoryMetrics = useMemo(() => {
    const allRuns = (jobsData?.items ?? []) as JobRunItem[];
    const grouped = new Map<string, JobRunItem[]>();

    for (const cat of PIPELINE_CATEGORIES) {
      grouped.set(cat.id, []);
    }
    grouped.set('uncategorized', []);

    for (const run of allRuns) {
      const catId = JOB_NAME_TO_CATEGORY.get(run.jobName) ?? 'uncategorized';
      const arr = grouped.get(catId);
      if (arr) arr.push(run);
    }

    const metricsMap = new Map<string, CategoryMetrics>();
    for (const [id, runs] of grouped) {
      metricsMap.set(id, computeCategoryMetrics(runs));
    }
    return metricsMap;
  }, [jobsData]);

  const totalRuns = jobsData?.total ?? 0;
  const totalSuccess = useMemo(() => {
    let sum = 0;
    for (const m of categoryMetrics.values()) sum += m.successCount;
    return sum;
  }, [categoryMetrics]);
  const totalFailed = useMemo(() => {
    let sum = 0;
    for (const m of categoryMetrics.values()) sum += m.failedCount;
    return sum;
  }, [categoryMetrics]);
  const totalRunning = useMemo(() => {
    let sum = 0;
    for (const m of categoryMetrics.values()) sum += m.runningCount;
    return sum;
  }, [categoryMetrics]);

  const runSeed = async () => {
    setError(null);
    try {
      const taskTypes = seedTaskTypes.split(',').map((v) => v.trim()).filter(Boolean) as Array<'SERP_GOOGLE' | 'SERP_GOOGLE_LOCAL' | 'SERP_MAPS_LOCAL'>;
      const countries = seedCountries.split(',').map((v) => v.trim()).filter(Boolean);
      const languages = seedLanguages.split(',').map((v) => v.trim()).filter(Boolean);
      const result = await triggerDiscoverySeed({ profile: seedProfile, maxTasks: seedMaxTasks, maxPages: seedMaxPages, bucket: seedBucket || undefined, taskTypes, countries, languages });
      setLastTriggeredRequestId(result.jobRequestId);
      await loadData();
    } catch (runError: unknown) {
      setError(runError instanceof Error ? runError.message : 'Failed to request seed job');
    }
  };

  const runDiscovery = async () => {
    setError(null);
    try {
      const result = await triggerDiscoveryRun({ maxTasks: runMaxTasks, concurrency: runConcurrency, timeBucket: runTimeBucket || undefined });
      setLastTriggeredRequestId(result.jobRequestId);
      await loadData();
    } catch (runError: unknown) {
      setError(runError instanceof Error ? runError.message : 'Failed to request discovery run');
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Header + Controls ────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Dev Console</h1>
          <p className="mt-0.5 text-sm text-muted-foreground/60">Pipeline job monitoring and trigger controls</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={String(autoRefreshIntervalMs)}
            onChange={(e) => setAutoRefreshIntervalMs(Number(e.target.value))}
            className="rounded-lg border border-border/40 bg-background px-3 py-2 text-xs font-medium text-foreground focus:border-zbooni-teal/50 focus:outline-none"
          >
            <option value="0">Auto-refresh: Off</option>
            <option value="2000">Every 2s</option>
            <option value="5000">Every 5s</option>
            <option value="10000">Every 10s</option>
            <option value="30000">Every 30s</option>
          </select>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zbooni-teal/15 px-3.5 py-2 text-xs font-semibold text-zbooni-teal transition-colors hover:bg-zbooni-teal/25 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Summary cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            <Activity className="h-3.5 w-3.5" />
            Total Runs
          </div>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight">{totalRuns}</p>
        </div>
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zbooni-green/60">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Success
          </div>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight text-zbooni-green">{totalSuccess}</p>
        </div>
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-red-400/60">
            <AlertTriangle className="h-3.5 w-3.5" />
            Failed
          </div>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight text-red-400">{totalFailed}</p>
        </div>
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-blue-400/60">
            <Loader2 className="h-3.5 w-3.5" />
            Running
          </div>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight text-blue-400">{totalRunning}</p>
        </div>
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-yellow-400/60">
            <Clock className="h-3.5 w-3.5" />
            Pending Approvals
          </div>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight text-yellow-400">{pendingDraftsQuery.data?.total ?? 0}</p>
        </div>
      </div>

      {/* ── Pipeline funnel ──────────────────────────────────────────── */}
      {funnelQuery.data && (
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-7">
          {([
            { label: 'Discovered', value: funnelQuery.data.discoveredCount },
            { label: 'Enriched', value: funnelQuery.data.enrichedCount },
            { label: 'Scored', value: funnelQuery.data.scoredCount },
            { label: 'Sent', value: funnelQuery.data.messagesSentCount },
            { label: 'Replies', value: funnelQuery.data.repliesCount },
            { label: 'Won', value: funnelQuery.data.dealsWonCount },
            { label: 'Cost/Lead', value: `$${funnelQuery.data.costPerLead.toFixed(2)}` },
          ] as const).map((item) => (
            <div key={item.label} className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">{item.label}</p>
              <p className="mt-1 text-lg font-extrabold tabular-nums tracking-tight">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Pipeline categories ──────────────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-sm font-bold tracking-tight text-muted-foreground/60">Jobs by Pipeline Category</h2>
        <div className="space-y-2">
          {PIPELINE_CATEGORIES.map((cat) => (
            <CategoryCard key={cat.id} category={cat} metrics={categoryMetrics.get(cat.id) ?? computeCategoryMetrics([])} />
          ))}
          {(categoryMetrics.get('uncategorized')?.totalRuns ?? 0) > 0 && (
            <CategoryCard
              category={{ id: 'uncategorized', title: 'Other / Uncategorized', icon: Zap, iconColor: 'text-muted-foreground', bgColor: 'bg-muted/10', jobNames: [] }}
              metrics={categoryMetrics.get('uncategorized')!}
            />
          )}
        </div>
      </div>

      {/* ── Trigger controls ─────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zbooni-teal/10">
              <Play className="h-4 w-4 text-zbooni-teal" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Request Discovery Seed</h3>
              <p className="text-[11px] text-muted-foreground/50">Generate search tasks for all ICP profiles</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-medium text-muted-foreground/60">
              Profile
              <select value={seedProfile} onChange={(e) => setSeedProfile(e.target.value as 'default' | 'small')} className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs text-foreground focus:border-zbooni-teal/50 focus:outline-none">
                <option value="small">small</option>
                <option value="default">default</option>
              </select>
            </label>
            <label className="text-[11px] font-medium text-muted-foreground/60">
              Max Tasks
              <input type="number" min={1} value={seedMaxTasks} onChange={(e) => setSeedMaxTasks(Number(e.target.value) || 1)} className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-zbooni-teal/50 focus:outline-none" />
            </label>
            <label className="text-[11px] font-medium text-muted-foreground/60">
              Max Pages
              <input type="number" min={1} value={seedMaxPages} onChange={(e) => setSeedMaxPages(Number(e.target.value) || 1)} className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-zbooni-teal/50 focus:outline-none" />
            </label>
            <label className="text-[11px] font-medium text-muted-foreground/60">
              Bucket
              <input value={seedBucket} onChange={(e) => setSeedBucket(e.target.value)} placeholder="small-validation" className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:outline-none" />
            </label>
            <label className="col-span-2 text-[11px] font-medium text-muted-foreground/60">
              Task Types (CSV)
              <input value={seedTaskTypes} onChange={(e) => setSeedTaskTypes(e.target.value)} className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-zbooni-teal/50 focus:outline-none" />
            </label>
            <label className="text-[11px] font-medium text-muted-foreground/60">
              Countries (CSV)
              <input value={seedCountries} onChange={(e) => setSeedCountries(e.target.value)} className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-zbooni-teal/50 focus:outline-none" />
            </label>
            <label className="text-[11px] font-medium text-muted-foreground/60">
              Languages (CSV)
              <input value={seedLanguages} onChange={(e) => setSeedLanguages(e.target.value)} className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-zbooni-teal/50 focus:outline-none" />
            </label>
          </div>
          <button type="button" onClick={() => void runSeed()} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-zbooni-teal/15 px-4 py-2 text-xs font-semibold text-zbooni-teal transition-colors hover:bg-zbooni-teal/25">
            <Play className="h-3.5 w-3.5" />
            Request Seed
          </button>
        </div>

        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zbooni-green/10">
              <Radar className="h-4 w-4 text-zbooni-green" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Request Discovery Run</h3>
              <p className="text-[11px] text-muted-foreground/50">Execute pending search tasks with bounded concurrency</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-medium text-muted-foreground/60">
              Max Tasks
              <input type="number" min={1} value={runMaxTasks} onChange={(e) => setRunMaxTasks(Number(e.target.value) || 1)} className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-zbooni-teal/50 focus:outline-none" />
            </label>
            <label className="text-[11px] font-medium text-muted-foreground/60">
              Concurrency
              <input type="number" min={1} max={10} value={runConcurrency} onChange={(e) => setRunConcurrency(Number(e.target.value) || 1)} className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-zbooni-teal/50 focus:outline-none" />
            </label>
            <label className="col-span-2 text-[11px] font-medium text-muted-foreground/60">
              Time Bucket Filter
              <input value={runTimeBucket} onChange={(e) => setRunTimeBucket(e.target.value)} placeholder="2026-W08:small-validation" className="mt-1 block w-full rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:outline-none" />
            </label>
          </div>
          <button type="button" onClick={() => void runDiscovery()} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-zbooni-green/15 px-4 py-2 text-xs font-semibold text-zbooni-green transition-colors hover:bg-zbooni-green/25">
            <Play className="h-3.5 w-3.5" />
            Request Run
          </button>

          {lastTriggeredRequestId !== null && (
            <p className="mt-2 text-[11px] text-muted-foreground/50">
              Last request: <span className="font-mono font-medium">{lastTriggeredRequestId}</span>
            </p>
          )}
        </div>
      </div>

      {/* ── Job Requests (collapsible) ───────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowRequests(!showRequests)}
          className="flex w-full items-center gap-2 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
        >
          <h2 className="text-sm font-bold tracking-tight">Job Requests</h2>
          <span className="text-[11px] text-muted-foreground/40">({requestsData?.total ?? 0} total)</span>
          <span className="ml-auto text-muted-foreground/30">
            {showRequests ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        </button>
        {showRequests && (
          <div className="border-t border-border/20 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/20 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  <th className="px-4 py-2.5">ID</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Requested</th>
                  <th className="px-4 py-2.5">Claimed By</th>
                  <th className="px-4 py-2.5">Job Run</th>
                  <th className="px-4 py-2.5">Error</th>
                </tr>
              </thead>
              <tbody>
                {!requestsData && loading ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground/50">Loading requests...</td></tr>
                ) : requestsData && requestsData.items.length > 0 ? (
                  requestsData.items.map((request) => (
                    <tr key={request.id} className="border-b border-border/10 last:border-0 hover:bg-white/[0.01]">
                      <td className="px-4 py-2.5 font-mono text-xs">{request.id}</td>
                      <td className="px-4 py-2.5 text-xs">{request.requestType}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', statusColor(request.status))}>
                          {request.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground/60">{new Date(request.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground/50">{request.claimedBy ?? '-'}</td>
                      <td className="px-4 py-2.5">
                        {request.jobRunId ? (
                          <Link href={`/discovery/jobs/${request.jobRunId}`} className="font-mono text-xs text-zbooni-teal hover:underline">
                            {request.jobRunId}
                          </Link>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-2.5 max-w-[200px] truncate font-mono text-xs text-red-400/70">{request.errorText ?? '-'}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground/40">No job requests found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

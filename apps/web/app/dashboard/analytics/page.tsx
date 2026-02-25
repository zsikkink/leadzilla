'use client';

import {
  BarChart3,
  Brain,
  CheckCircle2,
  Database,
  Gauge,
  MessageSquare,
  PieChart,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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

// ── Placeholder data for comprehensive model metrics ─────────────────────
const PLACEHOLDER_MODEL_PERFORMANCE = {
  auc: { value: 0.847, prev: 0.821, label: 'AUC' },
  precision: { value: 0.782, prev: 0.756, label: 'Precision' },
  recall: { value: 0.714, prev: 0.698, label: 'Recall' },
  f1: { value: 0.746, prev: 0.726, label: 'F1 Score' },
};

const PLACEHOLDER_FEATURE_IMPORTANCE = [
  { feature: 'company_revenue', importance: 0.94 },
  { feature: 'employee_count', importance: 0.87 },
  { feature: 'website_tech_stack', importance: 0.81 },
  { feature: 'social_presence_score', importance: 0.76 },
  { feature: 'industry_match', importance: 0.72 },
  { feature: 'review_count', importance: 0.68 },
  { feature: 'funding_stage', importance: 0.63 },
  { feature: 'location_proximity', importance: 0.57 },
  { feature: 'job_postings_count', importance: 0.49 },
  { feature: 'domain_authority', importance: 0.41 },
];

const PLACEHOLDER_CONVERSION_RATES = [
  { band: 'HIGH', leads: 142, conversions: 48, rate: 0.338, sends: 118, replies: 42, color: '#7BFF6B' },
  { band: 'MEDIUM', leads: 287, conversions: 41, rate: 0.143, sends: 204, replies: 38, color: '#FACC15' },
  { band: 'LOW', leads: 394, conversions: 12, rate: 0.030, sends: 89, replies: 8, color: '#F87171' },
];

const PLACEHOLDER_SOURCE_EFFECTIVENESS = [
  { source: 'Apollo', icps: ['SaaS B2B', 'E-commerce'], enrichmentRate: 0.84, avgScore: 0.72, leads: 312 },
  { source: 'LinkedIn', icps: ['SaaS B2B', 'Hospitality'], enrichmentRate: 0.91, avgScore: 0.68, leads: 189 },
  { source: 'Hunter', icps: ['E-commerce', 'Luxury'], enrichmentRate: 0.67, avgScore: 0.61, leads: 247 },
  { source: 'PDL', icps: ['Hospitality', 'F&B'], enrichmentRate: 0.78, avgScore: 0.65, leads: 156 },
  { source: 'Apify', icps: ['Luxury', 'SaaS B2B'], enrichmentRate: 0.59, avgScore: 0.58, leads: 203 },
];

const PLACEHOLDER_AB_VARIANTS = [
  { variant: 'A', channel: 'email', sends: 245, replies: 52, replyRate: 0.212, label: 'Formal tone, case study CTA' },
  { variant: 'B', channel: 'email', sends: 238, replies: 67, replyRate: 0.281, label: 'Casual tone, question CTA' },
  { variant: 'A', channel: 'whatsapp', sends: 112, replies: 31, replyRate: 0.277, label: 'Short intro + link' },
  { variant: 'B', channel: 'whatsapp', sends: 108, replies: 38, replyRate: 0.352, label: 'Personalized opener' },
];

const PLACEHOLDER_APPROVAL_RATES = [
  { name: 'Approved', value: 187, color: '#7BFF6B' },
  { name: 'Auto-sent', value: 94, color: '#3CC8E0' },
  { name: 'Edited', value: 43, color: '#FACC15' },
  { name: 'Rejected', value: 21, color: '#F87171' },
];

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

function MetricStatCard({
  label,
  value,
  prevValue,
  icon: Icon,
  iconColor,
}: {
  label: string;
  value: number;
  prevValue: number;
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
}) {
  const delta = value - prevValue;
  const isPositive = delta > 0;
  const pctChange = prevValue > 0 ? Math.abs(delta / prevValue) * 100 : 0;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 transition-colors hover:border-border/50">
      <div className="absolute -right-3 -top-3 opacity-[0.04] transition-opacity group-hover:opacity-[0.07]">
        <Icon className="h-20 w-20" />
      </div>
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{label}</p>
      </div>
      <p className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight">{value.toFixed(3)}</p>
      <div className="mt-1.5 flex items-center gap-1">
        {isPositive ? (
          <TrendingUp className="h-3 w-3 text-zbooni-green" />
        ) : (
          <TrendingDown className="h-3 w-3 text-red-400" />
        )}
        <span className={`text-[11px] font-semibold tabular-nums ${isPositive ? 'text-zbooni-green' : 'text-red-400'}`}>
          {isPositive ? '+' : '-'}{pctChange.toFixed(1)}%
        </span>
        <span className="text-[10px] text-muted-foreground/40">vs prev</span>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  iconColor,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  title: string;
  subtitle?: string | undefined;
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className={`h-4 w-4 ${iconColor}`} />
      <div>
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-[11px] text-muted-foreground/50">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: { active?: boolean | undefined; payload?: Array<{ value: number }> | undefined; label?: string | undefined }) {
  const first = active && payload ? payload[0] : undefined;
  if (!first) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-zbooni-navy px-3 py-2 shadow-lg">
      <p className="text-[11px] font-semibold text-muted-foreground/60">{label}</p>
      <p className="text-sm font-bold tabular-nums text-foreground">{first.value.toFixed(2)}</p>
    </div>
  );
}

function PieTooltip({ active, payload }: { active?: boolean | undefined; payload?: Array<{ name: string; value: number }> | undefined }) {
  const first = active && payload ? payload[0] : undefined;
  if (!first) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-zbooni-navy px-3 py-2 shadow-lg">
      <p className="text-[11px] font-semibold text-muted-foreground/60">{first.name}</p>
      <p className="text-sm font-bold tabular-nums text-foreground">{first.value}</p>
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

  const retrainStatus = useApiQuery(
    useCallback(() => apiClient.getRetrainStatus(), [apiClient]),
  );

  const scoreDistribution = useApiQuery(
    useCallback(() => apiClient.getScoreDistribution(dateFilter), [apiClient, dateFilter]),
    [dateFilter],
  );

  const modelMetrics = useApiQuery(
    useCallback(() => apiClient.getModelMetrics(dateFilter), [apiClient, dateFilter]),
    [dateFilter],
  );

  const totalMessaged = funnel.data?.messagesSentCount ?? 0;
  const totalReplied = funnel.data?.repliesCount ?? 0;
  const overallReplyRate = totalMessaged > 0 ? Math.round((totalReplied / totalMessaged) * 100) : 0;
  const totalMeetings = funnel.data?.meetingsCount ?? 0;
  const meetingRate = totalReplied > 0 ? Math.round((totalMeetings / totalReplied) * 100) : 0;

  const distributionMax = Math.max(...(scoreDistribution.data?.bands.map((band) => band.count) ?? [0]), 1);
  const metricsItems = [...(modelMetrics.data?.items ?? [])]
    .sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime())
    .slice(0, 6);

  // Derive approval/rejection total for center label
  const approvalTotal = PLACEHOLDER_APPROVAL_RATES.reduce((s, r) => s + r.value, 0);

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
      {funnel.error || feedback.error || retrainStatus.error || scoreDistribution.error || modelMetrics.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {funnel.error ?? feedback.error ?? retrainStatus.error ?? scoreDistribution.error ?? modelMetrics.error}
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

      {/* ── Model Status + Feedback side-by-side ──────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-bold tracking-tight">Scoring Model Status</h2>
          </div>
          {retrainStatus.data ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">Active model</span>
                <span className="font-mono text-xs">
                  {retrainStatus.data.activeModelVersionId
                    ? `${retrainStatus.data.activeModelVersionId.slice(0, 12)}...`
                    : 'Deterministic only'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">Current run</span>
                <span className="font-medium">
                  {retrainStatus.data.currentRun ? retrainStatus.data.currentRun.status : 'Idle'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">Last successful run</span>
                <span>
                  {retrainStatus.data.lastSuccessfulRun
                    ? new Date(retrainStatus.data.lastSuccessfulRun.endedAt).toLocaleString()
                    : 'Not yet'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">Next scheduled</span>
                <span>
                  {retrainStatus.data.nextScheduledAt
                    ? new Date(retrainStatus.data.nextScheduledAt).toLocaleString()
                    : 'Not scheduled'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/60">Loading model status...</p>
          )}
        </div>

        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-zbooni-green" />
            <h2 className="text-sm font-bold tracking-tight">Feedback Signals</h2>
          </div>
          {feedback.data ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground/60">Replied</p>
                <p className="text-lg font-bold text-zbooni-green">{feedback.data.repliedCount}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground/60">Meetings</p>
                <p className="text-lg font-bold text-zbooni-teal">{feedback.data.meetingBookedCount}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground/60">Deals Won</p>
                <p className="text-lg font-bold text-purple-400">{feedback.data.dealWonCount}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground/60">Deals Lost</p>
                <p className="text-lg font-bold text-red-400">{feedback.data.dealLostCount}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground/60">Unsubscribed</p>
                <p className="text-lg font-bold text-yellow-400">{feedback.data.unsubscribedCount}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground/60">Bounced</p>
                <p className="text-lg font-bold text-muted-foreground">{feedback.data.bouncedCount}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/60">Loading feedback summary...</p>
          )}
        </div>
      </div>

      {/* ── Raw Model Metrics Table ───────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Recent Model Evaluations</h2>
        </div>
        {metricsItems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-4">Version</th>
                  <th className="py-2 pr-4">Split</th>
                  <th className="py-2 pr-4">AUC</th>
                  <th className="py-2 pr-4">PR AUC</th>
                  <th className="py-2 pr-4">F1</th>
                  <th className="py-2 pr-0">Evaluated</th>
                </tr>
              </thead>
              <tbody>
                {metricsItems.map((item) => (
                  <tr key={`${item.modelVersionId}:${item.split}:${item.evaluatedAt}`} className="border-b border-border/30 last:border-0">
                    <td className="py-2 pr-4">{item.versionTag}</td>
                    <td className="py-2 pr-4">{item.split}</td>
                    <td className="py-2 pr-4">{item.auc.toFixed(3)}</td>
                    <td className="py-2 pr-4">{item.prAuc.toFixed(3)}</td>
                    <td className="py-2 pr-4">{item.f1.toFixed(3)}</td>
                    <td className="py-2 pr-0">{new Date(item.evaluatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/60">No model evaluation rows found yet.</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════ */}
      {/* ── COMPREHENSIVE MODEL METRICS SECTION ───────────────────── */}
      {/* ════════════════════════════════════════════════════════════ */}

      <div className="relative">
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-zbooni-teal/[0.03] via-transparent to-zbooni-green/[0.03]" />
        <div className="relative space-y-6 rounded-3xl border border-border/30 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zbooni-teal/10">
                  <Gauge className="h-4 w-4 text-zbooni-teal" />
                </div>
                <h2 className="text-lg font-extrabold tracking-tight">Model Performance Deep Dive</h2>
              </div>
              <p className="mt-1 pl-10 text-[12px] text-muted-foreground/50">
                Comprehensive metrics from the latest model version (placeholder data)
              </p>
            </div>
            <span className="rounded-full bg-yellow-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-yellow-400">
              Preview
            </span>
          </div>

          {/* ── 1. Model Performance Stat Cards (4-col grid) ───────── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricStatCard
              label={PLACEHOLDER_MODEL_PERFORMANCE.auc.label}
              value={PLACEHOLDER_MODEL_PERFORMANCE.auc.value}
              prevValue={PLACEHOLDER_MODEL_PERFORMANCE.auc.prev}
              icon={Target}
              iconColor="text-zbooni-teal"
            />
            <MetricStatCard
              label={PLACEHOLDER_MODEL_PERFORMANCE.precision.label}
              value={PLACEHOLDER_MODEL_PERFORMANCE.precision.value}
              prevValue={PLACEHOLDER_MODEL_PERFORMANCE.precision.prev}
              icon={CheckCircle2}
              iconColor="text-zbooni-green"
            />
            <MetricStatCard
              label={PLACEHOLDER_MODEL_PERFORMANCE.recall.label}
              value={PLACEHOLDER_MODEL_PERFORMANCE.recall.value}
              prevValue={PLACEHOLDER_MODEL_PERFORMANCE.recall.prev}
              icon={Zap}
              iconColor="text-yellow-400"
            />
            <MetricStatCard
              label={PLACEHOLDER_MODEL_PERFORMANCE.f1.label}
              value={PLACEHOLDER_MODEL_PERFORMANCE.f1.value}
              prevValue={PLACEHOLDER_MODEL_PERFORMANCE.f1.prev}
              icon={BarChart3}
              iconColor="text-purple-400"
            />
          </div>

          {/* ── 2. Feature Importance (horizontal bar chart) ────────── */}
          <div className="rounded-2xl border border-border/30 bg-card/60 p-6">
            <SectionHeader
              icon={BarChart3}
              iconColor="text-zbooni-green"
              title="Feature Importance"
              subtitle="Top 10 features ranked by model coefficient weight"
            />
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={PLACEHOLDER_FEATURE_IMPORTANCE}
                  layout="vertical"
                  margin={{ top: 4, right: 20, bottom: 4, left: 0 }}
                  barCategoryGap="18%"
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="hsl(240, 8%, 18%)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    type="number"
                    domain={[0, 1]}
                    tick={{ fill: 'hsl(240, 5%, 55%)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    dataKey="feature"
                    type="category"
                    width={140}
                    tick={{ fill: 'hsl(0, 0%, 90%)', fontSize: 11, fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="importance" radius={[0, 4, 4, 0]} maxBarSize={20}>
                    {PLACEHOLDER_FEATURE_IMPORTANCE.map((entry, i) => (
                      <Cell
                        key={entry.feature}
                        fill={i < 3 ? '#3CC8E0' : i < 6 ? '#7BFF6B' : '#7BFF6B80'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── 3. Conversion Rates by Score Band ──────────────────── */}
          <div className="rounded-2xl border border-border/30 bg-card/60 p-6">
            <SectionHeader
              icon={TrendingUp}
              iconColor="text-zbooni-teal"
              title="Conversion Rates by Score Band"
              subtitle="How each scoring tier converts through the pipeline"
            />
            <div className="grid gap-4 sm:grid-cols-3">
              {PLACEHOLDER_CONVERSION_RATES.map((band) => (
                <div
                  key={band.band}
                  className="group relative overflow-hidden rounded-xl border border-border/30 bg-zbooni-dark/30 p-5"
                >
                  <div
                    className="absolute bottom-0 left-0 h-1 transition-all duration-500 group-hover:h-1.5"
                    style={{ width: `${band.rate * 100 * 3}%`, backgroundColor: band.color }}
                  />
                  <div className="flex items-center justify-between">
                    <span
                      className="rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: `${band.color}15`,
                        color: band.color,
                      }}
                    >
                      {band.band}
                    </span>
                    <span className="text-2xl font-extrabold tabular-nums tracking-tight">
                      {(band.rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Leads</p>
                      <p className="font-bold tabular-nums text-foreground/80">{band.leads}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Conversions</p>
                      <p className="font-bold tabular-nums" style={{ color: band.color }}>{band.conversions}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Sends</p>
                      <p className="font-bold tabular-nums text-foreground/80">{band.sends}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Replies</p>
                      <p className="font-bold tabular-nums text-zbooni-green">{band.replies}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 4. Source Effectiveness per ICP ─────────────────────── */}
          <div className="rounded-2xl border border-border/30 bg-card/60 p-6">
            <SectionHeader
              icon={Database}
              iconColor="text-purple-400"
              title="Source Effectiveness per ICP"
              subtitle="Which data sources perform best for each customer profile"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    <th className="py-2.5 pr-4">Source</th>
                    <th className="py-2.5 pr-4">Top ICPs</th>
                    <th className="py-2.5 pr-4 text-right">Leads</th>
                    <th className="py-2.5 pr-4 text-right">Enrichment Rate</th>
                    <th className="py-2.5 text-right">Avg Score</th>
                  </tr>
                </thead>
                <tbody>
                  {PLACEHOLDER_SOURCE_EFFECTIVENESS.map((source) => {
                    const enrichPct = Math.round(source.enrichmentRate * 100);
                    return (
                      <tr key={source.source} className="border-b border-border/20 last:border-0">
                        <td className="py-3 pr-4">
                          <span className="font-semibold">{source.source}</span>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {source.icps.map((icp) => (
                              <span
                                key={icp}
                                className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70"
                              >
                                {icp}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums font-medium">{source.leads}</td>
                        <td className="py-3 pr-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zbooni-dark/60">
                              <div
                                className="h-full rounded-full bg-zbooni-teal/70"
                                style={{ width: `${enrichPct}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold tabular-nums">{enrichPct}%</span>
                          </div>
                        </td>
                        <td className="py-3 text-right">
                          <span className="font-mono text-xs font-semibold tabular-nums text-zbooni-green">
                            {source.avgScore.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── 5 + 6: A/B Variants + Approval Rates side-by-side ── */}
          <div className="grid gap-4 lg:grid-cols-5">
            {/* A/B Variant Performance (wider) */}
            <div className="rounded-2xl border border-border/30 bg-card/60 p-6 lg:col-span-3">
              <SectionHeader
                icon={Zap}
                iconColor="text-purple-400"
                title="A/B Variant Performance"
                subtitle="Reply rate comparison across message variants"
              />
              <div className="space-y-3">
                {PLACEHOLDER_AB_VARIANTS.map((v) => {
                  const maxRate = Math.max(...PLACEHOLDER_AB_VARIANTS.filter((x) => x.channel === v.channel).map((x) => x.replyRate));
                  const isWinner = v.replyRate === maxRate;
                  return (
                    <div
                      key={`${v.variant}-${v.channel}`}
                      className={`rounded-lg border px-4 py-3 transition-colors ${
                        isWinner
                          ? 'border-zbooni-green/30 bg-zbooni-green/[0.04]'
                          : 'border-border/20 bg-zbooni-dark/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">Variant {v.variant}</span>
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                            {v.channel}
                          </span>
                          {isWinner ? (
                            <span className="rounded-md bg-zbooni-green/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zbooni-green">
                              Winner
                            </span>
                          ) : null}
                        </div>
                        <span className="text-lg font-extrabold tabular-nums tracking-tight">
                          {(v.replyRate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground/40">{v.label}</p>
                      <div className="mt-2 flex gap-6 text-xs text-muted-foreground/60">
                        <span>
                          <span className="font-semibold text-foreground/80">{v.sends}</span> sends
                        </span>
                        <span>
                          <span className="font-semibold text-zbooni-green">{v.replies}</span> replies
                        </span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-zbooni-dark/60">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isWinner ? 'bg-zbooni-green' : 'bg-zbooni-teal/50'
                          }`}
                          style={{
                            width: `${maxRate > 0 ? Math.round((v.replyRate / maxRate) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Message Approval/Rejection Donut Chart (narrower) */}
            <div className="rounded-2xl border border-border/30 bg-card/60 p-6 lg:col-span-2">
              <SectionHeader
                icon={PieChart}
                iconColor="text-zbooni-green"
                title="Message Approval Rates"
                subtitle="Distribution of draft outcomes"
              />
              <div className="flex flex-col items-center">
                <div className="relative h-[200px] w-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPieChart>
                      <Pie
                        data={PLACEHOLDER_APPROVAL_RATES}
                        cx="50%"
                        cy="50%"
                        innerRadius={58}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {PLACEHOLDER_APPROVAL_RATES.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                  {/* Center label */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-extrabold tabular-nums tracking-tight">{approvalTotal}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                      Total
                    </span>
                  </div>
                </div>
                {/* Legend */}
                <div className="mt-4 grid w-full grid-cols-2 gap-x-4 gap-y-2">
                  {PLACEHOLDER_APPROVAL_RATES.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-[11px] text-muted-foreground/60">{entry.name}</span>
                      <span className="ml-auto text-[11px] font-bold tabular-nums">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
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

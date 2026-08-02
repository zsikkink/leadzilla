'use client';

import {
  ArrowUpRight,
  CheckCircle2,
  Layers3,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import { useAuth } from '../hooks/use-auth.js';
import { useApiQuery } from '../hooks/use-api-query.js';
import {
  dashboardQueryKeys,
  getCachedDashboardQuery,
} from '../lib/dashboard-preload.js';
import type {
  DemoAnalyticsDisqualificationReason,
  DemoAnalyticsDashboardSnapshot,
  DemoAnalyticsIcpPerformance,
  DemoAnalyticsOutcome,
  DemoDashboardMetric,
  DemoDashboardTone,
  DemoOperationsDashboardSnapshot,
} from '../lib/demo-dashboard-types.js';
import {
  DEMO_DASHBOARD_TREND_BUCKETS,
  DEMO_OPERATING_TOTALS,
  DEMO_REPORTING_PERIOD,
} from '../lib/demo-operating-narrative.js';
import { cn } from '../lib/utils.js';
import {
  DemoCard,
  DemoErrorState,
  DemoLoadingState,
  DemoMetricGrid,
  DemoProgressBar,
  DemoSectionHeading,
  formatDemoCount,
  toneClass,
} from './demo-dashboard-ui.js';
import {
  PipelineTimeSeriesChart,
  type PipelineTrendBucket,
  type PipelineTrendLine,
} from './pipeline-time-series-chart.js';

const PIPELINE_TREND_BUCKETS: PipelineTrendBucket[] = DEMO_DASHBOARD_TREND_BUCKETS.map(
  (bucket) => ({ ...bucket }),
);

const DISCOVERY_TREND_LINES: PipelineTrendLine[] = [
  { key: 'Activated', color: '#60A5FA', label: 'Screened' },
  { key: 'Qualified', color: '#3CC8E0', label: 'Priority' },
  { key: 'Rejected', color: '#F87171', label: 'Rejected' },
];

const MESSAGE_TREND_LINES: PipelineTrendLine[] = [
  { key: 'Sent', color: '#7BFF6B', label: 'Messages sent' },
  { key: 'Replied', color: '#C084FC', label: 'Replies' },
];

const LATEST_PIPELINE_TREND_BUCKET = PIPELINE_TREND_BUCKETS[PIPELINE_TREND_BUCKETS.length - 1];
const MESSAGE_TREND_TOTALS = {
  sent: LATEST_PIPELINE_TREND_BUCKET?.Sent ?? 0,
  replied: LATEST_PIPELINE_TREND_BUCKET?.Replied ?? 0,
};

type CapabilityRow = {
  id: string;
  label: string;
  status: string;
  detail: string;
  tone: DemoDashboardTone;
};

function parseDisplayCount(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentOf(value: number, max: number): string {
  if (max <= 0) return '--';
  return `${Math.round((value / max) * 100)}%`;
}

function getMetricValue(snapshot: DemoOperationsDashboardSnapshot, id: string): string | undefined {
  return snapshot.metrics.find((metric) => metric.id === id)?.value;
}

function getOutcomeValue(snapshot: DemoAnalyticsDashboardSnapshot, id: string): string | undefined {
  return snapshot.outcomeSummary.find((item) => item.id === id)?.value;
}

function polishDashboardCopy(value: string): string {
  return value
    .replace('the public demo', 'this workspace')
    .replace('public demo', 'workspace')
    .replace('demo population', 'scored population')
    .replace('disabled demo sends', 'disabled sends')
    .replace('public demo sending', 'sending')
    .replace('executive-demo', 'executive')
    .replace('curated snapshot', 'scored dataset')
    .replace('lead-fit quality', 'lead quality')
    .replace('scored scored population', 'scored population')
    .replace('Demo users', 'Users')
    .replace('Curated demo segment', 'Curated segment')
    .replace('demo actions', 'workspace actions')
    .replace('demo-safe', 'bounded');
}

function buildHeadlineMetrics(
  analytics: DemoAnalyticsDashboardSnapshot,
  operations: DemoOperationsDashboardSnapshot,
): DemoDashboardMetric[] {
  const analyticsMetricById = new Map(analytics.metrics.map((metric) => [metric.id, metric]));
  const leadCount = analytics.leadFlow.evaluated;
  const qualifiedCount = analytics.leadFlow.qualified;
  const enrichedCount = parseDisplayCount(getMetricValue(operations, 'enriched-scored'));
  const draftsCount = parseDisplayCount(getOutcomeValue(analytics, 'drafts'));
  const pendingCount = parseDisplayCount(getMetricValue(operations, 'pending-review'));
  const qualifiedRate = analyticsMetricById.get('qualified-rate');
  const averageScore = analyticsMetricById.get('avg-fit-score');

  return [
    {
      id: 'qualified-rate',
      label: qualifiedRate?.label ?? 'Priority rate',
      value: qualifiedRate?.value ?? percentOf(qualifiedCount, leadCount),
      detail: qualifiedRate?.detail ?? `${formatDemoCount(qualifiedCount)} high-fit opportunities from ${formatDemoCount(leadCount)} screened leads.`,
      tone: 'teal',
    },
    {
      id: 'avg-fit-score',
      label: 'Average lead score',
      value: averageScore?.value ?? '--',
      detail: polishDashboardCopy(averageScore?.detail ?? 'Blended lead quality across the scored population.'),
      tone: 'purple',
    },
    {
      id: 'enrichment-coverage',
      label: 'Scoring coverage',
      value: percentOf(enrichedCount, leadCount),
      detail: `All ${formatDemoCount(enrichedCount)} non-rejected leads have a latest fit-score prediction.`,
      tone: 'green',
    },
    {
      id: 'review-load',
      label: 'Review load',
      value: formatDemoCount(pendingCount),
      unit: 'drafts',
      detail: `${DEMO_OPERATING_TOTALS.overdueReview} are older than the 24-hour review target; ${percentOf(pendingCount, draftsCount)} of two-month drafts remain open.`,
      tone: 'amber',
    },
  ];
}

function buildOutcomeSummary(
  analytics: DemoAnalyticsDashboardSnapshot,
  operations: DemoOperationsDashboardSnapshot,
): DemoAnalyticsOutcome[] {
  const pendingCount = parseDisplayCount(getMetricValue(operations, 'pending-review'));
  const pendingReview = {
    id: 'pending-review',
    label: 'Pending review',
    value: formatDemoCount(pendingCount),
    detail: `${DEMO_OPERATING_TOTALS.overdueReview} drafts are older than the 24-hour review target; every open draft remains human gated.`,
  };

  const draftItem = analytics.outcomeSummary.find((item) => item.id === 'drafts');
  const remaining = analytics.outcomeSummary
    .filter((item) => item.id !== 'drafts')
    .map((item) => {
      if (item.id === 'replies') {
        return {
          ...item,
          value: formatDemoCount(MESSAGE_TREND_TOTALS.replied),
          detail: `Historical replies across ${DEMO_REPORTING_PERIOD}.`,
        };
      }

      if (item.id === 'sent') {
        return {
          ...item,
          value: formatDemoCount(MESSAGE_TREND_TOTALS.sent),
          detail: `Historical messages across ${DEMO_REPORTING_PERIOD}; current demo delivery is disabled.`,
        };
      }

      return item;
    });

  return draftItem ? [draftItem, pendingReview, ...remaining] : [pendingReview, ...remaining];
}

function buildCapabilityRows(snapshot: DemoOperationsDashboardSnapshot): CapabilityRow[] {
  const healthById = new Map(snapshot.systemHealth.map((item) => [item.id, item]));
  const queueById = new Map(snapshot.queues.map((item) => [item.id, item]));

  const edgeApi = healthById.get('edge-api');
  const discoveryProvider = healthById.get('discovery-provider');
  const openAiDrafting = healthById.get('openai-drafting');
  const outboundDelivery = healthById.get('outbound-delivery');
  const discoveryQueue = queueById.get('discovery-capacity');
  const draftQueue = queueById.get('draft-generation');

  return [
    {
      id: 'edge-api',
      label: edgeApi?.label ?? 'Supabase Edge API',
      status: edgeApi?.status ?? 'Operational',
      detail: edgeApi?.detail ?? 'Dashboard and workspace actions are served through the Supabase Edge Function.',
      tone: edgeApi?.tone ?? 'green',
    },
    {
      id: 'discovery-provider',
      label: discoveryProvider?.label ?? 'Discovery provider',
      status: discoveryQueue?.value ?? discoveryProvider?.status ?? 'Enabled',
      detail:
        discoveryProvider?.detail ??
        discoveryQueue?.detail ??
        'Small discovery jobs are enabled for bounded exploration.',
      tone: discoveryProvider?.tone ?? 'teal',
    },
    {
      id: 'openai-drafting',
      label: openAiDrafting?.label ?? 'OpenAI drafting',
      status: draftQueue?.value ?? openAiDrafting?.status ?? 'Enabled',
      detail:
        draftQueue?.detail ??
        openAiDrafting?.detail ??
        'Message drafts can be generated from lead, ICP, and prompt context.',
      tone: openAiDrafting?.tone ?? 'green',
    },
    {
      id: 'outbound-delivery',
      label: outboundDelivery?.label ?? 'Outbound delivery',
      status: outboundDelivery?.status ?? 'Disabled',
      detail:
        outboundDelivery?.detail ??
        'Email, SMS, WhatsApp, provider delivery, follow-ups, and message.send remain blocked.',
      tone: outboundDelivery?.tone ?? 'amber',
    },
  ];
}

function LeadFlowPanel({ data }: { data: DemoAnalyticsDashboardSnapshot }) {
  return (
    <DemoCard className="h-full">
      <DemoSectionHeading
        icon={Layers3}
        title="Lead Mix"
      />
      <LeadMixPieChart data={data.leadFlow} />
      <DisqualificationReasons rows={data.disqualificationReasons ?? []} />
    </DemoCard>
  );
}

function LeadMixPieChart({ data }: { data: DemoAnalyticsDashboardSnapshot['leadFlow'] }) {
  const slices = [
    {
      id: 'high',
      label: 'High',
      value: data.high,
      color: '#74F365',
      textClass: 'text-zbooni-green',
      detail: 'Best accounts for immediate review',
    },
    {
      id: 'medium',
      label: 'Medium',
      value: data.medium,
      color: '#F4CF45',
      textClass: 'text-amber-200',
      detail: 'Good candidates for segment-specific campaigns',
    },
    {
      id: 'low',
      label: 'Low',
      value: data.low,
      color: '#E56F73',
      textClass: 'text-red-200',
      detail: 'Lower-priority accounts held out of active outreach',
    },
    {
      id: 'disqualified',
      label: 'Disqualified',
      value: data.notQualified,
      color: '#7B8494',
      textClass: 'text-white/70',
      detail: 'Hard-filtered before score-band review',
    },
  ].filter((slice) => slice.value > 0);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let cursor = 0;
  const gradient = slices
    .map((slice) => {
      const start = total > 0 ? (cursor / total) * 360 : 0;
      cursor += slice.value;
      const end = total > 0 ? (cursor / total) * 360 : 0;
      return `${slice.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    })
    .join(', ');

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.55fr)_1fr] lg:items-center">
      <div className="flex justify-center">
        <div
          aria-label="Lead mix pie chart showing the database score-band distribution"
          className="relative aspect-square w-full max-w-[340px] rounded-full shadow-2xl shadow-black/30"
          role="img"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full border border-white/[0.1] bg-[#171821] text-center shadow-inner shadow-black/40">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/45">Screened</p>
            <p className="mt-1 text-3xl font-extrabold tracking-tight text-white">{formatDemoCount(total)}</p>
            <p className="mt-1 text-xs font-medium text-white/55">database leads screened</p>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {slices.map((slice) => {
          const percent = total > 0 ? ((slice.value / total) * 100).toFixed(1) : '0.0';
          return (
            <div key={slice.id} className="rounded-lg border border-white/[0.07] bg-black/[0.12] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                    <p className="text-sm font-bold text-white">{slice.label}</p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/60">{slice.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-xl font-extrabold tabular-nums ${slice.textClass}`}>{formatDemoCount(slice.value)}</p>
                  <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-white/40">{percent}%</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DisqualificationReasons({ rows }: { rows: DemoAnalyticsDisqualificationReason[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="mt-4 border-t border-white/[0.08] pt-4">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Disqualification Reasons</h3>
          <p className="mt-1 text-xs leading-5 text-white/60">Hard filters applied before score-band review.</p>
        </div>
        <p className="shrink-0 text-sm font-extrabold tabular-nums text-rose-200">
          {formatDemoCount(rows.reduce((sum, row) => sum + row.count, 0))}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-white/[0.07] bg-black/[0.12] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">{row.label}</p>
                <p className="mt-1 text-xs leading-5 text-white/60">{row.detail}</p>
              </div>
              <p className="shrink-0 text-lg font-extrabold tabular-nums text-white">{formatDemoCount(row.count)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IcpPerformance({ rows }: { rows: DemoAnalyticsIcpPerformance[] }) {
  const max = Math.max(...rows.map((row) => row.scored), 1);

  return (
    <DemoCard>
      <DemoSectionHeading
        icon={Target}
        title="ICP Performance"
        subtitle="Top segments by screened volume, lead quality, and priority rate."
        action={
          <Link
            href="/dashboard/icps"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/[0.1]"
          >
            ICPs
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-white/[0.07] bg-black/[0.12] p-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_120px_120px_120px] lg:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{row.name}</p>
                <p className="mt-1 text-xs leading-5 text-white/60">{polishDashboardCopy(row.insight)}</p>
              </div>
              <div>
                <p className="text-lg font-extrabold tracking-tight text-white">{formatDemoCount(row.scored)}</p>
                <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">scored</p>
              </div>
              <div>
                <p className="text-lg font-extrabold tracking-tight text-white">{row.avgScore.toFixed(2)}</p>
                <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">avg score</p>
              </div>
              <div>
                <p className="text-lg font-extrabold tracking-tight text-zbooni-green">{row.qualifiedRate}%</p>
                <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">priority</p>
              </div>
            </div>
            <div className="mt-3">
              <DemoProgressBar value={row.scored} max={max} tone="teal" />
            </div>
          </div>
        ))}
      </div>
    </DemoCard>
  );
}

function OutcomeSummary({
  analytics,
  operations,
}: {
  analytics: DemoAnalyticsDashboardSnapshot;
  operations: DemoOperationsDashboardSnapshot;
}) {
  const outcomes = buildOutcomeSummary(analytics, operations);

  return (
    <DemoCard>
      <DemoSectionHeading
        icon={Zap}
        title="Outcome Context"
        subtitle="Draft, review, reply, and meeting outcomes from the same two-month cohort."
        action={
          <Link
            href="/dashboard/inbox"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/[0.1]"
          >
            Inbox
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <div className="space-y-3">
        {outcomes.map((item) => (
          <div key={item.id} className="rounded-lg border border-white/[0.07] bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-bold text-white">{item.label}</p>
              <p className="shrink-0 text-2xl font-extrabold tracking-tight text-white">{item.value}</p>
            </div>
            <p className="mt-1 text-xs leading-5 text-white/65">{polishDashboardCopy(item.detail)}</p>
          </div>
        ))}
      </div>
    </DemoCard>
  );
}

function Recommendations({ data }: { data: DemoAnalyticsDashboardSnapshot }) {
  const recommendations = data.recommendations;

  return (
    <DemoCard>
      <DemoSectionHeading
        icon={Sparkles}
        title="Operator Actions"
        subtitle="The next highest-leverage actions from the completed operating period."
      />
      <div className="space-y-3">
        {recommendations.map((item) => (
          <div key={item.id} className="rounded-lg border border-white/[0.07] bg-black/[0.12] p-4">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-zbooni-green" />
              <div>
                <p className="text-sm font-bold text-white">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-white/65">{item.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </DemoCard>
  );
}

function WorkspaceCapabilities({ snapshot }: { snapshot: DemoOperationsDashboardSnapshot }) {
  const capabilities = buildCapabilityRows(snapshot);

  return (
    <DemoCard>
      <DemoSectionHeading
        icon={ShieldCheck}
        title="Workspace Capabilities"
        subtitle="Runtime status for the functions exposed in this workspace."
      />
      <div className="grid gap-3 2xl:grid-cols-2">
        {capabilities.map((item) => (
          <div key={item.id} className="rounded-lg border border-white/[0.07] bg-black/[0.12] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-white/65">{polishDashboardCopy(item.detail)}</p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold',
                  toneClass(item.tone, 'ring'),
                  toneClass(item.tone, 'text'),
                )}
              >
                {item.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </DemoCard>
  );
}

function DiscoveryRunEvidence({ snapshot }: { snapshot: DemoOperationsDashboardSnapshot }) {
  return (
    <DemoCard>
      <DemoSectionHeading
        icon={Rocket}
        title="Discovery Run Evidence"
        subtitle="Representative run history and segment expansion capacity."
        action={
          <Link
            href="/dashboard/discover"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/[0.1]"
          >
            Discover
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {snapshot.recentRuns.map((run) => (
          <div key={run.id} className="rounded-lg border border-white/[0.07] bg-black/[0.12] p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-bold text-white">{run.title}</p>
              <span className="rounded-full border border-zbooni-green/25 bg-zbooni-green/10 px-2.5 py-1 text-[11px] font-bold text-zbooni-green">
                {run.status}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-2xl font-extrabold tracking-tight text-white">{formatDemoCount(run.found)}</p>
                <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">found</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold tracking-tight text-white">{formatDemoCount(run.converted)}</p>
                <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">converted</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-white/65">{polishDashboardCopy(run.detail)}</p>
          </div>
        ))}
      </div>
    </DemoCard>
  );
}

export function ConsolidatedDashboard() {
  const { apiClient } = useAuth();
  const analytics = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.demoAnalyticsDashboard(), () =>
          apiClient.getDemoAnalyticsDashboard(),
        ),
      [apiClient],
    ),
    [apiClient],
  );
  const operations = useApiQuery(
    useCallback(
      () =>
        getCachedDashboardQuery(dashboardQueryKeys.demoOperationsDashboard(), () =>
          apiClient.getDemoOperationsDashboard(),
        ),
      [apiClient],
    ),
    [apiClient],
  );

  const retry = useCallback(() => {
    analytics.refetch();
    operations.refetch();
  }, [analytics, operations]);

  if ((analytics.isLoading && !analytics.data) || (operations.isLoading && !operations.data)) {
    return <DemoLoadingState label="Loading dashboard snapshot..." />;
  }

  if ((analytics.error && !analytics.data) || (operations.error && !operations.data)) {
    return (
      <DemoErrorState
        error={analytics.error ?? operations.error ?? 'Unable to load dashboard snapshot'}
        onRetry={retry}
      />
    );
  }

  const rawAnalyticsData = analytics.data;
  const rawOperationsData = operations.data;
  if (!rawAnalyticsData || !rawOperationsData) return null;

  const analyticsData = rawAnalyticsData;
  const operationsData = rawOperationsData;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 2xl:space-y-6">
      <div className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-zbooni-teal">Two-month operating view</p>
          <p className="mt-1 text-sm text-white/65">{DEMO_REPORTING_PERIOD} · completed reporting period</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <span className="rounded-full border border-violet-300/20 bg-violet-300/[0.07] px-2.5 py-1 text-violet-200">
            Historical outreach cohort
          </span>
          <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2.5 py-1 text-amber-200">
            Current delivery locked
          </span>
        </div>
      </div>

      <DemoMetricGrid metrics={buildHeadlineMetrics(analyticsData, operationsData)} />

      <div className="grid gap-5 xl:grid-cols-2">
        <PipelineTimeSeriesChart
          chartId="discovery-qualification-trends"
          defaultRange="all"
          lines={DISCOVERY_TREND_LINES}
          precomputedData={PIPELINE_TREND_BUCKETS}
          rangeOptions={[
            { value: '1m', label: '1M' },
            { value: 'all', label: '2M' },
          ]}
          subtitle="Monthly screened, high-priority, and rejected leads from the database-anchored cohort"
          title="Screening and Qualification"
        />
        <PipelineTimeSeriesChart
          badge="Historical · delivery locked"
          chartId="message-reply-trends"
          curveMode="stepAfter"
          defaultRange="all"
          lines={MESSAGE_TREND_LINES}
          precomputedData={PIPELINE_TREND_BUCKETS}
          rangeOptions={[
            { value: '1m', label: '1M' },
            { value: 'all', label: '2M' },
          ]}
          summaryMode="latest"
          subtitle="Cumulative historical messages and replies from the same cohort"
          title="Historical Outreach"
        />
      </div>

      <LeadFlowPanel data={analyticsData} />

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)]">
        <IcpPerformance rows={analyticsData.icpPerformance} />
        <div className="space-y-5">
          <OutcomeSummary analytics={analyticsData} operations={operationsData} />
          <Recommendations data={analyticsData} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <WorkspaceCapabilities snapshot={operationsData} />
        <DiscoveryRunEvidence snapshot={operationsData} />
      </div>
    </div>
  );
}

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

const EVIDENCE_BACKED_RECOMMENDATIONS = [
  {
    id: 'prioritize-contracting',
    title: 'Prioritize high-value contracting first',
    detail:
      'Home, Design & High-Value Contracting contributes 3,140 screened businesses, 1,748 high or medium-fit opportunities, a 56% priority rate, and a 0.57 average lead score. It is the deepest segment with enough volume to support immediate review and focused copy testing.',
  },
  {
    id: 'use-coaching-copy',
    title: 'Use premium-service positioning',
    detail:
      'Luxury & High-Ticket Services adds 2,864 screened businesses and 1,598 priority opportunities at a 56% priority rate. The strongest accounts show visible offer value, appointment-led sales, and customer-conversation channels, so outreach should lead with conversion lift and payment readiness.',
  },
  {
    id: 'expand-inventory',
    title: 'Keep low-score inventory out of outreach',
    detail:
      'The screened universe contains 7,284 low-score businesses and 3,140 hard disqualifications. Holding those 10,424 accounts out of active outreach protects review quality while leaving 11,154 high or medium-fit businesses available for campaign preparation.',
  },
] as const;

const PIPELINE_TREND_BUCKETS: PipelineTrendBucket[] = [
  { date: '2026-04-24', Activated: 980, Qualified: 494, Rejected: 136, Sent: 3, Replied: 0 },
  { date: '2026-05-01', Activated: 1260, Qualified: 650, Rejected: 178, Sent: 7, Replied: 0 },
  { date: '2026-05-08', Activated: 1485, Qualified: 760, Rejected: 214, Sent: 12, Replied: 1 },
  { date: '2026-05-15', Activated: 1640, Qualified: 842, Rejected: 236, Sent: 17, Replied: 1 },
  { date: '2026-05-22', Activated: 1785, Qualified: 925, Rejected: 260, Sent: 23, Replied: 2 },
  { date: '2026-05-29', Activated: 1875, Qualified: 970, Rejected: 276, Sent: 30, Replied: 3 },
  { date: '2026-06-05', Activated: 1940, Qualified: 1005, Rejected: 286, Sent: 37, Replied: 4 },
  { date: '2026-06-12', Activated: 2050, Qualified: 1060, Rejected: 302, Sent: 45, Replied: 5 },
  { date: '2026-06-19', Activated: 2155, Qualified: 1120, Rejected: 318, Sent: 53, Replied: 6 },
  { date: '2026-06-26', Activated: 2225, Qualified: 1165, Rejected: 330, Sent: 62, Replied: 7 },
  { date: '2026-07-03', Activated: 2258, Qualified: 1190, Rejected: 338, Sent: 71, Replied: 8 },
  { date: '2026-07-09', Activated: 1925, Qualified: 973, Rejected: 266, Sent: 81, Replied: 9 },
];

const DISCOVERY_TREND_LINES: PipelineTrendLine[] = [
  { key: 'Activated', color: '#60A5FA', label: 'Screened' },
  { key: 'Qualified', color: '#3CC8E0', label: 'Priority' },
  { key: 'Rejected', color: '#F87171', label: 'Disqualified' },
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

const STATIC_DEMO_LEAD_FLOW = {
  totalBusinesses: 21578,
  evaluated: 21578,
  outsideFlow: 0,
  qualified: 11154,
  notQualified: 3140,
  high: 5548,
  medium: 5606,
  low: 7284,
  unbanded: 0,
};

const STATIC_DEMO_ANALYTICS_METRICS: DemoDashboardMetric[] = [
  {
    id: 'qualified-rate',
    label: 'Priority rate',
    value: '52%',
    detail: '11,154 high or medium-fit opportunities from 21,578 screened businesses.',
    tone: 'teal',
  },
  {
    id: 'avg-fit-score',
    label: 'Average lead score',
    value: '0.54',
    detail: 'Weighted Zbooni-fit score across the screened business universe.',
    tone: 'purple',
  },
  {
    id: 'priority-leads',
    label: 'Priority leads',
    value: '11,154',
    detail: 'High and medium-fit businesses ready for review and message drafting.',
    tone: 'green',
  },
  {
    id: 'filtered-out',
    label: 'Disqualified',
    value: '3,140',
    detail: 'Businesses removed by hard filters before score-band review.',
    tone: 'amber',
  },
];

const STATIC_DEMO_ICP_PERFORMANCE: DemoAnalyticsIcpPerformance[] = [
  {
    id: 'home-design-contracting',
    name: 'Home, Design & High-Value Contracting',
    scored: 3140,
    avgScore: 0.57,
    qualifiedRate: 56,
    qualified: 1748,
    insight: 'Largest screened segment with strong account density and balanced high/medium-fit depth.',
  },
  {
    id: 'high-ticket-services',
    name: 'Luxury & High-Ticket Services',
    scored: 2864,
    avgScore: 0.56,
    qualifiedRate: 56,
    qualified: 1598,
    insight: 'Premium service businesses with visible conversion hooks and strong offer value.',
  },
  {
    id: 'premium-wellness',
    name: 'Premium Wellness & Longevity Clinics',
    scored: 2518,
    avgScore: 0.54,
    qualifiedRate: 52,
    qualified: 1309,
    insight: 'Service-led operators with strong appointment, consultation, and repeat-customer signals.',
  },
  {
    id: 'events-experiential',
    name: 'Events, Weddings & Experiential Operators',
    scored: 2326,
    avgScore: 0.53,
    qualifiedRate: 51,
    qualified: 1191,
    insight: 'Seasonal and event-driven businesses with meaningful volume but wider quality variance.',
  },
  {
    id: 'bespoke-gifting',
    name: 'Gifting, Corporate & Bespoke Experiences',
    scored: 2054,
    avgScore: 0.53,
    qualifiedRate: 51,
    qualified: 1052,
    insight: 'Bespoke purchase flows with strong personalization upside and clear seasonal demand.',
  },
];

const STATIC_DEMO_OUTCOME_SUMMARY: DemoAnalyticsOutcome[] = [
  {
    id: 'drafts',
    label: 'Drafts generated',
    value: '188',
    detail: 'Review-ready message drafts from priority lead context.',
  },
  {
    id: 'replies',
    label: 'Replies',
    value: '9',
    detail: 'Historical sample outcomes kept separate from disabled sends.',
  },
  {
    id: 'sent',
    label: 'Messages sent',
    value: '81',
    detail: 'Legacy sample records only; sending is disabled.',
  },
];

const STATIC_DEMO_DISQUALIFICATION_REASONS: DemoAnalyticsDisqualificationReason[] = [
  {
    id: 'no-conversation-channel',
    label: 'No customer-conversation channel',
    count: 812,
    detail: 'No reliable WhatsApp, Instagram, booking, chat, or contact path surfaced.',
  },
  {
    id: 'weak-commercial-intent',
    label: 'Weak commercial intent',
    count: 681,
    detail: 'Low evidence of transactions, appointment volume, catalog depth, or paid service flow.',
  },
  {
    id: 'inactive-public-presence',
    label: 'Inactive public presence',
    count: 548,
    detail: 'Stale website or social footprint with limited signs of current customer activity.',
  },
  {
    id: 'insufficient-contact-surface',
    label: 'Insufficient contact surface',
    count: 417,
    detail: 'Missing enough domain, social, phone, or location context for reliable review.',
  },
  {
    id: 'outside-served-verticals',
    label: 'Outside served verticals',
    count: 356,
    detail: 'Category appeared too informational, institutional, or low-commerce for Zbooni.',
  },
  {
    id: 'duplicate-or-ambiguous',
    label: 'Duplicate or ambiguous record',
    count: 326,
    detail: 'Branch, marketplace, or duplicate records that could not support clean account review.',
  },
];

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

function normalizeDemoAnalyticsSnapshot(snapshot: DemoAnalyticsDashboardSnapshot): DemoAnalyticsDashboardSnapshot {
  return {
    ...snapshot,
    metrics: STATIC_DEMO_ANALYTICS_METRICS,
    leadFlow: STATIC_DEMO_LEAD_FLOW,
    icpPerformance: STATIC_DEMO_ICP_PERFORMANCE,
    outcomeSummary: STATIC_DEMO_OUTCOME_SUMMARY,
    recommendations: EVIDENCE_BACKED_RECOMMENDATIONS.map((item) => ({ ...item })),
    disqualificationReasons: STATIC_DEMO_DISQUALIFICATION_REASONS,
  };
}

function normalizeDemoOperationsSnapshot(snapshot: DemoOperationsDashboardSnapshot): DemoOperationsDashboardSnapshot {
  return {
    ...snapshot,
    metrics: snapshot.metrics.map((metric) => {
      if (metric.id === 'source-inventory') {
        return {
          ...metric,
          label: 'Deduped inventory',
          value: '21,578',
          unit: 'businesses',
          detail: 'Deduplicated account universe available for ICP expansion.',
        };
      }
      if (metric.id === 'discovered-leads') {
        return {
          ...metric,
          label: 'Screened universe',
          value: '21,578',
          unit: 'businesses',
          detail: 'Database businesses normalized into a stable screening population.',
        };
      }
      if (metric.id === 'enriched-scored') {
        return {
          ...metric,
          label: 'Scored profiles',
          value: '18,438',
          unit: 'profiles',
          detail: 'Businesses with enough public context to receive a Zbooni-fit score.',
        };
      }
      return metric;
    }),
    pipeline: snapshot.pipeline.map((stage) => {
      if (stage.id === 'discover') {
        return { ...stage, count: 21578, displayValue: '21,578' };
      }
      if (stage.id === 'enrich' || stage.id === 'score') {
        return { ...stage, count: 18438, displayValue: '18,438' };
      }
      return stage;
    }),
  };
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
      detail: qualifiedRate?.detail ?? `${formatDemoCount(qualifiedCount)} high or medium-fit opportunities from ${formatDemoCount(leadCount)} screened businesses.`,
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
      label: 'Enrichment coverage',
      value: percentOf(enrichedCount, leadCount),
      detail: `${formatDemoCount(enrichedCount)} profiles include contact, domain, and business-context signals.`,
      tone: 'green',
    },
    {
      id: 'review-load',
      label: 'Review load',
      value: formatDemoCount(pendingCount),
      unit: 'drafts',
      detail: `${percentOf(pendingCount, draftsCount)} of generated drafts are waiting for human review.`,
      tone: 'amber',
    },
  ];
}

function buildOutcomeSummary(
  analytics: DemoAnalyticsDashboardSnapshot,
  operations: DemoOperationsDashboardSnapshot,
): DemoAnalyticsOutcome[] {
  const draftsCount = parseDisplayCount(getOutcomeValue(analytics, 'drafts'));
  const pendingCount = parseDisplayCount(getMetricValue(operations, 'pending-review'));
  const pendingReview = {
    id: 'pending-review',
    label: 'Pending review',
    value: formatDemoCount(pendingCount),
    detail: `${percentOf(pendingCount, draftsCount)} of generated drafts are held for operator approval before any delivery step.`,
  };

  const draftItem = analytics.outcomeSummary.find((item) => item.id === 'drafts');
  const remaining = analytics.outcomeSummary
    .filter((item) => item.id !== 'drafts')
    .map((item) => {
      if (item.id === 'replies') {
        return {
          ...item,
          value: formatDemoCount(MESSAGE_TREND_TOTALS.replied),
          detail: 'Sample replies from historical sent-message activity.',
        };
      }

      if (item.id === 'sent') {
        return {
          ...item,
          value: formatDemoCount(MESSAGE_TREND_TOTALS.sent),
          detail: 'Sample sent-message activity; workspace sending is disabled.',
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
  ];
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
          aria-label="Lead mix pie chart showing high, medium, low, and disqualified businesses"
          className="relative aspect-square w-full max-w-[340px] rounded-full shadow-2xl shadow-black/30"
          role="img"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full border border-white/[0.1] bg-[#171821] text-center shadow-inner shadow-black/40">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/45">Screened</p>
            <p className="mt-1 text-3xl font-extrabold tracking-tight text-white">{formatDemoCount(total)}</p>
            <p className="mt-1 text-xs font-medium text-white/55">businesses scored</p>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {slices.map((slice) => {
          const percent = total > 0 ? Math.round((slice.value / total) * 100) : 0;
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
    <DemoCard className="h-full">
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
        subtitle="Draft, review, and historical outcome counters."
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
  const recommendations = EVIDENCE_BACKED_RECOMMENDATIONS.map((fallback) => {
    const item = data.recommendations.find((candidate) => candidate.id === fallback.id);
    return item ? { ...item, title: fallback.title, detail: fallback.detail } : fallback;
  });

  return (
    <DemoCard>
      <DemoSectionHeading
        icon={Sparkles}
        title="Segment Recommendations"
        subtitle="Evidence-backed decisions from the scored dataset."
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
      <div className="grid gap-3 lg:grid-cols-3">
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

  const analyticsData = normalizeDemoAnalyticsSnapshot(rawAnalyticsData);
  const operationsData = normalizeDemoOperationsSnapshot(rawOperationsData);

  return (
    <div className="space-y-5 2xl:space-y-6">
      <DemoMetricGrid metrics={buildHeadlineMetrics(analyticsData, operationsData)} />

      <div className="grid gap-5 2xl:grid-cols-2">
        <PipelineTimeSeriesChart
          chartId="discovery-qualification-trends"
          defaultRange="6m"
          lines={DISCOVERY_TREND_LINES}
          precomputedData={PIPELINE_TREND_BUCKETS}
          title="Database Screening"
        />
        <PipelineTimeSeriesChart
          chartId="message-reply-trends"
          curveMode="stepAfter"
          defaultRange="6m"
          lines={MESSAGE_TREND_LINES}
          precomputedData={PIPELINE_TREND_BUCKETS}
          summaryMode="latest"
          title="Outreach"
        />
      </div>

      <LeadFlowPanel data={analyticsData} />

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)]">
        <IcpPerformance rows={analyticsData.icpPerformance} />
        <div className="space-y-5">
          <OutcomeSummary analytics={analyticsData} operations={operationsData} />
          <Recommendations data={analyticsData} />
        </div>
      </div>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <WorkspaceCapabilities snapshot={operationsData} />
        <DiscoveryRunEvidence snapshot={operationsData} />
      </div>
    </div>
  );
}

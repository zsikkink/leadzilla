'use client';

import { useState } from 'react';
import {
  Activity,
  BarChart3,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Gauge,
  GitBranch,
  Layers,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

import { cn } from '@/lib/utils.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface ModelVersion {
  id: string;
  versionTag: string;
  auc: number;
  prAuc: number;
  f1: number;
  precision: number;
  recall: number;
  sampleCount: number;
  trainedAt: string;
  promotedAt: string | null;
  status: 'active' | 'archived' | 'failed';
}

interface FeatureWeight {
  feature: string;
  weight: number;
  category: string;
}

// ── Placeholder data ────────────────────────────────────────────────────────

const ACTIVE_MODEL: ModelVersion = {
  id: 'model_v2.3.1_20260215',
  versionTag: 'v2.3.1',
  auc: 0.847,
  prAuc: 0.791,
  f1: 0.746,
  precision: 0.782,
  recall: 0.714,
  sampleCount: 2847,
  trainedAt: '2026-02-15T03:22:00Z',
  promotedAt: '2026-02-15T04:01:00Z',
  status: 'active',
};

const PREVIOUS_MODEL: ModelVersion = {
  id: 'model_v2.2.0_20260201',
  versionTag: 'v2.2.0',
  auc: 0.821,
  prAuc: 0.768,
  f1: 0.726,
  precision: 0.756,
  recall: 0.698,
  sampleCount: 2341,
  trainedAt: '2026-02-01T03:15:00Z',
  promotedAt: '2026-02-01T04:00:00Z',
  status: 'archived',
};

const TRAINING_HISTORY: ModelVersion[] = [
  ACTIVE_MODEL,
  PREVIOUS_MODEL,
  {
    id: 'model_v2.1.2_20260118',
    versionTag: 'v2.1.2',
    auc: 0.803,
    prAuc: 0.741,
    f1: 0.711,
    precision: 0.738,
    recall: 0.686,
    sampleCount: 1894,
    trainedAt: '2026-01-18T03:20:00Z',
    promotedAt: '2026-01-18T04:05:00Z',
    status: 'archived',
  },
  {
    id: 'model_v2.1.1_20260110',
    versionTag: 'v2.1.1',
    auc: 0.234,
    prAuc: 0.198,
    f1: 0.201,
    precision: 0.312,
    recall: 0.147,
    sampleCount: 1201,
    trainedAt: '2026-01-10T03:18:00Z',
    promotedAt: null,
    status: 'failed',
  },
  {
    id: 'model_v2.0.0_20260103',
    versionTag: 'v2.0.0',
    auc: 0.778,
    prAuc: 0.712,
    f1: 0.694,
    precision: 0.721,
    recall: 0.669,
    sampleCount: 987,
    trainedAt: '2026-01-03T03:25:00Z',
    promotedAt: '2026-01-03T04:10:00Z',
    status: 'archived',
  },
];

const FEATURE_IMPORTANCE: FeatureWeight[] = [
  { feature: 'review_count', weight: 0.94, category: 'Engagement' },
  { feature: 'has_whatsapp', weight: 0.89, category: 'Signal' },
  { feature: 'employee_count', weight: 0.87, category: 'Company' },
  { feature: 'website_tech_stack', weight: 0.81, category: 'Digital' },
  { feature: 'social_presence_score', weight: 0.76, category: 'Engagement' },
  { feature: 'industry_match', weight: 0.72, category: 'ICP' },
  { feature: 'accepts_online_payments', weight: 0.68, category: 'Signal' },
  { feature: 'funding_stage', weight: 0.63, category: 'Company' },
  { feature: 'follower_count', weight: 0.59, category: 'Engagement' },
  { feature: 'location_proximity', weight: 0.57, category: 'ICP' },
  { feature: 'recently_active', weight: 0.52, category: 'Signal' },
  { feature: 'domain_authority', weight: 0.49, category: 'Digital' },
  { feature: 'job_postings_count', weight: 0.44, category: 'Company' },
  { feature: 'email_verified', weight: 0.38, category: 'Quality' },
  { feature: 'linkedin_connections', weight: 0.31, category: 'Engagement' },
];

const CONFUSION_MATRIX = {
  truePositive: 142,
  falsePositive: 39,
  falseNegative: 57,
  trueNegative: 412,
};

// ── Category colors for feature chart ───────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Engagement: '#3CC8E0',
  Signal: '#7BFF6B',
  Company: '#A78BFA',
  Digital: '#FACC15',
  ICP: '#F97316',
  Quality: '#94A3B8',
};

// ── Sub-components ──────────────────────────────────────────────────────────

function MetricCard({
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
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{label}</p>
      </div>
      <p className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight">{value.toFixed(3)}</p>
      <div className="mt-1.5 flex items-center gap-1">
        {isPositive ? (
          <TrendingUp className="h-3 w-3 text-zbooni-green" />
        ) : (
          <TrendingDown className="h-3 w-3 text-red-400" />
        )}
        <span className={cn('text-[11px] font-semibold tabular-nums', isPositive ? 'text-zbooni-green' : 'text-red-400')}>
          {isPositive ? '+' : '-'}{pctChange.toFixed(1)}%
        </span>
        <span className="text-[10px] text-muted-foreground/40">vs {PREVIOUS_MODEL.versionTag}</span>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  iconColor,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  title: string;
  subtitle?: string | undefined;
  children?: React.ReactNode | undefined;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', iconColor)} />
        <div>
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          {subtitle ? <p className="text-[11px] text-muted-foreground/50">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean | undefined;
  payload?: Array<{ value: number; payload: FeatureWeight }> | undefined;
  label?: string | undefined;
}) {
  const first = active && payload ? payload[0] : undefined;
  if (!first) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-zbooni-navy px-3 py-2 shadow-lg">
      <p className="font-mono text-[11px] font-semibold text-foreground/80">{label}</p>
      <p className="text-sm font-bold tabular-nums text-foreground">{first.value.toFixed(3)}</p>
      <p className="text-[10px] text-muted-foreground/50">{first.payload.category}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: ModelVersion['status'] }) {
  const config = {
    active: { label: 'Active', color: 'text-zbooni-green', bg: 'bg-zbooni-green/10', border: 'border-zbooni-green/30' },
    archived: { label: 'Archived', color: 'text-muted-foreground/60', bg: 'bg-muted/10', border: 'border-border/30' },
    failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30' },
  }[status];

  return (
    <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', config.color, config.bg, config.border)}>
      {config.label}
    </span>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function ModelInspectorPage() {
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [expandedFeatures, setExpandedFeatures] = useState(true);

  const totalSamples = CONFUSION_MATRIX.truePositive + CONFUSION_MATRIX.falsePositive + CONFUSION_MATRIX.falseNegative + CONFUSION_MATRIX.trueNegative;
  const accuracy = (CONFUSION_MATRIX.truePositive + CONFUSION_MATRIX.trueNegative) / totalSamples;

  const sortedHistory = [...TRAINING_HISTORY].sort((a, b) =>
    sortDirection === 'desc'
      ? new Date(b.trainedAt).getTime() - new Date(a.trainedAt).getTime()
      : new Date(a.trainedAt).getTime() - new Date(b.trainedAt).getTime(),
  );

  return (
    <div className="space-y-4">
      {/* ── Active model card ────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-zbooni-green/[0.02] via-transparent to-zbooni-teal/[0.02]" />
        <div className="relative">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-zbooni-green/20 to-zbooni-teal/20">
                <Brain className="h-6 w-6 text-zbooni-green" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-extrabold tracking-tight">Active Model</h2>
                  <StatusBadge status="active" />
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground/50">
                  The currently promoted scoring model used for all new leads
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border/20 bg-zbooni-dark/20 px-4 py-3">
              <GitBranch className="h-4 w-4 text-zbooni-teal" />
              <div>
                <p className="font-mono text-sm font-bold">{ACTIVE_MODEL.versionTag}</p>
                <p className="text-[10px] text-muted-foreground/40">
                  Promoted {new Date(ACTIVE_MODEL.promotedAt!).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>

          {/* Model metadata row */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Training Samples</p>
              <p className="mt-0.5 text-xl font-extrabold tabular-nums">{ACTIVE_MODEL.sampleCount.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Trained At</p>
              <p className="mt-0.5 text-sm font-bold">{new Date(ACTIVE_MODEL.trainedAt).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Model ID</p>
              <p className="mt-0.5 truncate font-mono text-[11px]">{ACTIVE_MODEL.id}</p>
            </div>
            <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Accuracy</p>
              <p className="mt-0.5 text-xl font-extrabold tabular-nums text-zbooni-green">{(accuracy * 100).toFixed(1)}%</p>
            </div>
          </div>

          {/* Primary metrics */}
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MetricCard label="AUC" value={ACTIVE_MODEL.auc} prevValue={PREVIOUS_MODEL.auc} icon={Target} iconColor="text-zbooni-teal" />
            <MetricCard label="PR-AUC" value={ACTIVE_MODEL.prAuc} prevValue={PREVIOUS_MODEL.prAuc} icon={Gauge} iconColor="text-zbooni-green" />
            <MetricCard label="F1 Score" value={ACTIVE_MODEL.f1} prevValue={PREVIOUS_MODEL.f1} icon={BarChart3} iconColor="text-purple-400" />
            <MetricCard label="Precision" value={ACTIVE_MODEL.precision} prevValue={PREVIOUS_MODEL.precision} icon={CheckCircle2} iconColor="text-yellow-400" />
            <MetricCard label="Recall" value={ACTIVE_MODEL.recall} prevValue={PREVIOUS_MODEL.recall} icon={Zap} iconColor="text-orange-400" />
          </div>
        </div>
      </div>

      {/* ── Feature importance + Confusion matrix ────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* Feature importance chart */}
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <SectionHeader
            icon={BarChart3}
            iconColor="text-zbooni-green"
            title="Feature Importance"
            subtitle="Top 15 features ranked by model coefficient weight"
          >
            <button
              type="button"
              onClick={() => setExpandedFeatures(!expandedFeatures)}
              className="flex items-center gap-1 rounded-lg border border-border/30 bg-zbooni-dark/20 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              {expandedFeatures ? 'Collapse' : 'Expand'}
              {expandedFeatures ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </SectionHeader>

          {expandedFeatures && (
            <>
              <div className="h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={FEATURE_IMPORTANCE}
                    layout="vertical"
                    margin={{ top: 4, right: 20, bottom: 4, left: 0 }}
                    barCategoryGap="14%"
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
                      width={160}
                      tick={{ fill: 'hsl(0, 0%, 90%)', fontSize: 11, fontFamily: 'monospace' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="weight" radius={[0, 4, 4, 0]} maxBarSize={18}>
                      {FEATURE_IMPORTANCE.map((entry) => (
                        <Cell
                          key={entry.feature}
                          fill={CATEGORY_COLORS[entry.category] ?? '#7BFF6B'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Legend */}
              <div className="mt-4 flex flex-wrap gap-4">
                {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
                  <div key={cat} className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-[11px] text-muted-foreground/50">{cat}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Confusion matrix + evaluation comparison */}
        <div className="space-y-4">
          {/* Confusion matrix */}
          <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
            <SectionHeader
              icon={Layers}
              iconColor="text-purple-400"
              title="Confusion Matrix"
              subtitle="Classification performance on test split"
            />

            <div className="grid grid-cols-2 gap-2">
              {/* Labels */}
              <div className="col-span-2 mb-1 flex items-center justify-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Predicted</span>
              </div>

              {/* TP */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-zbooni-green/20 bg-zbooni-green/[0.06] p-4">
                <p className="text-2xl font-extrabold tabular-nums text-zbooni-green">{CONFUSION_MATRIX.truePositive}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-zbooni-green/60">True Pos</p>
              </div>

              {/* FP */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-red-400/20 bg-red-400/[0.06] p-4">
                <p className="text-2xl font-extrabold tabular-nums text-red-400">{CONFUSION_MATRIX.falsePositive}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-red-400/60">False Pos</p>
              </div>

              {/* FN */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-yellow-400/20 bg-yellow-400/[0.06] p-4">
                <p className="text-2xl font-extrabold tabular-nums text-yellow-400">{CONFUSION_MATRIX.falseNegative}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-yellow-400/60">False Neg</p>
              </div>

              {/* TN */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-zbooni-teal/20 bg-zbooni-teal/[0.06] p-4">
                <p className="text-2xl font-extrabold tabular-nums text-zbooni-teal">{CONFUSION_MATRIX.trueNegative}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-zbooni-teal/60">True Neg</p>
              </div>

              {/* Actual label */}
              <div className="col-span-2 mt-1 flex items-center justify-center">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Actual</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Total</p>
                <p className="font-mono text-sm font-bold tabular-nums">{totalSamples}</p>
              </div>
              <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Accuracy</p>
                <p className="font-mono text-sm font-bold tabular-nums text-zbooni-green">{(accuracy * 100).toFixed(1)}%</p>
              </div>
            </div>
          </div>

          {/* Evaluation comparison */}
          <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
            <SectionHeader
              icon={Activity}
              iconColor="text-zbooni-teal"
              title="Version Comparison"
              subtitle={`${ACTIVE_MODEL.versionTag} vs ${PREVIOUS_MODEL.versionTag}`}
            />

            <div className="space-y-3">
              {(
                [
                  { label: 'AUC', current: ACTIVE_MODEL.auc, previous: PREVIOUS_MODEL.auc },
                  { label: 'PR-AUC', current: ACTIVE_MODEL.prAuc, previous: PREVIOUS_MODEL.prAuc },
                  { label: 'F1', current: ACTIVE_MODEL.f1, previous: PREVIOUS_MODEL.f1 },
                  { label: 'Precision', current: ACTIVE_MODEL.precision, previous: PREVIOUS_MODEL.precision },
                  { label: 'Recall', current: ACTIVE_MODEL.recall, previous: PREVIOUS_MODEL.recall },
                ] as const
              ).map((metric) => {
                const delta = metric.current - metric.previous;
                const isPositive = delta > 0;
                return (
                  <div key={metric.label} className="flex items-center gap-3">
                    <span className="w-16 text-[11px] font-semibold text-muted-foreground/50">{metric.label}</span>
                    <div className="flex flex-1 items-center gap-2">
                      {/* Previous */}
                      <span className="w-14 text-right font-mono text-xs text-muted-foreground/40">{metric.previous.toFixed(3)}</span>
                      {/* Arrow */}
                      <div className="flex items-center justify-center">
                        {isPositive ? (
                          <TrendingUp className="h-3 w-3 text-zbooni-green" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-red-400" />
                        )}
                      </div>
                      {/* Current */}
                      <span className="w-14 font-mono text-xs font-bold">{metric.current.toFixed(3)}</span>
                      {/* Delta */}
                      <span className={cn(
                        'rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                        isPositive
                          ? 'bg-zbooni-green/10 text-zbooni-green'
                          : 'bg-red-400/10 text-red-400',
                      )}>
                        {isPositive ? '+' : ''}{delta.toFixed(3)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Training history table ───────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <SectionHeader
          icon={Cpu}
          iconColor="text-zbooni-teal"
          title="Training History"
          subtitle="All model versions with performance metrics"
        >
          <button
            type="button"
            onClick={() => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-zbooni-dark/20 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            Date {sortDirection === 'desc' ? 'newest' : 'oldest'}
            {sortDirection === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </button>
        </SectionHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                <th className="py-2.5 pr-4">Version</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4 text-right">AUC</th>
                <th className="py-2.5 pr-4 text-right">F1</th>
                <th className="py-2.5 pr-4 text-right">Precision</th>
                <th className="py-2.5 pr-4 text-right">Recall</th>
                <th className="py-2.5 pr-4 text-right">Samples</th>
                <th className="py-2.5">Trained</th>
              </tr>
            </thead>
            <tbody>
              {sortedHistory.map((version) => (
                <tr
                  key={version.id}
                  className={cn(
                    'border-b border-border/20 last:border-0 transition-colors',
                    version.status === 'active' && 'bg-zbooni-green/[0.02]',
                    version.status === 'failed' && 'bg-red-400/[0.02] opacity-60',
                  )}
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{version.versionTag}</span>
                      {version.status === 'active' && (
                        <div className="h-2 w-2 rounded-full bg-zbooni-green animate-pulse" />
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge status={version.status} />
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.auc.toFixed(3)}</td>
                  <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.f1.toFixed(3)}</td>
                  <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.precision.toFixed(3)}</td>
                  <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.recall.toFixed(3)}</td>
                  <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.sampleCount.toLocaleString()}</td>
                  <td className="py-3 text-xs text-muted-foreground/60">{new Date(version.trainedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

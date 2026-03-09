'use client';

import { useCallback, useMemo, useState } from 'react';
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
  Loader2,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { useAuth } from '@/hooks/use-auth.js';
import { useApiQuery } from '@/hooks/use-api-query.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface ModelMetricItem {
  modelVersionId: string;
  versionTag: string;
  split: string;
  evaluatedAt: string;
  auc: number;
  prAuc: number;
  precision: number;
  recall: number;
  f1: number;
  brierScore: number;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  prevValue,
  icon: Icon,
  iconColor,
  prevVersionTag,
}: {
  label: string;
  value: number;
  prevValue: number | null;
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  prevVersionTag: string | null;
}) {
  const delta = prevValue != null ? value - prevValue : 0;
  const isPositive = delta >= 0;
  const pctChange = prevValue != null && prevValue > 0 ? Math.abs(delta / prevValue) * 100 : 0;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/30 bg-slate-800 p-4 transition-colors hover:border-border/50">
      <div className="absolute -right-3 -top-3 opacity-[0.04] transition-opacity group-hover:opacity-[0.07]">
        <Icon className="h-20 w-20" />
      </div>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{label}</p>
      </div>
      <p className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight">{value.toFixed(3)}</p>
      {prevValue != null && prevVersionTag ? (
        <div className="mt-1.5 flex items-center gap-1">
          {isPositive ? (
            <TrendingUp className="h-3 w-3 text-zbooni-green" />
          ) : (
            <TrendingDown className="h-3 w-3 text-red-400" />
          )}
          <span className={cn('text-[11px] font-semibold tabular-nums', isPositive ? 'text-zbooni-green' : 'text-red-400')}>
            {isPositive ? '+' : '-'}{pctChange.toFixed(1)}%
          </span>
          <span className="text-[10px] text-slate-400">vs {prevVersionTag}</span>
        </div>
      ) : null}
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

function StatusBadge({ status }: { status: 'active' | 'archived' | 'failed' }) {
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

function EmptySection({ icon: Icon, title, description }: { icon: React.ComponentType<{ className?: string | undefined }>; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/30 bg-slate-800">
        <Icon className="h-6 w-6 text-muted-foreground/20" />
      </div>
      <h3 className="mt-4 text-sm font-bold tracking-tight text-muted-foreground/60">{title}</h3>
      <p className="mt-1 max-w-xs text-[12px] text-muted-foreground/35">{description}</p>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function ModelInspectorPage() {
  const { apiClient } = useAuth();
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const metricsQuery = useApiQuery(
    useCallback(() => apiClient.getModelMetrics(), [apiClient]),
  );

  const retrainQuery = useApiQuery(
    useCallback(() => apiClient.getRetrainStatus(), [apiClient]),
  );

  // Group metrics by version, take TEST split entries
  const testMetrics = useMemo(() => {
    if (!metricsQuery.data?.items) return [];
    return metricsQuery.data.items.filter((m: ModelMetricItem) => m.split === 'TEST');
  }, [metricsQuery.data]);

  // Find active model and previous model
  const activeModelId = retrainQuery.data?.activeModelVersionId;
  const activeMetric = testMetrics.find((m: ModelMetricItem) => m.modelVersionId === activeModelId) ?? testMetrics[0] ?? null;

  const sortedByDate = useMemo(() => {
    return [...testMetrics].sort((a: ModelMetricItem, b: ModelMetricItem) =>
      new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime(),
    );
  }, [testMetrics]);

  const previousMetric = activeMetric
    ? sortedByDate.find((m: ModelMetricItem) => m.modelVersionId !== activeMetric.modelVersionId) ?? null
    : null;

  const sortedHistory = useMemo(() => {
    return [...testMetrics].sort((a: ModelMetricItem, b: ModelMetricItem) =>
      sortDirection === 'desc'
        ? new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime()
        : new Date(a.evaluatedAt).getTime() - new Date(b.evaluatedAt).getTime(),
    );
  }, [testMetrics, sortDirection]);

  const isLoading = metricsQuery.isLoading || retrainQuery.isLoading;
  const hasData = testMetrics.length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading model data...
      </div>
    );
  }

  if (metricsQuery.error ?? retrainQuery.error) {
    return (
      <p className="text-sm text-destructive">{metricsQuery.error ?? retrainQuery.error}</p>
    );
  }

  if (!hasData) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <EmptySection
            icon={Brain}
            title="No models trained yet"
            description="The model inspector will display scoring model metrics, training history, and feature importance once the first model training completes."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Active model card ────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="absolute inset-0" />
        <div className="relative">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800">
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
            {activeMetric ? (
              <div className="flex items-center gap-3 rounded-xl border border-border/20 bg-slate-800 px-4 py-3">
                <GitBranch className="h-4 w-4 text-zbooni-teal" />
                <div>
                  <p className="font-mono text-sm font-bold">{activeMetric.versionTag}</p>
                  <p className="text-[10px] text-slate-400">
                    Evaluated {new Date(activeMetric.evaluatedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {activeMetric ? (
            <>
              {/* Model metadata row */}
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Evaluated At</p>
                  <p className="mt-0.5 text-sm font-bold">{new Date(activeMetric.evaluatedAt).toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Model Version ID</p>
                  <p className="mt-0.5 truncate font-mono text-[11px]">{activeMetric.modelVersionId}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Brier Score</p>
                  <p className="mt-0.5 text-xl font-extrabold tabular-nums">{activeMetric.brierScore.toFixed(4)}</p>
                </div>
              </div>

              {/* Primary metrics */}
              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <MetricCard label="AUC" value={activeMetric.auc} prevValue={previousMetric?.auc ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={Target} iconColor="text-zbooni-teal" />
                <MetricCard label="PR-AUC" value={activeMetric.prAuc} prevValue={previousMetric?.prAuc ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={Gauge} iconColor="text-zbooni-green" />
                <MetricCard label="F1 Score" value={activeMetric.f1} prevValue={previousMetric?.f1 ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={BarChart3} iconColor="text-purple-400" />
                <MetricCard label="Precision" value={activeMetric.precision} prevValue={previousMetric?.precision ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={CheckCircle2} iconColor="text-yellow-400" />
                <MetricCard label="Recall" value={activeMetric.recall} prevValue={previousMetric?.recall ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={Zap} iconColor="text-orange-400" />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Feature importance + Confusion matrix ────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* Feature importance - requires model coefficients (available after training) */}
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <SectionHeader
            icon={BarChart3}
            iconColor="text-zbooni-green"
            title="Feature Importance"
            subtitle="Feature weights from the trained model coefficients"
          />
          <EmptySection
            icon={Layers}
            title="Available after model training"
            description="Feature importance weights will be displayed here once a scoring model has been trained with coefficient data."
          />
        </div>

        {/* Version comparison */}
        <div className="space-y-4">
          {activeMetric && previousMetric ? (
            <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
              <SectionHeader
                icon={Activity}
                iconColor="text-zbooni-teal"
                title="Version Comparison"
                subtitle={`${activeMetric.versionTag} vs ${previousMetric.versionTag}`}
              />

              <div className="space-y-3">
                {(
                  [
                    { label: 'AUC', current: activeMetric.auc, previous: previousMetric.auc },
                    { label: 'PR-AUC', current: activeMetric.prAuc, previous: previousMetric.prAuc },
                    { label: 'F1', current: activeMetric.f1, previous: previousMetric.f1 },
                    { label: 'Precision', current: activeMetric.precision, previous: previousMetric.precision },
                    { label: 'Recall', current: activeMetric.recall, previous: previousMetric.recall },
                  ] as const
                ).map((metric) => {
                  const delta = metric.current - metric.previous;
                  const isPositive = delta > 0;
                  return (
                    <div key={metric.label} className="flex items-center gap-3">
                      <span className="w-16 text-[11px] font-semibold text-muted-foreground/50">{metric.label}</span>
                      <div className="flex flex-1 items-center gap-2">
                        <span className="w-14 text-right font-mono text-xs text-slate-400">{metric.previous.toFixed(3)}</span>
                        <div className="flex items-center justify-center">
                          {isPositive ? (
                            <TrendingUp className="h-3 w-3 text-zbooni-green" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          )}
                        </div>
                        <span className="w-14 font-mono text-xs font-bold">{metric.current.toFixed(3)}</span>
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
          ) : null}

          {/* Retrain status */}
          {retrainQuery.data ? (
            <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
              <SectionHeader
                icon={Cpu}
                iconColor="text-purple-400"
                title="Retrain Status"
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/60">Active Model</span>
                  <span className="font-mono text-xs font-bold">{retrainQuery.data.activeModelVersionId ?? 'None'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/60">Current Run</span>
                  <span className="text-xs font-bold">{retrainQuery.data.currentRun?.status ?? 'Idle'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/60">Next Scheduled</span>
                  <span className="text-xs">{retrainQuery.data.nextScheduledAt ? new Date(retrainQuery.data.nextScheduledAt).toLocaleString() : 'Not scheduled'}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Training history table ───────────────────────────────────── */}
      {sortedHistory.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <SectionHeader
            icon={Cpu}
            iconColor="text-zbooni-teal"
            title="Evaluation History"
            subtitle="All model versions with test-split performance metrics"
          >
            <button
              type="button"
              onClick={() => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc')}
              className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60 transition-colors hover:text-foreground"
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
                  <th className="py-2.5 pr-4 text-right">Brier</th>
                  <th className="py-2.5">Evaluated</th>
                </tr>
              </thead>
              <tbody>
                {sortedHistory.map((version: ModelMetricItem) => {
                  const isActive = version.modelVersionId === activeModelId;
                  return (
                    <tr
                      key={`${version.modelVersionId}-${version.split}`}
                      className={cn(
                        'border-b border-border/20 last:border-0 transition-colors',
                        isActive && 'bg-zbooni-green/[0.02]',
                      )}
                    >
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold">{version.versionTag}</span>
                          {isActive && (
                            <div className="h-2 w-2 rounded-full bg-zbooni-green animate-pulse" />
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={isActive ? 'active' : 'archived'} />
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.auc.toFixed(3)}</td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.f1.toFixed(3)}</td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.precision.toFixed(3)}</td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.recall.toFixed(3)}</td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.brierScore.toFixed(4)}</td>
                      <td className="py-3 text-xs text-muted-foreground/60">{new Date(version.evaluatedAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

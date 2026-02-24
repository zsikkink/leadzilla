'use client';

import type {
  IcpBreakdownItem,
  ManagerAnalysisResponse,
  ManagerRecommendation,
  ScoreBandBreakdownItem,
  VariantBreakdownItem,
} from '@lead-flood/contracts';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Minus,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

// ── Style maps ──────────────────────────────────────────────
const RECOMMENDATION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PAUSE_ICP: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Pause ICP' },
  ADJUST_THRESHOLD: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Adjust Threshold' },
  ADJUST_WEIGHT: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Adjust Weight' },
  INCREASE_VOLUME: { bg: 'bg-zbooni-green/15', text: 'text-zbooni-green', label: 'Increase Volume' },
};

const SCORE_BAND_STYLES: Record<string, { bg: string; text: string }> = {
  HIGH: { bg: 'bg-zbooni-green/15', text: 'text-zbooni-green' },
  MEDIUM: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  LOW: { bg: 'bg-red-500/15', text: 'text-red-400' },
};

// ── Helpers ─────────────────────────────────────────────────
function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = new Date(weekStart);
  const end = new Date(weekEnd);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${startStr} - ${endStr}`;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)}pp`;
}

// ── Trend indicator (higher is better by default, invert for bounce) ──
function TrendDelta({
  delta,
  label,
  invertColors,
}: {
  delta: number;
  label: string;
  invertColors?: boolean | undefined;
}) {
  const isPositive = delta > 0;
  const isNeutral = delta === 0;
  const isGood = invertColors ? !isPositive : isPositive;

  let colorClass: string;
  let Icon: typeof ArrowUp;

  if (isNeutral) {
    colorClass = 'text-muted-foreground/60';
    Icon = Minus;
  } else if (isGood) {
    colorClass = 'text-zbooni-green';
    Icon = ArrowUp;
  } else {
    colorClass = 'text-red-400';
    Icon = ArrowDown;
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
        {label}
      </p>
      <div className={`flex items-center gap-0.5 ${colorClass}`}>
        <Icon className="h-3 w-3" />
        <span className="text-sm font-bold">{formatDelta(delta)}</span>
      </div>
    </div>
  );
}

// ── Confidence bar ──────────────────────────────────────────
function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  let barColor: string;
  if (pct >= 80) {
    barColor = 'bg-zbooni-green';
  } else if (pct >= 50) {
    barColor = 'bg-yellow-400';
  } else {
    barColor = 'bg-red-400';
  }

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zbooni-dark/60">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground/60">
        {pct}%
      </span>
    </div>
  );
}

// ── Stat pill (compact metric) ──────────────────────────────
function StatPill({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
        {label}
      </p>
      <p className={`mt-0.5 text-xl font-extrabold tracking-tight ${accent}`}>{value}</p>
    </div>
  );
}

// ── Collapsible section toggle ──────────────────────────────
function CollapsibleHeader({
  title,
  icon: Icon,
  iconColor,
  isOpen,
  onToggle,
  count,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  isOpen: boolean;
  onToggle: () => void;
  count?: number | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left transition-colors hover:bg-white/5"
    >
      <Icon className={`h-4 w-4 ${iconColor}`} />
      <span className="text-sm font-bold tracking-tight">{title}</span>
      {count !== undefined ? (
        <span className="rounded-md bg-zbooni-dark/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground/60">
          {count}
        </span>
      ) : null}
      <span className="ml-auto">
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground/40" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground/40" />
        )}
      </span>
    </button>
  );
}

// ── Single recommendation card ──────────────────────────────
function RecommendationCard({ rec }: { rec: ManagerRecommendation }) {
  const style = RECOMMENDATION_STYLES[rec.type] ?? {
    bg: 'bg-muted/15',
    text: 'text-muted-foreground',
    label: rec.type,
  };

  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.bg} ${style.text}`}
          >
            {style.label}
          </span>
          {rec.field ? (
            <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/70">
              {rec.field}
            </span>
          ) : null}
        </div>
        <ConfidenceBar confidence={rec.confidence} />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground/80">{rec.reasoning}</p>

      {rec.currentValue !== null && rec.recommendedValue !== null ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
          <span className="text-xs text-muted-foreground/50">Suggested change:</span>
          <span className="font-mono text-sm font-semibold text-red-400/80">
            {rec.currentValue}
          </span>
          <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
          <span className="font-mono text-sm font-semibold text-zbooni-green">
            {rec.recommendedValue}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── ICP breakdown table ─────────────────────────────────────
function IcpBreakdownTable({ items }: { items: IcpBreakdownItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-3 text-sm text-muted-foreground/50">No ICP breakdown data available.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            <th className="py-2 pr-4">ICP</th>
            <th className="py-2 pr-4 text-right">Sends</th>
            <th className="py-2 pr-4 text-right">Replies</th>
            <th className="py-2 pr-4 text-right">Reply Rate</th>
            <th className="py-2 pr-4 text-right">Positive</th>
            <th className="py-2 pr-4 text-right">Pos. Rate</th>
            <th className="py-2 text-right">Bounced</th>
          </tr>
        </thead>
        <tbody>
          {items.map((icp) => (
            <tr key={icp.icpProfileId} className="border-b border-border/20 last:border-0">
              <td className="py-2 pr-4 font-medium">{icp.icpName}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{icp.sends}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-zbooni-green">{icp.replies}</td>
              <td className="py-2 pr-4 text-right tabular-nums font-semibold">
                {formatPct(icp.replyRate)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-zbooni-teal">
                {icp.positiveOutcomes}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{formatPct(icp.positiveRate)}</td>
              <td className="py-2 text-right tabular-nums text-red-400/70">{icp.bounced}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Variant breakdown table ─────────────────────────────────
function VariantBreakdownTable({ items }: { items: VariantBreakdownItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-3 text-sm text-muted-foreground/50">No variant comparison data available.</p>
    );
  }

  const maxReplyRate = Math.max(...items.map((v) => v.replyRate), 0);

  return (
    <div className="space-y-3">
      {items.map((variant) => {
        const isWinner = variant.replyRate === maxReplyRate && items.length > 1;
        return (
          <div
            key={`${variant.variantKey}-${variant.channel}`}
            className={`rounded-lg border px-4 py-3 ${
              isWinner
                ? 'border-zbooni-green/30 bg-zbooni-green/[0.04]'
                : 'border-border/20 bg-zbooni-dark/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold">{variant.variantKey}</span>
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                  {variant.channel}
                </span>
                {isWinner ? (
                  <span className="rounded-md bg-zbooni-green/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zbooni-green">
                    Winner
                  </span>
                ) : null}
              </div>
              <span className="text-lg font-extrabold tracking-tight">
                {formatPct(variant.replyRate)}
              </span>
            </div>
            <div className="mt-2 flex gap-6 text-xs text-muted-foreground/60">
              <span>
                <span className="font-semibold text-foreground/80">{variant.sends}</span> sends
              </span>
              <span>
                <span className="font-semibold text-zbooni-green">{variant.replies}</span> replies
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-zbooni-dark/60">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isWinner ? 'bg-zbooni-green' : 'bg-zbooni-teal/50'
                }`}
                style={{
                  width: `${maxReplyRate > 0 ? Math.round((variant.replyRate / maxReplyRate) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Score band breakdown ────────────────────────────────────
function ScoreBandTable({ items }: { items: ScoreBandBreakdownItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-3 text-sm text-muted-foreground/50">No score band data available.</p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((band) => {
        const bandStyle = SCORE_BAND_STYLES[band.scoreBand] ?? {
          bg: 'bg-muted/15',
          text: 'text-muted-foreground',
        };
        return (
          <div
            key={band.scoreBand}
            className="rounded-xl border border-border/30 bg-zbooni-dark/30 p-4"
          >
            <div className="flex items-center justify-between">
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${bandStyle.bg} ${bandStyle.text}`}
              >
                {band.scoreBand}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground/50">
                {band.sends} sends
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                  Reply Rate
                </p>
                <p className="text-lg font-extrabold tracking-tight">{formatPct(band.replyRate)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                  Positive Rate
                </p>
                <p className="text-lg font-extrabold tracking-tight text-zbooni-teal">
                  {formatPct(band.positiveRate)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Single analysis card (one week) ─────────────────────────
function AnalysisCard({ analysis }: { analysis: ManagerAnalysisResponse }) {
  const [showIcp, setShowIcp] = useState(false);
  const [showVariants, setShowVariants] = useState(false);
  const [showScoreBands, setShowScoreBands] = useState(false);

  return (
    <div className="rounded-2xl border border-border/50 bg-card shadow-sm">
      {/* Week header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 px-6 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Weekly Analysis
          </p>
          <h3 className="mt-0.5 text-lg font-extrabold tracking-tight">
            {formatWeekRange(analysis.weekStart, analysis.weekEnd)}
          </h3>
        </div>
        <div className="flex items-center gap-4">
          <TrendDelta delta={analysis.trend.replyRateDelta} label="Reply" />
          <TrendDelta delta={analysis.trend.positiveRateDelta} label="Positive" />
          <TrendDelta delta={analysis.trend.bounceRateDelta} label="Bounce" invertColors />
        </div>
      </div>

      <div className="p-6">
        {/* Overall stats row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatPill label="Total Sends" value={String(analysis.totalSends)} accent="text-foreground" />
          <StatPill
            label="Replies"
            value={`${analysis.totalReplies} (${formatPct(analysis.overallReplyRate)})`}
            accent="text-zbooni-green"
          />
          <StatPill
            label="Positive"
            value={`${analysis.totalPositive} (${formatPct(analysis.overallPositiveRate)})`}
            accent="text-zbooni-teal"
          />
          <StatPill
            label="Bounced"
            value={`${analysis.totalBounced} (${formatPct(analysis.overallBounceRate)})`}
            accent="text-red-400"
          />
        </div>

        {/* Recommendations */}
        {analysis.recommendations.length > 0 ? (
          <div className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-yellow-400" />
              <h4 className="text-sm font-bold tracking-tight">Recommendations</h4>
              <span className="rounded-md bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-yellow-400">
                {analysis.recommendations.length}
              </span>
            </div>
            <div className="space-y-3">
              {analysis.recommendations.map((rec, idx) => (
                <RecommendationCard key={`${rec.type}-${rec.field ?? 'global'}-${idx}`} rec={rec} />
              ))}
            </div>
          </div>
        ) : null}

        {/* Collapsible breakdown sections */}
        <div className="mt-6 space-y-1">
          <div>
            <CollapsibleHeader
              title="ICP Performance"
              icon={Users}
              iconColor="text-zbooni-teal"
              isOpen={showIcp}
              onToggle={() => setShowIcp((v) => !v)}
              count={analysis.icpBreakdown.length}
            />
            {showIcp ? (
              <div className="pb-3 pl-6 pt-1">
                <IcpBreakdownTable items={analysis.icpBreakdown} />
              </div>
            ) : null}
          </div>

          <div>
            <CollapsibleHeader
              title="A/B Variant Comparison"
              icon={Zap}
              iconColor="text-purple-400"
              isOpen={showVariants}
              onToggle={() => setShowVariants((v) => !v)}
              count={analysis.variantBreakdown.length}
            />
            {showVariants ? (
              <div className="pb-3 pl-6 pt-1">
                <VariantBreakdownTable items={analysis.variantBreakdown} />
              </div>
            ) : null}
          </div>

          <div>
            <CollapsibleHeader
              title="Score Band Breakdown"
              icon={TrendingUp}
              iconColor="text-zbooni-green"
              isOpen={showScoreBands}
              onToggle={() => setShowScoreBands((v) => !v)}
              count={analysis.scoreBandBreakdown.length}
            />
            {showScoreBands ? (
              <div className="pb-3 pl-6 pt-1">
                <ScoreBandTable items={analysis.scoreBandBreakdown} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────
export default function ManagerRecommendationsPage() {
  const { apiClient } = useAuth();

  const { data, error, isLoading } = useApiQuery(
    useCallback(() => apiClient.getManagerRecommendations(), [apiClient]),
  );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Manager Recommendations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Weekly AI analysis of outreach performance with actionable recommendations
        </p>
      </div>

      {/* Error state */}
      {error ? (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {/* Loading state */}
      {isLoading && !data ? (
        <div className="space-y-4">
          {/* Skeleton cards */}
          {[1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-2xl border border-border/50 bg-card p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="h-3 w-24 rounded bg-muted-foreground/10" />
                  <div className="mt-2 h-5 w-48 rounded bg-muted-foreground/15" />
                </div>
                <div className="flex gap-4">
                  <div className="h-8 w-16 rounded bg-muted-foreground/10" />
                  <div className="h-8 w-16 rounded bg-muted-foreground/10" />
                  <div className="h-8 w-16 rounded bg-muted-foreground/10" />
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="h-16 rounded-xl bg-muted-foreground/10" />
                ))}
              </div>
              <div className="mt-6 space-y-3">
                <div className="h-4 w-40 rounded bg-muted-foreground/10" />
                <div className="h-20 rounded-xl bg-muted-foreground/8" />
                <div className="h-20 rounded-xl bg-muted-foreground/8" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Empty state */}
      {!isLoading && data && data.items.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-12 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zbooni-teal/10">
            <Sparkles className="h-7 w-7 text-zbooni-teal/60" />
          </div>
          <h3 className="mt-4 text-base font-bold tracking-tight">No analyses yet</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground/60">
            The manager agent runs weekly to analyze outreach performance and generate
            recommendations. Check back after your first week of messaging activity.
          </p>
        </div>
      ) : null}

      {/* Analysis cards */}
      {data && data.items.length > 0 ? (
        <div className="space-y-6">
          {data.items.map((analysis) => (
            <AnalysisCard key={analysis.id} analysis={analysis} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

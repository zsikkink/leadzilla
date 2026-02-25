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
  Check,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Minus,
  Pencil,
  Sparkles,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '../../../src/components/ui/button.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../src/components/ui/dialog.js';
import { Input } from '../../../src/components/ui/input.js';
import { Label } from '../../../src/components/ui/label.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

// ── Style maps ──────────────────────────────────────────────
const RECOMMENDATION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PAUSE_ICP: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Pause ICP' },
  ADJUST_THRESHOLD: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Adjust Threshold' },
  ADJUST_WEIGHT: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Adjust Weight' },
  INCREASE_VOLUME: { bg: 'bg-zbooni-green/15', text: 'text-zbooni-green', label: 'Increase Volume' },
  DISABLE_FEATURE: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Disable Feature' },
  SWITCH_SOURCE: { bg: 'bg-purple-500/15', text: 'text-purple-400', label: 'Switch Source' },
};

const SCORE_BAND_STYLES: Record<string, { bg: string; text: string }> = {
  HIGH: { bg: 'bg-zbooni-green/15', text: 'text-zbooni-green' },
  MEDIUM: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  LOW: { bg: 'bg-red-500/15', text: 'text-red-400' },
};

type RecommendationStatus = 'pending' | 'approved' | 'rejected' | 'editing';

// ── Placeholder recommendations ─────────────────────────────
const PLACEHOLDER_RECOMMENDATIONS: Array<
  ManagerRecommendation & { id: string; reasoning: string }
> = [
  {
    id: 'placeholder-1',
    type: 'INCREASE_VOLUME',
    icpProfileId: 'icp-saas-b2b',
    field: 'email_warmup_limit',
    currentValue: 10,
    recommendedValue: 20,
    confidence: 0.89,
    reasoning:
      'Email warm-up has been running for 2 weeks with zero bounces and a consistent 94% inbox placement rate. Increasing the daily limit from 10 to 20 will double outreach capacity while maintaining deliverability.',
  },
  {
    id: 'placeholder-2',
    type: 'ADJUST_WEIGHT' as const,
    icpProfileId: 'icp-luxury',
    field: 'review_count',
    currentValue: 0.15,
    recommendedValue: 0.02,
    confidence: 0.76,
    reasoning:
      'The "review_count" feature has a signal-to-noise ratio of 0.12 for the Luxury segment, significantly below the 0.40 threshold. Reducing its weight from 0.15 to 0.02 will improve precision by an estimated 4.2% without impacting recall.',
  },
  {
    id: 'placeholder-3',
    type: 'ADJUST_THRESHOLD' as const,
    icpProfileId: 'icp-hospitality',
    field: 'primary_source',
    currentValue: null,
    recommendedValue: null,
    confidence: 0.82,
    reasoning:
      'Apollo achieves a 42% higher enrichment rate for Hospitality ICP compared to the current primary source (Hunter). Switching would increase pipeline throughput by approximately 65 qualified leads per week based on current discovery volume.',
  },
];

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

// ── Trend indicator ─────────────────────────────────────────
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

// ── Stat pill ───────────────────────────────────────────────
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

// ── Status badge ────────────────────────────────────────────
function StatusBadge({ status }: { status: RecommendationStatus }) {
  const styles: Record<RecommendationStatus, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'Pending Review' },
    approved: { bg: 'bg-zbooni-green/10', text: 'text-zbooni-green', label: 'Approved' },
    rejected: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Rejected' },
    editing: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Editing' },
  };
  const s = styles[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.bg} ${s.text}`}>
      {status === 'approved' ? <Check className="h-2.5 w-2.5" /> : null}
      {status === 'rejected' ? <X className="h-2.5 w-2.5" /> : null}
      {s.label}
    </span>
  );
}

// ── Reject dialog ───────────────────────────────────────────
function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Reject Recommendation</DialogTitle>
          <DialogDescription>
            Optionally provide a reason for rejecting this recommendation. This helps the AI agent learn from your feedback.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-reason">Reason (optional)</Label>
          <Input
            id="reject-reason"
            placeholder="e.g., Not applicable for current strategy..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onConfirm(reason);
              setReason('');
              onOpenChange(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog ─────────────────────────────────────────────
function EditDialog({
  open,
  onOpenChange,
  recommendation,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recommendation: ManagerRecommendation;
  onSave: (newValue: number | null) => void;
}) {
  const [editedValue, setEditedValue] = useState(
    recommendation.recommendedValue !== null ? String(recommendation.recommendedValue) : '',
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Edit Recommendation</DialogTitle>
          <DialogDescription>
            Modify the recommended value before applying. The original suggestion is preserved for comparison.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {recommendation.field ? (
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">Field</p>
              <p className="mt-0.5 font-mono text-sm font-medium">{recommendation.field}</p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground/60">Current Value</Label>
              <div className="rounded-lg border border-border/30 bg-zbooni-dark/40 px-3 py-2">
                <span className="font-mono text-sm font-semibold text-red-400/80">
                  {recommendation.currentValue !== null ? recommendation.currentValue : 'N/A'}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-value" className="text-[11px] text-muted-foreground/60">New Value</Label>
              <Input
                id="new-value"
                type="text"
                value={editedValue}
                onChange={(e) => setEditedValue(e.target.value)}
                placeholder="Enter value..."
                className="font-mono"
              />
            </div>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">Original Suggestion</p>
            <p className="mt-0.5 font-mono text-sm text-muted-foreground/60">
              {recommendation.recommendedValue !== null ? recommendation.recommendedValue : 'N/A'}
            </p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">Cancel</Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={() => {
              const parsed = editedValue !== '' ? parseFloat(editedValue) : null;
              onSave(parsed !== null && !isNaN(parsed) ? parsed : null);
              onOpenChange(false);
            }}
          >
            <Check className="h-3.5 w-3.5" />
            Save & Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Single recommendation card with action buttons ──────────
function RecommendationCard({
  rec,
  isPlaceholder,
}: {
  rec: ManagerRecommendation & { id?: string | undefined };
  isPlaceholder?: boolean | undefined;
}) {
  const [status, setStatus] = useState<RecommendationStatus>('pending');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  const style = RECOMMENDATION_STYLES[rec.type] ?? {
    bg: 'bg-muted/15',
    text: 'text-muted-foreground',
    label: rec.type,
  };

  const isResolved = status === 'approved' || status === 'rejected';

  return (
    <>
      <div
        className={`rounded-xl border p-4 transition-all duration-300 ${
          status === 'approved'
            ? 'border-zbooni-green/20 bg-zbooni-green/[0.03]'
            : status === 'rejected'
              ? 'border-red-400/10 bg-red-400/[0.02] opacity-60'
              : 'border-border/30 bg-zbooni-dark/30'
        }`}
      >
        {/* Top row: type badge + confidence + status */}
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
            {isPlaceholder ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground/40">
                Example
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            <ConfidenceBar confidence={rec.confidence} />
          </div>
        </div>

        {/* Reasoning text */}
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground/80">{rec.reasoning}</p>

        {/* Suggested change */}
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

        {/* Rejection reason (shown after rejection) */}
        {status === 'rejected' && rejectionReason ? (
          <div className="mt-3 rounded-lg bg-red-400/[0.05] px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-red-400/60">Rejection Reason</p>
            <p className="mt-0.5 text-xs text-muted-foreground/60">{rejectionReason}</p>
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/20 pt-3">
          {!isResolved ? (
            <>
              <Button
                variant="ghost"
                size="xs"
                className="text-red-400/70 hover:bg-red-400/10 hover:text-red-400"
                onClick={() => setShowRejectDialog(true)}
              >
                <X className="h-3 w-3" />
                Reject
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-blue-400/70 hover:bg-blue-400/10 hover:text-blue-400"
                onClick={() => setShowEditDialog(true)}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
              <Button
                size="xs"
                className="bg-zbooni-green/15 text-zbooni-green hover:bg-zbooni-green/25"
                onClick={() => setStatus('approved')}
              >
                <Check className="h-3 w-3" />
                Approve
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground/40 hover:text-muted-foreground/70"
              onClick={() => {
                setStatus('pending');
                setRejectionReason(null);
              }}
            >
              Undo
            </Button>
          )}
        </div>
      </div>

      <RejectDialog
        open={showRejectDialog}
        onOpenChange={setShowRejectDialog}
        onConfirm={(reason) => {
          setStatus('rejected');
          setRejectionReason(reason || null);
        }}
      />

      {showEditDialog ? (
        <EditDialog
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          recommendation={rec}
          onSave={() => {
            setStatus('approved');
          }}
        />
      ) : null}
    </>
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

        {/* Recommendations with action buttons */}
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

  const hasData = data && data.items.length > 0;
  const isEmpty = !isLoading && data && data.items.length === 0;

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

      {/* Empty state with placeholder recommendations */}
      {isEmpty ? (
        <div className="space-y-6">
          {/* Illustration + explanation */}
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

          {/* Placeholder recommendation cards */}
          <div className="relative">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-yellow-400/[0.02] via-transparent to-zbooni-teal/[0.02]" />
            <div className="relative space-y-4 rounded-3xl border border-border/30 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-400/10">
                    <Lightbulb className="h-4 w-4 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold tracking-tight">Example Recommendations</h3>
                    <p className="text-[11px] text-muted-foreground/50">
                      These are sample recommendations the AI manager will generate
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-yellow-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-yellow-400">
                  Preview
                </span>
              </div>

              <div className="space-y-3">
                {PLACEHOLDER_RECOMMENDATIONS.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    isPlaceholder
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Analysis cards (live data) */}
      {hasData ? (
        <div className="space-y-6">
          {data.items.map((analysis) => (
            <AnalysisCard key={analysis.id} analysis={analysis} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

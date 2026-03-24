'use client';

import type { StoredRecommendation } from '@lead-flood/contracts';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Lightbulb,
  Sparkles,
  X,
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
  PREFER_VARIANT: { bg: 'bg-indigo-500/15', text: 'text-indigo-400', label: 'Prefer Variant' },
};

// ── Placeholder recommendations ─────────────────────────────
// Shown when no real recommendations exist in the database yet
const PLACEHOLDER_RECOMMENDATIONS: Array<
  StoredRecommendation & { isPlaceholder: true }
> = [
  {
    id: 'placeholder-1',
    type: 'PAUSE_ICP',
    title: 'Pause discovery for Dubai hospitality segment',
    description:
      'Discovery yield rate for the Dubai Hospitality ICP dropped 40% this week (from 12% to 7.2%). The cost per qualified lead is now 3x higher than the Riyadh segment. Consider pausing discovery runs for this ICP until you review the search categories or lower the minimum review count.',
    icpProfileId: 'icp-hospitality-dubai',
    icpName: 'Dubai Hospitality',
    field: 'discoveryYieldRate',
    currentValue: 0.072,
    recommendedValue: null,
    confidence: 0.82,
    priority: 2,
    status: 'active',
    analysisRunId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPlaceholder: true,
  },
  {
    id: 'placeholder-2',
    type: 'ADJUST_THRESHOLD',
    title: 'Lower qualification threshold for Segment B',
    description:
      'Segment B (SMB e-commerce) has a 3x higher conversion rate than Segment A at the MEDIUM score band. 8 out of 12 MEDIUM-band leads from this segment replied positively (66.7% reply rate), compared to only 2 out of 15 for HIGH-band Segment A leads (13.3%). Lowering the scoring threshold from 0.50 to 0.40 for this ICP would capture these high-value leads.',
    icpProfileId: 'icp-ecommerce-smb',
    icpName: 'SMB E-commerce',
    field: 'scoringThreshold',
    currentValue: 0.50,
    recommendedValue: 0.40,
    confidence: 0.78,
    priority: 3,
    status: 'active',
    analysisRunId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPlaceholder: true,
  },
  {
    id: 'placeholder-3',
    type: 'ADJUST_WEIGHT',
    title: 'Increase weight on "has_whatsapp" feature',
    description:
      'Analysis of 200+ converted leads shows that businesses with WhatsApp enabled have a 4.2x higher positive outcome rate. The current scoring weight for "has_whatsapp" is 0.05 (2.6% of total weight pool). Increasing it to 0.12 would better reflect its strong predictive signal in high-converting leads.',
    icpProfileId: null,
    icpName: null,
    field: 'has_whatsapp',
    currentValue: 0.05,
    recommendedValue: 0.12,
    confidence: 0.85,
    priority: 3,
    status: 'active',
    analysisRunId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPlaceholder: true,
  },
  {
    id: 'placeholder-4',
    type: 'DISABLE_FEATURE',
    title: 'Disable "bank_transfer_reliance" scoring feature',
    description:
      'The "bank_transfer_reliance" feature has been extracted in only 3 out of 450 businesses processed (0.67% detection rate). Its near-zero signal means it adds noise to the scoring model without providing useful differentiation. Disabling it will simplify the feature set with no measurable impact on prediction quality.',
    icpProfileId: null,
    icpName: null,
    field: 'bank_transfer_reliance',
    currentValue: 0.04,
    recommendedValue: 0,
    confidence: 0.91,
    priority: 4,
    status: 'active',
    analysisRunId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPlaceholder: true,
  },
  {
    id: 'placeholder-5',
    type: 'SWITCH_SOURCE',
    title: 'Switch discovery source for luxury retail segment',
    description:
      'The current Google Maps discovery for the Luxury Retail ICP produces only 2.1% yield rate (6 leads from 285 businesses). Many luxury retailers have minimal Google Maps presence. Switching to a category-specific approach targeting "luxury boutique" and "designer store" categories, or supplementing with Instagram discovery, could significantly improve yield for this high-value segment.',
    icpProfileId: 'icp-luxury-retail',
    icpName: 'Luxury Retail',
    field: 'discoverySource',
    currentValue: null,
    recommendedValue: null,
    confidence: 0.73,
    priority: 5,
    status: 'active',
    analysisRunId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPlaceholder: true,
  },
  {
    id: 'placeholder-6',
    type: 'INCREASE_VOLUME',
    title: 'Increase discovery budget for Riyadh F&B segment',
    description:
      'The Riyadh Food & Beverage ICP has a 18.5% discovery yield rate (37 leads from 200 businesses) and a 23% reply rate on outreach. This is the highest-performing segment across all metrics. Increasing the search budget from 40 to 80 max tasks per run would double the lead pipeline for this segment at a marginal cost increase.',
    icpProfileId: 'icp-riyadh-fb',
    icpName: 'Riyadh F&B',
    field: 'maxTasks',
    currentValue: 40,
    recommendedValue: 80,
    confidence: 0.88,
    priority: 2,
    status: 'active',
    analysisRunId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPlaceholder: true,
  },
];

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

// ── Status badge ────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'Pending Review' },
    applied: { bg: 'bg-zbooni-green/10', text: 'text-zbooni-green', label: 'Applied' },
    dismissed: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Dismissed' },
  };
  const s = styles[status] ?? { bg: 'bg-muted/10', text: 'text-muted-foreground', label: status };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.bg} ${s.text}`}>
      {status === 'applied' ? <Check className="h-2.5 w-2.5" /> : null}
      {status === 'dismissed' ? <X className="h-2.5 w-2.5" /> : null}
      {s.label}
    </span>
  );
}

// ── Dismiss dialog ───────────────────────────────────────────
function DismissDialog({
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
          <DialogTitle>Dismiss Recommendation</DialogTitle>
          <DialogDescription>
            Optionally provide a reason for dismissing this recommendation. This helps the AI agent learn from your feedback.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="dismiss-reason">Reason (optional)</Label>
          <Input
            id="dismiss-reason"
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
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Single recommendation card ──────────────────────────────
function RecommendationCard({
  rec,
  isPlaceholder,
  onStatusChange,
}: {
  rec: StoredRecommendation;
  isPlaceholder?: boolean | undefined;
  onStatusChange?: ((id: string, status: StoredRecommendation['status']) => void) | undefined;
}) {
  const [localStatus, setLocalStatus] = useState(rec.status);
  const [showDismissDialog, setShowDismissDialog] = useState(false);

  const style = RECOMMENDATION_STYLES[rec.type] ?? {
    bg: 'bg-muted/15',
    text: 'text-muted-foreground',
    label: rec.type,
  };

  const isResolved = localStatus === 'applied' || localStatus === 'dismissed';

  function handleApply() {
    setLocalStatus('applied');
    if (onStatusChange) onStatusChange(rec.id, 'applied');
  }

  function handleDismiss() {
    setLocalStatus('dismissed');
    if (onStatusChange) onStatusChange(rec.id, 'dismissed');
  }

  function handleUndo() {
    setLocalStatus('active');
    if (onStatusChange) onStatusChange(rec.id, 'active');
  }

  return (
    <>
      <div
        className={`rounded-xl border p-4 transition-all duration-300 ${
          localStatus === 'applied'
            ? 'border-zbooni-green/20 bg-zbooni-green/[0.03]'
            : localStatus === 'dismissed'
              ? 'border-red-400/10 bg-red-400/[0.02] opacity-60'
              : 'border-border/30 bg-zbooni-dark/30'
        }`}
      >
        {/* Top row: type badge + ICP + confidence + status */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.bg} ${style.text}`}
            >
              {style.label}
            </span>
            {rec.icpName ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/70">
                {rec.icpName}
              </span>
            ) : null}
            {rec.field ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/50">
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
            <StatusBadge status={localStatus} />
            <ConfidenceBar confidence={rec.confidence} />
          </div>
        </div>

        {/* Title */}
        <h4 className="mt-2 text-sm font-bold tracking-tight">{rec.title}</h4>

        {/* Description */}
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground/80">{rec.description}</p>

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

        {/* Priority badge */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            Priority
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
            rec.priority <= 3
              ? 'bg-red-500/10 text-red-400'
              : rec.priority <= 6
                ? 'bg-yellow-500/10 text-yellow-400'
                : 'bg-muted/10 text-muted-foreground/60'
          }`}>
            {rec.priority}/10
          </span>
        </div>

        {/* Action buttons */}
        {!isPlaceholder ? (
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/20 pt-3">
            {!isResolved ? (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-red-400/70 hover:bg-red-400/10 hover:text-red-400"
                  onClick={() => setShowDismissDialog(true)}
                >
                  <X className="h-3 w-3" />
                  Dismiss
                </Button>
                <Button
                  size="xs"
                  className="bg-zbooni-green/15 text-zbooni-green hover:bg-zbooni-green/25"
                  onClick={handleApply}
                >
                  <Check className="h-3 w-3" />
                  Apply
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground/40 hover:text-muted-foreground/70"
                onClick={handleUndo}
              >
                Undo
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <DismissDialog
        open={showDismissDialog}
        onOpenChange={setShowDismissDialog}
        onConfirm={() => handleDismiss()}
      />
    </>
  );
}

// ── Main page ───────────────────────────────────────────────
export default function RecommendationsPage() {
  const { apiClient } = useAuth();

  const { data, error, isLoading, refetch } = useApiQuery(
    useCallback(() => apiClient.getStoredRecommendations(), [apiClient]),
  );

  // Dedup by type+title — the manager.analyze job can create duplicate records
  const uniqueItems = data
    ? Array.from(
        new Map(data.items.map((r) => [`${r.type}:${r.title}`, r])).values(),
      )
    : [];
  const hasRealData = uniqueItems.length > 0;
  const showPlaceholders = !isLoading && uniqueItems.length === 0;

  async function handleStatusChange(id: string, status: StoredRecommendation['status']) {
    try {
      await apiClient.updateRecommendationStatus(id, status);
      refetch();
    } catch {
      // Status updated locally already; silent fail on API
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Recommendations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          AI-generated recommendations to optimize your pipeline performance
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
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-border/30 bg-zbooni-dark/30 p-4"
            >
              <div className="flex items-center gap-2">
                <div className="h-5 w-24 rounded bg-muted-foreground/10" />
                <div className="h-5 w-16 rounded bg-muted-foreground/10" />
              </div>
              <div className="mt-3 h-4 w-3/4 rounded bg-muted-foreground/10" />
              <div className="mt-2 h-14 rounded bg-muted-foreground/8" />
            </div>
          ))}
        </div>
      ) : null}

      {/* Real recommendations from API */}
      {hasRealData ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-bold tracking-tight">Active Recommendations</h3>
            <span className="rounded-md bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-yellow-400">
              {uniqueItems.length}
            </span>
          </div>
          <div className="space-y-3">
            {uniqueItems.map((rec) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Placeholder recommendations (when no real data) */}
      {showPlaceholders ? (
        <div className="space-y-6">
          {/* Explanation card */}
          <div className="rounded-2xl border border-border/50 bg-card p-12 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zbooni-teal/10">
              <Sparkles className="h-7 w-7 text-zbooni-teal/60" />
            </div>
            <h3 className="mt-4 text-base font-bold tracking-tight">No recommendations yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground/60">
              The self-improving agent analyzes your pipeline weekly and generates actionable
              recommendations. Once you have enough discovery and outreach data, recommendations
              will appear here automatically.
            </p>
          </div>

          {/* Placeholder cards */}
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
                      These are sample recommendations the AI agent will generate
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
    </div>
  );
}

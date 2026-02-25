'use client';

import { useCallback, useState } from 'react';
import {
  MessageSquareReply,
  ThumbsUp,
  ThumbsDown,
  Clock,
  CalendarCheck,
  Unplug,
  AlertTriangle,
  TrendingDown,
  Tag,
  ChevronRight,
  Loader2,
  Sparkles,
} from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { useAuth } from '@/hooks/use-auth.js';
import { useApiQuery } from '@/hooks/use-api-query.js';

/* ------------------------------------------------------------------ */
/*  Classification config                                               */
/* ------------------------------------------------------------------ */

const CLASSIFICATION_CONFIG = [
  { key: 'replied', label: 'Replied', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', Icon: ThumbsUp },
  { key: 'meetingBooked', label: 'Meeting Booked', color: 'text-zbooni-teal', bg: 'bg-zbooni-teal/15', border: 'border-zbooni-teal/25', Icon: CalendarCheck },
  { key: 'dealWon', label: 'Deal Won', color: 'text-zbooni-green', bg: 'bg-zbooni-green/15', border: 'border-zbooni-green/25', Icon: ThumbsUp },
  { key: 'dealLost', label: 'Deal Lost', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/25', Icon: ThumbsDown },
  { key: 'unsubscribed', label: 'Unsubscribed', color: 'text-slate-400', bg: 'bg-slate-500/15', border: 'border-slate-500/25', Icon: Unplug },
  { key: 'bounced', label: 'Bounced', color: 'text-slate-500', bg: 'bg-slate-600/15', border: 'border-slate-600/25', Icon: AlertTriangle },
] as const;

const EVENT_TYPE_LABELS: Record<string, { className: string; label: string }> = {
  REPLIED: { className: 'bg-emerald-500/15 text-emerald-400', label: 'Replied' },
  MEETING_BOOKED: { className: 'bg-zbooni-teal/15 text-zbooni-teal', label: 'Meeting Booked' },
  DEAL_WON: { className: 'bg-zbooni-green/15 text-zbooni-green', label: 'Deal Won' },
  DEAL_LOST: { className: 'bg-red-500/15 text-red-400', label: 'Deal Lost' },
  UNSUBSCRIBED: { className: 'bg-slate-500/15 text-slate-400', label: 'Unsubscribed' },
  BOUNCED: { className: 'bg-slate-600/15 text-slate-500', label: 'Bounced' },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AE', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function conversionRate(from: number, to: number): string {
  if (from === 0) return '0%';
  return `${((to / from) * 100).toFixed(1)}%`;
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function FeedbackRepliesPage() {
  const { apiClient } = useAuth();
  const [hoveredStage, setHoveredStage] = useState<number | null>(null);

  const feedbackSummary = useApiQuery(
    useCallback(() => apiClient.getFeedbackSummary(), [apiClient]),
  );

  const funnel = useApiQuery(
    useCallback(() => apiClient.getFunnel(), [apiClient]),
  );

  const recentEvents = useApiQuery(
    useCallback(() => apiClient.listFeedbackEvents({ page: 1, pageSize: 20 }), [apiClient]),
  );

  const isLoading = feedbackSummary.isLoading || funnel.isLoading;
  const summary = feedbackSummary.data;
  const funnelData = funnel.data;

  // Build classification counts from summary
  const classificationCounts: Record<string, number> = summary ? {
    replied: summary.repliedCount,
    meetingBooked: summary.meetingBookedCount,
    dealWon: summary.dealWonCount,
    dealLost: summary.dealLostCount,
    unsubscribed: summary.unsubscribedCount,
    bounced: summary.bouncedCount,
  } : {};

  const totalResponses = summary?.totalEvents ?? 0;

  // Build funnel stages from real data
  const funnelStages = funnelData ? [
    { label: 'Messaged', value: funnelData.messagesSentCount, color: 'from-zbooni-teal/80 to-zbooni-teal/40' },
    { label: 'Replied', value: funnelData.repliesCount, color: 'from-blue-500/80 to-blue-500/40' },
    ...(summary ? [
      { label: 'Meeting Booked', value: summary.meetingBookedCount, color: 'from-zbooni-green/80 to-zbooni-green/40' },
      { label: 'Deal Won', value: summary.dealWonCount, color: 'from-amber-400/80 to-amber-400/40' },
    ] : []),
  ] : [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading feedback data...
      </div>
    );
  }

  if (feedbackSummary.error) {
    return <p className="text-sm text-destructive">{feedbackSummary.error}</p>;
  }

  return (
    <div className="space-y-4">
      {/* ── Section: Reply Classification Breakdown ─────────────── */}
      <div className="card">
        <div className="section-header">
          <div>
            <h2 className="flex items-center gap-2">
              <MessageSquareReply className="h-5 w-5 text-zbooni-teal" />
              Reply Classification Breakdown
            </h2>
            <p className="muted">
              Feedback distribution across {totalResponses} total events.
            </p>
          </div>
        </div>

        <div
          className="mt-4 grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))' }}
        >
          {CLASSIFICATION_CONFIG.map((item) => {
            const count = classificationCounts[item.key] ?? 0;
            return (
              <div
                key={item.key}
                className={cn(
                  'rounded-xl border p-4 transition-colors duration-200',
                  item.bg,
                  item.border,
                )}
              >
                <div className="flex items-center gap-2">
                  <item.Icon className={cn('h-4 w-4', item.color)} />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </span>
                </div>
                <p className={cn('mt-2 text-3xl font-extrabold tabular-nums tracking-tight', item.color)}>
                  {count}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Section: Conversion Funnel ──────────────────────────── */}
      {funnelStages.length > 0 ? (
        <div className="card">
          <div className="section-header">
            <div>
              <h2 className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-zbooni-green rotate-180" />
                Conversion Funnel
              </h2>
              <p className="muted">
                End-to-end pipeline throughput from first message to deal close.
              </p>
            </div>
          </div>

          {/* Funnel visualization */}
          <div className="mt-6 space-y-1">
            {funnelStages.map((stage, idx) => {
              const maxValue = funnelStages[0]?.value ?? 1;
              const widthPercent = maxValue > 0 ? Math.max(12, (stage.value / maxValue) * 100) : 12;
              const nextStage = funnelStages[idx + 1] as typeof funnelStages[number] | undefined;
              const rate = nextStage ? conversionRate(stage.value, nextStage.value) : null;
              const isHovered = hoveredStage === idx;

              return (
                <div key={stage.label} className="group">
                  {/* Bar row */}
                  <div
                    className="flex items-center gap-4"
                    onMouseEnter={() => setHoveredStage(idx)}
                    onMouseLeave={() => setHoveredStage(null)}
                  >
                    <span className="w-32 shrink-0 text-right text-sm font-medium text-muted-foreground">
                      {stage.label}
                    </span>
                    <div className="relative flex-1">
                      <div
                        className={cn(
                          'relative h-10 rounded-lg bg-gradient-to-r transition-all duration-300',
                          stage.color,
                          isHovered ? 'opacity-100 shadow-lg' : 'opacity-80',
                        )}
                        style={{ width: `${widthPercent}%` }}
                      >
                        <span className="absolute inset-0 flex items-center px-3 text-sm font-bold text-white drop-shadow-sm">
                          {stage.value}
                        </span>
                      </div>
                    </div>
                  </div>

                  {rate !== null ? (
                    <div className="ml-32 flex items-center gap-2 py-0.5 pl-4">
                      <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                      <span className="font-mono text-xs text-muted-foreground">
                        {rate} conversion
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Summary strip */}
          {funnelStages.length >= 2 ? (
            <div className="mt-4 flex flex-wrap gap-6 rounded-xl border border-border/50 bg-slate-800 px-4 py-3">
              <div>
                <span className="text-xs text-muted-foreground">Overall conversion</span>
                <p className="text-sm font-bold text-zbooni-green">
                  {conversionRate(funnelStages[0]!.value, funnelStages[funnelStages.length - 1]!.value)}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Reply rate</span>
                <p className="text-sm font-bold text-zbooni-teal">
                  {conversionRate(funnelStages[0]!.value, funnelStages[1]!.value)}
                </p>
              </div>
              {funnelStages.length >= 3 ? (
                <div>
                  <span className="text-xs text-muted-foreground">Meeting rate</span>
                  <p className="text-sm font-bold text-emerald-400">
                    {conversionRate(funnelStages[1]!.value, funnelStages[2]!.value)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Section: Training Labels Summary ───────────────────── */}
      {summary ? (
        <div className="card">
          <div className="section-header">
            <div>
              <h2 className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-zbooni-teal" />
                Training Labels Summary
              </h2>
              <p className="muted">
                Feedback signals collected for model retraining.
              </p>
            </div>
          </div>

          <div className="kpis mt-4">
            <div className="kpi">
              <span className="text-xs text-muted-foreground">Total Events</span>
              <strong className="text-zbooni-teal">{summary.totalEvents}</strong>
            </div>
            <div className="kpi">
              <span className="text-xs text-muted-foreground">Positive Signals</span>
              <strong className="text-emerald-400">{summary.repliedCount + summary.meetingBookedCount + summary.dealWonCount}</strong>
              <span className="text-xs text-muted-foreground">replied, meeting, deal won</span>
            </div>
            <div className="kpi">
              <span className="text-xs text-muted-foreground">Negative Signals</span>
              <strong className="text-red-400">{summary.dealLostCount + summary.unsubscribedCount + summary.bouncedCount}</strong>
              <span className="text-xs text-muted-foreground">deal lost, bounced, unsubscribed</span>
            </div>
          </div>

          {/* Progress bar toward retraining threshold */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-zbooni-green" />
                Label collection progress
              </span>
              <span className="font-mono text-sm font-bold text-muted-foreground">
                {summary.totalEvents} total labels
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800 border border-border/50">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (summary.totalEvents / Math.max(summary.totalEvents, 50)) * 100)}%`,
                  background: 'linear-gradient(90deg, #3CC8E0 0%, #7BFF6B 100%)',
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Section: Recent Feedback Events ─────────────────────── */}
      <div className="card">
        <div className="section-header">
          <div>
            <h2>Recent Feedback Events</h2>
            <p className="muted">Latest reply classifications and pipeline feedback signals.</p>
          </div>
        </div>

        {recentEvents.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading events...
          </div>
        ) : recentEvents.data && recentEvents.data.items.length > 0 ? (
          <div className="table-wrap mt-4">
            <table>
              <thead>
                <tr>
                  <th>Lead ID</th>
                  <th>Event Type</th>
                  <th>Source</th>
                  <th>Occurred At</th>
                  <th>Classification</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.data.items.map((event) => {
                  const pill = EVENT_TYPE_LABELS[event.eventType] ?? { className: 'bg-slate-700/40 text-slate-300', label: event.eventType };
                  return (
                    <tr key={event.id}>
                      <td className="font-mono text-xs">{event.leadId.slice(0, 16)}...</td>
                      <td className="mono">{event.eventType}</td>
                      <td>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                            event.source === 'WEBHOOK'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : event.source === 'MANUAL'
                                ? 'bg-blue-500/15 text-blue-400'
                                : 'bg-slate-500/15 text-slate-400',
                          )}
                        >
                          {event.source}
                        </span>
                      </td>
                      <td className="text-muted-foreground">{formatTime(event.occurredAt)}</td>
                      <td>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
                            pill.className,
                          )}
                        >
                          {pill.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/20" />
            <p className="mt-2 text-sm text-muted-foreground/50">No feedback events yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground/30">
              Events will appear here once leads receive replies and feedback is classified.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

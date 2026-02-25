'use client';

import { useState } from 'react';
import {
  MessageSquareReply,
  ThumbsUp,
  ThumbsDown,
  Clock,
  UserX,
  CalendarCheck,
  Unplug,
  AlertTriangle,
  TrendingDown,
  Tag,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../../src/lib/utils.js';

/* ------------------------------------------------------------------ */
/*  Placeholder data                                                   */
/* ------------------------------------------------------------------ */

const CLASSIFICATIONS = [
  { key: 'INTERESTED', label: 'Interested', count: 22, color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', Icon: ThumbsUp },
  { key: 'NOT_INTERESTED', label: 'Not Interested', count: 9, color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/25', Icon: ThumbsDown },
  { key: 'OUT_OF_OFFICE', label: 'Out of Office', count: 4, color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/25', Icon: Clock },
  { key: 'WRONG_PERSON', label: 'Wrong Person', count: 2, color: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/25', Icon: UserX },
  { key: 'MEETING_BOOKED', label: 'Meeting Booked', count: 8, color: 'text-zbooni-teal', bg: 'bg-zbooni-teal/15', border: 'border-zbooni-teal/25', Icon: CalendarCheck },
  { key: 'UNSUBSCRIBED', label: 'Unsubscribed', count: 3, color: 'text-slate-400', bg: 'bg-slate-500/15', border: 'border-slate-500/25', Icon: Unplug },
  { key: 'BOUNCED', label: 'Bounced', count: 1, color: 'text-slate-500', bg: 'bg-slate-600/15', border: 'border-slate-600/25', Icon: AlertTriangle },
] as const;

const FUNNEL_STAGES = [
  { label: 'Messaged', value: 240, color: 'from-zbooni-teal/80 to-zbooni-teal/40' },
  { label: 'Replied', value: 38, color: 'from-blue-500/80 to-blue-500/40' },
  { label: 'Interested', value: 22, color: 'from-emerald-500/80 to-emerald-500/40' },
  { label: 'Meeting Booked', value: 8, color: 'from-zbooni-green/80 to-zbooni-green/40' },
  { label: 'Deal Won', value: 3, color: 'from-amber-400/80 to-amber-400/40' },
] as const;

const TRAINING_LABELS = {
  total: 142,
  positive: 33,
  negative: 67,
  unlabeled: 42,
  collected: 33,
  threshold: 50,
};

interface FeedbackEvent {
  id: string;
  leadName: string;
  eventType: string;
  channel: 'WhatsApp' | 'Email';
  occurredAt: string;
  classification: string;
}

const RECENT_EVENTS: FeedbackEvent[] = [
  { id: 'fb-001', leadName: 'Al Baraka Sweets', eventType: 'reply.received', channel: 'WhatsApp', occurredAt: '2026-02-24T14:32:00Z', classification: 'INTERESTED' },
  { id: 'fb-002', leadName: 'Desert Rose Spa', eventType: 'reply.received', channel: 'Email', occurredAt: '2026-02-24T13:15:00Z', classification: 'NOT_INTERESTED' },
  { id: 'fb-003', leadName: 'Majlis Coffee Co.', eventType: 'meeting.booked', channel: 'WhatsApp', occurredAt: '2026-02-24T12:50:00Z', classification: 'MEETING_BOOKED' },
  { id: 'fb-004', leadName: 'Gulf Education Hub', eventType: 'reply.received', channel: 'Email', occurredAt: '2026-02-24T11:20:00Z', classification: 'OUT_OF_OFFICE' },
  { id: 'fb-005', leadName: 'Noor Fashion House', eventType: 'reply.received', channel: 'WhatsApp', occurredAt: '2026-02-24T10:45:00Z', classification: 'INTERESTED' },
  { id: 'fb-006', leadName: 'Emirates Catering', eventType: 'bounce.detected', channel: 'Email', occurredAt: '2026-02-24T09:30:00Z', classification: 'BOUNCED' },
  { id: 'fb-007', leadName: 'Rimal Hotels Group', eventType: 'reply.received', channel: 'WhatsApp', occurredAt: '2026-02-23T18:10:00Z', classification: 'INTERESTED' },
  { id: 'fb-008', leadName: 'Habibi Fitness', eventType: 'unsubscribe.clicked', channel: 'Email', occurredAt: '2026-02-23T16:40:00Z', classification: 'UNSUBSCRIBED' },
  { id: 'fb-009', leadName: 'Oasis Event Planners', eventType: 'reply.received', channel: 'WhatsApp', occurredAt: '2026-02-23T15:05:00Z', classification: 'WRONG_PERSON' },
  { id: 'fb-010', leadName: 'Pearl Jewellery', eventType: 'meeting.booked', channel: 'WhatsApp', occurredAt: '2026-02-23T14:22:00Z', classification: 'MEETING_BOOKED' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function classificationPill(classification: string): { className: string; label: string } {
  const match = CLASSIFICATIONS.find((c) => c.key === classification);
  if (!match) return { className: 'bg-slate-700/40 text-slate-300', label: classification };
  return { className: cn(match.bg, match.color), label: match.label };
}

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
  const [hoveredStage, setHoveredStage] = useState<number | null>(null);

  const progressPercent = Math.min(100, (TRAINING_LABELS.collected / TRAINING_LABELS.threshold) * 100);

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
              AI-classified reply distribution across {CLASSIFICATIONS.reduce((s, c) => s + c.count, 0)} total responses.
            </p>
          </div>
        </div>

        <div
          className="mt-4 grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))' }}
        >
          {CLASSIFICATIONS.map((item) => (
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
                {item.count}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section: Conversion Funnel ──────────────────────────── */}
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
          {FUNNEL_STAGES.map((stage, idx) => {
            const maxValue = FUNNEL_STAGES[0].value;
            const widthPercent = Math.max(12, (stage.value / maxValue) * 100);
            const nextStage = FUNNEL_STAGES[idx + 1] as typeof FUNNEL_STAGES[number] | undefined;
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
                  {/* Label */}
                  <span className="w-32 shrink-0 text-right text-sm font-medium text-muted-foreground">
                    {stage.label}
                  </span>

                  {/* Bar container */}
                  <div className="relative flex-1">
                    <div
                      className={cn(
                        'relative h-10 rounded-lg bg-gradient-to-r transition-all duration-300',
                        stage.color,
                        isHovered ? 'opacity-100 shadow-lg' : 'opacity-80',
                      )}
                      style={{ width: `${widthPercent}%` }}
                    >
                      {/* Value inside bar */}
                      <span className="absolute inset-0 flex items-center px-3 text-sm font-bold text-white drop-shadow-sm">
                        {stage.value}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Conversion arrow between stages */}
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
        <div className="mt-4 flex flex-wrap gap-6 rounded-xl border border-border/50 bg-zbooni-dark/30 px-4 py-3">
          <div>
            <span className="text-xs text-muted-foreground">Overall conversion</span>
            <p className="text-sm font-bold text-zbooni-green">
              {conversionRate(FUNNEL_STAGES[0].value, FUNNEL_STAGES[FUNNEL_STAGES.length - 1]!.value)}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Reply rate</span>
            <p className="text-sm font-bold text-zbooni-teal">
              {conversionRate(FUNNEL_STAGES[0].value, FUNNEL_STAGES[1].value)}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Interest rate</span>
            <p className="text-sm font-bold text-emerald-400">
              {conversionRate(FUNNEL_STAGES[1].value, FUNNEL_STAGES[2].value)}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Meeting close rate</span>
            <p className="text-sm font-bold text-amber-400">
              {conversionRate(FUNNEL_STAGES[3].value, FUNNEL_STAGES[4].value)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Section: Training Labels Summary ───────────────────── */}
      <div className="card">
        <div className="section-header">
          <div>
            <h2 className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-zbooni-teal" />
              Training Labels Summary
            </h2>
            <p className="muted">
              Feedback signals collected for model retraining. Threshold: {TRAINING_LABELS.threshold} labels.
            </p>
          </div>
        </div>

        <div className="kpis mt-4">
          <div className="kpi">
            <span className="text-xs text-muted-foreground">Total Labeled</span>
            <strong className="text-zbooni-teal">{TRAINING_LABELS.total}</strong>
          </div>
          <div className="kpi">
            <span className="text-xs text-muted-foreground">Positive</span>
            <strong className="text-emerald-400">{TRAINING_LABELS.positive}</strong>
            <span className="text-xs text-muted-foreground">replied, meeting, deal won</span>
          </div>
          <div className="kpi">
            <span className="text-xs text-muted-foreground">Negative</span>
            <strong className="text-red-400">{TRAINING_LABELS.negative}</strong>
            <span className="text-xs text-muted-foreground">no reply, bounced, unsubscribed</span>
          </div>
          <div className="kpi">
            <span className="text-xs text-muted-foreground">Unlabeled</span>
            <strong className="text-yellow-400">{TRAINING_LABELS.unlabeled}</strong>
            <span className="text-xs text-muted-foreground">awaiting cold timeout</span>
          </div>
        </div>

        {/* Progress bar toward retraining threshold */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-zbooni-green" />
              Next retraining threshold
            </span>
            <span className="font-mono text-sm font-bold text-muted-foreground">
              {TRAINING_LABELS.collected}/{TRAINING_LABELS.threshold} labels
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-zbooni-dark/60 border border-border/50">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressPercent}%`,
                background: 'linear-gradient(90deg, #3CC8E0 0%, #7BFF6B 100%)',
              }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {TRAINING_LABELS.threshold - TRAINING_LABELS.collected} more labels needed before automatic retraining triggers.
          </p>
        </div>
      </div>

      {/* ── Section: Recent Feedback Events ─────────────────────── */}
      <div className="card">
        <div className="section-header">
          <div>
            <h2>Recent Feedback Events</h2>
            <p className="muted">Latest reply classifications and pipeline feedback signals.</p>
          </div>
        </div>

        <div className="table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Event Type</th>
                <th>Channel</th>
                <th>Occurred At</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {RECENT_EVENTS.map((event) => {
                const pill = classificationPill(event.classification);
                return (
                  <tr key={event.id}>
                    <td className="font-medium">{event.leadName}</td>
                    <td className="mono">{event.eventType}</td>
                    <td>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                          event.channel === 'WhatsApp'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-blue-500/15 text-blue-400',
                        )}
                      >
                        {event.channel}
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
      </div>
    </div>
  );
}

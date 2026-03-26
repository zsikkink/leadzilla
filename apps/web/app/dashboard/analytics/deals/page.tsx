'use client';

import type {
  FeedbackSummaryResponse,
  ListFeedbackEventsResponse,
  ListLeadsResponse,
} from '@lead-flood/contracts';
import {
  AlertCircle,
  DollarSign,
  Loader2,
  Plus,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';
import { getWebEnv } from '../../../../src/lib/env.js';
import { cn } from '../../../../src/lib/utils.js';

// ── Types ────────────────────────────────────────────────────────────
type DealStatus = 'Won' | 'Lost' | 'In Progress';

interface DealFormData {
  leadId: string;
  status: DealStatus;
  value: string;
  notes: string;
}

interface LeadOption {
  id: string;
  label: string;
}

// ── Status config ────────────────────────────────────────────────────
const DEAL_STATUS_CONFIG: Record<
  DealStatus,
  { bgClass: string; textClass: string; borderClass: string; dotColor: string }
> = {
  Won: {
    bgClass: 'bg-emerald-500/10',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/20',
    dotColor: 'bg-emerald-400',
  },
  Lost: {
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-400',
    borderClass: 'border-red-500/20',
    dotColor: 'bg-red-400',
  },
  'In Progress': {
    bgClass: 'bg-yellow-500/10',
    textClass: 'text-yellow-400',
    borderClass: 'border-yellow-500/20',
    dotColor: 'bg-yellow-400',
  },
};

function statusToEventType(status: DealStatus): string {
  if (status === 'Won') return 'DEAL_WON';
  if (status === 'Lost') return 'DEAL_LOST';
  return 'MEETING_BOOKED'; // "In Progress" = active opportunity, closest event type
}

function eventTypeToDealStatus(eventType: string): DealStatus {
  if (eventType === 'DEAL_WON') return 'Won';
  if (eventType === 'DEAL_LOST') return 'Lost';
  return 'In Progress';
}

// ── Add Deal Modal ───────────────────────────────────────────────────
function AddDealModal({
  leads,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: {
  leads: LeadOption[];
  onClose: () => void;
  onSubmit: (data: DealFormData) => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [status, setStatus] = useState<DealStatus>('In Progress');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredLeads = useMemo(() => {
    if (!leadSearch.trim()) return leads.slice(0, 20);
    const q = leadSearch.toLowerCase();
    return leads.filter((l) => l.label.toLowerCase().includes(q)).slice(0, 20);
  }, [leads, leadSearch]);

  const selectedLabel = leads.find((l) => l.id === selectedLeadId)?.label ?? '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLeadId) return;
    onSubmit({ leadId: selectedLeadId, status, value, notes });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border/50 bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight">Add Deal</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Lead selector */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Lead *
            </label>
            <div className="relative">
              <input
                type="text"
                value={selectedLeadId ? selectedLabel : leadSearch}
                onChange={(e) => {
                  setLeadSearch(e.target.value);
                  setSelectedLeadId('');
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search leads..."
                className="w-full rounded-lg border border-border/30 bg-zbooni-dark/40 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:ring-1 focus:ring-zbooni-teal/30"
              />
              {showDropdown && !selectedLeadId && (
                <div className="absolute top-full z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border/30 bg-card shadow-xl">
                  {filteredLeads.length > 0 ? (
                    filteredLeads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => {
                          setSelectedLeadId(lead.id);
                          setLeadSearch('');
                          setShowDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-white/5"
                      >
                        {lead.label}
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-xs text-muted-foreground/50">
                      No leads found
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Deal status */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Status *
            </label>
            <div className="flex gap-2">
              {(['Won', 'Lost', 'In Progress'] as const).map((s) => {
                const cfg = DEAL_STATUS_CONFIG[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-xs font-bold transition-all',
                      status === s
                        ? `${cfg.bgClass} ${cfg.textClass} ${cfg.borderClass}`
                        : 'border-border/20 text-muted-foreground/50 hover:border-border/40',
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Deal value */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Value ($)
            </label>
            <div className="relative">
              <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
              <input
                type="number"
                min="0"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-border/30 bg-zbooni-dark/40 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:ring-1 focus:ring-zbooni-teal/30"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Additional details..."
              className="w-full resize-none rounded-lg border border-border/30 bg-zbooni-dark/40 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:ring-1 focus:ring-zbooni-teal/30"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!selectedLeadId || isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-zbooni-teal to-zbooni-green px-4 py-2.5 text-sm font-bold text-black transition-opacity disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {isSubmitting ? 'Creating...' : 'Add Deal'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────
export default function DealsPage() {
  const { apiClient, token } = useAuth();
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch feedback summary for deal counts
  const feedback = useApiQuery<FeedbackSummaryResponse>(
    useCallback(() => apiClient.getFeedbackSummary(), [apiClient]),
  );

  // Fetch recent deal events
  const dealWonEvents = useApiQuery<ListFeedbackEventsResponse>(
    useCallback(
      () => apiClient.listFeedbackEvents({ eventType: 'DEAL_WON', page: 1, pageSize: 50 }),
      [apiClient],
    ),
  );

  const dealLostEvents = useApiQuery<ListFeedbackEventsResponse>(
    useCallback(
      () => apiClient.listFeedbackEvents({ eventType: 'DEAL_LOST', page: 1, pageSize: 50 }),
      [apiClient],
    ),
  );

  const meetingEvents = useApiQuery<ListFeedbackEventsResponse>(
    useCallback(
      () => apiClient.listFeedbackEvents({ eventType: 'MEETING_BOOKED', page: 1, pageSize: 50 }),
      [apiClient],
    ),
  );

  // Fetch leads for the dropdown
  const leads = useApiQuery<ListLeadsResponse>(
    useCallback(
      () => apiClient.listLeads({ page: 1, pageSize: 100, includeQualityMetrics: false }),
      [apiClient],
    ),
  );

  const leadOptions = useMemo((): LeadOption[] => {
    if (!leads.data) return [];
    return leads.data.items.map((l) => ({
      id: l.id,
      label: `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim() || l.businessCategory || l.id.slice(0, 12),
    }));
  }, [leads.data]);

  // Merge all deal-like events into a single sorted list
  const allDeals = useMemo(() => {
    const events = [
      ...(dealWonEvents.data?.items ?? []),
      ...(dealLostEvents.data?.items ?? []),
      ...(meetingEvents.data?.items ?? []),
    ];
    return events.sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
  }, [dealWonEvents.data, dealLostEvents.data, meetingEvents.data]);

  // Build lead ID → name map
  const leadNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const opt of leadOptions) {
      m.set(opt.id, opt.label);
    }
    return m;
  }, [leadOptions]);

  const handleAddDeal = async (data: DealFormData) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;

      const body = {
        leadId: data.leadId,
        eventType: statusToEventType(data.status),
        source: 'MANUAL' as const,
        occurredAt: new Date().toISOString(),
        payloadJson: {
          dealValue: data.value ? parseFloat(data.value) : undefined,
          notes: data.notes || undefined,
          dealStatus: data.status,
        },
      };

      const res = await fetch(
        `${getWebEnv().NEXT_PUBLIC_API_BASE_URL}/v1/feedback/events`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as { error?: string; message?: string } | null;
        throw new Error(
          (errBody && ('error' in errBody ? errBody.error : errBody.message)) ??
            `Failed (${res.status})`,
        );
      }

      // Refresh data
      feedback.refetch();
      dealWonEvents.refetch();
      dealLostEvents.refetch();
      meetingEvents.refetch();
      setShowAddModal(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create deal');
    } finally {
      setIsSubmitting(false);
    }
  };

  const wonCount = feedback.data?.dealWonCount ?? 0;
  const lostCount = feedback.data?.dealLostCount ?? 0;
  const meetingCount = feedback.data?.meetingBookedCount ?? 0;
  const totalDeals = wonCount + lostCount + meetingCount;
  const winRate = totalDeals > 0 ? Math.round((wonCount / totalDeals) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Deals</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Track deal outcomes and pipeline revenue
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSubmitError(null);
            setShowAddModal(true);
          }}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-zbooni-teal to-zbooni-green px-4 py-2.5 text-sm font-bold text-black shadow-lg shadow-zbooni-teal/20 transition-all hover:shadow-xl hover:shadow-zbooni-teal/30"
        >
          <Plus className="h-4 w-4" />
          Add Deal
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="group relative overflow-hidden rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-lg transition-all hover:-translate-y-0.5">
          <div className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-emerald-400 opacity-15 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <Trophy className="h-3.5 w-3.5 text-emerald-400" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Won</p>
          </div>
          <p className="relative mt-2 text-2xl font-extrabold tracking-tight text-emerald-400">{wonCount}</p>
        </div>

        <div className="group relative overflow-hidden rounded-xl border border-red-500/20 bg-red-500/5 p-4 shadow-lg transition-all hover:-translate-y-0.5">
          <div className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-red-400 opacity-15 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Lost</p>
          </div>
          <p className="relative mt-2 text-2xl font-extrabold tracking-tight text-red-400">{lostCount}</p>
        </div>

        <div className="group relative overflow-hidden rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 shadow-lg transition-all hover:-translate-y-0.5">
          <div className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-yellow-400 opacity-15 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-yellow-400" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">In Progress</p>
          </div>
          <p className="relative mt-2 text-2xl font-extrabold tracking-tight text-yellow-400">{meetingCount}</p>
        </div>

        <div className="group relative overflow-hidden rounded-xl border border-zbooni-teal/20 bg-zbooni-teal/5 p-4 shadow-lg transition-all hover:-translate-y-0.5">
          <div className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-zbooni-teal opacity-15 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <DollarSign className="h-3.5 w-3.5 text-zbooni-teal" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Win Rate</p>
          </div>
          <p className="relative mt-2 text-2xl font-extrabold tracking-tight text-zbooni-teal">
            {totalDeals > 0 ? `${winRate}%` : '--'}
          </p>
        </div>
      </div>

      {/* Deal list */}
      {allDeals.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-base font-bold tracking-tight">All Deals</h2>
          <div className="space-y-2">
            {allDeals.map((event) => {
              const dealStatus = eventTypeToDealStatus(event.eventType);
              const cfg = DEAL_STATUS_CONFIG[dealStatus];
              const payload = event.payloadJson as Record<string, unknown> | null;
              const dealValue = typeof payload?.dealValue === 'number' ? payload.dealValue : null;
              const dealNotes = typeof payload?.notes === 'string' ? payload.notes : null;
              const leadName = leadNameMap.get(event.leadId) ?? event.leadId.slice(0, 12);

              return (
                <div
                  key={event.id}
                  className={cn(
                    'flex items-center gap-4 rounded-xl border px-4 py-3 transition-colors',
                    cfg.borderClass,
                    cfg.bgClass,
                  )}
                >
                  <div className={cn('h-2.5 w-2.5 shrink-0 rounded-full', cfg.dotColor)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{leadName}</p>
                    {dealNotes && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/50">
                        {dealNotes}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-muted-foreground/35">
                      {new Date(event.occurredAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {dealValue !== null && (
                      <span className="font-mono text-sm font-bold tabular-nums text-foreground/80">
                        ${dealValue.toLocaleString()}
                      </span>
                    )}
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider',
                        cfg.bgClass,
                        cfg.textClass,
                      )}
                    >
                      {dealStatus}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : dealWonEvents.isLoading || dealLostEvents.isLoading || meetingEvents.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading deals...
        </div>
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm font-bold text-foreground/80">No deals yet</p>
          <p className="mt-1 text-[11px] text-muted-foreground/50">
            Click &ldquo;Add Deal&rdquo; to record your first deal outcome.
          </p>
        </div>
      )}

      {/* Add Deal Modal */}
      {showAddModal && (
        <AddDealModal
          leads={leadOptions}
          onClose={() => setShowAddModal(false)}
          onSubmit={(data) => void handleAddDeal(data)}
          isSubmitting={isSubmitting}
          error={submitError}
        />
      )}
    </div>
  );
}

'use client';

import {
  AlertTriangle,
  Award,
  CheckCircle2,
  DollarSign,
  MessageSquare,
  Percent,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '../../../../src/components/ui/button.js';
import { Input } from '../../../../src/components/ui/input.js';
import { cn } from '../../../../src/lib/utils.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';
import { getSupabaseBrowserClient } from '../../../../src/lib/supabase-client.js';

// ── Types ────────────────────────────────────────────────────

interface DealLead {
  id: string;
  leadId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  icpName: string | null;
  eventType: 'DEAL_WON' | 'DEAL_LOST' | 'REPLIED';
  occurredAt: string;
  notes: string | null;
  dealValue: number | null;
  feedbackEventId: string | null;
}

interface DealStats {
  wonCount: number;
  lostCount: number;
  repliedCount: number;
  winRate: number;
  totalDealValue: number;
}

// ── Stat Card ────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  iconColor,
  subtext,
}: {
  label: string;
  value: string | number;
  icon: typeof Trophy;
  iconColor: string;
  subtext?: string | undefined;
}) {
  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/30 p-4">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', iconColor)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {label}
          </p>
          <p className="text-xl font-extrabold tabular-nums tracking-tight">{value}</p>
          {subtext ? (
            <p className="text-[11px] text-muted-foreground/50">{subtext}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Deal Row ─────────────────────────────────────────────────

function DealRow({
  deal,
  mode,
  onWon,
  onLost,
  onUpdateNotes,
  onUpdateDealValue,
}: {
  deal: DealLead;
  mode: 'won' | 'lost' | 'replied';
  onWon?: ((deal: DealLead) => void) | undefined;
  onLost?: ((deal: DealLead) => void) | undefined;
  onUpdateNotes?: ((deal: DealLead, notes: string) => void) | undefined;
  onUpdateDealValue?: ((deal: DealLead, value: number) => void) | undefined;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [editingValue, setEditingValue] = useState(false);
  const [notesValue, setNotesValue] = useState(deal.notes ?? '');
  const [dealValueInput, setDealValueInput] = useState(
    deal.dealValue !== null ? String(deal.dealValue) : '',
  );
  const [actionLoading, setActionLoading] = useState<'won' | 'lost' | null>(null);

  const statusColors = {
    won: 'border-zbooni-green/20 bg-zbooni-green/[0.03]',
    lost: 'border-red-400/10 bg-red-400/[0.02]',
    replied: 'border-yellow-400/10 bg-yellow-400/[0.02]',
  };

  function handleSaveNotes() {
    setEditingNotes(false);
    if (onUpdateNotes) onUpdateNotes(deal, notesValue);
  }

  function handleSaveDealValue() {
    setEditingValue(false);
    const parsed = Number.parseFloat(dealValueInput);
    if (onUpdateDealValue && Number.isFinite(parsed) && parsed >= 0) {
      onUpdateDealValue(deal, parsed);
    }
  }

  async function handleWon() {
    setActionLoading('won');
    try {
      if (onWon) onWon(deal);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleLost() {
    setActionLoading('lost');
    try {
      if (onLost) onLost(deal);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-4 transition-all duration-200',
        statusColors[mode],
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Lead info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-bold tracking-tight">
              {deal.companyName}
            </h4>
            {mode === 'won' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-zbooni-green/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zbooni-green">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Won
              </span>
            ) : null}
            {mode === 'lost' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-400">
                <XCircle className="h-2.5 w-2.5" />
                Lost
              </span>
            ) : null}
            {mode === 'replied' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-yellow-400">
                <MessageSquare className="h-2.5 w-2.5" />
                Replied
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground/60">
            {deal.contactName ? (
              <span>{deal.contactName}</span>
            ) : null}
            {deal.contactEmail ? (
              <span className="font-mono text-[11px]">{deal.contactEmail}</span>
            ) : null}
            {deal.icpName ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium">
                {deal.icpName}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/40">
            {new Date(deal.occurredAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>

        {/* Deal value */}
        <div className="flex items-center gap-2">
          {editingValue ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground/50">$</span>
              <Input
                value={dealValueInput}
                onChange={(e) => setDealValueInput(e.target.value)}
                className="h-7 w-24 text-right font-mono text-sm"
                placeholder="0.00"
                type="number"
                min={0}
                step={0.01}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveDealValue();
                  if (e.key === 'Escape') setEditingValue(false);
                }}
                autoFocus
              />
              <Button size="xs" variant="ghost" onClick={handleSaveDealValue}>
                Save
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingValue(true)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold tabular-nums transition-colors hover:bg-white/5"
              title="Click to edit deal value"
            >
              <DollarSign className="h-3.5 w-3.5 text-zbooni-green/60" />
              {deal.dealValue !== null ? (
                <span>{deal.dealValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
              ) : (
                <span className="text-muted-foreground/30">--</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="mt-3">
        {editingNotes ? (
          <div className="flex items-start gap-2">
            <Input
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              className="h-8 flex-1 text-xs"
              placeholder="Add notes about this deal..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNotes();
                if (e.key === 'Escape') setEditingNotes(false);
              }}
              autoFocus
            />
            <Button size="xs" variant="ghost" onClick={handleSaveNotes}>
              Save
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingNotes(true)}
            className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground/50 transition-colors hover:bg-white/5 hover:text-muted-foreground/70"
          >
            {deal.notes ? deal.notes : 'Click to add notes...'}
          </button>
        )}
      </div>

      {/* Won/Lost action buttons for replied leads */}
      {mode === 'replied' ? (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/20 pt-3">
          <Button
            size="xs"
            variant="ghost"
            className="text-red-400/70 hover:bg-red-400/10 hover:text-red-400"
            onClick={handleLost}
            disabled={actionLoading !== null}
          >
            <ThumbsDown className="h-3 w-3" />
            {actionLoading === 'lost' ? 'Saving...' : 'Lost'}
          </Button>
          <Button
            size="xs"
            className="bg-zbooni-green/15 text-zbooni-green hover:bg-zbooni-green/25"
            onClick={handleWon}
            disabled={actionLoading !== null}
          >
            <ThumbsUp className="h-3 w-3" />
            {actionLoading === 'won' ? 'Saving...' : 'Won'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── Data fetching ────────────────────────────────────────────

async function fetchDeals(): Promise<DealLead[]> {
  const supabase = getSupabaseBrowserClient();

  // Get leads that have DEAL_WON, DEAL_LOST, or REPLIED feedback events
  const { data: feedbackEvents, error } = await supabase
    .from('FeedbackEvent')
    .select('id, leadId, eventType, occurredAt, payloadJson')
    .in('eventType', ['DEAL_WON', 'DEAL_LOST', 'REPLIED'])
    .order('occurredAt', { ascending: false });

  if (error || !feedbackEvents) {
    console.error('Failed to fetch feedback events:', error);
    return [];
  }

  // Get unique lead IDs
  const leadIds = [...new Set(feedbackEvents.map((e: { leadId: string }) => e.leadId))];
  if (leadIds.length === 0) return [];

  // Fetch lead details
  const { data: leads, error: leadsError } = await supabase
    .from('Lead')
    .select('id, companyName, contactName, contactEmail')
    .in('id', leadIds);

  if (leadsError) {
    console.error('Failed to fetch leads:', leadsError);
    return [];
  }

  const leadMap = new Map(
    (leads ?? []).map((l: { id: string; companyName: string; contactName: string | null; contactEmail: string | null }) => [l.id, l]),
  );

  // Fetch ICP names for leads
  const { data: discoveryRecords } = await supabase
    .from('LeadDiscoveryRecord')
    .select('leadId, icpProfileId')
    .in('leadId', leadIds);

  const icpProfileIds = [...new Set((discoveryRecords ?? []).map((r: { icpProfileId: string }) => r.icpProfileId))];
  let icpNameMap = new Map<string, string>();
  if (icpProfileIds.length > 0) {
    const { data: icpProfiles } = await supabase
      .from('IcpProfile')
      .select('id, name')
      .in('id', icpProfileIds);
    icpNameMap = new Map((icpProfiles ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
  }

  const leadIcpMap = new Map<string, string | null>();
  for (const rec of discoveryRecords ?? []) {
    const typedRec = rec as { leadId: string; icpProfileId: string };
    if (!leadIcpMap.has(typedRec.leadId)) {
      leadIcpMap.set(typedRec.leadId, icpNameMap.get(typedRec.icpProfileId) ?? null);
    }
  }

  // For each lead, determine the highest-priority event type
  // Priority: DEAL_WON > DEAL_LOST > REPLIED
  const leadEventMap = new Map<string, { eventType: string; occurredAt: string; id: string; payloadJson: unknown }>();

  const priorityOrder: Record<string, number> = { DEAL_WON: 3, DEAL_LOST: 2, REPLIED: 1 };

  for (const event of feedbackEvents) {
    const typedEvent = event as { id: string; leadId: string; eventType: string; occurredAt: string; payloadJson: unknown };
    const existing = leadEventMap.get(typedEvent.leadId);
    const eventPriority = priorityOrder[typedEvent.eventType] ?? 0;
    const existingPriority = existing ? (priorityOrder[existing.eventType] ?? 0) : 0;

    if (!existing || eventPriority > existingPriority) {
      leadEventMap.set(typedEvent.leadId, typedEvent);
    }
  }

  const deals: DealLead[] = [];
  for (const [leadId, event] of leadEventMap) {
    const lead = leadMap.get(leadId) as { id: string; companyName: string; contactName: string | null; contactEmail: string | null } | undefined;
    if (!lead) continue;

    const payload = event.payloadJson as { notes?: string; dealValue?: number } | null;

    deals.push({
      id: `${event.id}`,
      leadId,
      companyName: lead.companyName,
      contactName: lead.contactName,
      contactEmail: lead.contactEmail,
      icpName: leadIcpMap.get(leadId) ?? null,
      eventType: event.eventType as DealLead['eventType'],
      occurredAt: event.occurredAt,
      notes: payload?.notes ?? null,
      dealValue: payload?.dealValue ?? null,
      feedbackEventId: event.id,
    });
  }

  return deals;
}

// ── Main Page ────────────────────────────────────────────────

export default function DealsPage() {
  const { token } = useAuth();
  const [deals, setDeals] = useState<DealLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'won' | 'lost' | 'replied'>('all');

  const loadDeals = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchDeals();
      setDeals(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deals');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  // Computed stats
  const stats: DealStats = useMemo(() => {
    const wonDeals = deals.filter((d) => d.eventType === 'DEAL_WON');
    const lostDeals = deals.filter((d) => d.eventType === 'DEAL_LOST');
    const repliedDeals = deals.filter((d) => d.eventType === 'REPLIED');
    const decidedCount = wonDeals.length + lostDeals.length;

    return {
      wonCount: wonDeals.length,
      lostCount: lostDeals.length,
      repliedCount: repliedDeals.length,
      winRate: decidedCount > 0 ? Math.round((wonDeals.length / decidedCount) * 100) : 0,
      totalDealValue: wonDeals.reduce((sum, d) => sum + (d.dealValue ?? 0), 0),
    };
  }, [deals]);

  // Filtered deals based on active tab
  const filteredDeals = useMemo(() => {
    if (activeTab === 'all') return deals;
    if (activeTab === 'won') return deals.filter((d) => d.eventType === 'DEAL_WON');
    if (activeTab === 'lost') return deals.filter((d) => d.eventType === 'DEAL_LOST');
    return deals.filter((d) => d.eventType === 'REPLIED');
  }, [deals, activeTab]);

  // Create a feedback event via the API
  async function createFeedbackEvent(
    leadId: string,
    eventType: 'DEAL_WON' | 'DEAL_LOST',
    payload?: { notes?: string; dealValue?: number },
  ) {
    const baseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:5050';
    const response = await fetch(`${baseUrl}/v1/feedback/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        leadId,
        eventType,
        source: 'MANUAL',
        occurredAt: new Date().toISOString(),
        ...(payload ? { payloadJson: payload } : {}),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create feedback event: ${text}`);
    }

    return response.json();
  }

  async function handleWon(deal: DealLead) {
    try {
      await createFeedbackEvent(deal.leadId, 'DEAL_WON');
      // Optimistic update: move the deal to Won
      setDeals((prev) =>
        prev.map((d) =>
          d.leadId === deal.leadId ? { ...d, eventType: 'DEAL_WON' as const } : d,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark deal as won');
    }
  }

  async function handleLost(deal: DealLead) {
    try {
      await createFeedbackEvent(deal.leadId, 'DEAL_LOST');
      // Optimistic update: move the deal to Lost
      setDeals((prev) =>
        prev.map((d) =>
          d.leadId === deal.leadId ? { ...d, eventType: 'DEAL_LOST' as const } : d,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark deal as lost');
    }
  }

  function handleUpdateNotes(deal: DealLead, notes: string) {
    // Optimistic local update (notes are stored in payloadJson but we don't persist to API here
    // since we'd need a PATCH endpoint — for now, update locally)
    setDeals((prev) =>
      prev.map((d) => (d.leadId === deal.leadId ? { ...d, notes } : d)),
    );
  }

  function handleUpdateDealValue(deal: DealLead, value: number) {
    setDeals((prev) =>
      prev.map((d) => (d.leadId === deal.leadId ? { ...d, dealValue: value } : d)),
    );
  }

  const tabs = [
    { key: 'all' as const, label: 'All', count: deals.length },
    { key: 'won' as const, label: 'Won', count: stats.wonCount },
    { key: 'lost' as const, label: 'Lost', count: stats.lostCount },
    { key: 'replied' as const, label: 'Replied', count: stats.repliedCount },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Deals</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Track deal outcomes from your outreach pipeline — mark leads as won or lost, add notes and deal values
        </p>
      </div>

      {/* Error */}
      {error ? (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
          <button
            type="button"
            className="ml-auto text-xs underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Deals Won"
          value={stats.wonCount}
          icon={Trophy}
          iconColor="bg-zbooni-green/10 text-zbooni-green"
        />
        <StatCard
          label="Deals Lost"
          value={stats.lostCount}
          icon={XCircle}
          iconColor="bg-red-500/10 text-red-400"
        />
        <StatCard
          label="Win Rate"
          value={`${stats.winRate}%`}
          icon={Percent}
          iconColor="bg-blue-500/10 text-blue-400"
          subtext={`${stats.wonCount + stats.lostCount} decided`}
        />
        <StatCard
          label="Total Value"
          value={`$${stats.totalDealValue.toLocaleString()}`}
          icon={DollarSign}
          iconColor="bg-yellow-500/10 text-yellow-400"
          subtext="from won deals"
        />
        <StatCard
          label="Awaiting Decision"
          value={stats.repliedCount}
          icon={Award}
          iconColor="bg-purple-500/10 text-purple-400"
          subtext="replied leads"
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl bg-zbooni-dark/30 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all',
              activeTab === tab.key
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
            )}
          >
            {tab.label}
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                activeTab === tab.key
                  ? 'bg-white/10 text-inherit'
                  : 'bg-muted/10 text-muted-foreground/50',
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-border/30 bg-zbooni-dark/30 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-5 w-40 rounded bg-muted-foreground/10" />
                <div className="h-4 w-16 rounded-full bg-muted-foreground/10" />
              </div>
              <div className="mt-2 h-3 w-64 rounded bg-muted-foreground/8" />
              <div className="mt-3 h-8 w-full rounded bg-muted-foreground/5" />
            </div>
          ))}
        </div>
      ) : null}

      {/* Empty state */}
      {!isLoading && filteredDeals.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-12 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zbooni-teal/10">
            <Trophy className="h-7 w-7 text-zbooni-teal/60" />
          </div>
          <h3 className="mt-4 text-base font-bold tracking-tight">
            {activeTab === 'all'
              ? 'No deals yet'
              : activeTab === 'replied'
                ? 'No replied leads awaiting decisions'
                : `No ${activeTab} deals`}
          </h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground/60">
            {activeTab === 'all'
              ? 'When leads reply to outreach or deals are marked as won/lost, they will appear here. Start by running a discovery and sending messages.'
              : activeTab === 'replied'
                ? 'When leads reply to your outreach, they will appear here for you to mark as won or lost.'
                : `When you mark deals as ${activeTab}, they will appear in this section.`}
          </p>
        </div>
      ) : null}

      {/* Deal cards */}
      {!isLoading && filteredDeals.length > 0 ? (
        <div className="space-y-3">
          {filteredDeals.map((deal) => (
            <DealRow
              key={deal.id}
              deal={deal}
              mode={
                deal.eventType === 'DEAL_WON'
                  ? 'won'
                  : deal.eventType === 'DEAL_LOST'
                    ? 'lost'
                    : 'replied'
              }
              onWon={deal.eventType === 'REPLIED' ? handleWon : undefined}
              onLost={deal.eventType === 'REPLIED' ? handleLost : undefined}
              onUpdateNotes={handleUpdateNotes}
              onUpdateDealValue={handleUpdateDealValue}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

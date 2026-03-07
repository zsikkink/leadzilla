'use client';

import type { LeadScoreBand, LeadStatus } from '@lead-flood/contracts';
import { Building2, Eye, Loader2, MessageSquare, Phone, ShieldX, Undo2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CustomSelect } from '../../../src/components/custom-select.js';
import { LeadStatusBadge } from '../../../src/components/lead-status-badge.js';
import { ScoreBandBadge } from '../../../src/components/score-band-badge.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';
import { getWebEnv } from '../../../src/lib/env.js';
import { getSupabaseBrowserClient } from '../../../src/lib/supabase-client.js';
import { cn } from '../../../src/lib/utils.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'processing', label: 'Processing' },
  { value: 'enriched', label: 'Enriched' },
  { value: 'scored', label: 'Scored' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'messaged', label: 'Messaged' },
  { value: 'replied', label: 'Replied' },
  { value: 'cold', label: 'Cold' },
  { value: 'stuck', label: 'Stuck' },
  { value: 'failed', label: 'Failed' },
];

const SCORE_OPTIONS = [
  { value: '', label: 'All scores' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per page' },
  { value: '20', label: '20 per page' },
  { value: '30', label: '30 per page' },
  { value: '40', label: '40 per page' },
  { value: '50', label: '50 per page' },
];

// ── Extract blended score from enrichment data ──────────
function extractBlendedScore(enrichmentData: unknown): number | null {
  if (!enrichmentData || typeof enrichmentData !== 'object') return null;
  const data = enrichmentData as Record<string, unknown>;

  // Try _scoreInfo.blendedScore first
  if (data._scoreInfo && typeof data._scoreInfo === 'object') {
    const scoreInfo = data._scoreInfo as Record<string, unknown>;
    if (typeof scoreInfo.blendedScore === 'number') {
      return scoreInfo.blendedScore;
    }
  }

  // Try top-level blendedScore
  if (typeof data.blendedScore === 'number') {
    return data.blendedScore;
  }

  return null;
}

// ── Extract phone from enrichment data ──────────────────
function extractPhone(enrichmentData: unknown): string | null {
  if (!enrichmentData || typeof enrichmentData !== 'object') return null;
  const data = enrichmentData as Record<string, unknown>;

  // Try nested phone fields
  if (typeof data.phone === 'string' && data.phone.length > 0) return data.phone;
  if (typeof data.phoneNumber === 'string' && data.phoneNumber.length > 0) return data.phoneNumber;

  // Try normalized payload
  if (data.normalized && typeof data.normalized === 'object') {
    const norm = data.normalized as Record<string, unknown>;
    if (typeof norm.phone === 'string' && norm.phone.length > 0) return norm.phone;
  }

  return null;
}

// ── Reason badge colors ─────────────────────────────────
const REASON_COLORS: Record<string, string> = {
  MANUAL: 'bg-muted-foreground/15 text-muted-foreground',
  WRONG_INDUSTRY: 'bg-yellow-500/15 text-yellow-400',
  WRONG_COUNTRY: 'bg-orange-500/15 text-orange-400',
  DUPLICATE_DOMAIN: 'bg-purple-500/15 text-purple-400',
  UNVERIFIED_CONTACT: 'bg-red-500/15 text-red-400',
  BELOW_THRESHOLD: 'bg-red-500/15 text-red-400',
  NO_DECISION_MAKER: 'bg-yellow-500/15 text-yellow-400',
};

type Tab = 'active' | 'rejected';

interface RejectedLeadRow {
  id: string;
  leadId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  reason: string;
  score: number | null;
  rejectedAt: string;
}

export default function LeadsPage() {
  const { apiClient, token } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | undefined>(undefined);
  const [scoreBandFilter, setScoreBandFilter] = useState<LeadScoreBand | undefined>(undefined);
  const [showAllLeads, setShowAllLeads] = useState(false);
  const [qualificationThreshold, setQualificationThreshold] = useState<number | null>(null);
  const [generatingForLead, setGeneratingForLead] = useState<string | null>(null);
  const [rejectingLead, setRejectingLead] = useState<string | null>(null);

  // Rejected leads state (loaded via Supabase)
  const [rejectedLeads, setRejectedLeads] = useState<RejectedLeadRow[]>([]);
  const [rejectedLoading, setRejectedLoading] = useState(false);
  const [unrejectingLead, setUnrejectingLead] = useState<string | null>(null);

  // Load qualification threshold from pipeline settings
  useEffect(() => {
    apiClient
      .listPipelineSettings()
      .then(({ items }) => {
        const setting = items.find((i) => i.key === 'scoreQualificationThreshold');
        if (setting && typeof setting.value === 'number') {
          setQualificationThreshold(setting.value);
        } else {
          setQualificationThreshold(0.5); // default
        }
      })
      .catch(() => {
        setQualificationThreshold(0.5); // fallback
      });
  }, [apiClient]);

  // Build the API query with score filter
  const leads = useApiQuery(
    useCallback(
      () =>
        apiClient.listLeads({
          page,
          pageSize,
          includeQualityMetrics: false,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(scoreBandFilter ? { scoreBand: scoreBandFilter } : {}),
          // When "show all" is OFF and we have a threshold, filter by score
          ...(!showAllLeads && qualificationThreshold !== null ? { minBlendedScore: qualificationThreshold } : {}),
        }),
      [apiClient, page, pageSize, statusFilter, scoreBandFilter, showAllLeads, qualificationThreshold],
    ),
    [page, pageSize, statusFilter, scoreBandFilter, showAllLeads, qualificationThreshold],
  );

  const totalPages = leads.data ? Math.ceil(leads.data.total / leads.data.pageSize) : 0;

  // Load rejected leads via Supabase when tab is "rejected"
  useEffect(() => {
    if (activeTab !== 'rejected') return;
    let cancelled = false;
    setRejectedLoading(true);

    async function loadRejected() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from('lead_rejections')
          .select('id, leadId:leadId, reason, score, rejectedAt:rejectedAt')
          .order('rejectedAt', { ascending: false })
          .limit(100);

        if (cancelled || error) {
          if (error) toast.error('Failed to load rejected leads');
          return;
        }

        // Now fetch lead details for each rejection
        const leadIds = (data ?? []).map((r: { leadId: string }) => r.leadId);
        if (leadIds.length === 0) {
          setRejectedLeads([]);
          return;
        }

        const { data: leadRows } = await supabase
          .from('Lead')
          .select('id, firstName, lastName, email')
          .in('id', leadIds);

        const leadMap = new Map<string, { firstName: string | null; lastName: string | null; email: string }>();
        for (const l of leadRows ?? []) {
          leadMap.set(l.id as string, {
            firstName: l.firstName as string | null,
            lastName: l.lastName as string | null,
            email: l.email as string,
          });
        }

        if (!cancelled) {
          setRejectedLeads(
            (data ?? []).map((r: { id: string; leadId: string; reason: string; score: number | null; rejectedAt: string }) => {
              const lead = leadMap.get(r.leadId);
              return {
                id: r.id,
                leadId: r.leadId,
                firstName: lead?.firstName ?? null,
                lastName: lead?.lastName ?? null,
                email: lead?.email ?? '',
                reason: r.reason,
                score: r.score,
                rejectedAt: r.rejectedAt,
              };
            }),
          );
        }
      } catch {
        if (!cancelled) toast.error('Failed to load rejected leads');
      } finally {
        if (!cancelled) setRejectedLoading(false);
      }
    }

    void loadRejected();
    return () => { cancelled = true; };
  }, [activeTab]);

  const handleReject = async (leadId: string, firstName: string, lastName: string) => {
    const confirmed = window.confirm(`Reject lead "${firstName} ${lastName}"? They will be moved to the Rejected tab.`);
    if (!confirmed) return;

    setRejectingLead(leadId);
    try {
      const baseUrl = getWebEnv().NEXT_PUBLIC_API_BASE_URL;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}/v1/leads/${leadId}/reject`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ reason: 'MANUAL' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Reject failed (${res.status})`);
      }
      toast.success(`${firstName} ${lastName} rejected`);
      leads.refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject lead');
    } finally {
      setRejectingLead(null);
    }
  };

  const handleUnreject = async (leadId: string, firstName: string | null, lastName: string | null) => {
    setUnrejectingLead(leadId);
    try {
      const baseUrl = getWebEnv().NEXT_PUBLIC_API_BASE_URL;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}/v1/leads/${leadId}/unreject`, {
        method: 'PATCH',
        headers,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Unreject failed (${res.status})`);
      }
      toast.success(`${firstName ?? ''} ${lastName ?? ''} restored`);
      setRejectedLeads((prev) => prev.filter((r) => r.leadId !== leadId));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore lead');
    } finally {
      setUnrejectingLead(null);
    }
  };

  const handleGenerateMessage = async (leadId: string, icpProfileId: string, firstName: string, scorePredictionId: string | null) => {
    setGeneratingForLead(leadId);
    try {
      await apiClient.generateDraft({
        leadId,
        icpProfileId,
        ...(scorePredictionId ? { scorePredictionId } : {}),
        promptVersion: 'v2',
      });
      toast.success(`Message draft generated for ${firstName}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate message');
    } finally {
      setGeneratingForLead(null);
    }
  };

  return (
    <div className="flex h-full flex-col space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Leads</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {leads.data ? `${leads.data.total} total leads` : 'Loading...'}
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-0.5 border-b border-border/30">
        <button
          type="button"
          onClick={() => { setActiveTab('active'); setPage(1); }}
          className={cn(
            'relative px-4 py-2.5 text-sm font-semibold transition-colors',
            activeTab === 'active'
              ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-zbooni-teal'
              : 'text-muted-foreground/60 hover:text-foreground',
          )}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('rejected')}
          className={cn(
            'relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors',
            activeTab === 'rejected'
              ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-red-400'
              : 'text-muted-foreground/60 hover:text-foreground',
          )}
        >
          <ShieldX className="h-3.5 w-3.5" />
          Rejected
        </button>
        <button
          type="button"
          onClick={() => router.push('/dashboard/leads/businesses')}
          className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <Building2 className="h-3.5 w-3.5" />
          Business Intel
        </button>
      </div>

      {/* ────── Active tab ────── */}
      {activeTab === 'active' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <CustomSelect
              value={statusFilter ?? ''}
              onChange={(v) => {
                setStatusFilter((v || undefined) as LeadStatus | undefined);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              placeholder="All statuses"
            />
            <CustomSelect
              value={scoreBandFilter ?? ''}
              onChange={(v) => {
                setScoreBandFilter((v || undefined) as LeadScoreBand | undefined);
                setPage(1);
              }}
              options={SCORE_OPTIONS}
              placeholder="All scores"
            />

            {/* Show all leads toggle (E9) */}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/40 bg-zbooni-dark/30 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-border/60 hover:text-foreground">
              <input
                type="checkbox"
                checked={showAllLeads}
                onChange={(e) => {
                  setShowAllLeads(e.target.checked);
                  setPage(1);
                }}
                className="h-3.5 w-3.5 rounded border-border/50 accent-zbooni-teal"
              />
              Show all leads
              {!showAllLeads && qualificationThreshold !== null && (
                <span className="text-[10px] text-muted-foreground/40">
                  (score &ge; {(qualificationThreshold * 100).toFixed(0)})
                </span>
              )}
            </label>

            <div className="ml-auto">
              <CustomSelect
                value={String(pageSize)}
                onChange={(v) => {
                  setPageSize(parseInt(v, 10) || 20);
                  setPage(1);
                }}
                options={PAGE_SIZE_OPTIONS}
                placeholder="20 per page"
              />
            </div>
          </div>

          {leads.error ? (
            <p className="text-sm text-destructive">{leads.error}</p>
          ) : null}

          {/* Table */}
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
            <div className="max-h-[calc(100vh-320px)] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-border/50 bg-card text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
                    <th className="hidden px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground xl:table-cell">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        Phone
                      </span>
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Band</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Score</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Created</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(leads.data?.items ?? []).map((lead) => {
                    const enrichmentRaw = lead.latestEnrichmentNormalizedPayload ?? lead.latestEnrichmentRawPayload;
                    const blendedScore = lead.latestBlendedScore ?? extractBlendedScore(enrichmentRaw);
                    const phone = extractPhone(enrichmentRaw);

                    return (
                      <tr
                        key={lead.id}
                        className="border-b border-border/30 transition-colors last:border-0 hover:bg-accent/50"
                      >
                        <td
                          className="cursor-pointer px-4 py-3 font-medium"
                          onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                        >
                          {lead.firstName} {lead.lastName}
                        </td>
                        <td
                          className="cursor-pointer px-4 py-3 text-muted-foreground"
                          onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                        >
                          {lead.email}
                        </td>
                        <td className="hidden px-4 py-3 xl:table-cell">
                          {phone ? (
                            <span className="font-mono text-xs text-muted-foreground">{phone}</span>
                          ) : (
                            <span className="text-muted-foreground/30">&mdash;</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <LeadStatusBadge status={lead.status} />
                        </td>
                        <td className="px-4 py-3">
                          {lead.latestScoreBand ? (
                            <ScoreBandBadge band={lead.latestScoreBand} />
                          ) : (
                            <span className="text-muted-foreground/40">&mdash;</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {blendedScore !== null ? (
                            <span
                              className={cn(
                                'font-mono text-sm font-bold tabular-nums',
                                blendedScore >= 0.7
                                  ? 'text-zbooni-green'
                                  : blendedScore >= 0.4
                                    ? 'text-yellow-400'
                                    : 'text-red-400',
                              )}
                            >
                              {(blendedScore * 100).toFixed(0)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">&mdash;</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(lead.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                              title="View details"
                              className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-accent/50 hover:text-foreground"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            {(() => {
                              const isAboveThreshold = qualificationThreshold !== null
                                && blendedScore !== null
                                && blendedScore >= qualificationThreshold;
                              const isBelowThreshold = qualificationThreshold !== null
                                && (blendedScore === null || blendedScore < qualificationThreshold);
                              const isActionable = lead.status === 'enriched' || lead.status === 'new' || lead.status === 'scored';

                              if (isAboveThreshold || !isActionable) return null;

                              return (
                                <>
                                  {isBelowThreshold && lead.latestIcpProfileId ? (
                                    <button
                                      type="button"
                                      title="Generate message draft"
                                      disabled={generatingForLead === lead.id}
                                      className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-zbooni-teal/15 hover:text-zbooni-teal disabled:opacity-50"
                                      onClick={() => handleGenerateMessage(lead.id, lead.latestIcpProfileId!, lead.firstName ?? '', lead.latestScorePredictionId ?? null)}
                                    >
                                      {generatingForLead === lead.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <MessageSquare className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    title="Reject lead"
                                    disabled={rejectingLead === lead.id}
                                    className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-red-500/15 hover:text-red-400 disabled:opacity-50"
                                    onClick={() => handleReject(lead.id, lead.firstName ?? '', lead.lastName ?? '')}
                                  >
                                    {rejectingLead === lead.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <X className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {leads.isLoading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
                          Loading leads...
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {!leads.isLoading && (leads.data?.items ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        No leads found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            {leads.data ? (
              <div className="flex items-center justify-between border-t border-border/50 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {Math.min((leads.data.page - 1) * leads.data.pageSize + 1, leads.data.total)}
                  &ndash;
                  {Math.min(leads.data.page * leads.data.pageSize, leads.data.total)} of{' '}
                  {leads.data.total} leads
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    aria-label="Previous page"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 text-sm transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-30"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="inline-flex h-9 items-center px-2 text-xs text-muted-foreground">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                    aria-label="Next page"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 text-sm transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-30"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* ────── Rejected tab ────── */}
      {activeTab === 'rejected' && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
          <div className="max-h-[calc(100vh-280px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border/50 bg-card text-left">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reason</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Score</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rejected</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rejectedLeads.map((rl) => (
                  <tr key={rl.id} className="border-b border-border/30 transition-colors last:border-0 hover:bg-accent/50">
                    <td
                      className="cursor-pointer px-4 py-3 font-medium"
                      onClick={() => router.push(`/dashboard/leads/${rl.leadId}`)}
                    >
                      {[rl.firstName, rl.lastName].filter(Boolean).join(' ') || 'Unknown'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{rl.email || '\u2014'}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        REASON_COLORS[rl.reason] ?? 'bg-muted/20 text-muted-foreground',
                      )}>
                        {rl.reason.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rl.score !== null ? (
                        <span className="font-mono text-sm font-bold tabular-nums text-red-400">
                          {(rl.score * 100).toFixed(0)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(rl.rejectedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => router.push(`/dashboard/leads/${rl.leadId}`)}
                          title="View details"
                          className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-accent/50 hover:text-foreground"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Restore lead"
                          disabled={unrejectingLead === rl.leadId}
                          onClick={() => handleUnreject(rl.leadId, rl.firstName, rl.lastName)}
                          className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-zbooni-green/15 hover:text-zbooni-green disabled:opacity-50"
                        >
                          {unrejectingLead === rl.leadId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Undo2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rejectedLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
                        Loading rejected leads...
                      </div>
                    </td>
                  </tr>
                ) : null}
                {!rejectedLoading && rejectedLeads.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No rejected leads.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

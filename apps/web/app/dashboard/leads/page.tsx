'use client';

import type { LeadScoreBand, LeadStatus } from '@lead-flood/contracts';
import { Building2, Eye, Loader2, MessageSquare, Phone, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CustomSelect } from '../../../src/components/custom-select.js';
import { LeadStatusBadge } from '../../../src/components/lead-status-badge.js';
import { ScoreBandBadge } from '../../../src/components/score-band-badge.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';
import { cn } from '../../../src/lib/utils.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'processing', label: 'Processing' },
  { value: 'enriched', label: 'Enriched' },
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

export default function LeadsPage() {
  const { apiClient } = useAuth();
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | undefined>(undefined);
  const [scoreBandFilter, setScoreBandFilter] = useState<LeadScoreBand | undefined>(undefined);
  const [rejectedLeadIds, setRejectedLeadIds] = useState<Set<string>>(new Set());
  const [qualificationThreshold, setQualificationThreshold] = useState<number | null>(null);
  const [generatingForLead, setGeneratingForLead] = useState<string | null>(null);

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

  const leads = useApiQuery(
    useCallback(
      () =>
        apiClient.listLeads({
          page,
          pageSize,
          includeQualityMetrics: false,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(scoreBandFilter ? { scoreBand: scoreBandFilter } : {}),
        }),
      [apiClient, page, pageSize, statusFilter, scoreBandFilter],
    ),
    [page, pageSize, statusFilter, scoreBandFilter],
  );

  const displayedItems = leads.data?.items.filter((l) => !rejectedLeadIds.has(l.id)) ?? [];
  const totalPages = leads.data ? Math.ceil(leads.data.total / leads.data.pageSize) : 0;

  const handleReject = (leadId: string, firstName: string, lastName: string) => {
    const confirmed = window.confirm(`Reject lead "${firstName} ${lastName}"? They will be hidden from this list.`);
    if (!confirmed) return;

    setRejectedLeadIds((prev) => {
      const next = new Set(prev);
      next.add(leadId);
      return next;
    });

    toast('Lead rejected', {
      description: `${firstName} ${lastName} removed from list`,
      action: {
        label: 'Undo',
        onClick: () =>
          setRejectedLeadIds((prev) => {
            const next = new Set(prev);
            next.delete(leadId);
            return next;
          }),
      },
    });
  };

  const handleGenerateMessage = async (leadId: string, icpProfileId: string, firstName: string) => {
    setGeneratingForLead(leadId);
    try {
      await apiClient.generateDraft({
        leadId,
        icpProfileId,
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
          className="relative px-4 py-2.5 text-sm font-semibold text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-zbooni-teal"
        >
          Leads
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

      {/* Table with scrollable content */}
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
              {displayedItems.map((lead) => {
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
                          // Leads above qualification threshold already had messages auto-generated
                          const isAboveThreshold = qualificationThreshold !== null
                            && blendedScore !== null
                            && blendedScore >= qualificationThreshold;
                          const isBelowThreshold = qualificationThreshold !== null
                            && (blendedScore === null || blendedScore < qualificationThreshold);
                          const isActionable = lead.status === 'enriched' || lead.status === 'new';

                          if (isAboveThreshold || !isActionable) return null;

                          return (
                            <>
                              {isBelowThreshold && lead.latestIcpProfileId ? (
                                <button
                                  type="button"
                                  title="Generate message draft"
                                  disabled={generatingForLead === lead.id}
                                  className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-zbooni-teal/15 hover:text-zbooni-teal disabled:opacity-50"
                                  onClick={() => handleGenerateMessage(lead.id, lead.latestIcpProfileId!, lead.firstName ?? '')}
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
                                className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-red-500/15 hover:text-red-400"
                                onClick={() => handleReject(lead.id, lead.firstName ?? '', lead.lastName ?? '')}
                              >
                                <X className="h-3.5 w-3.5" />
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
              {!leads.isLoading && displayedItems.length === 0 ? (
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
    </div>
  );
}

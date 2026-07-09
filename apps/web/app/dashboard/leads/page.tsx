'use client';

import type { LeadDisplayScoreSource, LeadListSortBy, LeadScoreBand, LeadStatus } from '@lead-flood/contracts';
import { AlertTriangle, Loader2, MessageSquare, RefreshCw, Undo2, UserPlus, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmModal, useConfirmModal } from '../../../src/components/confirm-modal.js';
import { CustomSelect } from '../../../src/components/custom-select.js';
import { LeadsNav } from '../../../src/components/leads-nav.js';
import { LeadStatusBadge } from '../../../src/components/lead-status-badge.js';
import { ScoreBandBadge } from '../../../src/components/score-band-badge.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';
import { getWebEnv } from '../../../src/lib/env.js';
import {
  parseScoreQualificationThreshold,
} from '../../../src/lib/lead-draft-gating.js';
import { cn } from '../../../src/lib/utils.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'drafted', label: 'Drafted' },
  { value: 'messaged', label: 'Messaged' },
  { value: 'replied', label: 'Replied' },
  { value: 'cold', label: 'Cold' },
  { value: 'failed', label: 'Failed' },
];

const SCORE_OPTIONS = [
  { value: '', label: 'All scores' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'score_desc', label: 'Score high to low' },
  { value: 'score_asc', label: 'Score low to high' },
];

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per page' },
  { value: '20', label: '20 per page' },
  { value: '30', label: '30 per page' },
  { value: '40', label: '40 per page' },
  { value: '50', label: '50 per page' },
];

const SCORE_SOURCE_LABELS: Record<LeadDisplayScoreSource, string> = {
  AI_SCORE: 'AI',
  LEGACY_SCORE: 'Legacy',
  BUSINESS_SCORE: 'Business',
  NONE: '',
};

function buildInboxDraftHref(leadId: string, draftId?: string | null, pollDraft = false): string {
  const params = new URLSearchParams({ leadId });
  if (draftId) {
    params.set('draftId', draftId);
  }
  if (pollDraft) {
    params.set('pollDraft', '1');
  }
  return `/dashboard/inbox?${params.toString()}`;
}

// ── Extract legacy score from enrichment data ──────────
function extractLegacyScore(enrichmentData: unknown): number | null {
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

// ── Extract company name from enrichment data ────────────
function extractCompanyName(enrichmentData: unknown): string | null {
  if (!enrichmentData || typeof enrichmentData !== 'object') return null;
  const data = enrichmentData as Record<string, unknown>;

  // Try all known key variations
  for (const key of ['companyName', 'company_name', 'organization_name', 'company']) {
    if (typeof data[key] === 'string' && data[key].length > 0) return data[key];
  }
  return null;
}

// ── A2: Extract position/title from enrichment data ───────
function extractPosition(enrichmentData: unknown): string | null {
  if (!enrichmentData || typeof enrichmentData !== 'object') return null;
  const data = enrichmentData as Record<string, unknown>;

  for (const key of ['title', 'job_title', 'position']) {
    if (typeof data[key] === 'string' && data[key].length > 0) return data[key];
  }
  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return 'unknown error';
}

// ── Reason badge colors ─────────────────────────────────
const REASON_COLORS: Record<string, string> = {
  MANUAL: 'bg-muted-foreground/15 text-muted-foreground',
  WRONG_INDUSTRY: 'bg-yellow-500/15 text-yellow-400',
  WRONG_COUNTRY: 'bg-orange-500/15 text-orange-400',
  DUPLICATE_DOMAIN: 'bg-purple-500/15 text-purple-400',
  UNVERIFIED_CONTACT: 'bg-red-500/15 text-red-400',
  BELOW_THRESHOLD: 'bg-red-500/15 text-red-400',
  HARD_FILTER_FAILED: 'bg-red-500/15 text-red-400',
  NO_DECISION_MAKER: 'bg-yellow-500/15 text-yellow-400',
};

type Tab = 'active' | 'rejected';

interface RejectedLeadRow {
  id: string;
  leadId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  companyName: string | null;
  icpProfileName: string | null;
  reason: string;
  reasonDetails: string[];
  score: number | null;
  rejectedAt: string;
  businessName: string | null;
  websiteDomain: string | null;
  category: string | null;
  city: string | null;
  country: string | null;
}

interface LeadsTableState {
  page: number;
  pageSize: number;
  statusFilter: LeadStatus | null;
  scoreBandFilter: LeadScoreBand | null;
  sortBy: LeadListSortBy;
  searchQuery: string;
}

const LEADS_TABLE_STATE_STORAGE_KEY = 'lead-flood:leads-table-state:v1';

const DEFAULT_LEADS_TABLE_STATE: LeadsTableState = {
  page: 1,
  pageSize: 20,
  statusFilter: null,
  scoreBandFilter: null,
  sortBy: 'score_desc',
  searchQuery: '',
};

const VALID_STATUS_FILTERS = new Set(STATUS_OPTIONS.map((option) => option.value).filter(Boolean));
const VALID_SCORE_FILTERS = new Set(SCORE_OPTIONS.map((option) => option.value).filter(Boolean));
const VALID_SORTS = new Set(SORT_OPTIONS.map((option) => option.value));
const VALID_PAGE_SIZES = new Set(PAGE_SIZE_OPTIONS.map((option) => Number.parseInt(option.value, 10)));

function readPositiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readPersistedLeadsTableState(): LeadsTableState {
  if (typeof window === 'undefined') return DEFAULT_LEADS_TABLE_STATE;

  try {
    const raw = window.sessionStorage.getItem(LEADS_TABLE_STATE_STORAGE_KEY);
    if (!raw) return DEFAULT_LEADS_TABLE_STATE;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_LEADS_TABLE_STATE;
    }

    const record = parsed as Record<string, unknown>;
    const pageSize = readPositiveInteger(record.pageSize, DEFAULT_LEADS_TABLE_STATE.pageSize);
    const sortBy = typeof record.sortBy === 'string' && VALID_SORTS.has(record.sortBy)
      ? record.sortBy as LeadListSortBy
      : DEFAULT_LEADS_TABLE_STATE.sortBy;

    return {
      page: readPositiveInteger(record.page, DEFAULT_LEADS_TABLE_STATE.page),
      pageSize: VALID_PAGE_SIZES.has(pageSize) ? pageSize : DEFAULT_LEADS_TABLE_STATE.pageSize,
      statusFilter: typeof record.statusFilter === 'string' && VALID_STATUS_FILTERS.has(record.statusFilter)
        ? record.statusFilter as LeadStatus
        : null,
      scoreBandFilter: typeof record.scoreBandFilter === 'string' && VALID_SCORE_FILTERS.has(record.scoreBandFilter)
        ? record.scoreBandFilter as LeadScoreBand
        : null,
      sortBy,
      searchQuery: typeof record.searchQuery === 'string' ? record.searchQuery : DEFAULT_LEADS_TABLE_STATE.searchQuery,
    };
  } catch {
    return DEFAULT_LEADS_TABLE_STATE;
  }
}

function persistLeadsTableState(state: LeadsTableState): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(LEADS_TABLE_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; the table can still operate with in-memory state.
  }
}

export default function LeadsPage() {
  const { apiClient, token, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialTableState] = useState(() => readPersistedLeadsTableState());

  const [activeTab, setActiveTab] = useState<Tab>('active');
  const [page, setPage] = useState(initialTableState.page);
  const [pageSize, setPageSize] = useState(initialTableState.pageSize);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | undefined>(initialTableState.statusFilter ?? undefined);
  const [scoreBandFilter, setScoreBandFilter] = useState<LeadScoreBand | undefined>(initialTableState.scoreBandFilter ?? undefined);
  const [sortBy, setSortBy] = useState<LeadListSortBy>(initialTableState.sortBy);
  const [qualificationThreshold, setQualificationThreshold] = useState<number | null>(null);
  const [isQualificationThresholdLoading, setIsQualificationThresholdLoading] = useState(true);
  const [qualificationThresholdError, setQualificationThresholdError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialTableState.searchQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(initialTableState.searchQuery);
  const [generatingForLead, setGeneratingForLead] = useState<string | null>(null);
  const [enrichingLead, setEnrichingLead] = useState<string | null>(null);
  const [rejectingLead, setRejectingLead] = useState<string | null>(null);
  const thresholdLoadedRef = useRef(false);
  const searchResetReadyRef = useRef(false);

  // Rejected leads state
  const [rejectedLeads, setRejectedLeads] = useState<RejectedLeadRow[]>([]);
  const [rejectedLoading, setRejectedLoading] = useState(false);
  const [unrejectingLead, setUnrejectingLead] = useState<string | null>(null);

  // Reject confirmation modal state
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [pendingReject, setPendingReject] = useState<{ leadId: string; firstName: string; lastName: string } | null>(null);
  const { shouldSkip: shouldSkipRejectConfirm } = useConfirmModal('confirm-reject-lead');
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false);
  const [pendingRegenerate, setPendingRegenerate] = useState<{
    leadId: string;
    icpProfileId: string;
    firstName: string;
    scorePredictionId: string | null;
  } | null>(null);
  const { shouldSkip: shouldSkipRegenerateConfirm } = useConfirmModal('confirm-regenerate-message-draft');

  useEffect(() => {
    const tab = searchParams.get('tab');
    setActiveTab(tab === 'rejected' ? 'rejected' : 'active');
  }, [searchParams]);

  const loadQualificationThreshold = useCallback(async () => {
    setIsQualificationThresholdLoading(true);
    setQualificationThresholdError(null);

    try {
      const { items } = await apiClient.listPipelineSettings();
      const value = parseScoreQualificationThreshold(items);

      if (value === null) {
        setQualificationThreshold(null);
        setQualificationThresholdError(
          'Score qualification threshold is missing or invalid in pipeline settings.',
        );
        return;
      }

      setQualificationThreshold(value);
    } catch (error: unknown) {
      setQualificationThreshold(null);
      setQualificationThresholdError(
        `Failed to load pipeline settings: ${getErrorMessage(error)}`,
      );
    } finally {
      setIsQualificationThresholdLoading(false);
    }
  }, [apiClient]);

  // Load the verified qualification threshold once auth is ready.
  useEffect(() => {
    if (thresholdLoadedRef.current || isAuthLoading || !isAuthenticated) {
      return;
    }

    thresholdLoadedRef.current = true;
    void loadQualificationThreshold();
  }, [isAuthLoading, isAuthenticated, loadQualificationThreshold]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset to page 1 when search query changes
  useEffect(() => {
    if (!searchResetReadyRef.current) {
      searchResetReadyRef.current = true;
      return;
    }
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    persistLeadsTableState({
      page,
      pageSize,
      statusFilter: statusFilter ?? null,
      scoreBandFilter: scoreBandFilter ?? null,
      sortBy,
      searchQuery,
    });
  }, [page, pageSize, statusFilter, scoreBandFilter, sortBy, searchQuery]);

  // Build the API query with score filter and search
  const leads = useApiQuery(
    useCallback(
      () =>
        apiClient.listLeads({
          page,
          pageSize,
          includeQualityMetrics: false,
          sortBy,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(scoreBandFilter ? { scoreBand: scoreBandFilter } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
        }),
      [apiClient, page, pageSize, statusFilter, scoreBandFilter, sortBy, debouncedSearch],
    ),
    [page, pageSize, statusFilter, scoreBandFilter, sortBy, debouncedSearch],
  );

  const totalPages = leads.data ? Math.ceil(leads.data.total / leads.data.pageSize) : 0;

  // Load rejected leads via API when tab is "rejected"
  useEffect(() => {
    if (activeTab !== 'rejected') return;
    let cancelled = false;
    setRejectedLoading(true);

    async function loadRejected() {
      try {
        const result = await apiClient.listRejectedLeads({ page: 1, pageSize: 100 });
        if (cancelled) return;
        if (!cancelled) {
          setRejectedLeads(result.items);
        }
      } catch {
        if (!cancelled) toast.error('Failed to load rejected leads');
      } finally {
        if (!cancelled) setRejectedLoading(false);
      }
    }

    void loadRejected();
    return () => { cancelled = true; };
  }, [activeTab, apiClient]);

  const requestReject = (leadId: string, firstName: string, lastName: string) => {
    if (shouldSkipRejectConfirm()) {
      void executeReject(leadId, firstName, lastName);
      return;
    }
    setPendingReject({ leadId, firstName, lastName });
    setRejectModalOpen(true);
  };

  const executeReject = async (leadId: string, firstName: string, lastName: string) => {
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
      const headers: Record<string, string> = {};
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

  const handleGenerateMessage = async (
    leadId: string,
    icpProfileId: string,
    firstName: string,
    scorePredictionId: string | null,
    forceRegenerate = false,
  ) => {
    if (isQualificationThresholdLoading) {
      toast.error('Draft generation is disabled while pipeline settings are still loading.');
      return;
    }

    if (qualificationThresholdError || qualificationThreshold === null) {
      toast.error('Draft generation is disabled until the score qualification threshold is available.');
      return;
    }

    setGeneratingForLead(leadId);
    try {
      const result = await apiClient.generateDraft({
        leadId,
        icpProfileId,
        ...(scorePredictionId ? { scorePredictionId } : {}),
        promptVersion: 'v2',
        ...(forceRegenerate ? { forceRegenerate: true } : {}),
      });

      const leadDisplayName = firstName.trim().length > 0 ? firstName.trim() : 'this lead';

      switch (result.status) {
        case 'QUEUED': {
          toast.success(
            forceRegenerate
              ? `Draft regeneration queued for ${leadDisplayName}. Opening Inbox draft review.`
              : `Draft generation queued for ${leadDisplayName}. Opening Inbox draft review.`,
          );
          router.push(buildInboxDraftHref(leadId, null, true));
          break;
        }
        case 'CREATED': {
          toast.success(
            forceRegenerate
              ? `New draft created for ${leadDisplayName}. Opening Inbox to review it.`
              : `Draft created for ${leadDisplayName}. Opening Inbox to review it.`,
          );
          router.push(buildInboxDraftHref(leadId, result.draftId));
          break;
        }
        case 'EXISTS': {
          toast.info(
            forceRegenerate
              ? `A current draft still exists for ${leadDisplayName}. Opening Inbox to review it.`
              : `An initial draft already exists for ${leadDisplayName}. Opening Inbox to review it.`,
          );
          router.push(buildInboxDraftHref(leadId, result.draftId));
          break;
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate draft');
    } finally {
      setGeneratingForLead(null);
    }
  };

  const handleEnrichLead = async (leadId: string, displayName: string) => {
    setEnrichingLead(leadId);
    try {
      await apiClient.enrichLead(leadId);
      toast.success(`Hunter enrichment queued for ${displayName || 'this lead'}`);
      leads.refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to queue Hunter enrichment');
    } finally {
      setEnrichingLead(null);
    }
  };

  const requestRegenerateDraft = (
    leadId: string,
    icpProfileId: string,
    firstName: string,
    scorePredictionId: string | null,
  ) => {
    if (shouldSkipRegenerateConfirm()) {
      void handleGenerateMessage(leadId, icpProfileId, firstName, scorePredictionId, true);
      return;
    }

    setPendingRegenerate({
      leadId,
      icpProfileId,
      firstName,
      scorePredictionId,
    });
    setRegenerateModalOpen(true);
  };

  return (
    <div className="flex h-full flex-col space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Leads</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {leads.data ? `${leads.data.total} total leads` : 'Loading...'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Qualified leads stay in operator review until you generate the initial draft. Sending then depends on approval or auto-approval settings.
        </p>
      </div>

      <LeadsNav active={activeTab === 'rejected' ? 'rejected' : 'main'} />

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

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search leads..."
              className="h-9 w-48 rounded-lg border border-border/40 bg-zbooni-dark/30 px-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-zbooni-teal/50 focus:outline-none focus:ring-2 focus:ring-zbooni-teal/20"
            />

            <div className="ml-auto flex items-center gap-2">
              <CustomSelect
                value={sortBy}
                onChange={(v) => {
                  setSortBy(v as LeadListSortBy);
                  setPage(1);
                }}
                options={SORT_OPTIONS}
                placeholder="Newest first"
              />
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
            <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-300" />
              <p className="flex-1">Failed to load leads: {leads.error}. This can happen with slow database connections — try again.</p>
              <button
                type="button"
                onClick={() => leads.refetch()}
                className="shrink-0 rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/25"
              >
                Retry
              </button>
            </div>
          ) : null}

          {isQualificationThresholdLoading ? (
            <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/60 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <p>Loading pipeline settings. Draft generation is temporarily disabled.</p>
            </div>
          ) : null}

          {qualificationThresholdError ? (
            <div className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                <p>
                  {qualificationThresholdError}. Draft generation is disabled until a retry succeeds.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadQualificationThreshold()}
                disabled={isQualificationThresholdLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isQualificationThresholdLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                Retry Load
              </button>
            </div>
          ) : null}

          {/* Table */}
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
            <div className="max-h-[calc(100vh-320px)] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-border/50 bg-card text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Company</th>
                    <th className="hidden px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">Position</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Score</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Created</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(leads.data?.items ?? []).map((lead) => {
                    const enrichmentRaw = lead.latestEnrichmentNormalizedPayload ?? lead.latestEnrichmentRawPayload;
                    const fallbackScore = lead.latestBlendedScore ?? extractLegacyScore(enrichmentRaw);
                    const displayScore = lead.displayScore ?? fallbackScore;
                    const displayScoreBand = lead.displayScoreBand ?? lead.latestScoreBand;
                    const scoreSourceLabel = lead.displayScoreSource
                      ? SCORE_SOURCE_LABELS[lead.displayScoreSource]
                      : null;
                    // Use API-provided fields first, then fall back to enrichment extraction
                    const companyName = lead.businessName ?? extractCompanyName(enrichmentRaw);
                    const position = lead.decisionMakerTitle ?? extractPosition(enrichmentRaw);

                    return (
                      <tr
                        key={lead.id}
                        className="border-b border-border/30 transition-colors last:border-0 hover:bg-accent/50"
                      >
                        <td
                          className="cursor-pointer px-4 py-3"
                          onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                        >
                          <p className="font-medium">{lead.firstName} {lead.lastName}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground/60">{lead.email}</p>
                        </td>
                        <td
                          className="cursor-pointer px-4 py-3 text-muted-foreground"
                          onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                        >
                          {companyName || lead.businessCategory || (
                            <span className="text-muted-foreground/30">&mdash;</span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 lg:table-cell">
                          {position ? (
                            <span className="text-xs text-muted-foreground">{position}</span>
                          ) : (
                            <span className="text-muted-foreground/30">&mdash;</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <LeadStatusBadge status={lead.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {displayScore !== null ? (
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={cn(
                                  'font-mono text-sm font-bold tabular-nums',
                                  displayScore >= 0.7
                                    ? 'text-zbooni-green'
                                    : displayScore >= 0.4
                                      ? 'text-yellow-400'
                                      : 'text-red-400',
                                )}
                              >
                                {(displayScore * 100).toFixed(0)}
                              </span>
                              <div className="flex items-center justify-end gap-1.5">
                                {displayScoreBand ? (
                                  <ScoreBandBadge band={displayScoreBand} />
                                ) : null}
                                {scoreSourceLabel ? (
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/40">
                                    {scoreSourceLabel}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">No score yet</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(lead.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {lead.status === 'qualified' && (
                              <button
                                type="button"
                                title="Generate the initial draft for this qualified lead"
                                disabled={generatingForLead === lead.id}
                                className="rounded-md p-1.5 text-zbooni-green transition-colors hover:bg-zbooni-green/15 disabled:opacity-50"
                                onClick={() => {
                                  void handleGenerateMessage(
                                    lead.id,
                                    lead.latestIcpProfileId ?? '',
                                    lead.firstName ?? '',
                                    lead.latestScorePredictionId ?? null,
                                  );
                                }}
                              >
                                {generatingForLead === lead.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <MessageSquare className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            {lead.status === 'drafted' && lead.latestIcpProfileId && (
                              <button
                                type="button"
                                title="Regenerate the current unsent draft using the latest messaging settings"
                                disabled={generatingForLead === lead.id}
                                className="rounded-md p-1.5 text-amber-300 transition-colors hover:bg-amber-400/15 disabled:opacity-50"
                                onClick={() => {
                                  requestRegenerateDraft(
                                    lead.id,
                                    lead.latestIcpProfileId!,
                                    lead.firstName ?? '',
                                    lead.latestScorePredictionId ?? null,
                                  );
                                }}
                              >
                                {generatingForLead === lead.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            {!lead.hunterEnrichmentUsed && (
                              <button
                                type="button"
                                title="Enrich"
                                disabled={enrichingLead === lead.id}
                                className="rounded-md p-1.5 text-sky-300 transition-colors hover:bg-sky-400/15 disabled:opacity-50"
                                onClick={() => {
                                  const displayName = companyName || `${lead.firstName} ${lead.lastName}`.trim();
                                  void handleEnrichLead(lead.id, displayName);
                                }}
                              >
                                {enrichingLead === lead.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <UserPlus className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              title="Reject lead"
                              disabled={rejectingLead === lead.id}
                              className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-red-500/15 hover:text-red-400 disabled:opacity-50"
                              onClick={() => requestReject(lead.id, lead.firstName ?? '', lead.lastName ?? '')}
                            >
                              {rejectingLead === lead.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <X className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {leads.isLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
                          Loading leads...
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {!leads.isLoading && (leads.data?.items ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
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
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Company Name</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contact Name</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">ICP Profile</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rejection Reason</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Score</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rejected Date</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rejectedLeads.map((rl) => (
                  <tr key={rl.id} className="border-b border-border/30 transition-colors last:border-0 hover:bg-accent/50">
                    <td className="px-4 py-3 text-muted-foreground">
                      <div>
                        <p>{rl.companyName || rl.businessName || 'Unknown company'}</p>
                        {rl.websiteDomain ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground/60">{rl.websiteDomain}</p>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className="cursor-pointer px-4 py-3 font-medium"
                      onClick={() => router.push(`/dashboard/leads/${rl.leadId}`)}
                    >
                      <div>
                        <p>{[rl.firstName, rl.lastName].filter(Boolean).join(' ') || rl.businessName || 'Unknown'}</p>
                        {rl.category ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground/60">{rl.category}</p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{rl.email || 'No email'}</td>
                    <td className="px-4 py-3">
                      <div>
                        {rl.icpProfileName ? (
                          <span className="truncate text-xs text-muted-foreground">{rl.icpProfileName}</span>
                        ) : '\u2014'}
                        {rl.city || rl.country ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                            {[rl.city, rl.country].filter(Boolean).join(', ')}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        REASON_COLORS[rl.reason] ?? 'bg-muted/20 text-muted-foreground',
                      )}>
                        {rl.reason.replace(/_/g, ' ')}
                      </span>
                      {rl.reasonDetails.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {rl.reasonDetails.map((detail, detailIdx) => (
                            <span
                              key={`${rl.id}-${detail}-${detailIdx}`}
                              className="inline-flex rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300"
                            >
                              {detail.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      ) : null}
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
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
                        Loading rejected leads...
                      </div>
                    </td>
                  </tr>
                ) : null}
                {!rejectedLoading && rejectedLeads.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      No rejected leads.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reject lead confirmation modal */}
      <ConfirmModal
        isOpen={rejectModalOpen}
        title="Reject Lead"
        message={pendingReject ? `Reject lead "${pendingReject.firstName} ${pendingReject.lastName}"? They will be moved to the Rejected tab.` : ''}
        confirmLabel="Reject"
        variant="danger"
        onConfirm={() => {
          setRejectModalOpen(false);
          if (pendingReject) {
            void executeReject(pendingReject.leadId, pendingReject.firstName, pendingReject.lastName);
          }
        }}
        onCancel={() => {
          setRejectModalOpen(false);
          setPendingReject(null);
        }}
        showDontAsk
        dontAskKey="confirm-reject-lead"
      />

      <ConfirmModal
        isOpen={regenerateModalOpen}
        title="Regenerate Draft"
        message={
          pendingRegenerate
            ? `Replace the current unsent initial draft for ${pendingRegenerate.firstName || 'this lead'} with a new one using the latest AI prompt and ICP settings? If a message has already been queued or sent, regeneration will be blocked.`
            : ''
        }
        confirmLabel="Regenerate"
        variant="info"
        onConfirm={() => {
          const current = pendingRegenerate;
          setRegenerateModalOpen(false);
          setPendingRegenerate(null);
          if (!current) {
            return;
          }
          void handleGenerateMessage(
            current.leadId,
            current.icpProfileId,
            current.firstName,
            current.scorePredictionId,
            true,
          );
        }}
        onCancel={() => {
          setRegenerateModalOpen(false);
          setPendingRegenerate(null);
        }}
        showDontAsk
        dontAskKey="confirm-regenerate-message-draft"
      />
    </div>
  );
}

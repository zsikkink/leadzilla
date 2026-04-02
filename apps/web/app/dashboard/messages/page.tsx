'use client';

import type {
  GetLeadResponse,
  MessageApprovalStatus,
  MessageDraftResponse,
  MessageSendResponse,
} from '@lead-flood/contracts';
import { AlertTriangle, Check, CheckCheck, Minus, Square, X, XCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { CustomSelect } from '../../../src/components/custom-select.js';
import { cn } from '../../../src/lib/utils.js';
import { MessageDraftCard } from '../../../src/components/message-draft-card.js';
import { Pagination } from '../../../src/components/pagination.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

const APPROVAL_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'AUTO_APPROVED', label: 'Auto-Approved' },
];

interface ApprovalModeState {
  isLoading: boolean;
  error: string | null;
  manualApprovalOnly: boolean;
  autoApproveEnabled: boolean;
  autoApproveScoreMin: number | null;
  autoApproveScoreMax: number | null;
}

function parseBooleanSetting(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

function parseFractionSetting(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return null;
  }
  return parsed;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getSendRecency(send: MessageSendResponse): number {
  return new Date(send.updatedAt).getTime();
}

function BulkCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean | undefined;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1 focus:ring-offset-background',
        checked || indeterminate
          ? 'border-zbooni-green bg-zbooni-green/20 text-zbooni-green'
          : 'border-border/60 bg-transparent text-transparent hover:border-muted-foreground/50',
      )}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3" />
      ) : checked ? (
        <Check className="h-3 w-3" />
      ) : (
        <Square className="h-2.5 w-2.5" />
      )}
    </button>
  );
}

export default function MessagesPage() {
  const { apiClient, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<MessageApprovalStatus | undefined>(undefined);
  const [approving, setApproving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'approve' | 'reject' | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const rejectInputRef = useRef<HTMLInputElement>(null);
  const [sendRefreshNonce, setSendRefreshNonce] = useState(0);
  const [approvalMode, setApprovalMode] = useState<ApprovalModeState>({
    isLoading: true,
    error: null,
    manualApprovalOnly: false,
    autoApproveEnabled: false,
    autoApproveScoreMin: null,
    autoApproveScoreMax: null,
  });
  const [initialSendByDraftId, setInitialSendByDraftId] = useState<Record<string, MessageSendResponse>>({});
  const [loadedInitialSendLeadIds, setLoadedInitialSendLeadIds] = useState<Set<string>>(new Set());

  const leadIdFilter = searchParams.get('leadId')?.trim() || undefined;
  const draftIdTarget = searchParams.get('draftId')?.trim() || undefined;

  const drafts = useApiQuery(
    useCallback(
      () =>
        apiClient.listDrafts({
          page,
          pageSize: 10,
          ...(leadIdFilter ? { leadId: leadIdFilter } : {}),
          ...(statusFilter ? { approvalStatus: statusFilter } : {}),
        }),
      [apiClient, leadIdFilter, page, statusFilter],
    ),
    [leadIdFilter, page, statusFilter],
  );

  // Sort items newest first by createdAt
  const sortedItems: MessageDraftResponse[] = useMemo(() => {
    if (!drafts.data?.items) return [];
    return [...drafts.data.items].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [drafts.data?.items]);

  // Fetch lead details for display names
  const [leadDataMap, setLeadDataMap] = useState<Record<string, { name: string; company: string }>>({});

  const leadIds = useMemo(() => {
    if (!sortedItems.length) return [];
    const ids = new Set<string>();
    for (const draft of sortedItems) {
      ids.add(draft.leadId);
    }
    return Array.from(ids);
  }, [sortedItems]);

  useEffect(() => {
    if (leadIds.length === 0) return;

    let cancelled = false;

    void Promise.allSettled(
      leadIds.map((id) => apiClient.getLead(id)),
    ).then((results) => {
      if (cancelled) return;

      const dataMap: Record<string, { name: string; company: string }> = {};
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const leadId = leadIds[i];
        if (!result || !leadId) continue;

        if (result.status === 'fulfilled') {
          const lead: GetLeadResponse = result.value;
          const fullName = `${lead.firstName} ${lead.lastName}`.trim();
          const enrichment = lead.enrichmentData as Record<string, unknown> | null | undefined;
          const companyName = (enrichment?.companyName as string) ?? '';
          const emailLocal = lead.email?.split('@')[0] ?? '';
          const displayName = fullName || companyName || emailLocal || `Lead ${leadId.slice(0, 8)}`;
          dataMap[leadId] = { name: displayName, company: companyName };
        }
      }

      setLeadDataMap(dataMap);
    });

    return () => {
      cancelled = true;
    };
  }, [leadIds, apiClient]);

  useEffect(() => {
    let cancelled = false;

    setApprovalMode((current) => ({
      ...current,
      isLoading: true,
      error: null,
    }));

    void apiClient.listPipelineSettings().then(
      ({ items }) => {
        if (cancelled) return;

        let manualApprovalOnly = false;
        let autoApproveEnabled = false;
        let autoApproveScoreMin: number | null = null;
        let autoApproveScoreMax: number | null = null;

        for (const item of items) {
          if (item.key === 'messaging_manual_approval_only') {
            manualApprovalOnly = parseBooleanSetting(item.value) ?? false;
          } else if (item.key === 'auto_approve_enabled') {
            autoApproveEnabled = parseBooleanSetting(item.value) ?? false;
          } else if (item.key === 'auto_approve_score_min') {
            autoApproveScoreMin = parseFractionSetting(item.value);
          } else if (item.key === 'auto_approve_score_max') {
            autoApproveScoreMax = parseFractionSetting(item.value);
          }
        }

        setApprovalMode({
          isLoading: false,
          error: null,
          manualApprovalOnly,
          autoApproveEnabled,
          autoApproveScoreMin,
          autoApproveScoreMax,
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        setApprovalMode({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load approval mode',
          manualApprovalOnly: false,
          autoApproveEnabled: false,
          autoApproveScoreMin: null,
          autoApproveScoreMax: null,
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const pendingDrafts: MessageDraftResponse[] = useMemo(
    () => sortedItems.filter((d) => d.approvalStatus === 'PENDING'),
    [sortedItems],
  );

  // Fetch global pending count (independent of current page/filter)
  const globalPendingCount = useApiQuery(
    useCallback(
      () => apiClient.listDrafts({ page: 1, pageSize: 1, approvalStatus: 'PENDING' as MessageApprovalStatus }),
      [apiClient],
    ),
    [],
  );
  const pendingCount = globalPendingCount.data?.total ?? pendingDrafts.length;

  // Visible items (filter out optimistically hidden ones), already sorted newest first
  const visibleItems: MessageDraftResponse[] = useMemo(
    () => sortedItems.filter((d) => !hiddenIds.has(d.id)),
    [hiddenIds, sortedItems],
  );

  const initialDraftLeadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const draft of visibleItems) {
      if (draft.followUpNumber === 0) {
        ids.add(draft.leadId);
      }
    }
    return Array.from(ids);
  }, [visibleItems]);

  useEffect(() => {
    if (initialDraftLeadIds.length === 0) {
      setInitialSendByDraftId({});
      setLoadedInitialSendLeadIds(new Set());
      return;
    }

    let cancelled = false;
    setInitialSendByDraftId({});
    setLoadedInitialSendLeadIds(new Set());

    void Promise.allSettled(
      initialDraftLeadIds.map((leadId) =>
        apiClient.listSends({ leadId, page: 1, pageSize: 100 }),
      ),
    ).then((results) => {
      if (cancelled) return;

      const nextSendMap: Record<string, MessageSendResponse> = {};
      const nextLoadedLeadIds = new Set<string>();

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const leadId = initialDraftLeadIds[i];
        if (!result || !leadId || result.status !== 'fulfilled') {
          continue;
        }

        nextLoadedLeadIds.add(leadId);

        for (const send of result.value.items) {
          if (send.followUpNumber !== 0) {
            continue;
          }

          const existing = nextSendMap[send.messageDraftId];
          if (!existing || getSendRecency(send) > getSendRecency(existing)) {
            nextSendMap[send.messageDraftId] = send;
          }
        }
      }

      setInitialSendByDraftId(nextSendMap);
      setLoadedInitialSendLeadIds(nextLoadedLeadIds);
    });

    return () => {
      cancelled = true;
    };
  }, [apiClient, initialDraftLeadIds, sendRefreshNonce]);

  // Selection helpers
  const pendingIds = new Set(pendingDrafts.map((d) => d.id));
  const visiblePendingIds = new Set(
    visibleItems.filter((d) => d.approvalStatus === 'PENDING').map((d) => d.id),
  );
  const selectedPendingCount = [...selectedIds].filter((id) => pendingIds.has(id)).length;
  const allVisiblePendingSelected =
    visiblePendingIds.size > 0 && [...visiblePendingIds].every((id) => selectedIds.has(id));
  const someVisiblePendingSelected =
    !allVisiblePendingSelected && [...visiblePendingIds].some((id) => selectedIds.has(id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allVisiblePendingSelected) {
      // Deselect all visible pending
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visiblePendingIds) {
          next.delete(id);
        }
        return next;
      });
    } else {
      // Select all visible pending
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visiblePendingIds) {
          next.add(id);
        }
        return next;
      });
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setShowRejectInput(false);
    setBulkRejectReason('');
  };

  const refreshQueueData = useCallback(() => {
    drafts.refetch();
    globalPendingCount.refetch();
    setSendRefreshNonce((current) => current + 1);
  }, [drafts, globalPendingCount]);

  useEffect(() => {
    setPage(1);
    clearSelection();
  }, [leadIdFilter]);

  const handleAutoApproveAll = async () => {
    setApproving(true);
    const userId = user?.id ?? 'unknown';
    const toastId = toast.loading('Fetching all pending drafts...');

    try {
      // Fetch all pending drafts across all pages (pageSize max is 100)
      const allPending: MessageDraftResponse[] = [];
      let fetchPage = 1;
      let totalPending = 0;

      let hasMore = true;
      while (hasMore) {
        const result = await apiClient.listDrafts({
          page: fetchPage,
          pageSize: 100,
          approvalStatus: 'PENDING' as MessageApprovalStatus,
        });
        allPending.push(...result.items);
        totalPending = result.total;

        if (allPending.length >= totalPending || result.items.length === 0) {
          hasMore = false;
        } else {
          fetchPage++;
        }
      }

      if (allPending.length === 0) {
        toast.dismiss(toastId);
        toast.info('No pending drafts to approve');
        setApproving(false);
        return;
      }

      let approved = 0;
      let failed = 0;
      toast.loading(`Approving... 0 of ${allPending.length}`, { id: toastId });

      for (const draft of allPending) {
        try {
          const firstVariant = draft.variants[0];
          await apiClient.approveDraft(draft.id, {
            approvedByUserId: userId,
            selectedVariantId: firstVariant?.id,
          });
          approved++;
        } catch {
          failed++;
        }
        toast.loading(`Approving... ${approved + failed} of ${allPending.length}`, { id: toastId });
      }

      toast.dismiss(toastId);
      if (failed === 0) {
        toast.success(`Approved all ${approved} pending drafts`);
      } else {
        toast.error(`Approved ${approved} of ${allPending.length} drafts (${failed} failed)`);
      }

      refreshQueueData();
    } catch {
      toast.dismiss(toastId);
      toast.error('Failed to fetch pending drafts');
    } finally {
      setApproving(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0 || !drafts.data) return;

    setBulkAction('approve');
    const userId = user?.id ?? 'unknown';
    const targets = drafts.data.items.filter(
      (d) => selectedIds.has(d.id) && d.approvalStatus === 'PENDING',
    );

    // Optimistic: hide approved items
    setHiddenIds((prev) => {
      const next = new Set(prev);
      for (const t of targets) next.add(t.id);
      return next;
    });

    const results = await Promise.allSettled(
      targets.map((draft) => {
        const firstVariant = draft.variants[0];
        return apiClient.approveDraft(draft.id, {
          approvedByUserId: userId,
          selectedVariantId: firstVariant?.id,
        });
      }),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    if (failed === 0) {
      toast.success(`Approved ${succeeded} draft${succeeded !== 1 ? 's' : ''}`);
    } else {
      toast.error(`Approved ${succeeded} of ${targets.length} drafts (${failed} failed)`);
    }

    clearSelection();
    setBulkAction(null);
    setHiddenIds(new Set());
    refreshQueueData();
  };

  const handleBulkReject = async () => {
    if (selectedIds.size === 0 || !drafts.data || !bulkRejectReason.trim()) return;

    setBulkAction('reject');
    const userId = user?.id ?? 'unknown';
    const targets = drafts.data.items.filter(
      (d) => selectedIds.has(d.id) && d.approvalStatus === 'PENDING',
    );

    // Optimistic: hide rejected items
    setHiddenIds((prev) => {
      const next = new Set(prev);
      for (const t of targets) next.add(t.id);
      return next;
    });

    const results = await Promise.allSettled(
      targets.map((draft) =>
        apiClient.rejectDraft(draft.id, {
          rejectedByUserId: userId,
          rejectedReason: bulkRejectReason.trim(),
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    if (failed === 0) {
      toast.success(`Rejected ${succeeded} draft${succeeded !== 1 ? 's' : ''}`);
    } else {
      toast.error(`Rejected ${succeeded} of ${targets.length} drafts (${failed} failed)`);
    }

    clearSelection();
    setBulkAction(null);
    setHiddenIds(new Set());
    setShowRejectInput(false);
    setBulkRejectReason('');
    refreshQueueData();
  };

  const handleRejectClick = () => {
    setShowRejectInput(true);
    // Focus the input after render
    setTimeout(() => rejectInputRef.current?.focus(), 50);
  };

  const approvalModeSummary = useMemo(() => {
    if (approvalMode.isLoading) {
      return {
        badge: 'Loading approval mode',
        badgeClass: 'bg-muted/20 text-muted-foreground',
        body: 'Loading runtime approval settings for initial outbound drafts.',
      };
    }

    if (approvalMode.error) {
      return {
        badge: 'Approval mode unavailable',
        badgeClass: 'bg-amber-500/15 text-amber-300',
        body: `Approval mode could not be loaded: ${approvalMode.error}`,
      };
    }

    if (approvalMode.manualApprovalOnly) {
      return {
        badge: 'Manual approval only',
        badgeClass: 'bg-amber-500/15 text-amber-300',
        body: 'Runtime override is on. Initial drafts require explicit approval, and auto-approval is currently suppressed.',
      };
    }

    if (
      approvalMode.autoApproveEnabled &&
      approvalMode.autoApproveScoreMin !== null &&
      approvalMode.autoApproveScoreMax !== null
    ) {
      return {
        badge: 'Auto-approval active',
        badgeClass: 'bg-zbooni-green/15 text-zbooni-green',
        body: `Initial drafts auto-approve and queue their send when score is between ${formatPercent(approvalMode.autoApproveScoreMin)} and ${formatPercent(approvalMode.autoApproveScoreMax)}. Drafts outside that range stay pending approval.`,
      };
    }

    if (approvalMode.autoApproveEnabled) {
      return {
        badge: 'Auto-approve misconfigured',
        badgeClass: 'bg-amber-500/15 text-amber-300',
        body: 'Auto-approve is enabled, but the score range is unavailable here. Treat initial drafts as pending approval until that setting is corrected.',
      };
    }

    return {
      badge: 'Manual approval',
      badgeClass: 'bg-blue-500/15 text-blue-300',
      body: 'Auto-approve is off. Initial drafts stay pending until an operator approves them, then the initial send is queued automatically.',
    };
  }, [approvalMode]);

  const filteredLeadLabel = leadIdFilter
    ? leadDataMap[leadIdFilter]?.name ?? `Lead ${leadIdFilter.slice(0, 8)}`
    : null;

  return (
    <div className="space-y-5 pb-24">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Message Queue</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {drafts.data ? `${drafts.data.total} drafts` : 'Loading...'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Drafts appear here only after an operator triggers generation from a qualified lead. Review them here, then approve or reject; approved initial drafts queue their send automatically unless auto-approval already handled it.
        </p>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold',
              approvalModeSummary.badgeClass,
            )}
          >
            {approvalModeSummary.badge}
          </span>
          {leadIdFilter ? (
            <>
              <span className="text-xs text-muted-foreground/70">Filtered to</span>
              <span className="text-xs font-medium text-foreground">{filteredLeadLabel}</span>
              <button
                type="button"
                onClick={() => router.push('/dashboard/messages')}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
              >
                Clear filter
              </button>
            </>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{approvalModeSummary.body}</p>
      </div>

      {/* Bounced / Failed sends summary */}
      {(() => {
        const bouncedSends = Object.values(initialSendByDraftId).filter((s) => s.status === 'BOUNCED');
        const failedSends = Object.values(initialSendByDraftId).filter((s) => s.status === 'FAILED');
        if (bouncedSends.length === 0 && failedSends.length === 0) return null;

        return (
          <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span className="text-sm font-semibold text-red-300">Delivery Issues</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {bouncedSends.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 font-semibold text-amber-300">
                  <XCircle className="h-3 w-3" />
                  {bouncedSends.length} bounced
                </span>
              ) : null}
              {failedSends.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 font-semibold text-red-300">
                  <XCircle className="h-3 w-3" />
                  {failedSends.length} failed
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground/60">
              These messages could not be delivered. Check the lead&apos;s email address and retry or try a different contact.
            </p>
          </div>
        );
      })()}

      {/* Controls row: select-all + approve-all + status filter */}
      <div className="flex items-center justify-between rounded-xl border border-border/30 bg-card/50 px-4 py-2.5">
        <div className="flex items-center gap-3">
          {visiblePendingIds.size > 0 ? (
            <>
              <BulkCheckbox
                checked={allVisiblePendingSelected}
                indeterminate={someVisiblePendingSelected}
                onChange={toggleSelectAll}
                label={allVisiblePendingSelected ? 'Deselect all pending drafts' : 'Select all pending drafts'}
              />
              <span className="text-xs font-medium text-muted-foreground">
                {allVisiblePendingSelected
                  ? `All ${visiblePendingIds.size} pending selected`
                  : someVisiblePendingSelected
                    ? `${selectedPendingCount} selected`
                    : 'Select pending drafts'}
              </span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 ? (
            <button
              type="button"
              disabled={approving}
              onClick={handleAutoApproveAll}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zbooni-green/20 px-3.5 py-2 text-xs font-semibold text-zbooni-green transition-colors hover:bg-zbooni-green/30 disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {approving ? 'Approving...' : `Approve All (${pendingCount})`}
            </button>
          ) : null}
          <CustomSelect
            value={statusFilter ?? ''}
            onChange={(v) => {
              setStatusFilter((v || undefined) as MessageApprovalStatus | undefined);
              setPage(1);
              clearSelection();
            }}
            options={APPROVAL_OPTIONS}
            placeholder="All statuses"
          />
        </div>
      </div>

      {drafts.error ? (
        <p className="text-sm text-destructive">{drafts.error}</p>
      ) : null}

      {drafts.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          Loading drafts...
        </div>
      ) : null}

      <div className="space-y-4">
        {visibleItems.map((draft) => {
          const isPending = draft.approvalStatus === 'PENDING';
          const isSelected = selectedIds.has(draft.id);
          const isTargetDraft = draftIdTarget === draft.id;
          const sendForDraft = draft.followUpNumber === 0 ? initialSendByDraftId[draft.id] ?? null : null;
          const isBounced = sendForDraft?.status === 'BOUNCED';
          const isFailed = sendForDraft?.status === 'FAILED';

          return (
            <div
              key={draft.id}
              className={cn(
                'flex gap-3 transition-all duration-200',
                isPending && 'items-start',
              )}
            >
              {isPending ? (
                <div className="mt-5 shrink-0">
                  <BulkCheckbox
                    checked={isSelected}
                    onChange={() => toggleSelect(draft.id)}
                    label={`Select draft ${draft.id}`}
                  />
                </div>
              ) : null}
              <div
                className={cn(
                  'min-w-0 flex-1',
                  isSelected && 'rounded-2xl ring-1 ring-zbooni-green/30',
                  isTargetDraft && 'rounded-2xl ring-1 ring-zbooni-teal/40',
                  (isBounced || isFailed) && 'rounded-2xl ring-1 ring-red-500/30',
                )}
              >
                {(isBounced || isFailed) ? (
                  <div className="flex items-center gap-2 rounded-t-2xl border-b border-red-500/20 bg-red-500/[0.06] px-4 py-1.5">
                    {isBounced ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300">
                        <AlertTriangle className="h-3 w-3" />
                        Bounced
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-300">
                        <XCircle className="h-3 w-3" />
                        Failed to send
                      </span>
                    )}
                  </div>
                ) : null}
                <MessageDraftCard
                  draft={draft}
                  leadName={leadDataMap[draft.leadId]?.name}
                  companyName={leadDataMap[draft.leadId]?.company}
                  initialSend={sendForDraft}
                  initialSendLoaded={
                    draft.followUpNumber > 0 || loadedInitialSendLeadIds.has(draft.leadId)
                  }
                  onAction={refreshQueueData}
                />
              </div>
            </div>
          );
        })}
      </div>

      {!drafts.isLoading && visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-8 text-center shadow-sm">
          <p className="text-muted-foreground/60">
            {leadIdFilter
              ? 'No message drafts found for this lead.'
              : statusFilter === 'PENDING'
                ? 'No pending messages to review.'
                : 'No messages found.'}
          </p>
          {leadIdFilter ? (
            <p className="mt-2 text-xs text-muted-foreground/50">
              If draft generation was just queued from Leads, refresh here in a moment.
            </p>
          ) : null}
        </div>
      ) : null}

      {drafts.data && drafts.data.total > 10 ? (
        <Pagination
          page={drafts.data.page}
          pageSize={drafts.data.pageSize}
          total={drafts.data.total}
          onPageChange={(p) => {
            setPage(p);
            clearSelection();
          }}
        />
      ) : null}

      {/* Floating bulk action bar */}
      <div
        className={cn(
          'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transition-all duration-300',
          selectedIds.size > 0
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0',
        )}
      >
        <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card/95 px-6 py-3 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <span className="text-sm font-semibold text-foreground">
            {selectedPendingCount} selected
          </span>

          <div className="mx-1 h-5 w-px bg-border/50" />

          {showRejectInput ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleBulkReject();
              }}
            >
              <label htmlFor="bulk-reject-reason" className="sr-only">
                Rejection reason
              </label>
              <input
                ref={rejectInputRef}
                id="bulk-reject-reason"
                type="text"
                value={bulkRejectReason}
                onChange={(e) => setBulkRejectReason(e.target.value)}
                placeholder="Rejection reason..."
                className="w-48 rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-destructive/50 focus:outline-none focus:ring-2 focus:ring-destructive/20"
              />
              <button
                type="submit"
                disabled={!bulkRejectReason.trim() || bulkAction === 'reject'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3.5 py-1.5 text-xs font-semibold text-destructive-foreground transition-colors hover:bg-destructive/80 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                {bulkAction === 'reject' ? 'Rejecting...' : `Reject (${selectedPendingCount})`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRejectInput(false);
                  setBulkRejectReason('');
                }}
                className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <button
                type="button"
                disabled={bulkAction === 'approve'}
                onClick={handleBulkApprove}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zbooni-green/20 px-3.5 py-2 text-xs font-semibold text-zbooni-green transition-colors hover:bg-zbooni-green/30 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {bulkAction === 'approve'
                  ? 'Approving...'
                  : `Approve (${selectedPendingCount})`}
              </button>

              <button
                type="button"
                onClick={handleRejectClick}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/15 px-3.5 py-2 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Reject ({selectedPendingCount})
              </button>
            </>
          )}

          <div className="mx-1 h-5 w-px bg-border/50" />

          <button
            type="button"
            onClick={clearSelection}
            className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

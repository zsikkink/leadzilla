'use client';

/**
 * INBOX DATA: All data is REAL from the API.
 * - Conversation list: fetched via apiClient.listSends() — actual MessageSend records
 * - Lead names: resolved via apiClient.getLead() for each unique leadId
 * - Conversation threads: fetched via apiClient.getConversation(leadId)
 * - No fake/seed data is hardcoded here. If the inbox appears empty, there are no sends in the DB.
 */

import type {
  ConversationEntry,
  ConversationResponse,
  GetLeadResponse,
  MessageDraftResponse,
  MessageSendResponse,
} from '@lead-flood/contracts';
import DOMPurify from 'dompurify';
import {
  FileText,
  Inbox as InboxIcon,
  Mail,
  MessageSquare,
  PenLine,
  Phone,
  RefreshCw,
  Send,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { MessageDraftCard } from '../../../src/components/message-draft-card.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';
import { useDraftCompletionNotifier } from '../../../src/hooks/use-draft-completion-notifier.js';

// Mirrors the worker/provider default until the API exposes runtime sender config.
const OUTBOUND_EMAIL = 'outbound@leadzilla.example';
const INBOX_MESSAGE_TRASH_STORAGE_KEY = 'lead-flood:inbox:trashed-messages';

// ── Classification badge colors ────────────────────
function classificationColor(classification: string | null): string {
  switch (classification) {
    case 'INTERESTED': return 'bg-emerald-500/15 text-emerald-400';
    case 'NOT_INTERESTED': return 'bg-red-500/15 text-red-400';
    case 'OUT_OF_OFFICE': return 'bg-yellow-500/15 text-yellow-400';
    default: return 'bg-muted/20 text-muted-foreground';
  }
}

function channelBadge(channel: string): string {
  return channel === 'WHATSAPP'
    ? 'bg-emerald-500/15 text-emerald-400'
    : 'bg-blue-500/15 text-blue-400';
}

function isProblemSendStatus(status: MessageSendResponse['status']): boolean {
  return status === 'FAILED' || status === 'BOUNCED' || status === 'UNRESOLVED';
}

function activityTimestampMs(timestamp: string | null | undefined): number {
  return timestamp ? new Date(timestamp).getTime() : 0;
}

function conversationEntryKey(leadId: string, entry: Pick<ConversationEntry, 'id' | 'type'>): string {
  return `${leadId}:${entry.type}:${entry.id}`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getBusinessNameFromLead(lead: GetLeadResponse): string | null {
  const enrichment = readRecord(lead.enrichmentData);
  return readOptionalString(
    enrichment?.companyName
      ?? enrichment?.company_name
      ?? enrichment?.organization_name
      ?? enrichment?.company,
  );
}

function formatLeadName(lead: GetLeadResponse): string {
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim();
  if (fullName && fullName.toLowerCase() !== 'unknown contact') {
    return fullName;
  }
  return getBusinessNameFromLead(lead) ?? 'Generic Contact';
}

// ── Types ────────────────────────────────────────────
type InboxFolder = 'INBOX' | 'SENT' | 'DRAFTS' | 'FAILED' | 'TRASH';

interface LeadDisplayDetails {
  name: string;
  email: string;
  businessEmail: string | null;
  companyName: string | null;
  latestIcpProfileId: string | null;
}

interface LeadReplyOutcomeSummary {
  occurredAt: string;
  classification: string | null;
  channel: MessageSendResponse['channel'] | null;
}

interface LeadConversationSummary {
  leadId: string;
  leadName: string;
  leadEmail: string;
  leadCompany: string | null;
  lastMessage: string;
  lastActivityAt: string;
  channel: MessageSendResponse['channel'];
  replyCount: number;
  latestReply: LeadReplyOutcomeSummary | null;
  latestSendId: string;
  hasProblem: boolean;
}

export default function InboxPage() {
  const { apiClient } = useAuth();
  const searchParams = useSearchParams();
  const requestedLeadId = searchParams.get('leadId');
  const requestedDraftId = searchParams.get('draftId');
  const shouldPollDraftFromUrl = searchParams.get('pollDraft') === '1';
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');
  const [activeFolder, setActiveFolder] = useState<InboxFolder>('INBOX');
  const [trashedMessageKeys, setTrashedMessageKeys] = useState<string[]>([]);
  const [manualSubject, setManualSubject] = useState('');
  const [manualBody, setManualBody] = useState('');
  const [manualDraftAction, setManualDraftAction] = useState<'saving' | null>(null);

  // Fetch all recent sends to build conversation list
  const sends = useApiQuery(
    useCallback(() => apiClient.listSends({ page: 1, pageSize: 100 }), [apiClient]),
    [],
  );

  const drafts = useApiQuery(
    useCallback(() => apiClient.listDrafts({ page: 1, pageSize: 100 }), [apiClient]),
    [],
  );

  // Fetch conversation for selected lead
  const conversation = useApiQuery(
    useCallback(
      () => (selectedLeadId ? apiClient.getConversation(selectedLeadId) : Promise.resolve({ leadId: '', entries: [] } as ConversationResponse)),
      [apiClient, selectedLeadId],
    ),
    [selectedLeadId],
  );

  const selectedDrafts = useApiQuery(
    useCallback(
      () => (
        selectedLeadId
          ? apiClient.listDrafts({ leadId: selectedLeadId, page: 1, pageSize: 20 })
          : Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 })
      ),
      [apiClient, selectedLeadId],
    ),
    [selectedLeadId],
  );

  // Batch-fetch lead details for display names
  const [leadDetailsMap, setLeadDetailsMap] = useState<Record<string, LeadDisplayDetails>>({});
  const [replyOutcomeMap, setReplyOutcomeMap] = useState<Record<string, LeadReplyOutcomeSummary>>({});

  const leadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const send of sends.data?.items ?? []) {
      ids.add(send.leadId);
    }
    for (const draft of drafts.data?.items ?? []) {
      ids.add(draft.leadId);
    }
    if (requestedLeadId) {
      ids.add(requestedLeadId);
    }
    return Array.from(ids);
  }, [drafts.data, requestedLeadId, sends.data]);

  const repliedLeadIds = useMemo(() => {
    if (!sends.data?.items) return [];
    const ids = new Set<string>();
    for (const send of sends.data.items) {
      if (send.status === 'REPLIED' || send.repliedAt) {
        ids.add(send.leadId);
      }
    }
    return Array.from(ids).sort();
  }, [sends.data]);

  const sendChannelById = useMemo(() => {
    const channels: Record<string, MessageSendResponse['channel']> = {};
    for (const send of sends.data?.items ?? []) {
      channels[send.id] = send.channel;
    }
    return channels;
  }, [sends.data]);

  useEffect(() => {
    if (!requestedLeadId) return;
    setSelectedLeadId(requestedLeadId);
    if (requestedDraftId || shouldPollDraftFromUrl) {
      setActiveFolder('DRAFTS');
    }
  }, [requestedDraftId, requestedLeadId, shouldPollDraftFromUrl]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(INBOX_MESSAGE_TRASH_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setTrashedMessageKeys(parsed.filter((item): item is string => typeof item === 'string'));
      }
    } catch {
      setTrashedMessageKeys([]);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(INBOX_MESSAGE_TRASH_STORAGE_KEY, JSON.stringify(trashedMessageKeys));
  }, [trashedMessageKeys]);

  useEffect(() => {
    setManualSubject('');
    setManualBody('');
  }, [selectedLeadId]);

  useEffect(() => {
    if (leadIds.length === 0) return;

    let cancelled = false;

    void Promise.allSettled(
      leadIds.map((id) => apiClient.getLead(id)),
    ).then((results) => {
      if (cancelled) return;

      const detailsMap: Record<string, LeadDisplayDetails> = {};
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const leadId = leadIds[i];
        if (!result || !leadId) continue;

        if (result.status === 'fulfilled') {
          const lead: GetLeadResponse = result.value;
          const companyName = getBusinessNameFromLead(lead);
          detailsMap[leadId] = {
            name: formatLeadName(lead),
            email: lead.email,
            businessEmail: lead.businessEmail ?? null,
            companyName,
            latestIcpProfileId: lead.latestIcpProfileId ?? null,
          };
        }
      }

      setLeadDetailsMap(detailsMap);
    });

    return () => {
      cancelled = true;
    };
  }, [leadIds, apiClient]);

  useEffect(() => {
    if (repliedLeadIds.length === 0) {
      setReplyOutcomeMap({});
      return;
    }

    let cancelled = false;

    void Promise.allSettled(
      repliedLeadIds.map(async (leadId) => {
        const response = await apiClient.listFeedbackEvents({
          leadId,
          eventType: 'REPLIED',
          page: 1,
          pageSize: 1,
        });

        const latestReply = response.items[0];
        if (!latestReply) {
          return null;
        }

        return {
          leadId,
          outcome: {
            occurredAt: latestReply.occurredAt,
            classification: latestReply.replyClassification,
            channel: latestReply.messageSendId ? sendChannelById[latestReply.messageSendId] ?? null : null,
          },
        };
      }),
    ).then((results) => {
      if (cancelled) return;

      const nextReplyOutcomeMap: Record<string, LeadReplyOutcomeSummary> = {};
      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        nextReplyOutcomeMap[result.value.leadId] = result.value.outcome;
      }

      setReplyOutcomeMap(nextReplyOutcomeMap);
    });

    return () => {
      cancelled = true;
    };
  }, [apiClient, repliedLeadIds, sendChannelById]);

  // Build conversation summaries grouped by lead
  const summaries = useMemo((): LeadConversationSummary[] => {
    if (!sends.data?.items) return [];

    const byLead = new Map<string, MessageSendResponse[]>();
    for (const send of sends.data.items) {
      const existing = byLead.get(send.leadId) ?? [];
      existing.push(send);
      byLead.set(send.leadId, existing);
    }

    const result: LeadConversationSummary[] = [];
    for (const [leadId, leadSends] of byLead) {
      const sorted = [...leadSends].sort((a, b) =>
        activityTimestampMs(b.sentAt ?? b.createdAt) - activityTimestampMs(a.sentAt ?? a.createdAt),
      );
      const latest = sorted[0];
      if (!latest) continue;

      const latestReplyFromSends = leadSends.reduce<string | null>((currentLatest, send) => {
        if (!send.repliedAt) return currentLatest;
        return activityTimestampMs(send.repliedAt) > activityTimestampMs(currentLatest)
          ? send.repliedAt
          : currentLatest;
      }, null);

      const latestReply = replyOutcomeMap[leadId] ?? (
        latestReplyFromSends
          ? {
              occurredAt: latestReplyFromSends,
              classification: null,
              channel: null,
            }
          : null
      );

      const latestSendAt = latest.sentAt ?? latest.createdAt;
      const lastActivityIsReply = latestReply !== null
        && activityTimestampMs(latestReply.occurredAt) >= activityTimestampMs(latestSendAt);
      const lastActivityAt = lastActivityIsReply ? latestReply.occurredAt : latestSendAt;
      const replyCount = leadSends.filter((s) => s.status === 'REPLIED' || s.repliedAt).length;
      const lastMessage = lastActivityIsReply && latestReply
        ? latestReply.classification
          ? `${latestReply.channel === 'WHATSAPP' ? 'WhatsApp' : 'Lead'} reply — ${latestReply.classification}`
          : latestReply.channel === 'WHATSAPP'
            ? 'WhatsApp reply received'
            : 'Reply received'
        : `${latest.channel} — ${latest.status}`;
      const channel = lastActivityIsReply && latestReply
        ? latestReply.channel ?? latest.channel
        : latest.channel;
      const leadDetails = leadDetailsMap[leadId];
      const hasProblem = isProblemSendStatus(latest.status);

      result.push({
        leadId,
        leadName: leadDetails?.name ?? leadId.slice(0, 8),
        leadEmail: leadDetails?.email ?? '',
        leadCompany: leadDetails?.companyName ?? null,
        lastMessage,
        lastActivityAt,
        channel,
        replyCount,
        latestReply,
        latestSendId: latest.id,
        hasProblem,
      });
    }

    return result.sort((a, b) =>
      activityTimestampMs(b.lastActivityAt) - activityTimestampMs(a.lastActivityAt),
    );
  }, [leadDetailsMap, sends.data, replyOutcomeMap]);

  const selectedLeadDetails = selectedLeadId ? leadDetailsMap[selectedLeadId] ?? null : null;
  const selectedSummary = selectedLeadId
    ? summaries.find((summary) => summary.leadId === selectedLeadId) ?? null
    : null;
  const selectedIcpProfileId = selectedLeadDetails?.latestIcpProfileId
    ?? selectedDrafts.data?.items[0]?.icpProfileId
    ?? null;

  const sentDraftIds = useMemo(() => {
    const ids = new Set<string>();
    for (const send of sends.data?.items ?? []) {
      ids.add(send.messageDraftId);
    }
    return ids;
  }, [sends.data]);

  const unsentDrafts = useMemo(
    () => (drafts.data?.items ?? []).filter((draft) => !sentDraftIds.has(draft.id)),
    [drafts.data, sentDraftIds],
  );

  const selectedUnsentDrafts = useMemo(
    () => (selectedDrafts.data?.items ?? []).filter((draft) => !sentDraftIds.has(draft.id)),
    [selectedDrafts.data, sentDraftIds],
  );

  const trashedSet = useMemo(() => new Set(trashedMessageKeys), [trashedMessageKeys]);

  const folderCounts = useMemo(() => {
    return {
      INBOX: summaries.filter((summary) => summary.latestReply).length,
      SENT: summaries.filter((summary) => !summary.latestReply && !summary.hasProblem).length,
      DRAFTS: unsentDrafts.length,
      FAILED: summaries.filter((summary) => summary.hasProblem).length,
      TRASH: trashedMessageKeys.length,
    } satisfies Record<InboxFolder, number>;
  }, [summaries, trashedMessageKeys.length, unsentDrafts.length]);

  // Filter summaries
  const filtered = useMemo(() => {
    let items = activeFolder === 'TRASH'
      ? summaries.filter((summary) => trashedMessageKeys.some((key) => key.startsWith(`${summary.leadId}:`)))
      : summaries;
    if (activeFolder === 'INBOX') {
      items = items.filter((summary) => summary.latestReply);
    } else if (activeFolder === 'SENT') {
      items = items.filter((summary) => !summary.latestReply && !summary.hasProblem);
    } else if (activeFolder === 'FAILED') {
      items = items.filter((summary) => summary.hasProblem);
    } else if (activeFolder === 'DRAFTS') {
      items = [];
    }
    if (channelFilter !== 'ALL') {
      items = items.filter((s) => s.channel === channelFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (s) => s.leadName.toLowerCase().includes(q) || s.leadEmail.toLowerCase().includes(q) || s.leadId.toLowerCase().includes(q),
      );
    }
    return items;
  }, [activeFolder, channelFilter, searchQuery, summaries, trashedMessageKeys]);

  const filteredDrafts = useMemo((): MessageDraftResponse[] => {
    if (activeFolder !== 'DRAFTS') return [];
    let items = unsentDrafts;
    if (channelFilter !== 'ALL') {
      items = items.filter((draft) => draft.variants.some((variant) => variant.channel === channelFilter));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((draft) => {
        const details = leadDetailsMap[draft.leadId];
        const selectedVariant = draft.variants.find((variant) => variant.isSelected) ?? draft.variants[0];
        return (
          draft.id.toLowerCase().includes(q)
          || (details?.name ?? '').toLowerCase().includes(q)
          || (details?.email ?? '').toLowerCase().includes(q)
          || (selectedVariant?.subject ?? '').toLowerCase().includes(q)
          || selectedVariant?.bodyText.toLowerCase().includes(q)
        );
      });
    }
    return items;
  }, [activeFolder, channelFilter, leadDetailsMap, searchQuery, unsentDrafts]);

  const refreshMessaging = useCallback(() => {
    sends.refetch();
    drafts.refetch();
    selectedDrafts.refetch();
    conversation.refetch();
  }, [conversation, drafts, selectedDrafts, sends]);
  const waitForDraftCompletion = useDraftCompletionNotifier({
    apiClient,
    onCompleted: refreshMessaging,
  });

  const handleMoveEntryToTrash = useCallback((entry: ConversationEntry) => {
    if (!selectedLeadId) return;
    const key = conversationEntryKey(selectedLeadId, entry);
    setTrashedMessageKeys((current) => Array.from(new Set([...current, key])));
    toast.success('Message moved to Trash');
  }, [selectedLeadId]);

  const handleRestoreEntry = useCallback((entry: ConversationEntry) => {
    if (!selectedLeadId) return;
    const key = conversationEntryKey(selectedLeadId, entry);
    setTrashedMessageKeys((current) => current.filter((item) => item !== key));
    toast.success('Message restored');
  }, [selectedLeadId]);

  const handleCreateManualDraft = useCallback(async () => {
    if (!selectedLeadId || !selectedIcpProfileId) {
      toast.error('This lead does not have an ICP profile, so an in-app reply draft cannot be created.');
      return;
    }
    if (!manualBody.trim()) {
      toast.error('Write a reply before saving a draft.');
      return;
    }

    setManualDraftAction('saving');
    try {
      await apiClient.createManualDraft({
        leadId: selectedLeadId,
        icpProfileId: selectedIcpProfileId,
        channel: 'EMAIL',
        subject: manualSubject.trim() || undefined,
        bodyText: manualBody.trim(),
        ...(selectedSummary?.latestSendId ? { parentMessageSendId: selectedSummary.latestSendId } : {}),
      });
      setManualSubject('');
      setManualBody('');
      refreshMessaging();
      toast.success('Reply draft saved. Review it in Inbox draft review. No message was sent.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to save reply draft');
    } finally {
      setManualDraftAction(null);
    }
  }, [
    apiClient,
    manualBody,
    manualSubject,
    refreshMessaging,
    selectedIcpProfileId,
    selectedLeadId,
    selectedSummary?.latestSendId,
  ]);

  const visibleConversationEntries = useMemo(() => {
    if (!selectedLeadId) return [];
    const entries = conversation.data?.entries ?? [];
    return entries.filter((entry) => {
      const isTrashed = trashedSet.has(conversationEntryKey(selectedLeadId, entry));
      return activeFolder === 'TRASH' ? isTrashed : !isTrashed;
    });
  }, [activeFolder, conversation.data, selectedLeadId, trashedSet]);

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
      {/* Left panel: conversation list */}
      <div className="flex w-[360px] min-h-0 shrink-0 flex-col border-r border-border/50">
        {/* Search + filter */}
        <div className="space-y-2 border-b border-border/50 p-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'INBOX' as const, label: 'Inbox', icon: InboxIcon },
              { id: 'SENT' as const, label: 'Sent', icon: Send },
              { id: 'DRAFTS' as const, label: 'Draft Review', icon: FileText },
              { id: 'FAILED' as const, label: 'Needs review', icon: RefreshCw },
              { id: 'TRASH' as const, label: 'Trash', icon: Trash2 },
            ].map((folder) => {
              const Icon = folder.icon;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setActiveFolder(folder.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                    activeFolder === folder.id
                      ? 'border-primary/50 bg-primary/15 text-primary'
                      : 'border-border/40 bg-muted/10 text-muted-foreground hover:bg-muted/20'
                  } ${folder.id === 'TRASH' ? 'col-span-2' : ''}`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {folder.label}
                  </span>
                  <span className="rounded-full bg-zbooni-dark/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {folderCounts[folder.id]}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeFolder === 'DRAFTS' ? 'Search drafts...' : 'Search conversations...'}
              className="w-full rounded-lg border border-border/50 bg-zbooni-dark/40 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex gap-1.5">
            {['ALL', 'EMAIL', 'WHATSAPP'].map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter(ch)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                  channelFilter === ch
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/20 text-muted-foreground hover:bg-muted/40'
                }`}
              >
                {ch === 'ALL' ? 'All' : ch === 'EMAIL' ? 'Email' : 'WhatsApp'}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {sends.isLoading || drafts.isLoading ? (
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
              <span className="ml-2">Loading...</span>
            </div>
          ) : filtered.length === 0 && filteredDrafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <InboxIcon className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground/60">
                {activeFolder === 'DRAFTS' ? 'No drafts to review' : 'No conversations in this folder'}
              </p>
            </div>
          ) : activeFolder === 'DRAFTS' ? (
            filteredDrafts.map((draft) => {
              const details = leadDetailsMap[draft.leadId];
              const selectedVariant = draft.variants.find((variant) => variant.isSelected) ?? draft.variants[0];
              return (
                <button
                  key={draft.id}
                  type="button"
                  onClick={() => setSelectedLeadId(draft.leadId)}
                  className={`w-full border-b border-border/30 px-4 py-3 text-left transition-colors hover:bg-muted/10 ${
                    selectedLeadId === draft.leadId ? 'bg-muted/15' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{details?.name ?? draft.leadId.slice(0, 8)}</p>
                      {details?.email ? (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">{details.email}</p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${channelBadge(selectedVariant?.channel ?? 'EMAIL')}`}>
                          {(selectedVariant?.channel ?? 'EMAIL') === 'WHATSAPP' ? <Phone className="h-2.5 w-2.5" /> : <Mail className="h-2.5 w-2.5" />}
                          {(selectedVariant?.channel ?? 'EMAIL') === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-300">
                          {draft.approvalStatus}
                        </span>
                      </div>
                    </div>
                    <p className="shrink-0 text-[10px] text-muted-foreground/40">
                      {new Date(draft.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground/60">
                    {selectedVariant?.subject ? `Subject: ${selectedVariant.subject}` : selectedVariant?.bodyText ?? 'Draft message'}
                  </p>
                </button>
              );
            })
          ) : (
            filtered.map((summary) => (
              <button
                key={summary.leadId}
                type="button"
                onClick={() => setSelectedLeadId(summary.leadId)}
                className={`w-full border-b border-border/30 px-4 py-3 text-left transition-colors hover:bg-muted/10 ${
                  selectedLeadId === summary.leadId ? 'bg-muted/15' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{summary.leadName}</p>
                    {summary.leadEmail ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">{summary.leadEmail}</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${channelBadge(summary.channel)}`}>
                        {summary.channel === 'WHATSAPP' ? <Phone className="h-2.5 w-2.5" /> : <Mail className="h-2.5 w-2.5" />}
                        {summary.channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
                      </span>
                      {summary.hasProblem ? (
                        <span className="inline-flex items-center rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                          Needs review
                        </span>
                      ) : null}
                      {summary.latestReply ? (
                        <span className="inline-flex items-center rounded-full bg-zbooni-green/15 px-1.5 py-0.5 text-[10px] font-semibold text-zbooni-green">
                          {summary.latestReply.channel === 'WHATSAPP' ? 'WhatsApp reply' : 'Reply received'}
                        </span>
                      ) : null}
                      {summary.latestReply?.classification ? (
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${classificationColor(summary.latestReply.classification)}`}>
                          {summary.latestReply.classification}
                        </span>
                      ) : null}
                      {summary.replyCount > 1 ? (
                        <span className="inline-flex items-center rounded-full bg-muted/20 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {summary.replyCount} replies
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="shrink-0 text-[10px] text-muted-foreground/40">
                    {new Date(summary.lastActivityAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground/60">{summary.lastMessage}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel: conversation thread */}
      <div className="flex flex-1 flex-col">
        {!selectedLeadId ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-12 w-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground/60">Select a conversation to view</p>
            </div>
          </div>
        ) : conversation.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="border-b border-border/50 px-6 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">
                  Conversation with {selectedLeadDetails?.name ?? selectedLeadId.slice(0, 8)}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground/70">
                  {selectedLeadDetails?.email ? (
                    <a className="hover:text-primary" href={`mailto:${selectedLeadDetails.email}`}>
                      To: {selectedLeadDetails.email}
                    </a>
                  ) : null}
                  {selectedLeadDetails?.businessEmail && selectedLeadDetails.businessEmail !== selectedLeadDetails.email ? (
                    <a className="hover:text-primary" href={`mailto:${selectedLeadDetails.businessEmail}`}>
                      Business: {selectedLeadDetails.businessEmail}
                    </a>
                  ) : null}
                  <span>From: {OUTBOUND_EMAIL}</span>
                  {selectedLeadDetails?.companyName ? <span>{selectedLeadDetails.companyName}</span> : null}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {visibleConversationEntries.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground/60">
                  {activeFolder === 'TRASH' ? 'No trashed messages in this conversation' : 'No messages in this conversation'}
                </p>
              ) : null}

              {visibleConversationEntries.map((entry: ConversationEntry, i: number) => {
                const isTrashed = selectedLeadId
                  ? trashedSet.has(conversationEntryKey(selectedLeadId, entry))
                  : false;

                return (
                  <div key={`${entry.type}:${entry.id}`}>
                    {/* Visual separator between messages */}
                    {i > 0 ? (
                      <div className="my-4 flex items-center gap-3">
                        <div className="h-px flex-1 bg-border/30" />
                        <span className="text-[10px] text-muted-foreground/40">
                          {new Date(entry.timestamp).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <div className="h-px flex-1 bg-border/30" />
                      </div>
                    ) : null}
                    <div
                      className={`flex ${entry.type === 'sent' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                          entry.type === 'sent'
                            ? 'bg-blue-600/20 text-foreground'
                            : 'bg-muted/30 text-foreground'
                        }`}
                      >
                        <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground/50">
                          {entry.type === 'sent'
                            ? `From ${OUTBOUND_EMAIL}${selectedLeadDetails?.email ? ` to ${selectedLeadDetails.email}` : ''}`
                            : `From ${selectedLeadDetails?.email ?? 'lead'} to ${OUTBOUND_EMAIL}`}
                        </p>
                        {entry.subject ? (
                          <p className="mb-1 text-xs font-semibold text-muted-foreground/70">
                            Subject: {entry.subject}
                          </p>
                        ) : null}
                        <div className="text-sm leading-relaxed">
                          {entry.bodyHtml ? (
                            <div
                              dangerouslySetInnerHTML={{
                                __html: DOMPurify.sanitize(entry.bodyHtml),
                              }}
                            />
                          ) : (
                            entry.bodyText.split('\n\n').map((paragraph, pIdx) => (
                              <p key={pIdx} className={pIdx > 0 ? 'mt-3' : ''}>
                                {paragraph.split('\n').map((line, lIdx, arr) => (
                                  <span key={lIdx}>
                                    {line}
                                    {lIdx < arr.length - 1 ? <br /> : null}
                                  </span>
                                ))}
                              </p>
                            ))
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${channelBadge(entry.channel)}`}>
                            {entry.channel}
                          </span>
                          {entry.replyClassification ? (
                            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${classificationColor(entry.replyClassification)}`}>
                              {entry.replyClassification}
                            </span>
                          ) : null}
                          {entry.status ? (
                            <span className="text-[10px] text-muted-foreground/50">{entry.status}</span>
                          ) : null}
                          <span className="text-[10px] text-muted-foreground/40">
                            {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (isTrashed) {
                                handleRestoreEntry(entry);
                              } else {
                                handleMoveEntryToTrash(entry);
                              }
                            }}
                            className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted/35"
                          >
                            {isTrashed ? <Undo2 className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
                            {isTrashed ? 'Restore' : 'Move to Trash'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {activeFolder !== 'TRASH' && selectedUnsentDrafts.length ? (
                <div className="border-t border-border/40 pt-5">
                  <div className="mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Draft review for this lead</h3>
                  </div>
                  <div className="space-y-3">
                    {selectedUnsentDrafts.map((draft) => (
                      <MessageDraftCard
                        key={draft.id}
                        draft={draft}
                        leadName={selectedLeadDetails?.name}
                        companyName={selectedLeadDetails?.companyName ?? undefined}
                        initialSend={null}
                        initialSendLoaded={!sends.isLoading}
                        onAction={refreshMessaging}
                        onQueuedRegenerate={(queuedDraft) => {
                          waitForDraftCompletion({
                            leadId: queuedDraft.leadId,
                            afterMs: Date.now() - 5_000,
                            excludeDraftId: queuedDraft.id,
                            forceRegenerate: true,
                          });
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {activeFolder !== 'TRASH' ? (
            <div className="border-t border-border/50 bg-zbooni-dark/20 px-6 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <PenLine className="h-4 w-4 text-primary" />
                    Write a reply
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground/60">
                    Saves an email draft for {selectedLeadDetails?.email ?? 'this lead'}; outbound delivery is disabled for the demo.
                  </p>
                </div>
                {!selectedIcpProfileId ? (
                  <span className="rounded-full bg-yellow-500/15 px-2 py-1 text-[10px] font-semibold text-yellow-300">
                    Missing ICP
                  </span>
                ) : null}
              </div>
              <div className="grid gap-2">
                <input
                  value={manualSubject}
                  onChange={(event) => setManualSubject(event.target.value)}
                  placeholder="Subject"
                  className="w-full rounded-lg border border-border/50 bg-zbooni-dark/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <textarea
                  value={manualBody}
                  onChange={(event) => setManualBody(event.target.value)}
                  placeholder="Write the reply..."
                  rows={4}
                  className="w-full resize-none rounded-lg border border-border/50 bg-zbooni-dark/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-muted-foreground/55">
                    The draft is saved for review only; outbound delivery is disabled for the demo.
                  </p>
                  <button
                    type="button"
                    disabled={manualDraftAction === 'saving' || !manualBody.trim() || !selectedIcpProfileId}
                    onClick={handleCreateManualDraft}
                    className="zbooni-gradient-bg inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-zbooni-dark transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {manualDraftAction === 'saving' ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    Save Reply Draft
                  </button>
                </div>
              </div>
            </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

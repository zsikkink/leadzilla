'use client';

/**
 * INBOX DATA: All data is REAL from the API.
 * - Conversation list: fetched via apiClient.listSends() — actual MessageSend records
 * - Lead names: resolved via apiClient.getLead() for each unique leadId
 * - Conversation threads: fetched via apiClient.getConversation(leadId)
 * - No fake/seed data is hardcoded here. If the inbox appears empty, there are no sends in the DB.
 */

import type { ConversationEntry, ConversationResponse, GetLeadResponse, MessageSendResponse } from '@lead-flood/contracts';
import DOMPurify from 'dompurify';
import {
  Inbox as InboxIcon,
  Mail,
  MessageSquare,
  Phone,
  Search,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

// ── Classification badge colors ────────────────────
function classificationColor(classification: string | null): string {
  switch (classification) {
    case 'INTERESTED': return 'bg-emerald-500/15 text-emerald-400';
    case 'NOT_INTERESTED': return 'bg-red-500/15 text-red-400';
    case 'OUT_OF_OFFICE': return 'bg-yellow-500/15 text-yellow-400';
    case 'NOT_INTERESTED': return 'bg-red-500/15 text-red-400';
    default: return 'bg-muted/20 text-muted-foreground';
  }
}

function channelBadge(channel: string): string {
  return channel === 'WHATSAPP'
    ? 'bg-emerald-500/15 text-emerald-400'
    : 'bg-blue-500/15 text-blue-400';
}

function activityTimestampMs(timestamp: string | null | undefined): number {
  return timestamp ? new Date(timestamp).getTime() : 0;
}

// ── Types ────────────────────────────────────────────
interface LeadReplyOutcomeSummary {
  occurredAt: string;
  classification: string | null;
  channel: MessageSendResponse['channel'] | null;
}

interface LeadConversationSummary {
  leadId: string;
  leadName: string;
  leadEmail: string;
  lastMessage: string;
  lastActivityAt: string;
  channel: MessageSendResponse['channel'];
  replyCount: number;
  latestReply: LeadReplyOutcomeSummary | null;
}

export default function InboxPage() {
  const { apiClient } = useAuth();
  const searchParams = useSearchParams();
  const requestedLeadId = searchParams.get('leadId');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');

  // Fetch all recent sends to build conversation list
  const sends = useApiQuery(
    useCallback(() => apiClient.listSends({ page: 1, pageSize: 100 }), [apiClient]),
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

  // Batch-fetch lead details for display names
  const [leadNameMap, setLeadNameMap] = useState<Record<string, string>>({});
  const [replyOutcomeMap, setReplyOutcomeMap] = useState<Record<string, LeadReplyOutcomeSummary>>({});

  const leadIds = useMemo(() => {
    if (!sends.data?.items) return [];
    const ids = new Set<string>();
    for (const send of sends.data.items) {
      ids.add(send.leadId);
    }
    return Array.from(ids);
  }, [sends.data]);

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
  }, [requestedLeadId]);

  useEffect(() => {
    if (leadIds.length === 0) return;

    let cancelled = false;

    void Promise.allSettled(
      leadIds.map((id) => apiClient.getLead(id)),
    ).then((results) => {
      if (cancelled) return;

      const nameMap: Record<string, string> = {};
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const leadId = leadIds[i];
        if (!result || !leadId) continue;

        if (result.status === 'fulfilled') {
          const lead: GetLeadResponse = result.value;
          const fullName = `${lead.firstName} ${lead.lastName}`.trim();
          if (fullName) {
            nameMap[leadId] = fullName;
          } else {
            // Fall back to company name from enrichmentData
            const enrichment = lead.enrichmentData as Record<string, unknown> | null | undefined;
            const companyName = enrichment?.companyName as string | undefined;
            if (companyName) {
              nameMap[leadId] = companyName;
            }
          }
        }
      }

      setLeadNameMap(nameMap);
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

      result.push({
        leadId,
        leadName: leadNameMap[leadId] ?? leadId.slice(0, 8),
        leadEmail: '',
        lastMessage,
        lastActivityAt,
        channel,
        replyCount,
        latestReply,
      });
    }

    return result.sort((a, b) =>
      activityTimestampMs(b.lastActivityAt) - activityTimestampMs(a.lastActivityAt),
    );
  }, [sends.data, leadNameMap, replyOutcomeMap]);

  // Filter summaries
  const filtered = useMemo(() => {
    let items = summaries;
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
  }, [summaries, channelFilter, searchQuery]);

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
      {/* Left panel: conversation list */}
      <div className="flex w-[360px] min-h-0 shrink-0 flex-col border-r border-border/50">
        {/* Search + filter */}
        <div className="space-y-2 border-b border-border/50 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
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
          {sends.isLoading ? (
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
              <span className="ml-2">Loading...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <InboxIcon className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground/60">No conversations yet</p>
            </div>
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
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${channelBadge(summary.channel)}`}>
                        {summary.channel === 'WHATSAPP' ? <Phone className="h-2.5 w-2.5" /> : <Mail className="h-2.5 w-2.5" />}
                        {summary.channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
                      </span>
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
              <h2 className="text-sm font-semibold">Conversation with {leadNameMap[selectedLeadId] ?? selectedLeadId.slice(0, 8)}</h2>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {conversation.data?.entries.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground/60">No messages in this conversation</p>
              ) : null}

              {conversation.data?.entries.map((entry: ConversationEntry, i: number) => (
                <div key={i}>
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
                    <div className="mt-2 flex items-center gap-2">
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
                    </div>
                  </div>
                </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

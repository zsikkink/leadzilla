'use client';

import {
  Archive,
  ArrowLeft,
  CalendarCheck2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Inbox,
  Mail,
  MoreVertical,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Star,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  DEMO_INBOX_CONVERSATIONS,
  DEMO_INBOX_DRAFTS,
  DEMO_INBOX_LEADS,
  DEMO_OPERATING_TOTALS,
  type DemoInboxConversation,
  type DemoInboxMessageEvent,
} from '../lib/demo-operating-narrative.js';
import { cn } from '../lib/utils.js';

type DemoInboxFolder = 'INBOX' | 'STARRED' | 'SENT' | 'DRAFTS' | 'SCHEDULED' | 'NURTURE';

const FOLDERS = [
  { id: 'INBOX' as const, label: 'Inbox', icon: Inbox },
  { id: 'STARRED' as const, label: 'Starred', icon: Star },
  { id: 'SENT' as const, label: 'Sent', icon: Send },
  { id: 'DRAFTS' as const, label: 'Drafts', icon: FileText },
  { id: 'SCHEDULED' as const, label: 'Scheduled', icon: CalendarClock },
  { id: 'NURTURE' as const, label: 'Nurture', icon: Clock3 },
] as const;

const leadById = new Map(DEMO_INBOX_LEADS.map((lead) => [lead.id, lead]));
const draftsByLeadId = new Map(
  DEMO_INBOX_LEADS.map((lead) => [
    lead.id,
    DEMO_INBOX_DRAFTS.filter((draft) => draft.leadId === lead.id),
  ]),
);

function formatMailboxDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function formatMessageDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatMeetingDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function conversationHasReply(conversation: DemoInboxConversation): boolean {
  return conversation.events.some((event) => event.kind === 'message' && event.direction === 'inbound');
}

function conversationHasOutbound(conversation: DemoInboxConversation): boolean {
  return conversation.events.some((event) => event.kind === 'message' && event.direction === 'outbound');
}

function conversationHasMeeting(conversation: DemoInboxConversation): boolean {
  return conversation.events.some((event) => event.kind === 'meeting');
}

function conversationSubject(conversation: DemoInboxConversation): string {
  const subject = [...conversation.events]
    .reverse()
    .find((event): event is DemoInboxMessageEvent => event.kind === 'message' && Boolean(event.subject))
    ?.subject;
  return subject ?? `${leadById.get(conversation.leadId)?.company ?? 'Lead'} conversation`;
}

function stageClasses(stage: DemoInboxConversation['stage']): string {
  switch (stage) {
    case 'Meeting booked':
      return 'bg-emerald-400/10 text-emerald-300';
    case 'Interested':
      return 'bg-cyan-400/10 text-cyan-300';
    case 'Nurture':
      return 'bg-violet-400/10 text-violet-300';
    case 'Draft review':
      return 'bg-amber-400/10 text-amber-300';
    case 'Closed':
      return 'bg-white/5 text-white/45';
  }
}

function classificationLabel(classification: DemoInboxMessageEvent['classification']): string | null {
  if (!classification) return null;
  return {
    INTERESTED: 'Interested',
    NOT_INTERESTED: 'Not interested',
    NOT_NOW: 'Not now',
    OUT_OF_OFFICE: 'Out of office',
  }[classification];
}

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

interface DemoMailboxRow {
  id: string;
  conversation: DemoInboxConversation;
  activityAt: string;
  sender: string;
  subject: string;
  preview: string;
  unread: boolean;
}

const MAILBOX_PAGE_SIZE = 50;

export function DemoInboxShowcase() {
  const [activeFolder, setActiveFolder] = useState<DemoInboxFolder>('INBOX');
  const [searchQuery, setSearchQuery] = useState('');
  const [mailboxPage, setMailboxPage] = useState(0);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [starredConversationIds, setStarredConversationIds] = useState<Set<string>>(
    () => new Set(['conversation-aster-stone', 'conversation-northline-wellness']),
  );
  const [composeDraft, setComposeDraft] = useState<{
    to: string;
    subject: string;
    body: string;
  } | null>(null);

  const folderCount = (folder: DemoInboxFolder): number => {
    switch (folder) {
      case 'INBOX':
        return DEMO_OPERATING_TOTALS.replies;
      case 'STARRED':
        return starredConversationIds.size;
      case 'SENT':
        return DEMO_OPERATING_TOTALS.sent;
      case 'DRAFTS':
        return DEMO_INBOX_DRAFTS.length;
      case 'SCHEDULED':
        return DEMO_OPERATING_TOTALS.meetings;
      case 'NURTURE':
        return DEMO_INBOX_CONVERSATIONS.filter((conversation) => conversation.stage === 'Nurture').length;
    }
  };

  const filteredRows = useMemo((): DemoMailboxRow[] => {
    const query = searchQuery.trim().toLowerCase();
    const rows = DEMO_INBOX_CONVERSATIONS.flatMap((conversation): DemoMailboxRow[] => {
        const lead = leadById.get(conversation.leadId);
        if (!lead) return [];
        const folderMatch =
          (activeFolder === 'INBOX' && conversationHasReply(conversation))
          || (activeFolder === 'STARRED' && starredConversationIds.has(conversation.id))
          || (activeFolder === 'SENT' && conversationHasOutbound(conversation))
          || (activeFolder === 'DRAFTS' && (draftsByLeadId.get(conversation.leadId)?.length ?? 0) > 0)
          || (activeFolder === 'SCHEDULED' && conversationHasMeeting(conversation))
          || (activeFolder === 'NURTURE' && conversation.stage === 'Nurture');
        if (!folderMatch) return [];

        if (activeFolder === 'SENT') {
          return conversation.events.flatMap((event): DemoMailboxRow[] => {
            if (event.kind !== 'message' || event.direction !== 'outbound') return [];
            const subject = event.subject ?? conversationSubject(conversation);
            const preview = event.body.replace(/\s+/g, ' ').trim();
            const queryMatch = !query || [lead.company, lead.contactName, lead.email, subject, preview]
              .some((value) => value.toLowerCase().includes(query));
            return queryMatch ? [{
              id: `${conversation.id}:${event.id}`,
              conversation,
              activityAt: event.timestamp,
              sender: `To: ${lead.contactName}`,
              subject,
              preview,
              unread: false,
            }] : [];
          });
        }

        const subject = conversationSubject(conversation);
        const sender = conversationHasReply(conversation) ? lead.contactName : 'Jordan Davis';
        const queryMatch = !query || [
          lead?.company,
          lead?.contactName,
          lead?.email,
          subject,
          conversation.preview,
        ].some((value) => value?.toLowerCase().includes(query));
        return queryMatch ? [{
          id: conversation.id,
          conversation,
          activityAt: conversation.lastActivityAt,
          sender,
          subject,
          preview: conversation.preview,
          unread: conversation.unreadCount > 0,
        }] : [];
      });
    return rows.sort((a, b) => new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime());
  }, [activeFolder, searchQuery, starredConversationIds]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / MAILBOX_PAGE_SIZE));
  const safeMailboxPage = Math.min(mailboxPage, pageCount - 1);
  const visibleRows = filteredRows.slice(
    safeMailboxPage * MAILBOX_PAGE_SIZE,
    (safeMailboxPage + 1) * MAILBOX_PAGE_SIZE,
  );
  const visibleFolderTotal = searchQuery.trim()
    ? filteredRows.length
    : folderCount(activeFolder);

  const selectedConversation = selectedConversationId
    ? DEMO_INBOX_CONVERSATIONS.find((conversation) => conversation.id === selectedConversationId) ?? null
    : null;
  const selectedLead = selectedConversation ? leadById.get(selectedConversation.leadId) ?? null : null;
  const selectedDrafts = selectedConversation
    ? draftsByLeadId.get(selectedConversation.leadId) ?? []
    : [];

  const openCompose = (conversation?: DemoInboxConversation | null) => {
    const lead = conversation ? leadById.get(conversation.leadId) : null;
    setComposeDraft({
      to: lead?.email ?? '',
      subject: conversation ? `Re: ${conversationSubject(conversation).replace(/^Re:\s*/i, '')}` : '',
      body: '',
    });
  };

  const explainBlockedSend = () => {
    toast.info('Sending is unavailable in the public demo. This message remains saved as a draft.');
  };

  const toggleStar = (conversationId: string) => {
    setStarredConversationIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  };

  return (
    <div className="h-[calc(100vh-7rem)] min-h-[600px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111219] shadow-xl">
      <div className="grid h-full grid-cols-[68px_minmax(0,1fr)] xl:grid-cols-[216px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-white/[0.07] bg-[#0e0f15] py-3">
          <div className="px-2 xl:px-3">
            <button
              type="button"
              onClick={() => openCompose()}
              className="zbooni-gradient-bg flex h-12 w-12 items-center justify-center rounded-2xl font-bold text-zbooni-dark shadow-lg shadow-zbooni-green/10 transition-transform hover:-translate-y-0.5 xl:w-full xl:justify-start xl:gap-3 xl:px-4"
            >
              <Pencil className="h-4 w-4 shrink-0" />
              <span className="hidden text-sm xl:inline">Compose</span>
            </button>
          </div>

          <nav className="mt-4 space-y-1 px-2" aria-label="Mailbox folders">
            {FOLDERS.map((folder) => {
              const Icon = folder.icon;
              const isActive = activeFolder === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  title={folder.label}
                  onClick={() => {
                    setActiveFolder(folder.id);
                    setMailboxPage(0);
                    setSelectedConversationId(null);
                  }}
                  className={cn(
                    'flex h-10 w-full items-center justify-center rounded-full text-sm transition-colors xl:justify-start xl:gap-3 xl:px-4',
                    isActive
                      ? 'bg-zbooni-teal/15 font-semibold text-zbooni-teal'
                      : 'text-white/55 hover:bg-white/[0.055] hover:text-white/85',
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="hidden min-w-0 flex-1 truncate text-left xl:block">{folder.label}</span>
                  <span className="hidden text-xs tabular-nums text-white/35 xl:block">{folderCount(folder.id)}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto hidden px-6 pb-2 text-[11px] leading-5 text-white/30 xl:block">
            {DEMO_OPERATING_TOTALS.sent} messages processed<br />June–July 2026
          </div>
        </aside>

        <section className="flex min-w-0 flex-col">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.07] px-3 sm:px-5">
            <label className="relative max-w-3xl flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <span className="sr-only">Search mail</span>
              <input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setMailboxPage(0);
                  setSelectedConversationId(null);
                }}
                placeholder="Search mail"
                className="h-11 w-full rounded-full border border-transparent bg-white/[0.055] pl-11 pr-4 text-sm text-white outline-none placeholder:text-white/35 focus:border-zbooni-teal/35 focus:bg-white/[0.075] focus:ring-2 focus:ring-zbooni-teal/10"
              />
            </label>
            <IconButton label="Refresh mailbox">
              <RefreshCw className="h-4 w-4" />
            </IconButton>
            <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-zbooni-teal/15 text-xs font-bold text-zbooni-teal sm:flex">
              JD
            </div>
          </header>

          <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.07] px-3 sm:px-5">
            <div className="flex items-center gap-1">
              {selectedConversation ? (
                <IconButton label="Back to inbox" onClick={() => setSelectedConversationId(null)}>
                  <ArrowLeft className="h-4 w-4" />
                </IconButton>
              ) : (
                <label className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/[0.07]">
                  <span className="sr-only">Select all messages</span>
                  <input type="checkbox" className="h-3.5 w-3.5 accent-zbooni-teal" />
                </label>
              )}
              <IconButton label="Archive">
                <Archive className="h-4 w-4" />
              </IconButton>
              <IconButton label="Delete">
                <Trash2 className="h-4 w-4" />
              </IconButton>
              <IconButton label="More options">
                <MoreVertical className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="flex items-center gap-1 text-xs text-white/40">
              <span className="hidden px-2 sm:inline">
                {visibleRows.length === 0
                  ? '0'
                  : `${safeMailboxPage * MAILBOX_PAGE_SIZE + 1}–${safeMailboxPage * MAILBOX_PAGE_SIZE + visibleRows.length}`} of {visibleFolderTotal}
              </span>
              <IconButton
                label="Newer messages"
                disabled={safeMailboxPage === 0}
                onClick={() => setMailboxPage(Math.max(0, safeMailboxPage - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="Older messages"
                disabled={safeMailboxPage >= pageCount - 1}
                onClick={() => setMailboxPage(Math.min(pageCount - 1, safeMailboxPage + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </IconButton>
            </div>
          </div>

          {selectedConversation && selectedLead ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-[#12131a]">
              <div className="mx-auto max-w-5xl px-4 py-5 sm:px-7">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                        {conversationSubject(selectedConversation)}
                      </h2>
                      <span className={cn('rounded-md px-2 py-1 text-[10px] font-semibold', stageClasses(selectedConversation.stage))}>
                        {selectedConversation.stage}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/40">{selectedLead.company} · {selectedLead.segment}</p>
                  </div>
                  <Link
                    href="/dashboard/leads"
                    className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/85"
                  >
                    <UserRound className="h-4 w-4" />
                    View lead
                  </Link>
                </div>

                <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]">
                  {selectedConversation.events.map((event) => {
                    if (event.kind === 'meeting') {
                      return (
                        <div key={event.id} className="border-b border-white/[0.07] px-4 py-4 last:border-b-0 sm:px-6">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-400/10">
                              <CalendarCheck2 className="h-4 w-4 text-emerald-300" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-white">{event.title}</p>
                                <span className="text-xs text-white/35">{formatMessageDate(event.timestamp)}</span>
                              </div>
                              <p className="mt-1 text-sm text-emerald-200">{formatMeetingDate(event.scheduledFor)} · {event.durationMinutes} min</p>
                              <p className="mt-1 text-xs text-white/50">{event.location} · {event.agenda}</p>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (event.kind === 'note') {
                      return (
                        <div key={event.id} className="border-b border-white/[0.07] bg-amber-300/[0.035] px-4 py-3 last:border-b-0 sm:px-6">
                          <div className="flex items-start gap-3">
                            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-200/75" />
                            <div>
                              <p className="text-xs font-semibold text-amber-100">{event.label}</p>
                              <p className="mt-1 text-xs leading-5 text-white/50">{event.body}</p>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const isInbound = event.direction === 'inbound';
                    const classification = classificationLabel(event.classification);
                    return (
                      <article key={event.id} className="border-b border-white/[0.07] px-4 py-5 last:border-b-0 sm:px-6">
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                            isInbound ? 'bg-violet-400/15 text-violet-200' : 'bg-zbooni-teal/15 text-zbooni-teal',
                          )}>
                            {isInbound ? selectedLead.contactName.split(' ').map((part) => part[0]).join('').slice(0, 2) : 'JD'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-white">
                                    {isInbound ? selectedLead.contactName : 'Jordan Davis'}
                                  </p>
                                  {classification ? (
                                    <span className="rounded-md bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                      {classification}
                                    </span>
                                  ) : null}
                                  {event.followUpNumber ? (
                                    <span className="text-[10px] font-medium text-white/35">Follow-up {event.followUpNumber}</span>
                                  ) : null}
                                </div>
                                <p className="mt-0.5 text-xs text-white/35">
                                  {isInbound ? `to me · ${selectedLead.email}` : `to ${selectedLead.contactName} · ${selectedLead.email}`}
                                </p>
                              </div>
                              <span className="text-xs text-white/35">{formatMessageDate(event.timestamp)}</span>
                            </div>
                            <div className="mt-4 space-y-3 whitespace-pre-line text-sm leading-6 text-white/75">
                              {event.body}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {selectedDrafts.map((draft) => (
                  <div key={draft.id} className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">Draft</span>
                        <span className="text-xs text-white/40">to {selectedLead.email}</span>
                      </div>
                      <span className="text-xs text-white/35">{formatMessageDate(draft.createdAt)}</span>
                    </div>
                    {draft.subject ? <p className="mt-3 text-sm font-semibold text-white">{draft.subject}</p> : null}
                    <p className="mt-3 whitespace-pre-line text-sm leading-6 text-white/70">{draft.body}</p>
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={explainBlockedSend}
                        className="zbooni-gradient-bg inline-flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-bold text-zbooni-dark hover:opacity-90"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Send
                      </button>
                      <IconButton label="Attach file">
                        <Paperclip className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                ))}

                {selectedDrafts.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => openCompose(selectedConversation)}
                    className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-white/[0.12] px-4 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white"
                  >
                    <ArrowLeft className="h-4 w-4 rotate-180" />
                    Reply
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredRows.length === 0 ? (
                <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center">
                  <Mail className="h-9 w-9 text-white/15" />
                  <p className="mt-3 text-sm font-medium text-white/60">No messages in this view</p>
                  <p className="mt-1 text-xs text-white/35">Try another folder or search term.</p>
                </div>
              ) : visibleRows.map((row) => {
                const conversation = row.conversation;
                const lead = leadById.get(conversation.leadId);
                if (!lead) return null;
                const isStarred = starredConversationIds.has(conversation.id);
                const unread = row.unread;
                const drafts = draftsByLeadId.get(conversation.leadId) ?? [];
                return (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedConversationId(conversation.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        setSelectedConversationId(conversation.id);
                      }
                    }}
                    className={cn(
                      'group grid min-h-[54px] cursor-pointer grid-cols-[32px_32px_minmax(120px,0.8fr)_minmax(0,2.5fr)_auto] items-center border-b border-white/[0.06] px-2 text-left transition-colors sm:px-4',
                      unread ? 'bg-white/[0.055] text-white' : 'bg-[#111219] text-white/70 hover:bg-white/[0.035]',
                    )}
                  >
                    <label className="inline-flex h-8 w-8 items-center justify-center" onClick={(event) => event.stopPropagation()}>
                      <span className="sr-only">Select message from {lead.contactName}</span>
                      <input type="checkbox" className="h-3.5 w-3.5 accent-zbooni-teal" />
                    </label>
                    <button
                      type="button"
                      aria-label={isStarred ? 'Remove star' : 'Add star'}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleStar(conversation.id);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.06]"
                    >
                      <Star className={cn('h-4 w-4', isStarred ? 'fill-amber-300 text-amber-300' : 'text-white/25')} />
                    </button>
                    <p className={cn('truncate pr-4 text-sm', unread ? 'font-bold' : 'font-medium')}>{row.sender}</p>
                    <div className="flex min-w-0 items-center gap-2 overflow-hidden text-sm">
                      {drafts.length > 0 ? (
                        <span className="shrink-0 font-semibold text-amber-300">Draft</span>
                      ) : null}
                      <span className={cn('shrink-0 truncate', unread ? 'font-semibold text-white' : 'text-white/70')}>
                        {row.subject}
                      </span>
                      <span className="hidden shrink-0 text-white/20 sm:inline">—</span>
                      <span className="hidden min-w-0 truncate text-white/35 sm:block">{row.preview}</span>
                    </div>
                    <div className="ml-3 flex items-center gap-3">
                      <span className={cn('hidden rounded px-2 py-0.5 text-[10px] font-semibold lg:inline', stageClasses(conversation.stage))}>
                        {conversation.stage}
                      </span>
                      <span className={cn('w-12 text-right text-xs tabular-nums', unread ? 'font-semibold text-white' : 'text-white/40')}>
                        {formatMailboxDate(row.activityAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {composeDraft ? (
        <div className="fixed bottom-4 right-4 z-50 flex h-[min(520px,calc(100vh-2rem))] w-[min(520px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-white/[0.12] bg-[#171820] shadow-2xl shadow-black/60">
          <div className="flex h-11 shrink-0 items-center justify-between bg-[#242631] px-4">
            <p className="text-sm font-semibold text-white">New message</p>
            <button
              type="button"
              aria-label="Close compose"
              onClick={() => setComposeDraft(null)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/50 hover:bg-white/[0.08] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <label className="flex h-11 shrink-0 items-center border-b border-white/[0.08] px-4 text-sm">
            <span className="mr-2 text-white/40">To</span>
            <input
              value={composeDraft.to}
              onChange={(event) => setComposeDraft({ ...composeDraft, to: event.target.value })}
              className="min-w-0 flex-1 bg-transparent text-white outline-none"
            />
          </label>
          <input
            value={composeDraft.subject}
            onChange={(event) => setComposeDraft({ ...composeDraft, subject: event.target.value })}
            placeholder="Subject"
            className="h-11 shrink-0 border-b border-white/[0.08] bg-transparent px-4 text-sm text-white outline-none placeholder:text-white/35"
          />
          <textarea
            value={composeDraft.body}
            onChange={(event) => setComposeDraft({ ...composeDraft, body: event.target.value })}
            placeholder="Write a message"
            className="min-h-0 flex-1 resize-none bg-transparent p-4 text-sm leading-6 text-white outline-none placeholder:text-white/35"
          />
          <div className="flex h-14 shrink-0 items-center gap-2 border-t border-white/[0.08] px-4">
            <button
              type="button"
              onClick={explainBlockedSend}
              className="zbooni-gradient-bg inline-flex h-9 items-center gap-2 rounded-lg px-5 text-xs font-bold text-zbooni-dark hover:opacity-90"
            >
              Send
              <Send className="h-3.5 w-3.5" />
            </button>
            <IconButton label="Attach file">
              <Paperclip className="h-4 w-4" />
            </IconButton>
            <button
              type="button"
              aria-label="Discard draft"
              onClick={() => setComposeDraft(null)}
              className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full text-white/45 hover:bg-white/[0.07] hover:text-white"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

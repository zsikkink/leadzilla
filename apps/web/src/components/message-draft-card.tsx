'use client';

import type {
  MessageDraftResponse,
  MessageSendResponse,
  MessageVariantResponse,
} from '@lead-flood/contracts';
import { Check, ChevronDown, ChevronUp, Pencil, Send, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '../hooks/use-auth.js';
import type { ApiClient } from '../lib/api-client.js';

interface MessageDraftCardProps {
  draft: MessageDraftResponse;
  leadName?: string | undefined;
  companyName?: string | undefined;
  initialSend?: MessageSendResponse | null;
  initialSendLoaded?: boolean | undefined;
  onAction: () => void;
}

function getApprovalBadge(draft: MessageDraftResponse): { label: string; className: string } {
  switch (draft.approvalStatus) {
    case 'AUTO_APPROVED':
      return {
        label: 'Auto-Approved',
        className: 'bg-zbooni-green/15 text-zbooni-green',
      };
    case 'APPROVED':
      return {
        label: 'Approved',
        className: 'bg-blue-500/15 text-blue-300',
      };
    case 'REJECTED':
      return {
        label: 'Rejected',
        className: 'bg-red-500/15 text-red-400',
      };
    default:
      return {
        label: 'Pending Approval',
        className: 'bg-yellow-500/15 text-yellow-400',
      };
  }
}

function getInitialSendBadge(
  draft: MessageDraftResponse,
  initialSend: MessageSendResponse | null,
  initialSendLoaded: boolean,
): { label: string; className: string; detail?: string | undefined } | null {
  if (draft.followUpNumber !== 0 || !initialSendLoaded) {
    return null;
  }

  if (!initialSend) {
    if (
      draft.approvalStatus === 'APPROVED' ||
      draft.approvalStatus === 'AUTO_APPROVED'
    ) {
      return {
        label: 'No Send Record Yet',
        className: 'bg-muted/20 text-muted-foreground',
      };
    }
    return null;
  }

  if (initialSend.status === 'FAILED' && initialSend.failureCode === 'SUPPRESSED') {
    return {
      label: 'Suppressed',
      className: 'bg-orange-500/15 text-orange-300',
      detail: initialSend.failureReason ?? undefined,
    };
  }

  switch (initialSend.status) {
    case 'QUEUED':
      return {
        label: 'Queued To Send',
        className: 'bg-blue-500/15 text-blue-300',
      };
    case 'SENDING':
      return {
        label: 'Sending',
        className: 'bg-blue-500/15 text-blue-300',
      };
    case 'UNRESOLVED':
      return {
        label: 'Send Unresolved',
        className: 'bg-amber-500/15 text-amber-300',
        detail: initialSend.failureReason ?? undefined,
      };
    case 'SENT':
      return {
        label: 'Sent',
        className: 'bg-zbooni-green/15 text-zbooni-green',
      };
    case 'DELIVERED':
      return {
        label: 'Delivered',
        className: 'bg-zbooni-green/15 text-zbooni-green',
      };
    case 'REPLIED':
      return {
        label: 'Replied',
        className: 'bg-zbooni-green/20 text-zbooni-green',
      };
    case 'BOUNCED':
      return {
        label: 'Bounced',
        className: 'bg-red-500/15 text-red-400',
        detail: initialSend.failureReason ?? undefined,
      };
    case 'FAILED':
      return {
        label: 'Failed',
        className: 'bg-red-500/15 text-red-400',
        detail: initialSend.failureReason ?? undefined,
      };
  }

  return null;
}

function getSendActionLabel(
  draft: MessageDraftResponse,
  initialSend: MessageSendResponse | null,
  initialSendLoaded: boolean,
): string | null {
  const isApproved =
    draft.approvalStatus === 'APPROVED' || draft.approvalStatus === 'AUTO_APPROVED';

  if (!isApproved) {
    return null;
  }

  if (draft.followUpNumber !== 0) {
    return 'Send';
  }

  if (!initialSendLoaded) {
    return null;
  }

  if (!initialSend) {
    return 'Send';
  }

  if (initialSend.status === 'FAILED' && initialSend.failureCode !== 'SUPPRESSED') {
    return 'Retry Send';
  }

  return null;
}

function VariantEditor({
  variant,
  isPending,
  sendActionLabel,
  actionInProgress,
  onApprove,
  onSend,
  apiClient,
  onAction,
}: {
  variant: MessageVariantResponse;
  isPending: boolean;
  sendActionLabel: string | null;
  actionInProgress: string | null;
  onApprove: (variantId: string) => void;
  onSend: (variantId: string) => void;
  apiClient: ApiClient;
  onAction: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(variant.subject ?? '');
  const [editBody, setEditBody] = useState(variant.bodyText);
  const [isSaving, setIsSaving] = useState(false);

  const hasChanges =
    editBody !== variant.bodyText ||
    (variant.subject !== null && editSubject !== variant.subject);

  const handleEditStart = () => {
    setEditSubject(variant.subject ?? '');
    setEditBody(variant.bodyText);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditSubject(variant.subject ?? '');
    setEditBody(variant.bodyText);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!editBody.trim()) return;
    setIsSaving(true);
    try {
      await apiClient.updateVariant(variant.id, {
        bodyText: editBody,
        ...(variant.subject !== null ? { subject: editSubject } : {}),
      });
      toast.success('Message updated');
      setIsEditing(false);
      onAction();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/50 bg-zbooni-dark/40 p-4 transition-colors hover:border-border/70">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Message
          </span>
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              variant.channel === 'WHATSAPP'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-blue-500/15 text-blue-400'
            }`}
          >
            {variant.channel}
          </span>
        </div>
        {!isEditing ? (
          <button
            type="button"
            onClick={handleEditStart}
            disabled={!!actionInProgress}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          {variant.subject !== null ? (
            <div>
              <label htmlFor={`subject-${variant.id}`} className="mb-1 block text-[11px] font-semibold text-muted-foreground/70">Subject</label>
              <input
                id={`subject-${variant.id}`}
                type="text"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                className="w-full rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          ) : null}
          <div>
            <label htmlFor={`body-${variant.id}`} className="mb-1 block text-[11px] font-semibold text-muted-foreground/70">Body</label>
            <textarea
              id={`body-${variant.id}`}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={8}
              className="w-full resize-y rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isSaving || !editBody.trim() || !hasChanges}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1 rounded-lg bg-zbooni-green/20 px-3 py-1.5 text-xs font-semibold text-zbooni-green transition-colors hover:bg-zbooni-green/30 disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleCancel}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {variant.subject ? (
            <p className="mb-1.5 text-sm font-medium text-foreground/90">Subject: {variant.subject}</p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{variant.bodyText}</p>
        </>
      )}

      {!isEditing ? (
        <div className="mt-3 flex gap-2">
          {isPending ? (
            <button
              type="button"
              disabled={!!actionInProgress}
              onClick={() => onApprove(variant.id)}
              className="inline-flex items-center gap-1 rounded-lg bg-zbooni-green/20 px-3 py-1.5 text-xs font-semibold text-zbooni-green transition-colors hover:bg-zbooni-green/30 disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> Approve
            </button>
          ) : null}
          {sendActionLabel ? (
            <button
              type="button"
              disabled={!!actionInProgress}
              onClick={() => onSend(variant.id)}
              className="zbooni-gradient-bg inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-zbooni-dark transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-3 w-3" /> {sendActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MessageDraftCard({
  draft,
  leadName,
  companyName,
  initialSend = null,
  initialSendLoaded = false,
  onAction,
}: MessageDraftCardProps) {
  const { apiClient, user } = useAuth();
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const userId = user?.id ?? 'unknown';

  const handleApprove = async (variantId?: string | undefined) => {
    setActionInProgress('approve');
    setError(null);
    try {
      await apiClient.approveDraft(draft.id, {
        approvedByUserId: userId,
        selectedVariantId: variantId,
      });
      onAction();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSend = async (variantId: string) => {
    setActionInProgress('send');
    setError(null);
    try {
      await apiClient.sendMessage({
        messageDraftId: draft.id,
        messageVariantId: variantId,
        idempotencyKey: `ui:${draft.id}:${variantId}:${Date.now()}`,
      });
      onAction();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setActionInProgress(null);
    }
  };

  const isPending = draft.approvalStatus === 'PENDING';
  const approvalBadge = getApprovalBadge(draft);
  const initialSendBadge = getInitialSendBadge(draft, initialSend, initialSendLoaded);
  const sendActionLabel = getSendActionLabel(draft, initialSend, initialSendLoaded);

  // Determine primary channel from first variant
  const primaryChannel = draft.variants[0]?.channel ?? 'EMAIL';
  const channelLabel = primaryChannel === 'WHATSAPP' ? 'WhatsApp' : 'Email';
  const channelColorClass = primaryChannel === 'WHATSAPP'
    ? 'bg-[#25D366]/15 text-[#25D366]'
    : 'bg-[#3B82F6]/15 text-[#3B82F6]';

  // Build display name
  const displayName = leadName || 'Unknown Lead';
  const companyDisplay = companyName ? `, ${companyName}` : '';

  // Extract a preview from the first variant — longer for full-width display
  const previewVariant = draft.variants[0];
  const previewText = previewVariant
    ? previewVariant.bodyText.length > 240
      ? `${previewVariant.bodyText.slice(0, 240)}...`
      : previewVariant.bodyText
    : 'No variants';

  return (
    <div className="rounded-2xl border border-border/50 bg-card shadow-sm transition-all">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-muted/5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">
              {displayName}{companyDisplay}
            </p>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${approvalBadge.className}`}
            >
              {approvalBadge.label}
            </span>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${channelColorClass}`}
            >
              {channelLabel}
            </span>
            {initialSendBadge ? (
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${initialSendBadge.className}`}
              >
                {initialSendBadge.label}
              </span>
            ) : null}
          </div>
          {!expanded ? (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground/80">{previewText}</p>
          ) : null}
        </div>
        <div className="ml-4 shrink-0 text-muted-foreground/40">
          {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded ? (
        <div className="border-t border-border/30 p-5 pt-4">
          {initialSendBadge?.detail ? (
            <div className="mb-4 rounded-xl border border-border/40 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
              {initialSendBadge.detail}
            </div>
          ) : null}
          <div className="space-y-4">
            {draft.variants.map((variant) => (
              <VariantEditor
                key={variant.id}
                variant={variant}
                isPending={isPending}
                sendActionLabel={sendActionLabel}
                actionInProgress={actionInProgress}
                onApprove={handleApprove}
                onSend={handleSend}
                apiClient={apiClient}
                onAction={onAction}
              />
            ))}
          </div>

          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

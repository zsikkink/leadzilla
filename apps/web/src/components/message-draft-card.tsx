'use client';

import type {
  MessageDraftResponse,
  MessageSendResponse,
  MessageVariantResponse,
} from '@lead-flood/contracts';
import { Check, ChevronDown, ChevronUp, Loader2, Pencil, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '../hooks/use-auth.js';
import type { ApiClient } from '../lib/api-client.js';
import { toSafeDisplayErrorMessage } from '../lib/error-messages.js';

interface MessageDraftCardProps {
  draft: MessageDraftResponse;
  leadName?: string | undefined;
  companyName?: string | undefined;
  initialSend?: MessageSendResponse | null;
  initialSendLoaded?: boolean | undefined;
  onAction: () => void;
  onQueuedRegenerate?: ((draft: MessageDraftResponse) => void) | undefined;
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
        label: 'Draft Only',
        className: 'bg-muted/20 text-muted-foreground',
      };
    }
    return null;
  }

  if (initialSend.status === 'FAILED' && initialSend.failureCode === 'SUPPRESSED') {
      return {
        label: 'Suppressed',
        className: 'bg-orange-500/15 text-orange-300',
        detail: 'Delivery was skipped by workspace safety checks.',
      };
  }

  if (initialSend.status === 'FAILED' && initialSend.failureCode === 'OUTBOUND_DISABLED') {
      return {
        label: 'Delivery Disabled',
        className: 'bg-amber-500/15 text-amber-300',
        detail: 'Outbound delivery is disabled in this demo.',
      };
  }

  switch (initialSend.status) {
    case 'QUEUED':
      return {
        label: 'Delivery Disabled',
        className: 'bg-amber-500/15 text-amber-300',
      };
    case 'SENDING':
      return {
        label: 'Delivery Disabled',
        className: 'bg-amber-500/15 text-amber-300',
      };
    case 'UNRESOLVED':
      return {
        label: 'Delivery Unresolved',
        className: 'bg-amber-500/15 text-amber-300',
        detail: 'Delivery status is awaiting review.',
      };
    case 'SENT':
      return {
        label: 'Previously Sent',
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
        detail: 'The recipient server did not accept this historical message.',
      };
    case 'FAILED':
      return {
        label: 'Failed',
        className: 'bg-red-500/15 text-red-400',
        detail: 'Delivery was not completed.',
      };
  }

  return null;
}

function VariantEditor({
  variant,
  isPending,
  actionInProgress,
  onRegenerate,
  regenerateDisabledReason,
  apiClient,
  onAction,
}: {
  variant: MessageVariantResponse;
  isPending: boolean;
  actionInProgress: string | null;
  onRegenerate?: ((feedback: string) => Promise<void> | void) | undefined;
  regenerateDisabledReason?: string | null | undefined;
  apiClient: ApiClient;
  onAction: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(variant.subject ?? '');
  const [editBody, setEditBody] = useState(variant.bodyText);
  const [isSaving, setIsSaving] = useState(false);
  const [isRedraftOpen, setIsRedraftOpen] = useState(false);
  const [redraftFeedback, setRedraftFeedback] = useState('');

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
      toast.info(
        toSafeDisplayErrorMessage(
          err,
          'Couldn’t save this draft change. Please try again.',
        ),
      );
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
          <div className="flex items-center gap-1.5">
            {onRegenerate ? (
              <button
                type="button"
                onClick={() => setIsRedraftOpen((current) => !current)}
                disabled={!!actionInProgress || !!regenerateDisabledReason}
                title={regenerateDisabledReason ?? 'Re-draft this outreach message with operator feedback'}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground disabled:opacity-50"
              >
                {actionInProgress === 'regenerate' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Re-draft
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleEditStart}
              disabled={!!actionInProgress}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground disabled:opacity-50"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          </div>
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
          {isRedraftOpen && onRegenerate ? (
            <form
              className="mb-3 rounded-lg border border-border/50 bg-background/40 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const feedback = redraftFeedback.trim();
                if (!feedback) return;
                void onRegenerate(feedback);
                setIsRedraftOpen(false);
                setRedraftFeedback('');
              }}
            >
              <label
                htmlFor={`redraft-feedback-${variant.id}`}
                className="mb-1 block text-[11px] font-semibold text-muted-foreground/70"
              >
                What would you like to change about the message?
              </label>
              <textarea
                id={`redraft-feedback-${variant.id}`}
                value={redraftFeedback}
                onChange={(event) => setRedraftFeedback(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Example: Make the subject clearer, avoid mentioning WordPress, and keep the payment angle less specific."
                className="w-full resize-y rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground/50">
                  This note is sent to the AI with the re-draft request.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRedraftOpen(false);
                      setRedraftFeedback('');
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!!actionInProgress || !redraftFeedback.trim()}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-50"
                  >
                    {actionInProgress === 'regenerate' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Generate New Draft
                  </button>
                </div>
              </div>
            </form>
          ) : null}
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
              disabled
              aria-disabled="true"
              className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg bg-zbooni-green/10 px-3 py-1.5 text-xs font-semibold text-zbooni-green/40"
            >
              <Check className="h-3 w-3" /> Approve Draft
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
  onQueuedRegenerate,
}: MessageDraftCardProps) {
  const { apiClient } = useAuth();
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const primaryChannel = draft.variants[0]?.channel ?? 'EMAIL';

  const handleRegenerate = async (feedback: string) => {
    if (draft.followUpNumber !== 0) {
      toast.error('Only initial outreach drafts can be re-drafted from this queue');
      return;
    }

    if (!initialSendLoaded) {
      toast.info('Checking send status before allowing re-draft');
      return;
    }

    if (initialSend) {
      toast.error('This draft already has a send record, so re-draft is blocked');
      return;
    }

    setActionInProgress('regenerate');
    setError(null);
    try {
      const result = await apiClient.generateDraft({
        leadId: draft.leadId,
        icpProfileId: draft.icpProfileId,
        ...(draft.scorePredictionId ? { scorePredictionId: draft.scorePredictionId } : {}),
        channel: primaryChannel,
        promptVersion: 'v2',
        forceRegenerate: true,
        redraftFeedback: feedback,
      });

      if (result.status === 'QUEUED') {
        toast.success('Re-draft queued. The current draft will be replaced after generation succeeds.');
        onQueuedRegenerate?.(draft);
      } else if (result.status === 'CREATED') {
        toast.success('New draft created');
      } else {
        toast.info('A current draft still exists for this lead');
      }

      onAction();
    } catch (err: unknown) {
      const message = toSafeDisplayErrorMessage(
        err,
        'Couldn’t start the re-draft. Please try again.',
      );
      setError(message);
      toast.info(message);
    } finally {
      setActionInProgress(null);
    }
  };

  const isPending = draft.approvalStatus === 'PENDING';
  const approvalBadge = getApprovalBadge(draft);
  const initialSendBadge = getInitialSendBadge(draft, initialSend, initialSendLoaded);
  const isInitialDraft = draft.followUpNumber === 0;
  const regenerateDisabledReason = !isInitialDraft
    ? 'Only initial outreach drafts can be re-drafted from this queue.'
    : !initialSendLoaded
      ? 'Checking whether this draft has already been queued or sent.'
      : initialSend
        ? 'This draft already has a send record, so re-draft is blocked.'
        : null;

  // Determine primary channel from first variant
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
                actionInProgress={actionInProgress}
                onRegenerate={isInitialDraft ? handleRegenerate : undefined}
                regenerateDisabledReason={regenerateDisabledReason}
                apiClient={apiClient}
                onAction={onAction}
              />
            ))}
          </div>

          {error ? <p className="mt-2 text-xs text-amber-300">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

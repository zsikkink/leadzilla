'use client';

import type { MessageDraftResponse, MessageVariantResponse } from '@lead-flood/contracts';
import { Check, ChevronDown, ChevronUp, Send } from 'lucide-react';
import { useState } from 'react';

import { useAuth } from '../hooks/use-auth.js';

interface MessageDraftCardProps {
  draft: MessageDraftResponse;
  leadName?: string | undefined;
  companyName?: string | undefined;
  onAction: () => void;
}

function VariantEditor({
  variant,
  isPending,
  isApproved,
  actionInProgress,
  onApprove,
  onSend,
}: {
  variant: MessageVariantResponse;
  isPending: boolean;
  isApproved: boolean;
  actionInProgress: string | null;
  onApprove: (variantId: string) => void;
  onSend: (variantId: string) => void;
}) {
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
      </div>

      <>
        {variant.subject ? (
          <p className="mb-1.5 text-sm font-medium text-foreground/90">Subject: {variant.subject}</p>
        ) : null}
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{variant.bodyText}</p>
      </>

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
        {isApproved ? (
          <button
            type="button"
            disabled={!!actionInProgress}
            onClick={() => onSend(variant.id)}
            className="zbooni-gradient-bg inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-zbooni-dark transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-3 w-3" /> Send
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function MessageDraftCard({ draft, leadName, companyName, onAction }: MessageDraftCardProps) {
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
  const isApproved = draft.approvalStatus === 'APPROVED' || draft.approvalStatus === 'AUTO_APPROVED';

  // Determine primary channel from first variant
  const primaryChannel = draft.variants[0]?.channel ?? 'EMAIL';
  const channelLabel = primaryChannel === 'WHATSAPP' ? 'WhatsApp' : 'Email';
  const channelColorClass = primaryChannel === 'WHATSAPP'
    ? 'bg-[#25D366]/15 text-[#25D366]'
    : 'bg-[#3B82F6]/15 text-[#3B82F6]';

  // Status display
  const statusLabel =
    draft.approvalStatus === 'AUTO_APPROVED' ? 'Auto-Approved'
      : draft.approvalStatus === 'APPROVED' ? 'Approved'
        : draft.approvalStatus === 'REJECTED' ? 'Rejected'
          : 'Pending';
  const statusColorClass =
    isPending
      ? 'bg-yellow-500/15 text-yellow-400'
      : isApproved
        ? 'bg-zbooni-green/15 text-zbooni-green'
        : 'bg-red-500/15 text-red-400';

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
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColorClass}`}
            >
              {statusLabel}
            </span>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${channelColorClass}`}
            >
              {channelLabel}
            </span>
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
          <div className="space-y-4">
            {draft.variants.map((variant) => (
              <VariantEditor
                key={variant.id}
                variant={variant}
                isPending={isPending}
                isApproved={isApproved}
                actionInProgress={actionInProgress}
                onApprove={handleApprove}
                onSend={handleSend}
              />
            ))}
          </div>

          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

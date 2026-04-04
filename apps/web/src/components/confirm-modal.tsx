'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '../lib/utils.js';

// ── Types ──────────────────────────────────────────────────────────────────────

type ConfirmVariant = 'danger' | 'info';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
  showDontAsk?: boolean | undefined;
  dontAskKey?: string | undefined;
}

// ── Variant styling ────────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<ConfirmVariant, { button: string; icon: string }> = {
  danger: {
    button:
      'bg-red-500/90 text-white hover:bg-red-500 shadow-lg shadow-red-500/20',
    icon: 'text-red-400',
  },
  info: {
    button:
      'bg-gradient-to-r from-zbooni-teal to-zbooni-green text-black hover:shadow-xl hover:shadow-zbooni-teal/30 shadow-lg shadow-zbooni-teal/20',
    icon: 'text-zbooni-teal',
  },
};

// ── useConfirmModal hook ───────────────────────────────────────────────────────

/**
 * Returns a wrapped onConfirm that checks localStorage first.
 * If the "don't ask" key is set, fires onConfirm immediately.
 * Otherwise returns { shouldShow: true } so the caller can open the modal.
 */
export function useConfirmModal(dontAskKey: string | undefined) {
  const shouldSkip = useCallback((): boolean => {
    if (!dontAskKey) return false;
    try {
      return localStorage.getItem(dontAskKey) === 'true';
    } catch {
      return false;
    }
  }, [dontAskKey]);

  return { shouldSkip };
}

// ── ConfirmModal component ─────────────────────────────────────────────────────

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant,
  onConfirm,
  onCancel,
  showDontAsk = false,
  dontAskKey,
}: ConfirmModalProps) {
  const [dontAskChecked, setDontAskChecked] = useState(false);
  const style = VARIANT_STYLES[variant];

  // Reset checkbox when modal opens
  useEffect(() => {
    if (isOpen) setDontAskChecked(false);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (showDontAsk && dontAskChecked && dontAskKey) {
      try {
        localStorage.setItem(dontAskKey, 'true');
      } catch {
        // localStorage unavailable — silently continue
      }
    }
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      {/* Backdrop click closes */}
      <div
        className="absolute inset-0"
        onClick={onCancel}
        role="presentation"
      />

      {/* Modal card */}
      <div className="relative w-full max-w-sm rounded-2xl border border-border/50 bg-card/95 p-6 shadow-2xl backdrop-blur-xl">
        {/* Title */}
        <h3 className="text-base font-bold tracking-tight">{title}</h3>

        {/* Message */}
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>

        {/* Don't ask again */}
        {showDontAsk && dontAskKey && (
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground/60 select-none">
            <input
              type="checkbox"
              checked={dontAskChecked}
              onChange={(e) => setDontAskChecked(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border/30 bg-zbooni-dark/40 accent-zbooni-teal"
            />
            Don&apos;t show this again
          </label>
        )}

        {/* Actions */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border/30 bg-white/5 px-4 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-white/10"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={cn(
              'rounded-lg px-4 py-2 text-xs font-bold transition-all',
              style.button,
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

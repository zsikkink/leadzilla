'use client';

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import type { ApiClient } from '../lib/api-client.js';
import { toSafeDisplayErrorMessage } from '../lib/error-messages.js';

interface DraftCompletionTarget {
  leadId: string;
  afterMs?: number | undefined;
  excludeDraftId?: string | undefined;
  forceRegenerate?: boolean | undefined;
}

interface UseDraftCompletionNotifierOptions {
  apiClient: ApiClient;
  onCompleted: () => void;
}

export function useDraftCompletionNotifier({
  apiClient,
  onCompleted,
}: UseDraftCompletionNotifierOptions): (target: DraftCompletionTarget) => void {
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const stopListening = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  useEffect(() => stopListening, [stopListening]);

  return useCallback((target: DraftCompletionTarget) => {
    stopListening();

    unsubscribeRef.current = apiClient.subscribeMessageDraftEvents(
      {
        leadId: target.leadId,
        ...(target.afterMs !== undefined ? { afterMs: target.afterMs } : {}),
        ...(target.excludeDraftId ? { excludeDraftId: target.excludeDraftId } : {}),
      },
      {
        onDraftCreated: () => {
          stopListening();
          toast.success(target.forceRegenerate ? 'Re-draft completed.' : 'Draft completed.');
          onCompleted();
        },
        onTimeout: () => {
          stopListening();
          toast.info(
            target.forceRegenerate
              ? 'Re-draft is still generating. Refresh the drafts when you are ready to check again.'
              : 'Draft is still generating. Refresh the drafts when you are ready to check again.',
          );
        },
        onError: (error) => {
          stopListening();
          toast.info(
            toSafeDisplayErrorMessage(
              error,
              'Draft generation is still processing. Refresh the drafts in a moment.',
            ),
          );
        },
      },
    );
  }, [apiClient, onCompleted, stopListening]);
}

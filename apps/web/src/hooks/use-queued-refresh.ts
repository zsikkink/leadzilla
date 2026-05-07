'use client';

import { useCallback, useEffect, useRef } from 'react';

const QUEUED_REFRESH_DELAYS_MS = [1000, 2500, 5000, 9000, 14000, 20000, 30000];

export function useQueuedRefresh(callback: () => boolean | void): () => void {
  const callbackRef = useRef(callback);
  const timeoutIdRef = useRef<number | null>(null);
  const delayIndexRef = useRef(0);
  const scheduleNextRef = useRef<() => void>(() => {});

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const clearQueuedRefreshes = useCallback(() => {
    if (timeoutIdRef.current !== null) {
      window.clearTimeout(timeoutIdRef.current);
    }
    timeoutIdRef.current = null;
    delayIndexRef.current = 0;
  }, []);

  scheduleNextRef.current = () => {
    const delay = QUEUED_REFRESH_DELAYS_MS[delayIndexRef.current];
    if (delay === undefined) {
      clearQueuedRefreshes();
      return;
    }

    delayIndexRef.current += 1;
    timeoutIdRef.current = window.setTimeout(() => {
      timeoutIdRef.current = null;
      const shouldContinue = callbackRef.current();
      if (shouldContinue === false) {
        clearQueuedRefreshes();
        return;
      }
      scheduleNextRef.current();
    }, delay);
  };

  const scheduleQueuedRefreshes = useCallback(() => {
    clearQueuedRefreshes();
    scheduleNextRef.current();
  }, [clearQueuedRefreshes]);

  useEffect(() => clearQueuedRefreshes, [clearQueuedRefreshes]);

  return scheduleQueuedRefreshes;
}

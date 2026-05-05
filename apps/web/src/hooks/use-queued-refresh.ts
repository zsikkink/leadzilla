'use client';

import { useCallback, useEffect, useRef } from 'react';

const QUEUED_REFRESH_DELAYS_MS = [1000, 2500, 5000, 9000, 14000, 20000, 30000];

export function useQueuedRefresh(callback: () => void): () => void {
  const timeoutIdsRef = useRef<number[]>([]);

  const clearQueuedRefreshes = useCallback(() => {
    for (const timeoutId of timeoutIdsRef.current) {
      window.clearTimeout(timeoutId);
    }
    timeoutIdsRef.current = [];
  }, []);

  const scheduleQueuedRefreshes = useCallback(() => {
    clearQueuedRefreshes();
    timeoutIdsRef.current = QUEUED_REFRESH_DELAYS_MS.map((delay) =>
      window.setTimeout(callback, delay),
    );
  }, [callback, clearQueuedRefreshes]);

  useEffect(() => clearQueuedRefreshes, [clearQueuedRefreshes]);

  return scheduleQueuedRefreshes;
}

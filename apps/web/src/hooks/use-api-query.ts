'use client';

import { useCallback, useEffect, useState } from 'react';

import { toSafeDisplayErrorMessage } from '../lib/error-messages.js';

interface UseApiQueryResult<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  refetch: () => void;
}

export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): UseApiQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refetchCounter, setRefetchCounter] = useState(0);

  const refetch = useCallback(() => {
    setRefetchCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(toSafeDisplayErrorMessage(err));
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refetchCounter, ...deps]);

  return { data, error, isLoading, refetch };
}

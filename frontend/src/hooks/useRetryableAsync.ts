import { useCallback, useRef, useState } from 'react';

type Status = 'idle' | 'loading' | 'success' | 'error';

/**
 * Wraps an async action with loading/error state and a retry that re-runs
 * the last invocation's arguments.
 */
export function useRetryableAsync<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>
) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const lastArgsRef = useRef<Args | null>(null);

  const run = useCallback(
    async (...args: Args) => {
      lastArgsRef.current = args;
      setStatus('loading');
      setError(null);
      try {
        const result = await action(...args);
        setData(result);
        setStatus('success');
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
        setStatus('error');
        throw err;
      }
    },
    [action]
  );

  const retry = useCallback(() => {
    if (lastArgsRef.current) return run(...lastArgsRef.current);
  }, [run]);

  return { data, error, status, isLoading: status === 'loading', run, retry };
}

import { useCallback, useEffect, useRef } from 'react';
import { Stopwatch } from '../lib/stopwatch';

/**
 * Measures how long something has been on screen, excluding time the tab is
 * hidden. `restart()` when a new question appears; `elapsedMs()` when it is answered.
 */
export function useActiveStopwatch() {
  const watch = useRef<Stopwatch>(new Stopwatch());

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') watch.current.pause(Date.now());
      else watch.current.resume(Date.now());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const restart = useCallback(() => {
    watch.current.restart(Date.now(), document.visibilityState !== 'hidden');
  }, []);
  const elapsedMs = useCallback((): number | null => watch.current.elapsed(Date.now()), []);
  return { restart, elapsedMs };
}

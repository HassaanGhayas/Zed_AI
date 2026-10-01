import { useCallback, useRef, useState } from 'react';

/**
 * Shows a transient confirmation message (e.g. "Saved!", "Copied!") for a
 * fixed duration, then clears it. Re-triggering cancels the pending clear.
 */
export function useTransientFeedback(durationMs = 1500) {
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (text: string) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setMessage(text);
      timeoutRef.current = setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs]
  );

  return { message, show };
}

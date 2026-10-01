import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab focus inside a container while isOpen: moves focus into it on
 * open, wraps Tab/Shift+Tab at its boundaries, and restores focus to
 * whatever had it beforehand on close.
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, isOpen: boolean) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable[0] ?? container).focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    const restoreTarget = previouslyFocused.current;
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      restoreTarget?.focus?.();
    };
  }, [isOpen, containerRef]);
}

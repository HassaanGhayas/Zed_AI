import { m } from 'motion/react';

interface ProgressBarProps {
  /** 0-100 */
  value: number;
  label: string;
  /** Tailwind classes for the fill colour. */
  fillClassName?: string;
}

/**
 * Accessible progress bar. The fill is full width and scaled with `scaleX`
 * (compositor-only), so animating it never triggers layout.
 */
export function ProgressBar({ value, label, fillClassName = 'bg-accent' }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-2 rounded-full bg-sunken overflow-hidden"
    >
      <m.div
        className={`h-full w-full rounded-full origin-left ${fillClassName}`}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: pct / 100 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

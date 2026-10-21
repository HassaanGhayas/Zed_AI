import { useEffect } from 'react';
import { formatCounter } from './rollingNumberFormat';
import { m, useReducedMotion, useSpring, useTransform } from 'motion/react';

/** Adapted from Cult UI "Rolling Number" (MIT), https://www.cult-ui.com. */

interface RollingNumberProps {
  /** Final value; `null` renders the placeholder with no animation. */
  value: number | null;
  decimals?: number;
  suffix?: string;
  placeholder?: string;
  /** Skip the animation entirely (reduced motion / tests). */
  instant?: boolean;
}

/**
 * Counts up from 0 to `value` when mounted, and tweens when `value` later changes.
 * Screen readers get the final value from a visually hidden node; the ticking
 * text is aria-hidden so nothing is announced while it runs.
 */
export function RollingNumber({ value, decimals = 0, suffix = '', placeholder = '—', instant = false }: RollingNumberProps) {
  const finalText = formatCounter(value, decimals, suffix, placeholder);
  const reduced = useReducedMotion();
  if (instant || reduced || value === null || !Number.isFinite(value)) return <>{finalText}</>;
  return <Ticker value={value} decimals={decimals} suffix={suffix} finalText={finalText} />;
}

function Ticker({ value, decimals, suffix, finalText }: { value: number; decimals: number; suffix: string; finalText: string }) {
  const spring = useSpring(0, { stiffness: 90, damping: 22, mass: 0.8 });
  const display = useTransform(spring, (v) => `${v.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return (
    <>
      <span className="sr-only">{finalText}</span>
      <m.span aria-hidden="true" className="tabular-nums">
        {display}
      </m.span>
    </>
  );
}

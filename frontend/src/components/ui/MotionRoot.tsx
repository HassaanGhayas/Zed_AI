import type { ReactNode } from 'react';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';

/**
 * Scopes the `motion` runtime to the subtree that needs it. Only the small
 * `domAnimation` feature set is loaded and `m.*` components must be used inside.
 * `reducedMotion="user"` makes transform/opacity animations respect the OS setting.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

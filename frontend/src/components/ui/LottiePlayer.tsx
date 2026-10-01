import React, { useEffect, useState } from 'react';
import { Lottie } from 'lottie-react';

interface LottiePlayerProps {
  animationData: object;
  loop?: boolean;
  className?: string;
}

/** Thin wrapper around lottie-react that honors prefers-reduced-motion by
 * not rendering at all (these are purely decorative touches). */
export const LottiePlayer: React.FC<LottiePlayerProps> = ({ animationData, loop = true, className }) => {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (reducedMotion) return null;

  return (
    <Lottie
      src={animationData}
      loop={loop}
      autoplay
      className={className}
      aria-hidden="true"
    />
  );
};

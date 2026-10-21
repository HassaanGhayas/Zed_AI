interface LogoProps {
  className?: string;
}

/**
 * Studify AI brand mark — an open book with a play symbol on the right page,
 * for video-led study. Drawn in lucide's stroke style (round caps and joins,
 * currentColor) so callers control color. Stroke is 2 (not 1.8) so it stays
 * legible at the 14px hero-badge size.
 */
export function Logo({ className = 'w-5 h-5' }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path
        d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 6v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M14.6 9.4 L17.6 11.3 L14.6 13.2Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

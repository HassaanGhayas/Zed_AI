interface LogoProps {
  className?: string;
}

/**
 * Studify AI brand mark — a minimal owl (classical symbol of wisdom, in
 * keeping with the Socratic/active-recall identity), drawn in lucide's
 * stroke style so it sits consistently alongside the rest of the icon set.
 */
export function Logo({ className = 'w-5 h-5' }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <circle cx="12" cy="13" r="7" stroke="currentColor" strokeWidth="2" />
      <line x1="7.6" y1="7.4" x2="6" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="16.4" y1="7.4" x2="18" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle className="owl-eye" cx="9.3" cy="12" r="1.3" fill="currentColor" />
      <circle className="owl-eye" cx="14.7" cy="12" r="1.3" fill="currentColor" />
      <path d="M11.3 14.9 L12 16.3 L12.7 14.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

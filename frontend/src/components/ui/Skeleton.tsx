interface SkeletonProps {
  className?: string;
}

export function SkeletonLine({ className = '' }: SkeletonProps) {
  return <div className={`h-3 rounded-full bg-line-soft animate-pulse ${className}`} aria-hidden="true" />;
}

export function SkeletonBlock({ className = '' }: SkeletonProps) {
  return <div className={`rounded-xl bg-line-soft animate-pulse ${className}`} aria-hidden="true" />;
}

export function SkeletonCircle({ className = '' }: SkeletonProps) {
  return <div className={`rounded-full bg-line-soft animate-pulse ${className}`} aria-hidden="true" />;
}

import React from 'react';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-ink-muted border-line/60',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
  accent: 'bg-ember-500/10 text-ember-300 border-ember-500/25',
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className = '', children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold border ${toneClasses[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

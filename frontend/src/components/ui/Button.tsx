import React from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-ember-500 to-ember-400 text-on-accent hover:from-ember-400 hover:to-ember-300 shadow-lg shadow-ember-500/25',
  secondary:
    'bg-sunken hover:bg-line-soft text-ink-muted hover:text-ink border border-line/60',
  ghost: 'bg-transparent hover:bg-sunken text-ink-faint hover:text-ink',
  danger: 'bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', loading = false, disabled, className = '', children, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 cursor-pointer hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:active:scale-100 ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
);
Button.displayName = 'Button';

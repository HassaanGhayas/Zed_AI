import React from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'sm' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** md: default; sm: compact (toolbars); icon: square 44px tap target. */
  size?: ButtonSize;
  loading?: boolean;
}

const sizeClasses: Record<ButtonSize, string> = {
  md: 'px-4 py-2 text-sm',
  sm: 'px-2.5 sm:px-3 py-2 text-xs sm:text-sm',
  icon: 'min-w-[44px] p-0 text-sm',
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-accent hover:bg-accent-hover',
  secondary:
    'bg-sunken hover:bg-line-soft text-ink-muted hover:text-ink border border-line',
  ghost: 'bg-transparent hover:bg-sunken text-ink-faint hover:text-ink',
  danger: 'bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, disabled, className = '', children, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-md font-semibold transition-[color,background-color,border-color,transform] duration-150 cursor-pointer active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
);
Button.displayName = 'Button';

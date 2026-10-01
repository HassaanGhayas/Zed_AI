import React from 'react';

type CardRadius = 'sm' | 'md' | 'lg';

const radiusClasses: Record<CardRadius, string> = {
  sm: 'rounded-lg',
  md: 'rounded-xl',
  lg: 'rounded-2xl',
};

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  radius?: CardRadius;
}

export function Card({ radius = 'md', className = '', children, ...rest }: CardProps) {
  return (
    <div className={`bg-raised border border-line-soft ${radiusClasses[radius]} ${className}`} {...rest}>
      {children}
    </div>
  );
}

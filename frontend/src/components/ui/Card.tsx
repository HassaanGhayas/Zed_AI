import React from 'react';

type CardRadius = 'sm' | 'md' | 'lg';

const radiusClasses: Record<CardRadius, string> = {
  sm: 'rounded-md',
  md: 'rounded-lg',
  lg: 'rounded-lg',
};

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  radius?: CardRadius;
}

export function Card({ radius = 'md', className = '', children, ...rest }: CardProps) {
  return (
    <div className={`bg-raised border border-line-soft shadow-card ${radiusClasses[radius]} ${className}`} {...rest}>
      {children}
    </div>
  );
}

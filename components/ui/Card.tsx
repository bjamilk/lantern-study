import React from 'react';

type CardVariant = 'default' | 'elevated' | 'outline';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: CardVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-lantern-surface border border-lantern-border shadow-sm',
  elevated: 'bg-lantern-surface border border-lantern-border shadow-md',
  outline: 'bg-transparent border border-lantern-border',
};

const paddingClasses = {
  none: '',
  sm: 'p-3',
  md: 'p-4 md:p-5',
  lg: 'p-6',
};

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
  onClick,
}) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-lantern-xl ${variantClasses[variant]} ${paddingClasses[padding]} ${onClick ? 'text-left w-full hover:border-lantern-primary/40 transition-colors' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
};

export default Card;

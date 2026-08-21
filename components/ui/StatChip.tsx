import React from 'react';

type StatChipVariant = 'primary' | 'accent' | 'success' | 'neutral' | 'danger';

const variantClasses: Record<StatChipVariant, string> = {
  primary: 'bg-lantern-primary-background text-lantern-primary',
  accent: 'bg-lantern-accent-background text-lantern-accent',
  success: 'bg-emerald-50 dark:bg-emerald-950/30 text-lantern-success',
  neutral: 'bg-lantern-background-secondary text-lantern-text-secondary',
  danger: 'bg-red-50 dark:bg-red-950/30 text-lantern-error',
};

interface StatChipProps {
  label: string;
  variant?: StatChipVariant;
  className?: string;
}

export const StatChip: React.FC<StatChipProps> = ({
  label,
  variant = 'neutral',
  className = '',
}) => (
  <span
    className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${variantClasses[variant]} ${className}`}
  >
    {label}
  </span>
);

export default StatChip;

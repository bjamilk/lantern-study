import React from 'react';

interface StatPillProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  accent?: 'primary' | 'accent' | 'success' | 'warning' | 'neutral';
  className?: string;
}

const accentClasses = {
  primary: 'bg-lantern-primary-background text-lantern-primary-dark',
  accent: 'bg-lantern-accent-background text-amber-800 dark:text-amber-200',
  success: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  neutral: 'bg-lantern-background-secondary text-lantern-text-secondary',
};

export const StatPill: React.FC<StatPillProps> = ({
  label,
  value,
  icon,
  accent = 'neutral',
  className = '',
}) => (
  <div className={`flex items-center gap-2 px-3 py-2 rounded-lantern ${accentClasses[accent]} ${className}`}>
    {icon && <span className="shrink-0 opacity-80">{icon}</span>}
    <div className="min-w-0">
      <p className="text-xs font-medium opacity-80 truncate">{label}</p>
      <p className="text-sm font-bold truncate">{value}</p>
    </div>
  </div>
);

export default StatPill;

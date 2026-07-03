import React from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
}) => (
  <div className={`text-center py-10 sm:py-12 px-4 rounded-xl border border-lantern-border bg-lantern-surface ${className}`}>
    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-lantern-primary-background text-lantern-primary flex items-center justify-center mx-auto mb-4">
      {icon}
    </div>
    <h2 className="text-lg sm:text-xl font-semibold text-lantern-text mb-2">{title}</h2>
    <p className="text-sm text-lantern-text-secondary mb-6 max-w-sm mx-auto">{description}</p>
    {(actionLabel && onAction) && (
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <Button onClick={onAction}>{actionLabel}</Button>
        {secondaryActionLabel && onSecondaryAction && (
          <Button variant="secondary" onClick={onSecondaryAction}>{secondaryActionLabel}</Button>
        )}
      </div>
    )}
  </div>
);

export default EmptyState;

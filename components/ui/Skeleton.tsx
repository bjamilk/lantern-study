import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string;
  height?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'rectangular',
  width,
  height,
}) => {
  const base = 'animate-pulse bg-lantern-background-secondary dark:bg-slate-700';
  const shape =
    variant === 'circular'
      ? 'rounded-full'
      : variant === 'text'
        ? 'rounded h-4'
        : 'rounded-lantern';

  return (
    <div
      className={`${base} ${shape} ${className}`}
      style={{ width, height }}
      aria-hidden
    />
  );
};

export const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`p-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface space-y-3 ${className}`}>
    <Skeleton variant="text" className="w-1/3" />
    <Skeleton variant="rectangular" className="h-16 w-full" />
    <div className="flex gap-2">
      <Skeleton variant="rectangular" className="h-8 w-20" />
      <Skeleton variant="rectangular" className="h-8 w-20" />
    </div>
  </div>
);

export const SkeletonStatRow: React.FC = () => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    {[1, 2, 3, 4].map((i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);

export default Skeleton;

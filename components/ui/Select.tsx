import React from 'react';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const selectFieldClasses =
  'rounded-lg border border-lantern-border bg-lantern-surface text-lantern-text px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary';

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', ...props }, ref) => (
    <select ref={ref} className={`${selectFieldClasses} ${className}`.trim()} {...props} />
  )
);

Select.displayName = 'Select';

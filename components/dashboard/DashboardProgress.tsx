import React, { useState } from 'react';
import { AppIcon } from '../ui/AppIcon';

interface DashboardProgressProps {
  title?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const DashboardProgress: React.FC<DashboardProgressProps> = ({
  title = 'Progress & analytics',
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-lantern-border bg-lantern-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-lantern-background-secondary transition-colors"
        aria-expanded={open}
      >
        <span className="font-semibold text-lantern-text">{title}</span>
        {open ? (
          <AppIcon name="chevron-up" size={20} className="text-lantern-text-secondary" />
        ) : (
          <AppIcon name="chevron-down" size={20} className="text-lantern-text-secondary" />
        )}
      </button>
      {open && <div className="px-4 pb-4 space-y-6 border-t border-lantern-border pt-4">{children}</div>}
    </div>
  );
};

export default DashboardProgress;

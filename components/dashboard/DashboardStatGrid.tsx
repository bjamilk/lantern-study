import React from 'react';

export interface DashboardStatItem {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  iconBgClass: string;
}

interface DashboardStatGridProps {
  items: DashboardStatItem[];
}

export const DashboardStatGrid: React.FC<DashboardStatGridProps> = ({ items }) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
    {items.map((item) => (
      <div
        key={item.label}
        className="bg-lantern-surface/95 rounded-lantern-xl p-4 shadow-lantern border border-lantern-border"
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${item.iconBgClass}`}
          >
            {item.icon}
          </div>
          <div className="min-w-0">
            <p className="text-caption text-lantern-text-secondary truncate">{item.label}</p>
            <p className="text-display tabular-nums text-lantern-text">{item.value}</p>
          </div>
        </div>
      </div>
    ))}
  </div>
);

export default DashboardStatGrid;

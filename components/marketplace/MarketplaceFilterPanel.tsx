import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { formatCampusLabel, type MarketplaceCampus } from '@lantern/shared';

export interface MarketplaceFilterPanelProps {
  minPrice: string;
  maxPrice: string;
  campusIdFilter: string;
  locationFilter: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  campuses: MarketplaceCampus[];
  activeFilterCount: number;
  onMinPriceChange: (v: string) => void;
  onMaxPriceChange: (v: string) => void;
  onCampusChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onSortChange: (sortBy: string, sortOrder: 'asc' | 'desc') => void;
  onClearFilters: () => void;
  variant?: 'hero' | 'card';
}

export const MarketplaceFilterPanel: React.FC<MarketplaceFilterPanelProps> = ({
  minPrice,
  maxPrice,
  campusIdFilter,
  locationFilter,
  sortBy,
  sortOrder,
  campuses,
  activeFilterCount,
  onMinPriceChange,
  onMaxPriceChange,
  onCampusChange,
  onLocationChange,
  onSortChange,
  onClearFilters,
  variant = 'card',
}) => {
  const shellClass =
    variant === 'hero'
      ? 'bg-lantern-primary-background/50 rounded-lantern border border-lantern-border p-3 space-y-3'
      : 'bg-lantern-surface rounded-lantern-xl border border-lantern-border p-4 space-y-3 shadow-lantern';

  const labelClass = 'block text-xs font-medium text-lantern-text-secondary mb-1';
  const inputClass =
    'w-full min-w-0 box-border px-3 py-2 rounded-lg bg-lantern-surface border border-lantern-border text-lantern-text text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary';

  return (
    <div className={shellClass}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 min-w-0">
        <div className="min-w-0">
          <label className={labelClass}>Price range (₦)</label>
          <div className="flex gap-2 min-w-0">
            <input
              type="number"
              placeholder="Min"
              value={minPrice}
              onChange={e => onMinPriceChange(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              placeholder="Max"
              value={maxPrice}
              onChange={e => onMaxPriceChange(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Campus</label>
          <select value={campusIdFilter} onChange={e => onCampusChange(e.target.value)} className={inputClass}>
            <option value="">All campuses</option>
            {campuses.map(campus => (
              <option key={campus.id} value={campus.id}>
                {formatCampusLabel(campus)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Meetup area</label>
          <input
            type="text"
            placeholder="Gate, hall, faculty…"
            value={locationFilter}
            onChange={e => onLocationChange(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Sort by</label>
          <select
            value={`${sortBy}:${sortOrder}`}
            onChange={e => {
              const [field, order] = e.target.value.split(':');
              onSortChange(field, order as 'asc' | 'desc');
            }}
            className={inputClass}
          >
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="price:asc">Price: low to high</option>
            <option value="price:desc">Price: high to low</option>
          </select>
        </div>
      </div>

      {activeFilterCount > 0 ? (
        <button
          type="button"
          onClick={onClearFilters}
          className="text-xs text-lantern-primary hover:text-lantern-primary-dark flex items-center gap-1 transition-colors"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
          Clear all filters
        </button>
      ) : null}
    </div>
  );
};

export default MarketplaceFilterPanel;

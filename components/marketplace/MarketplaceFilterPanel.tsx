import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { formatCampusLabel, type MarketplaceCampus } from '@lantern/shared';

/**
 * Item-condition options. Values mirror what the create flow actually writes to
 * `category_specific_fields.condition` (hyphenated), so the filter is aligned
 * with stored data if/when the listings API learns to filter on it.
 */
export const MARKETPLACE_CONDITION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'like-new', label: 'Like New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
];

export interface MarketplaceFilterPanelProps {
  minPrice: string;
  maxPrice: string;
  campusIdFilter: string;
  locationFilter: string;
  condition: string;
  /** '' = any rating; otherwise '4' | '3' | '2' | '1' (avg rating at least N). */
  minRating: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  campuses: MarketplaceCampus[];
  activeFilterCount: number;
  onMinPriceChange: (v: string) => void;
  onMaxPriceChange: (v: string) => void;
  onCampusChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onConditionChange: (v: string) => void;
  onMinRatingChange: (v: string) => void;
  onSortChange: (sortBy: string, sortOrder: 'asc' | 'desc') => void;
  onClearFilters: () => void;
  variant?: 'hero' | 'card';
}

export const MarketplaceFilterPanel: React.FC<MarketplaceFilterPanelProps> = ({
  minPrice,
  maxPrice,
  campusIdFilter,
  locationFilter,
  condition,
  minRating,
  sortBy,
  sortOrder,
  campuses,
  activeFilterCount,
  onMinPriceChange,
  onMaxPriceChange,
  onCampusChange,
  onLocationChange,
  onConditionChange,
  onMinRatingChange,
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 min-w-0">
        <div className="min-w-0">
          <label htmlFor="marketplace-filter-min-price" className={labelClass}>Price range (₦)</label>
          <div className="flex gap-2 min-w-0">
            <input
              id="marketplace-filter-min-price"
              type="number"
              placeholder="Min"
              aria-label="Minimum price"
              value={minPrice}
              onChange={e => onMinPriceChange(e.target.value)}
              className={inputClass}
            />
            <input
              id="marketplace-filter-max-price"
              type="number"
              placeholder="Max"
              aria-label="Maximum price"
              value={maxPrice}
              onChange={e => onMaxPriceChange(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="min-w-0">
          <label htmlFor="marketplace-filter-condition" className={labelClass}>Condition</label>
          <select
            id="marketplace-filter-condition"
            value={condition}
            onChange={e => onConditionChange(e.target.value)}
            className={inputClass}
          >
            <option value="">Any condition</option>
            {MARKETPLACE_CONDITION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="marketplace-filter-campus" className={labelClass}>Campus (optional)</label>
          <select
            id="marketplace-filter-campus"
            value={campusIdFilter}
            onChange={e => onCampusChange(e.target.value)}
            className={inputClass}
          >
            <option value="">All Nigeria</option>
            {campuses.map(campus => (
              <option key={campus.id} value={campus.id}>
                {formatCampusLabel(campus)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="marketplace-filter-location" className={labelClass}>Pickup or delivery area</label>
          <input
            id="marketplace-filter-location"
            type="text"
            placeholder="City, campus, landmark…"
            value={locationFilter}
            onChange={e => onLocationChange(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="marketplace-filter-min-rating" className={labelClass}>Customer rating</label>
          <select
            id="marketplace-filter-min-rating"
            value={minRating}
            onChange={e => onMinRatingChange(e.target.value)}
            className={inputClass}
          >
            <option value="">Any rating</option>
            <option value="4">★ 4 &amp; up</option>
            <option value="3">★ 3 &amp; up</option>
            <option value="2">★ 2 &amp; up</option>
            <option value="1">★ 1 &amp; up</option>
          </select>
        </div>

        <div>
          <label htmlFor="marketplace-filter-sort" className={labelClass}>Sort by</label>
          <select
            id="marketplace-filter-sort"
            value={`${sortBy}:${sortOrder}`}
            onChange={e => {
              const [field, order] = e.target.value.split(':');
              onSortChange(field, order as 'asc' | 'desc');
            }}
            className={inputClass}
          >
            <option value="trending:desc">Trending</option>
            <option value="rating:desc">Top rated</option>
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

import React, { useMemo, useState } from 'react';
import {
  filterCampusesByQuery,
  formatCampusLabel,
  isOtherCityCampus,
  type MarketplaceCampus,
} from '@lantern/shared/marketplace';

type CampusOption = Pick<MarketplaceCampus, 'id' | 'name' | 'city' | 'slug' | 'state'>;

interface CampusSearchSelectProps {
  campuses: CampusOption[];
  value: string;
  onChange: (campusId: string | null) => void;
  otherCity?: string;
  onOtherCityChange?: (city: string) => void;
  emptyLabel?: string;
  id?: string;
  className?: string;
}

/**
 * Searchable campus picker for Settings / listing forms.
 */
export const CampusSearchSelect: React.FC<CampusSearchSelectProps> = ({
  campuses,
  value,
  onChange,
  otherCity = '',
  onOtherCityChange,
  emptyLabel = 'All campuses (no default filter)',
  id = 'campus-search-select',
  className = '',
}) => {
  const [query, setQuery] = useState('');
  const selected = campuses.find((c) => c.id === value) || null;
  const showOtherInput = isOtherCityCampus(selected || undefined);

  const filtered = useMemo(
    () => filterCampusesByQuery(campuses, query),
    [campuses, query]
  );

  return (
    <div className={`space-y-2 ${className}`}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search universities, polytechnics, or cities…"
        className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text text-sm"
        aria-label="Search campuses"
      />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text"
        size={Math.min(10, Math.max(6, filtered.length + 1))}
      >
        <option value="">{emptyLabel}</option>
        {filtered.map((campus) => (
          <option key={campus.id} value={campus.id}>
            {formatCampusLabel(campus)}
            {campus.state ? ` · ${campus.state}` : ''}
          </option>
        ))}
      </select>
      {query.trim() && filtered.length === 0 ? (
        <p className="text-xs text-lantern-text-secondary">
          No matches. Try another spelling, or choose &quot;Other (city in Nigeria)&quot;.
        </p>
      ) : (
        <p className="text-xs text-lantern-text-secondary">
          {filtered.length} of {campuses.length} campuses shown
          {selected ? ` · Selected: ${formatCampusLabel(selected)}` : ''}
        </p>
      )}
      {showOtherInput && onOtherCityChange ? (
        <div>
          <label htmlFor={`${id}-other-city`} className="block text-sm font-medium text-lantern-text mb-1">
            Your city
          </label>
          <input
            id={`${id}-other-city`}
            type="text"
            value={otherCity}
            onChange={(e) => onOtherCityChange(e.target.value)}
            placeholder="e.g. Abeokuta, Nsukka, Warri"
            className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text"
          />
        </div>
      ) : null}
    </div>
  );
};

export default CampusSearchSelect;

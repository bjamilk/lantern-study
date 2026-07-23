import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
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
  /** When true (default), the search list collapses after a campus is chosen. */
  collapsible?: boolean;
}

/**
 * Searchable campus picker for Settings / listing forms.
 * Collapses to a single selected-campus row after pick so the long list does not stay open.
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
  collapsible = true,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(!collapsible || !value);
  const selected = campuses.find((c) => c.id === value) || null;
  const showOtherInput = isOtherCityCampus(selected || undefined);

  const filtered = useMemo(
    () => filterCampusesByQuery(campuses, query),
    [campuses, query]
  );

  useEffect(() => {
    if (!collapsible) {
      setOpen(true);
    }
  }, [collapsible]);

  const selectCampus = (campusId: string | null) => {
    onChange(campusId);
    setQuery('');
    if (collapsible) setOpen(false);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2 p-3 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-left text-sm text-lantern-text"
      >
        <span className={selected ? 'text-lantern-text' : 'text-lantern-text-secondary'}>
          {selected ? formatCampusLabel(selected) : emptyLabel}
        </span>
        <ChevronDownIcon
          className={`w-4 h-4 shrink-0 text-lantern-text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          id={`${id}-panel`}
          className="border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary overflow-hidden"
        >
          <div className="relative border-b border-lantern-border">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-tertiary pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search universities, polytechnics, or cities…"
              className="w-full pl-9 pr-3 py-2.5 bg-transparent text-lantern-text text-sm focus:outline-none"
              aria-label="Search campuses"
              autoFocus={collapsible}
            />
          </div>
          <ul
            role="listbox"
            aria-label="Campuses"
            className="max-h-56 overflow-y-auto"
          >
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => selectCampus(null)}
                className={`w-full text-left px-3 py-2.5 text-sm border-b border-lantern-border/60 ${
                  !value
                    ? 'bg-lantern-primary/10 text-lantern-text font-medium'
                    : 'text-lantern-text-secondary hover:bg-lantern-background'
                }`}
              >
                {emptyLabel}
              </button>
            </li>
            {filtered.map((campus) => {
              const isSelected = campus.id === value;
              return (
                <li key={campus.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectCampus(campus.id)}
                    className={`w-full text-left px-3 py-2.5 text-sm border-b border-lantern-border/40 last:border-b-0 ${
                      isSelected
                        ? 'bg-lantern-primary/10 text-lantern-text font-medium'
                        : 'text-lantern-text hover:bg-lantern-background'
                    }`}
                  >
                    <span className="block">{formatCampusLabel(campus)}</span>
                    {campus.state ? (
                      <span className="block text-xs text-lantern-text-secondary mt-0.5">{campus.state}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {query.trim() && filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-lantern-text-secondary">
              No matches. Try another spelling, or choose &quot;Other (city in Nigeria)&quot;.
            </p>
          ) : (
            <p className="px-3 py-2 text-xs text-lantern-text-secondary border-t border-lantern-border">
              {filtered.length} of {campuses.length} campuses shown
            </p>
          )}
        </div>
      ) : null}

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

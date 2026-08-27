import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ClockIcon, MagnifyingGlassIcon, TagIcon } from '@heroicons/react/24/outline';
import {
  suggestMarketplaceSearch,
  type MarketplaceDepartment,
  type MarketplaceSearchSuggestion,
} from '@lantern/shared/marketplace';

interface MarketplaceSearchSuggestProps {
  appliedQuery: string;
  remountKey: number;
  department?: MarketplaceDepartment;
  recents: string[];
  placeholder: string;
  ariaLabel: string;
  onQueryChange: (value: string) => void;
  onApplyQuery: (value: string) => void;
  onSelectType: (suggestion: Extract<MarketplaceSearchSuggestion, { kind: 'type' }>) => void;
}

const MarketplaceSearchSuggest: React.FC<MarketplaceSearchSuggestProps> = ({
  appliedQuery,
  remountKey,
  department,
  recents,
  placeholder,
  ariaLabel,
  onQueryChange,
  onApplyQuery,
  onSelectType,
}) => {
  const [draft, setDraft] = useState(appliedQuery);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    setDraft(appliedQuery);
  }, [appliedQuery, remountKey]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const suggestions = useMemo(
    () => suggestMarketplaceSearch(draft, { department, recents, limit: 8 }),
    [draft, department, recents],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [draft, open]);

  const commit = (suggestion: MarketplaceSearchSuggestion) => {
    if (suggestion.kind === 'type') {
      onSelectType(suggestion);
    } else {
      onApplyQuery(suggestion.query);
    }
    setDraft(suggestion.kind === 'type' ? draft : suggestion.query);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, suggestions.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = suggestions[activeIndex];
      if (open && selected) commit(selected);
      else onApplyQuery(draft);
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative flex-1 min-w-0 w-full">
      <MagnifyingGlassIcon className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lantern-text-tertiary pointer-events-none" />
      <input
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          setOpen(true);
          onQueryChange(value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        className="w-full min-w-0 max-w-full box-border pl-8 sm:pl-10 pr-3 py-2 rounded-lantern bg-lantern-surface border border-lantern-border text-lantern-text placeholder-lantern-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary text-sm shadow-lantern"
      />
      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-80 overflow-y-auto rounded-xl border border-lantern-border bg-lantern-surface shadow-lantern-md"
        >
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.id} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(suggestion)}
                className={`w-full flex items-start gap-2 px-3 py-2 text-left text-sm ${
                  index === activeIndex ? 'bg-lantern-primary-background' : 'hover:bg-lantern-background-secondary'
                }`}
              >
                {suggestion.kind === 'recent' ? (
                  <ClockIcon className="w-4 h-4 mt-0.5 shrink-0 text-lantern-text-tertiary" />
                ) : suggestion.kind === 'type' ? (
                  <TagIcon className="w-4 h-4 mt-0.5 shrink-0 text-lantern-primary" />
                ) : (
                  <MagnifyingGlassIcon className="w-4 h-4 mt-0.5 shrink-0 text-lantern-text-tertiary" />
                )}
                <span className="min-w-0">
                  <span className="block font-medium text-lantern-text truncate">{suggestion.label}</span>
                  {suggestion.kind === 'type' ? (
                    <span className="block text-[11px] text-lantern-text-tertiary truncate">
                      {suggestion.pathLabel}
                    </span>
                  ) : suggestion.kind === 'recent' ? (
                    <span className="block text-[11px] text-lantern-text-tertiary">Recent search</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export default MarketplaceSearchSuggest;

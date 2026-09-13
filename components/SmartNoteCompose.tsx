import React from 'react';
import {
  NOTES_STUDIO_DEPTHS,
  SMART_NOTE_FILTER_LABELS,
  SMART_NOTES_CREDIT_COST,
  SMART_NOTES_GUIDANCE_MAX_CHARS,
  formatCreditCost,
  listSmartNoteFilters,
  smartNoteFilterSelected,
  type SmartNoteFilterId,
  type SmartNoteSourceId,
  type SmartNotesDepth,
} from '@lantern/shared';
import { Button } from './ui';

export interface SmartNoteComposeProps {
  theme: 'light' | 'dark';
  sources: SmartNoteSourceId[];
  selectedSources: SmartNoteSourceId[];
  onToggleFilter: (id: SmartNoteFilterId) => void;
  depth: SmartNotesDepth;
  onDepthChange: (depth: SmartNotesDepth) => void;
  guidance: string;
  onGuidanceChange: (value: string) => void;
  onWrite: () => void;
  writing?: boolean;
  writeDisabled?: boolean;
}

/**
 * Enhanced Notes compose: which materials to synthesize, how deep, optional
 * guidance, then Write. Uploaded document / YouTube / photos share one
 * Materials chip so a lecture can pick Transcript and Materials together.
 */
export function SmartNoteCompose({
  theme,
  sources,
  selectedSources,
  onToggleFilter,
  depth,
  onDepthChange,
  guidance,
  onGuidanceChange,
  onWrite,
  writing = false,
  writeDisabled = false,
}: SmartNoteComposeProps) {
  const isDark = theme === 'dark';
  const filters = listSmartNoteFilters(sources);
  const writeCost = formatCreditCost(SMART_NOTES_CREDIT_COST[depth]);
  const fieldClass = `w-full px-3 py-2 rounded-lg text-body border ${
    isDark
      ? 'bg-lantern-background border-lantern-border text-lantern-text placeholder:text-lantern-text-tertiary'
      : 'bg-lantern-surface border-lantern-border text-lantern-text placeholder:text-lantern-text-secondary'
  }`;

  return (
    <div className="space-y-3">
      {filters.length > 0 ? (
        <div className="space-y-1.5">
          <span className="text-label uppercase text-lantern-text-secondary">Synthesize from</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Synthesize from">
            {filters.map((id) => {
              const on = smartNoteFilterSelected(id, selectedSources, sources);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggleFilter(id)}
                  className={`min-h-[44px] rounded-full border px-3 text-body font-medium ${
                    on
                      ? 'border-lantern-primary bg-lantern-primary text-white'
                      : 'border-lantern-border bg-lantern-surface text-lantern-text hover:border-lantern-text-tertiary'
                  }`}
                >
                  {SMART_NOTE_FILTER_LABELS[id]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Smart Notes depth">
        {NOTES_STUDIO_DEPTHS.map(({ id: value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={depth === value}
            aria-label={`${label}, ${formatCreditCost(SMART_NOTES_CREDIT_COST[value])}`}
            onClick={() => onDepthChange(value)}
            className={`min-h-[44px] px-3 rounded-full text-body font-medium border ${
              depth === value
                ? 'bg-lantern-primary text-white border-lantern-primary'
                : 'bg-lantern-surface text-lantern-text border-lantern-border hover:border-lantern-text-tertiary'
            }`}
          >
            {label}
            <span className="ml-1 text-caption font-normal opacity-80">
              · {formatCreditCost(SMART_NOTES_CREDIT_COST[value])}
            </span>
          </button>
        ))}
      </div>
      {depth === 'deep' && (
        <p className="text-caption text-lantern-text-secondary">
          Comprehensive covers more of long sources and adds a review pass — takes longer and costs{' '}
          {formatCreditCost(SMART_NOTES_CREDIT_COST.deep)}.
        </p>
      )}

      <input
        type="text"
        value={guidance}
        onChange={(event) => onGuidanceChange(event.target.value)}
        maxLength={SMART_NOTES_GUIDANCE_MAX_CHARS}
        placeholder='Optional guidance — e.g. "focus on mechanisms"'
        aria-label="Smart Notes guidance"
        className={fieldClass}
      />

      <Button size="sm" onClick={onWrite} loading={writing} disabled={writing || writeDisabled}>
        Write · {writeCost}
      </Button>
    </div>
  );
}

export default SmartNoteCompose;

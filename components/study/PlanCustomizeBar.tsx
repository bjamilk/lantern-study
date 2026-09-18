import React from 'react';
import {
  PLAN_SORT_OPTIONS,
  STUDY_SET_MODES,
  type PlanSortKey,
  type StudySetMode,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';

/**
 * "Customize your Study Plan" — the reference's tinted bar above the units.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT. Mode and Sort By both change what the page
 * does: `mode` is an end-to-end field on the set that decides which topic is
 * recommended (`pickRecommendedTopic`), and `sort` reorders the units through
 * `sortPlanTimeline`. The reference also draws a filter icon and a settings
 * gear at 32x32; the gear opens the set's own settings, which exists. The
 * FILTER does not exist as a concept — there is nothing on a plan row to filter
 * BY that the sort does not already express — so it is not drawn. A control
 * that looks live and does nothing is the thing the declutter pass removed
 * everywhere else in this app, and drawing it disabled would be the same lie
 * with a tooltip.
 *
 * Both controls are native `<select>`s rather than custom menus. They are the
 * reference's dropdowns in behaviour, they are reachable by keyboard and by a
 * screen reader without a line of JavaScript, and on a phone they open the
 * platform's own picker. The 44px hit target comes from padding, not height, so
 * the bar still measures the reference's 32px pill row.
 */
export const PlanCustomizeBar: React.FC<{
  mode: StudySetMode;
  onModeChange: (mode: StudySetMode) => void;
  sort: PlanSortKey;
  onSortChange: (sort: PlanSortKey) => void;
  /** Opens the set's settings. Omitted hides the gear rather than disabling it. */
  onOpenSettings?: () => void;
}> = ({ mode, onModeChange, sort, onSortChange, onOpenSettings }) => {
  const control =
    'h-8 rounded-full border border-lantern-border bg-lantern-surface px-3 text-caption text-lantern-text';
  return (
    <section
      aria-label="Customize your study plan"
      className="rounded-2xl bg-lantern-feature-ai-tint/40 p-3"
    >
      <h3 className="text-label uppercase tracking-wide text-lantern-text-secondary">
        Customize your study plan
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="inline-flex items-center gap-2">
          <span className="text-caption text-lantern-text-secondary">Mode</span>
          <select
            value={mode}
            onChange={(event) => onModeChange(event.target.value as StudySetMode)}
            className={control}
          >
            {STUDY_SET_MODES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-2">
          <span className="text-caption text-lantern-text-secondary">Sort by</span>
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as PlanSortKey)}
            className={control}
          >
            {PLAN_SORT_OPTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Study set settings"
            className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full text-lantern-text-secondary hover:bg-lantern-surface hover:text-lantern-text"
          >
            <AppIcon name="settings" size={18} />
          </button>
        ) : null}
      </div>
      {/* The chosen mode's promise, written out. The mode names alone say
          nothing about what changes, and a tooltip is not readable on a
          phone or by a screen reader that is not hovering. */}
      <p className="mt-2 text-caption text-lantern-text-secondary">
        {STUDY_SET_MODES.find((item) => item.id === mode)?.promise}
        {' · '}
        {PLAN_SORT_OPTIONS.find((item) => item.id === sort)?.promise}
      </p>
    </section>
  );
};

export default PlanCustomizeBar;

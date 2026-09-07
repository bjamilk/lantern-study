import React, { useEffect, useMemo } from 'react';
import { CAMPUS_SEGMENTS, type CampusSegment } from '../../utils/appRoutes';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

/**
 * Campus — one destination, three segments (Communities · Shop · Jobs).
 *
 * It replaces three separate sidebar entries (Discover, Marketplace, Jobs) that
 * were three doors onto the same idea: the things at your school that are not
 * your own studying. The segments are the only chrome this screen adds; each
 * one renders the screen that already existed, unchanged, underneath.
 *
 * A closed segment is HIDDEN, never shown-and-empty. Communities is
 * platform-admin-only until campus rooms ship and Shop is a private pilot, so
 * an ordinary account would otherwise meet two tabs that lead to an apology.
 * Jobs is open to everyone, which is why there is always at least one segment.
 */
export interface CampusHubScreenProps {
  segment: CampusSegment;
  /**
   * `replace` is set when the screen is CORRECTING a segment the viewer cannot
   * open — a bookmark to a closed gate should not leave a history entry that
   * Back walks straight back into.
   */
  onSelectSegment: (segment: CampusSegment, options?: { replace?: boolean }) => void;
  /** Communities is open to this viewer (the Discover hub gate). */
  communitiesOpen: boolean;
  /**
   * Shop is open to this viewer (marketplace private pilot). `null` while the
   * access probe is still out — the tab stays up and the screen underneath says
   * "checking", because hiding a tab and then putting it back is worse than a
   * moment of honesty.
   */
  shopOpen: boolean | null;
  children: React.ReactNode;
}

const SEGMENT_LABELS: Record<CampusSegment, string> = {
  communities: 'Communities',
  shop: 'Shop',
  jobs: 'Jobs',
};

const SEGMENT_ICONS: Record<CampusSegment, AppIconName> = {
  communities: 'people',
  shop: 'bag',
  jobs: 'briefcase',
};

export function visibleCampusSegments(input: {
  communitiesOpen: boolean;
  shopOpen: boolean | null;
}): CampusSegment[] {
  return CAMPUS_SEGMENTS.filter((segment) => {
    if (segment === 'communities') return input.communitiesOpen;
    if (segment === 'shop') return input.shopOpen !== false;
    return true;
  });
}

const CampusHubScreen: React.FC<CampusHubScreenProps> = ({
  segment,
  onSelectSegment,
  communitiesOpen,
  shopOpen,
  children,
}) => {
  const segments = useMemo(
    () => visibleCampusSegments({ communitiesOpen, shopOpen }),
    [communitiesOpen, shopOpen],
  );
  const active = segments.includes(segment) ? segment : (segments[0] ?? segment);

  useEffect(() => {
    // Landing on a closed segment (a bookmark, or the gate closing while the
    // student was away) moves them to a segment that exists rather than
    // showing an empty tab strip with nothing selected.
    const first = segments[0];
    if (first && !segments.includes(segment)) {
      onSelectSegment(first, { replace: true });
    }
  }, [segments, segment, onSelectSegment]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden bg-lantern-background">
      <div className="shrink-0 border-b border-lantern-border bg-lantern-surface px-3 sm:px-4 md:px-6">
        <h1 className="pt-3 text-lg font-semibold tracking-tight text-lantern-text">Campus</h1>
        {segments.length > 1 ? (
          <div role="tablist" aria-label="Campus sections" className="flex gap-1 pt-2">
            {segments.map((id) => {
              const iconName = SEGMENT_ICONS[id];
              const selected = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onSelectSegment(id)}
                  className={`relative flex min-h-[44px] items-center gap-1.5 px-3 text-sm font-medium transition-colors ${
                    selected
                      ? 'text-lantern-primary'
                      : 'text-lantern-text-secondary hover:text-lantern-text'
                  }`}
                >
                  <AppIcon name={iconName} size={16} aria-hidden={true} />
                  <span>{SEGMENT_LABELS[id]}</span>
                  {selected ? (
                    <span
                      className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-lantern-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          // One surviving segment is a heading, not a choice.
          <p className="pb-2 pt-0.5 text-xs text-lantern-text-secondary">
            {SEGMENT_LABELS[active]}
          </p>
        )}
      </div>
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
};

export default CampusHubScreen;

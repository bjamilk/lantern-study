import React from 'react';
import { AppIcon } from '../ui/AppIcon';

/**
 * The AI companion, collapsed to a 48px column beside the studio.
 *
 * WHY IT EXISTS (issue #105). The docked companion is 384–512px and, until now,
 * could not be closed at all: `AICompanionPanel` has had a `closable` prop since
 * the Library note editor needed one, and the set room never passed it. So a
 * room that docked the panel when it should not have was not recoverable by the
 * student. This rail is the other end of that — the companion is always one
 * click away, and never more than 48px wide until it is asked for.
 *
 * 48px WIDE, 44px TARGET. The two do not contradict each other: the button is a
 * 44×44 box centred in a 48px column, the same arrangement `SetRoomFocusBar`
 * uses inside its 48px bar. Do not "fix" the width by shrinking the button.
 *
 * `aria-expanded` / `aria-controls` make this a disclosure rather than a mystery
 * icon: the panel it controls is `ai-companion-panel`, which is exactly the
 * element that appears when it is pressed.
 */

export interface CompanionRailButtonProps {
  /** Expand the companion — docked when the room can hold it, overlay if not. */
  onExpand: () => void;
  /**
   * The companion is holding an attached note, so pressing this does not start
   * from nothing. Drawn as a dot rather than a count: it is a hint that there is
   * something in there, and a number would be a claim we cannot make honestly.
   */
  hasAttachment?: boolean;
}

export const CompanionRailButton: React.FC<CompanionRailButtonProps> = ({
  onExpand,
  hasAttachment = false,
}) => (
  <aside
    className="flex w-12 shrink-0 flex-col items-center self-stretch border-l border-lantern-border bg-lantern-surface pt-2"
    aria-label="Lantern AI"
  >
    <button
      type="button"
      onClick={onExpand}
      aria-label="Open Lantern AI"
      aria-expanded={false}
      aria-controls="ai-companion-panel"
      title="Open Lantern AI"
      className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
    >
      <AppIcon name="sparkles" size={20} />
      {hasAttachment ? (
        <span
          // Decorative. A screen reader gets the attached note from the panel
          // itself, where it is named; a second, wordless announcement here
          // would only say "something".
          aria-hidden
          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-lantern-primary ring-2 ring-lantern-surface"
        />
      ) : null}
    </button>
  </aside>
);

export default CompanionRailButton;

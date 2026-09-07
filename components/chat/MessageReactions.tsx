import React, { useState } from 'react';
import {
  CHAT_REACTION_EMOJI,
  sortedReactionEntries,
  totalReactionCount,
} from '@lantern/shared/chat';
import { AppIcon } from '../ui/AppIcon';

interface MessageReactionsProps {
  reactions?: Record<string, number> | null;
  /** Emoji the viewer has personally added to this message. */
  mine?: string[];
  /** Toggle: `added` tells the caller which direction the tap went. */
  onToggle: (emoji: string, added: boolean) => void;
  /** Read-only (removed messages, or a viewer who cannot post here). */
  disabled?: boolean;
  align?: 'start' | 'end';
  /**
   * Override the chip's accessible name. Community boards pass
   * `reactionAccessibilityLabel` so both clients announce a chip identically
   * (spec §9); chat keeps the default wording.
   */
  labelFor?: (emoji: string, count: number, mine: boolean) => string;
  /** Accessible name + visible label for the picker trigger. */
  addLabel?: string;
  /**
   * 'touch' grows every control to a 44px target — required on the board,
   * where a card is the tap surface. Chat keeps the compact strip.
   */
  size?: 'compact' | 'touch';
}

/**
 * Reaction strip under a message bubble: existing counts as toggle chips, plus
 * a picker for the fixed emoji set.
 *
 * Deliberately separate from the question vote row above it — votes decide
 * whether a question is verified and reaches tests; reactions gate nothing, so
 * the two must not read as one control.
 */
export const MessageReactions: React.FC<MessageReactionsProps> = ({
  reactions,
  mine = [],
  onToggle,
  disabled = false,
  align = 'start',
  labelFor,
  addLabel = 'Add a reaction',
  size = 'compact',
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const entries = sortedReactionEntries(reactions);
  const total = totalReactionCount(reactions);
  const mineSet = new Set(mine);
  const touch = size === 'touch';

  if (disabled && total === 0) return null;

  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-1 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      }`}
    >
      {entries.map(([emoji, count]) => {
        const isMine = mineSet.has(emoji);
        return (
          <button
            key={emoji}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(emoji, !isMine)}
            aria-pressed={isMine}
            aria-label={
              labelFor
                ? labelFor(emoji, count, isMine)
                : `${emoji} ${count} ${count === 1 ? 'reaction' : 'reactions'}${
                    isMine ? ', including yours' : ''
                  }`
            }
            className={`inline-flex items-center gap-1 rounded-full border text-xs transition-colors disabled:cursor-default disabled:opacity-60 ${
              touch ? 'min-h-[44px] px-3 py-1' : 'px-2 py-0.5'
            } ${
              isMine
                ? 'border-lantern-primary bg-lantern-primary-background text-lantern-primary'
                : 'border-lantern-border bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border'
            }`}
          >
            <span aria-hidden>{emoji}</span>
            <span className="font-medium tabular-nums">{count}</span>
          </button>
        );
      })}

      {disabled ? null : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-label={addLabel}
            aria-expanded={pickerOpen}
            title={addLabel}
            className={`inline-flex items-center justify-center gap-1 rounded-full border border-lantern-border bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border ${
              touch ? 'min-h-[44px] px-3 text-xs font-medium' : 'h-6 w-6'
            }`}
          >
            <AppIcon name="happy" size={14} aria-hidden />
            {touch ? <span>{addLabel}</span> : null}
          </button>

          {pickerOpen ? (
            <>
              {/* Click-away closes without trapping focus elsewhere on the page. */}
              <button
                type="button"
                aria-label="Close reaction picker"
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setPickerOpen(false)}
              />
              <div
                role="menu"
                className={`absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-lantern-border bg-lantern-surface p-1 shadow-lantern ${
                  align === 'end' ? 'right-0' : 'left-0'
                }`}
              >
                {CHAT_REACTION_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="menuitem"
                    aria-label={`React with ${emoji}`}
                    onClick={() => {
                      setPickerOpen(false);
                      onToggle(emoji, !mineSet.has(emoji));
                    }}
                    className={`rounded-full text-base leading-none transition-transform hover:scale-125 ${
                      touch ? 'min-h-[44px] min-w-[44px] px-2' : 'px-1.5 py-0.5'
                    } ${mineSet.has(emoji) ? 'bg-lantern-primary-background' : ''}`}
                  >
                    <span aria-hidden>{emoji}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default MessageReactions;

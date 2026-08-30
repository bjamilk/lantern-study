import React, { useState } from 'react';
import { FaceSmileIcon } from '@heroicons/react/24/outline';
import {
  CHAT_REACTION_EMOJI,
  sortedReactionEntries,
  totalReactionCount,
} from '@lantern/shared/chat';

interface MessageReactionsProps {
  reactions?: Record<string, number> | null;
  /** Emoji the viewer has personally added to this message. */
  mine?: string[];
  /** Toggle: `added` tells the caller which direction the tap went. */
  onToggle: (emoji: string, added: boolean) => void;
  /** Read-only (removed messages, or a viewer who cannot post here). */
  disabled?: boolean;
  align?: 'start' | 'end';
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
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const entries = sortedReactionEntries(reactions);
  const total = totalReactionCount(reactions);
  const mineSet = new Set(mine);

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
            aria-label={`${emoji} ${count} ${count === 1 ? 'reaction' : 'reactions'}${
              isMine ? ', including yours' : ''
            }`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-default disabled:opacity-60 ${
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
            aria-label="Add a reaction"
            aria-expanded={pickerOpen}
            title="Add a reaction"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-lantern-border bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border"
          >
            <FaceSmileIcon className="h-3.5 w-3.5" aria-hidden />
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
                    className={`rounded-full px-1.5 py-0.5 text-base leading-none transition-transform hover:scale-125 ${
                      mineSet.has(emoji) ? 'bg-lantern-primary-background' : ''
                    }`}
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

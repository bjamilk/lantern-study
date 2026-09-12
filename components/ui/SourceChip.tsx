import React from 'react';
import { AppIcon } from './AppIcon';

export interface SourceChipProps {
  /** The note's title. Truncated — the full string stays in the tooltip. */
  title: string;
  /**
   * What part of it, e.g. "Excerpt 3". There are no page numbers anywhere in
   * the companion pipeline, so this must never be phrased as a page.
   */
  detail?: string;
  /** Makes the chip a button — typically "open that note". */
  onPress?: () => void;
  /** When given, draws a trailing × that detaches the source. */
  onRemove?: () => void;
  /** Passed down rather than read from a store, matching AICompanionPanel. */
  theme?: 'light' | 'dark';
  className?: string;
}

/**
 * One source pill: which document a thing came from.
 *
 * Used for both halves of the companion's honesty story — the note attached to
 * the composer, and the excerpts an answer was actually read out of. They are
 * the same claim ("this came from here"), so they are the same chip.
 */
export function SourceChip({
  title,
  detail,
  onPress,
  onRemove,
  theme = 'light',
  className = '',
}: SourceChipProps) {
  const label = detail ? `${title} · ${detail}` : title;

  const tone =
    theme === 'dark'
      ? 'border-lantern-primary/40 bg-lantern-primary/15 text-lantern-primary-light'
      : 'border-lantern-primary/30 bg-lantern-primary-background text-lantern-primary';

  const body = (
    <>
      <AppIcon name="document-text" size={14} className="flex-shrink-0" />
      <span className="truncate font-medium">{label}</span>
    </>
  );

  return (
    <div
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${tone} ${className}`}
      title={label}
    >
      {onPress ? (
        <button
          type="button"
          onClick={onPress}
          className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
        >
          {body}
        </button>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1.5">{body}</span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove note context"
          aria-label="Remove note context"
          className="flex-shrink-0 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
        >
          <AppIcon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

export default SourceChip;

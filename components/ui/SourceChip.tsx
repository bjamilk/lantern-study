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
  /**
   * Kept for the call sites that thread theme through by hand, but no longer
   * read: both halves of the `ai` pair are theme-aware tokens, so the one
   * class works in light and dark without a branch.
   */
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
  className = '',
}: SourceChipProps) {
  const label = detail ? `${title} · ${detail}` : title;

  /**
   * The companion's own lilac, not the primary ramp.
   *
   * A citation is the companion saying where it read something, so it wears the
   * `ai` feature pair — `ai` ink on the `ai` tint — the way the phone's
   * citation chip does. In the primary indigo it was indistinguishable from the
   * dozen other pills the app already draws in that hue, and the two surfaces
   * disagreed about what a source looks like.
   */
  const tone = 'border-lantern-feature-ai-ink/30 bg-lantern-feature-ai-tint text-lantern-feature-ai-ink';

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

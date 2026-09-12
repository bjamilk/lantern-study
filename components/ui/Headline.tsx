import React from 'react';
import { FEATURE_INK_TEXT, type FeatureKey } from './featureClasses';

export interface HeadlineProps {
  /**
   * The heading, in full, as plain text: `"Turn your files into Games"`.
   * A ReactNode is deliberately not accepted — the accent is found by matching
   * a substring, which only has a meaning over text.
   */
  children: string;
  /**
   * The ONE word (or phrase) inside `children` to set in italic serif. It must
   * appear in `children` verbatim; if it does not, the heading renders whole
   * and unaccented rather than throwing, because a headline is not worth a
   * white screen. Matching is case-sensitive: "Games" and "games" are
   * different accents.
   */
  accent?: string;
  /** Whose ink the accent word is set in. Defaults to the body ink. */
  feature?: FeatureKey;
  /** `display` (28 px) for a screen's own name, `title` (22 px) for a section. */
  size?: 'display' | 'title';
  /** The heading level. Pick by the document outline, never by the size. */
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}

/**
 * A section heading with one italic accent word, the 2026-09-11 direction's
 * display voice: *"Turn your files into **Games**"* — the accent in italic
 * serif, in the section's own hue.
 *
 * WHY THE ACCENT IS A PROP AND NOT MARKUP. The obvious alternative is to let
 * call sites pass `<>Turn your files into <i>Games</i></>`. That puts a
 * presentational `<i>` in thirty screens, gives each one its own chance to
 * pick a different hue, and — the part that actually bites — makes the
 * heading's text unavailable as a string to anything that wants it (a page
 * title, a test, an aria-label). Passing the whole line as text and naming the
 * accent keeps one source for both.
 *
 * ACCESSIBILITY. The accent is a `<span>`, not an `<em>`: it carries no
 * emphasis a screen reader should voice, only a hue and a slant. The heading
 * is announced as the one sentence it is.
 *
 * The serif comes from `text-display` / `text-title`, which index.css maps to
 * `--font-display` (Bitter). No call site names the family.
 */
export const Headline: React.FC<HeadlineProps> = ({
  children,
  accent,
  feature,
  size = 'title',
  as: Tag = 'h2',
  className = '',
}) => {
  const sizeClass = size === 'display' ? 'text-display' : 'text-title';
  const base = `${sizeClass} text-lantern-text ${className}`;

  const at = accent ? children.indexOf(accent) : -1;
  if (!accent || at === -1) {
    return <Tag className={base}>{children}</Tag>;
  }

  const before = children.slice(0, at);
  const after = children.slice(at + accent.length);
  const inkClass = feature ? FEATURE_INK_TEXT[feature] : '';

  return (
    <Tag className={base}>
      {before}
      <span data-testid="headline-accent" className={`italic ${inkClass}`}>
        {accent}
      </span>
      {after}
    </Tag>
  );
};

export default Headline;

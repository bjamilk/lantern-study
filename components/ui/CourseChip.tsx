import React from 'react';

export interface CourseChipProps {
  /**
   * `Course.code`, already normalised ("BIO 201"). Same prop name as mobile's
   * `CourseChip`, so a row reads the same on both platforms. Empty or missing
   * draws nothing — a "no course" chip is a label on an absence, and most rows
   * in these lists are unfiled.
   */
  code?: string | null;
  /** Full course title, for the tooltip / accessible name. */
  title?: string | null;
  /** When given the chip becomes a filter button; otherwise it is plain text. */
  onClick?: () => void;
  className?: string;
}

/**
 * The right-hand chip on a typed list row: which course this thing belongs to.
 *
 * Deliberately neutral. §5.6 caps a card at two feature hues, and the disc on
 * the left has already spent one on the object type; a second hue for the
 * course would make every row a rainbow and would encode nothing a student can
 * decode. Border + secondary ink, `text-label`, so it reads as metadata.
 */
export const CourseChip: React.FC<CourseChipProps> = ({
  code,
  title,
  onClick,
  className = '',
}) => {
  const text = code?.trim();
  if (!text) return null;

  const shared = `shrink-0 max-w-[10rem] truncate rounded-full border border-lantern-border bg-lantern-background px-2 py-0.5 text-label tracking-normal text-lantern-text-secondary ${className}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? text}
        className={`${shared} hover:border-lantern-text-tertiary hover:text-lantern-text transition-colors`}
      >
        {text}
      </button>
    );
  }

  return (
    <span title={title ?? text} className={shared}>
      {text}
    </span>
  );
};

export default CourseChip;

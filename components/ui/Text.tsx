import React from 'react';

/**
 * Type primitives — the six steps of the Lantern scale, one role each.
 *
 * | Step      | px | LH | Weight | Tracking | Role                                   |
 * |-----------|----|----|--------|----------|----------------------------------------|
 * | `display` | 28 | 34 | 700    | -0.02em  | hero greeting, score numeral           |
 * | `title`   | 22 | 28 | 700    | -0.02em  | every screen h1, modal title           |
 * | `heading` | 17 | 24 | 600    | -0.011em | section h2, card title, flashcard face |
 * | `body`    | 15 | 22 | 400    | -0.011em | all prose, chat, list titles (600)     |
 * | `caption` | 13 | 18 | 400    | 0        | secondary, timestamps, stat labels     |
 * | `label`   | 11 | 16 | 600    | +0.04em  | uppercase eyebrows, badges, tab labels |
 *
 * Nothing below `label`. The steps are the Tailwind `text-display` … `text-label`
 * utilities (tailwind.config.js), so a migrated call site can either use the
 * class directly or one of these components; the components exist so that
 * `<Title>` also picks the right element and so the scale is discoverable from
 * `components/ui`.
 *
 * Weight/leading/tracking travel with the step and are overridable at the call
 * site — Tailwind emits `font-*`, `leading-*` and `tracking-*` after
 * `text-*`, so `<Body className="font-semibold">` is a 15/22 list title.
 */

export type TypeStep = 'display' | 'title' | 'heading' | 'body' | 'caption' | 'label';

const STEP_CLASS: Record<TypeStep, string> = {
  display: 'text-display',
  title: 'text-title',
  heading: 'text-heading',
  body: 'text-body',
  caption: 'text-caption',
  label: 'text-label',
};

type TextOwnProps = {
  /** Which step of the scale. Defaults to `body`. */
  step?: TypeStep;
  /** Element to render. Defaults to the element the step usually belongs to. */
  as?: keyof React.JSX.IntrinsicElements;
  /**
   * Numerals that live in a column or tick in place (stats, scores, timers,
   * counts). Adds `tabular-nums` so digits do not reflow as the value changes.
   */
  numeral?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export type TextProps = TextOwnProps & Omit<React.HTMLAttributes<HTMLElement>, keyof TextOwnProps>;

const DEFAULT_ELEMENT: Record<TypeStep, keyof React.JSX.IntrinsicElements> = {
  display: 'div',
  title: 'h1',
  heading: 'h2',
  body: 'p',
  caption: 'p',
  label: 'span',
};

export const Text: React.FC<TextProps> = ({
  step = 'body',
  as,
  numeral = false,
  className = '',
  children,
  ...rest
}) => {
  const Component = (as || DEFAULT_ELEMENT[step]) as React.ElementType;
  return (
    <Component
      className={`${STEP_CLASS[step]}${numeral ? ' tabular-nums' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </Component>
  );
};

type StepProps = Omit<TextProps, 'step'>;

/** 28/34/700 — hero greeting, the one big numeral on a screen. */
export const Display: React.FC<StepProps> = (props) => <Text step="display" {...props} />;
/** 22/28/700 — every screen `h1` and every modal title. */
export const Title: React.FC<StepProps> = (props) => <Text step="title" {...props} />;
/** 17/24/600 — section `h2` and card titles. */
export const Heading: React.FC<StepProps> = (props) => <Text step="heading" {...props} />;
/** 15/22/400 — prose, chat, list titles (add `font-semibold`). */
export const Body: React.FC<StepProps> = (props) => <Text step="body" {...props} />;
/** 13/18/400 — secondary copy, timestamps, stat labels. */
export const Caption: React.FC<StepProps> = (props) => <Text step="caption" {...props} />;
/** 11/16/600 +0.04em — eyebrows, badges, tab labels. The floor: nothing smaller. */
export const Label: React.FC<StepProps> = (props) => <Text step="label" {...props} />;

export default Text;

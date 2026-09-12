import { typeScale } from '../design/typeScale';

/** Air above a section heading and between groups. */
export const SPACE_BEFORE_HEADING = 20;

/**
 * The three heading levels, one type step each.
 *
 * `#` → Display 28/34, `##` → Title 22/28, `###` → Heading 17/24, over a Body
 * 15/22. The first mapping was one step lower throughout (`##` at 17 over a 15
 * body); on a phone that is a 2 sp difference at the same weight, which reads
 * as no hierarchy at all. Each level moved up a step, and the top two — the
 * only steps set in the Bitter serif (components/ui/Text.tsx) — now carry a
 * second voice as well as a second size.
 *
 * `serif` marks those two: their face supplies its own weight, so neither the
 * step nor a bold run inside it may add a numeric `fontWeight`.
 *
 * A step name, never a `fontSize` — a lint forbids size literals, and the
 * app's text-size setting only rescales sizes that come from the scale.
 */
export const HEADING_STEPS = {
  title: { step: 'Display', serif: true, marginTop: 0, marginBottom: 8 },
  heading: { step: 'Title', serif: true, marginTop: SPACE_BEFORE_HEADING, marginBottom: 8 },
  subheading: {
    step: 'Heading',
    serif: false,
    marginTop: SPACE_BEFORE_HEADING,
    marginBottom: 4,
  },
} as const satisfies Record<
  'title' | 'heading' | 'subheading',
  { step: 'Display' | 'Title' | 'Heading'; serif: boolean; marginTop: number; marginBottom: number }
>;


/** The rendered size of one heading level, for the ladder assertions. */
export function headingSize(kind: keyof typeof HEADING_STEPS): number {
  const step = HEADING_STEPS[kind].step.toLowerCase() as 'display' | 'title' | 'heading';
  return typeScale[step].fontSize;
}

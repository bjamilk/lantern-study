import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SMART_NOTES_END, SMART_NOTES_START } from '@lantern/shared/utils/smartNotes';
import { NoteReadingView } from './NoteReadingView';

/**
 * The reading state the notes studio opens in. Server rendering keeps this
 * suite off a DOM it does not need, and off the studio's stores.
 */
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const visibleText = (html: string) => html.replace(/<[^>]*>/g, '');

const BODY = `${SMART_NOTES_START}
# Cell Biology
## Overview
The **mitochondrion** makes ATP.
### Organelles
- Nucleus
  - Nucleolus
1. First step
${SMART_NOTES_END}
<!-- lantern:anything -->`;

describe('NotesStudio reading view', () => {
  // Four distinct steps, one per level. The first mapping stopped at
  // `text-heading` (17) for `##` over a 15 body, which on a phone reads as one
  // flat size; each role moved up a step and the two display ones took the
  // serif, so `##` must now be `text-title` and `###` `text-heading`.
  it('puts each heading level on its own type step, above the body', () => {
    const html = render(<NoteReadingView body={BODY} />);
    expect(html).toMatch(/<h1 class="text-display font-display font-semibold[^"]*">/);
    expect(html).toMatch(/<h2 class="text-title font-display font-semibold[^"]*">Overview<\/h2>/);
    expect(html).toMatch(/<h3 class="text-heading font-semibold[^"]*">Organelles<\/h3>/);
    expect(html).toMatch(/<p class="text-body [^"]*">/);
    // The body step never carries a heading, and no level doubles up.
    expect(html).not.toMatch(/<h[1-3] class="text-body/);
  });

  it('marks a key term bold and indents a nested bullet', () => {
    const html = render(<NoteReadingView body={BODY} />);
    expect(html).toContain('<strong class="font-semibold text-lantern-text">mitochondrion</strong>');
    expect(html.match(/<ul class="[^"]*pl-6/g) || []).toHaveLength(2);
    expect(html).toContain('list-decimal');
  });

  it('lets no markdown or machine marker reach the screen', () => {
    const text = visibleText(render(<NoteReadingView body={BODY} />));
    expect(text).not.toContain('#');
    expect(text).not.toContain('**');
    expect(text).not.toContain('<!--');
    expect(text).not.toContain('lantern:smart-notes');
    expect(text).toContain('Cell Biology');
    expect(text).toContain('mitochondrion');
  });

  it('leaks no `node` attribute onto the markup', () => {
    // react-markdown passes each mapped component the mdast node it came
    // from. Spread onto the element it becomes `node="[object Object]"` in
    // the DOM — invalid markup, and a React warning per element.
    const html = render(<NoteReadingView body={BODY} />);
    expect(html).not.toMatch(/\snode=/);
    expect(html).not.toContain('[object Object]');
  });

  it('renders a plain body as prose and an empty one as a hint', () => {
    expect(visibleText(render(<NoteReadingView body="Just a sentence." />))).toBe('Just a sentence.');
    const empty = render(<NoteReadingView body="" emptyLine="Nothing here yet." />);
    expect(visibleText(empty)).toBe('Nothing here yet.');
    expect(empty).toContain('text-lantern-text-tertiary');
  });
});

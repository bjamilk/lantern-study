import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoteReadingView } from './NoteReadingView';

/** The reading state the lecture studio's "My notes" pane opens in. */
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const visibleText = (html: string) => html.replace(/<[^>]*>/g, '');

const LECTURE = `[00:36] Professor starts on entropy
Second law: disorder never falls.

## After class
- Read chapter 4`;

describe('LectureStudio reading view', () => {
  it('tones a transcript timestamp as a caption inside a body paragraph', () => {
    const html = render(<NoteReadingView body={LECTURE} />);
    expect(html).toMatch(/<p class="text-body [^"]*">/);
    expect(html).toContain('<span class="text-caption text-lantern-text-secondary mr-1.5">00:36');
    expect(html).toContain('Professor starts on entropy');
    expect(visibleText(html)).not.toContain('[00:36]');
  });

  it('keeps a single newline as a line break', () => {
    const html = render(<NoteReadingView body={'Line one\nLine two'} />);
    expect(html).toContain('<br/>');
  });

  it('shows the section heading a clear step above the body, with no hashes', () => {
    const html = render(<NoteReadingView body={LECTURE} />);
    // `##` is the 22 px serif title step, not the 17 px heading step it used
    // to be: 17 over a 15 body reads flat on a phone. See NoteReadingView.
    expect(html).toMatch(/<h2 class="text-title font-display font-semibold[^"]*">After class<\/h2>/);
    expect(visibleText(html)).not.toContain('#');
  });
});

import {
  MIN_HIGHLIGHT_CHARS,
  NOTES_STUDIO_DEPTHS,
  buildFigureQuestion,
  buildSpanQuestion,
  canAskAboutHighlight,
  highlightFromRange,
} from './notesStudio';

describe('notes studio helpers', () => {
  it('maps existing Smart Notes depths to studio labels', () => {
    expect(NOTES_STUDIO_DEPTHS.map((row) => row.id)).toEqual(['concise', 'standard', 'deep']);
    expect(NOTES_STUDIO_DEPTHS.map((row) => row.label)).toEqual([
      'Summarized',
      'In-depth',
      'Comprehensive',
    ]);
  });

  it('quotes a highlighted span so Ask cites that span', () => {
    const message = buildSpanQuestion({
      question: 'What does this mean?',
      excerpt: 'Enzymes lower activation energy.',
      noteTitle: 'Week 3',
    });
    expect(message).toContain('What does this mean?');
    expect(message).toContain('in "Week 3"');
    expect(message).toContain('Enzymes lower activation energy.');
    expect(message).toContain('"""');
  });

  it('does not pretend an empty highlight was cited', () => {
    const message = buildSpanQuestion({ excerpt: '   ', noteTitle: 'Week 3' });
    expect(message).toContain('but it was empty');
    expect(message).not.toContain('"""');
  });

  it('asks about a figure with extracted text when we have it', () => {
    const withText = buildFigureQuestion({
      label: 'Figure 2',
      excerpt: 'A Michaelis-Menten curve.',
    });
    expect(withText).toContain('Figure 2');
    expect(withText).toContain('A Michaelis-Menten curve.');
    const without = buildFigureQuestion({ label: 'Slide 4' });
    expect(without).toContain('no extracted text');
  });

  it('only offers Ask once the highlight is a real span', () => {
    expect(canAskAboutHighlight('short')).toBe(false);
    expect(canAskAboutHighlight('a'.repeat(MIN_HIGHLIGHT_CHARS))).toBe(true);
    expect(highlightFromRange('abcdef', 1, 4)).toBe('bcd');
    expect(highlightFromRange('abcdef', 4, 1)).toBe('');
  });
});

import { noteRowMark } from './noteRowMark';

describe('noteRowMark', () => {
  it('puts everything that reads as notes on the teal family', () => {
    for (const source of ['typed', 'import', 'pdf', 'presentation', 'photos', 'youtube']) {
      expect(noteRowMark(source).feature).toBe('notes');
    }
  });

  it('puts a lecture recording on the recording family', () => {
    expect(noteRowMark('audio')).toEqual({ feature: 'recording', icon: 'mic', label: 'Audio' });
  });

  it('gives each source its own glyph so the disc, not a word, says what it is', () => {
    expect(noteRowMark('pdf').icon).toBe('document');
    expect(noteRowMark('presentation').icon).toBe('easel');
    expect(noteRowMark('photos').icon).toBe('images');
    expect(noteRowMark('youtube').icon).toBe('logo-youtube');
  });

  it('reads an unknown or missing source as a plain note rather than a blank', () => {
    expect(noteRowMark(undefined).label).toBe('Note');
    expect(noteRowMark(null).label).toBe('Note');
    expect(noteRowMark('something-new').label).toBe('Note');
  });

  it('never spends more than two hues on the list', () => {
    const hues = new Set(
      ['typed', 'import', 'pdf', 'presentation', 'photos', 'youtube', 'audio'].map(
        (s) => noteRowMark(s).feature,
      ),
    );
    expect(hues.size).toBeLessThanOrEqual(2);
  });
});

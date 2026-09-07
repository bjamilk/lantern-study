import { previewCard } from '@lantern/shared/flashcards/generationOptions';
import { firstSourceLine, longestTerm, previewSampleFromSource } from './generationSample';

describe('firstSourceLine', () => {
  it('takes the heading, without its markdown', () => {
    expect(firstSourceLine('# Photosynthesis\n\nIt happens in the chloroplast.')).toBe(
      'Photosynthesis'
    );
  });

  it('takes the first sentence of a paragraph, not the whole block', () => {
    expect(firstSourceLine('The mitochondrion makes ATP. It has two membranes.')).toBe(
      'The mitochondrion makes ATP.'
    );
  });

  it('strips a bullet marker', () => {
    expect(firstSourceLine('- Krebs cycle runs in the matrix')).toBe(
      'Krebs cycle runs in the matrix'
    );
  });

  it('clips a very long opening line', () => {
    expect(firstSourceLine('x'.repeat(400)).endsWith('…')).toBe(true);
  });

  it('is empty for an empty source', () => {
    expect(firstSourceLine('   \n\n ')).toBe('');
  });
});

describe('longestTerm', () => {
  it('finds the word a cloze card would hide', () => {
    expect(longestTerm('The mitochondrion makes ATP.')).toBe('mitochondrion');
  });
});

describe('previewSampleFromSource', () => {
  it('feeds the shared preview both halves from the student’s own notes', () => {
    const sample = previewSampleFromSource('The mitochondrion makes ATP.')!;
    expect(sample).toEqual({
      front: 'The mitochondrion makes ATP.',
      back: 'mitochondrion',
      sentence: 'The mitochondrion makes ATP.',
    });
    const card = previewCard({ count: 20, typeMix: 'cloze' }, sample);
    expect(card.type).toBe('CLOZE');
    expect(card.clozeText).toContain('{{c1::mitochondrion}}');
    expect(card.front).not.toContain('mitochondrion');
  });

  it('has nothing to show rather than showing a fake card', () => {
    expect(previewSampleFromSource('')).toBeNull();
  });
});

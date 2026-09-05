/**
 * Keyword-overlap retrieval for the note-scoped tutor.
 *
 * The behaviour that matters is not "does it rank" — it is that a question
 * about the END of a long note reaches the end of the note, and that a
 * question with nothing to match on degrades to the document opening instead
 * of returning nothing.
 */
import {
  TUTOR_CHUNKS_PER_QUESTION,
  extractQueryKeywords,
  selectDocumentExcerptsForQuestion,
  selectRelevantChunks,
} from './smartNotes';

describe('extractQueryKeywords', () => {
  it('drops stopwords and question verbs, keeps the topic', () => {
    expect(extractQueryKeywords('Can you explain how the Calvin cycle works?')).toEqual([
      'calvin',
      'cycle',
      'work',
    ]);
  });

  it('leaves an "-is" singular alone instead of mangling it', () => {
    expect(extractQueryKeywords('glycolysis')).toEqual(['glycolysis']);
  });

  it('folds plurals so "enzymes" finds "enzyme"', () => {
    expect(extractQueryKeywords('enzymes')).toEqual(extractQueryKeywords('enzyme'));
  });

  it('returns nothing for a query made only of question words', () => {
    expect(extractQueryKeywords('summarize this note for me please')).toEqual([]);
  });

  it('ignores one- and two-letter noise', () => {
    expect(extractQueryKeywords('a b of xy glycolysis')).toEqual(['glycolysis']);
  });
});

describe('selectRelevantChunks', () => {
  const chunks = [
    'Chapter one covers cell structure: the membrane, the cytoplasm and the nucleus.',
    'Chapter two covers glycolysis, which splits glucose into two molecules of pyruvate.',
    'Chapter three covers the electron transport chain and oxidative phosphorylation.',
    'Chapter four covers photosynthesis in the chloroplast, including the Calvin cycle.',
  ];

  it('reaches a chunk at the END of the document, not just the opening', () => {
    const result = selectRelevantChunks(chunks, 'What happens in the Calvin cycle?');
    expect(result.strategy).toBe('keyword');
    expect(result.chunks.map((c) => c.index)).toContain(3);
    expect(result.chunks[0].matchedTerms).toContain('calvin');
  });

  it('returns at most the requested number of chunks', () => {
    const result = selectRelevantChunks(chunks, 'chapter cell glycolysis electron photosynthesis', {
      limit: 2,
    });
    expect(result.chunks).toHaveLength(2);
  });

  it('defaults to 2-3 chunks per question', () => {
    const result = selectRelevantChunks(chunks, 'chapter cell glycolysis electron photosynthesis');
    expect(result.chunks.length).toBeLessThanOrEqual(TUTOR_CHUNKS_PER_QUESTION);
  });

  it('returns selected chunks in reading order, not score order', () => {
    const result = selectRelevantChunks(chunks, 'Calvin cycle and glycolysis', { limit: 3 });
    const indexes = result.chunks.map((c) => c.index);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it('weights a rare term above one that appears in every chunk', () => {
    // "chapter" is in all four chunks; "pyruvate" is in exactly one.
    const result = selectRelevantChunks(chunks, 'chapter pyruvate', { limit: 1 });
    expect(result.chunks[0].index).toBe(1);
  });

  it('falls back to the document opening when the query has no topic words', () => {
    const result = selectRelevantChunks(chunks, 'summarize this note', { limit: 2 });
    expect(result.strategy).toBe('leading');
    expect(result.chunks.map((c) => c.index)).toEqual([0, 1]);
  });

  it('falls back to the opening when real keywords match nothing', () => {
    const result = selectRelevantChunks(chunks, 'thermodynamics entropy', { limit: 1 });
    expect(result.strategy).toBe('leading');
    expect(result.chunks[0].index).toBe(0);
  });

  it('reports "none" for an empty document rather than inventing a chunk', () => {
    expect(selectRelevantChunks([], 'glycolysis')).toEqual({
      chunks: [],
      strategy: 'none',
      totalChunks: 0,
    });
    expect(selectRelevantChunks(['   ', ''], 'glycolysis').strategy).toBe('none');
  });

  it('is deterministic — the same question returns the same excerpts', () => {
    const a = selectRelevantChunks(chunks, 'glycolysis pyruvate');
    const b = selectRelevantChunks(chunks, 'glycolysis pyruvate');
    expect(a).toEqual(b);
  });

  it('counts totalChunks from the whole document, not the selection', () => {
    const result = selectRelevantChunks(chunks, 'Calvin cycle', { limit: 1 });
    expect(result.totalChunks).toBe(4);
    expect(result.chunks).toHaveLength(1);
  });
});

describe('selectDocumentExcerptsForQuestion', () => {
  it('chunks a long document and finds the answer buried at the end', () => {
    const filler = 'Introductory material about study habits and revision timetables. '.repeat(120);
    const document = `${filler}\n\nThe Nigerian Factories Act of 1990 governs workplace safety inspections.`;

    const result = selectDocumentExcerptsForQuestion(document, 'What does the Factories Act cover?');

    expect(result.totalChunks).toBeGreaterThan(1);
    expect(result.strategy).toBe('keyword');
    expect(result.chunks.map((c) => c.text).join(' ')).toContain('Factories Act');
  });

  it('sends far less text to the model than the document contains', () => {
    const document = 'Photosynthesis in the chloroplast. '.repeat(2000);
    const result = selectDocumentExcerptsForQuestion(document, 'explain photosynthesis');
    const sent = result.chunks.reduce((total, chunk) => total + chunk.text.length, 0);

    expect(sent).toBeLessThan(document.length);
    expect(sent).toBeLessThanOrEqual(4200);
  });

  it('handles an empty document without throwing', () => {
    expect(selectDocumentExcerptsForQuestion('', 'anything').strategy).toBe('none');
  });
});

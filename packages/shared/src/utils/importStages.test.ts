import {
  CREATION_TABS,
  countCreations,
  creationsSummary,
  deriveImportStages,
  emptyImportRunState,
  filterCreations,
  importRunHeading,
  importWaitHint,
  isImportRunning,
  whereNextCards,
  type CreationEntry,
  type ImportRunState,
} from './importStages';

describe('deriveImportStages', () => {
  it('starts with the upload active and nothing after it running', () => {
    const cards = deriveImportStages(emptyImportRunState('pdf'));
    expect(cards.map((c) => c.id)).toEqual(['uploaded', 'processing', 'generating']);
    expect(cards[0].status).toBe('active');
    expect(cards[1].status).toBe('pending');
    expect(cards[2].status).toBe('pending');
  });

  it('carries the upload percent only while the upload is running', () => {
    const uploading: ImportRunState = {
      ...emptyImportRunState('pdf'),
      upload: { phase: 'uploading', percent: 42 },
    };
    expect(deriveImportStages(uploading)[0].percent).toBe(42);

    const landed: ImportRunState = {
      ...uploading,
      upload: { phase: 'processing', percent: 100 },
    };
    const cards = deriveImportStages(landed);
    expect(cards[0].status).toBe('done');
    expect(cards[1].status).toBe('active');
    // The server reads the file without reporting progress, so the middle card
    // must never show a number. This is the fake-percentage guard.
    expect(cards[1].percent).toBeNull();
  });

  it('never invents a percentage when the length is not computable', () => {
    const cards = deriveImportStages({
      ...emptyImportRunState('presentation'),
      upload: { phase: 'uploading', percent: null },
    });
    expect(cards[0].percent).toBeNull();
  });

  it('reports the generator run as the fraction of stages it has reached', () => {
    const cards = deriveImportStages({
      ...emptyImportRunState('pdf'),
      upload: { phase: 'complete', percent: 100 },
      materialReady: true,
      generation: { index: 2, count: 5 },
    });
    expect(cards[1].status).toBe('done');
    expect(cards[2].status).toBe('active');
    expect(cards[2].percent).toBe(40);
  });

  it('names the third card after what will actually be generated', () => {
    const label = (generates: ('flashcards' | 'quiz')[]) =>
      deriveImportStages(emptyImportRunState('pdf', generates))[2].label;
    expect(label(['flashcards', 'quiz'])).toBe('Generating flashcards and quiz');
    expect(label(['flashcards'])).toBe('Generating flashcards');
    expect(label(['quiz'])).toBe('Generating quiz');
    // Both toggles off: the Smart Notes pass is what runs, and the card says so
    // rather than promising a deck nobody asked for.
    expect(label([])).toBe('Writing Smart Notes');
  });

  it('calls the first card "Video linked" when no bytes are sent', () => {
    const state = emptyImportRunState('youtube', ['flashcards'], false);
    expect(deriveImportStages(state)[0].label).toBe('Video linked');
    expect(deriveImportStages(state)[0].status).toBe('active');
    expect(deriveImportStages({ ...state, materialReady: true })[0].status).toBe('done');
  });

  it('hangs a failure on the stage that broke and stops the ones after it', () => {
    const cards = deriveImportStages({
      ...emptyImportRunState('pdf'),
      upload: { phase: 'complete', percent: 100 },
      failure: { stage: 'processing', message: 'No text could be read out of this PDF.' },
    });
    expect(cards[0].status).toBe('done');
    expect(cards[1].status).toBe('failed');
    expect(cards[1].error).toBe('No text could be read out of this PDF.');
    expect(cards[1].percent).toBeNull();
    // Not 'active': the generator is not running, and a spinner there would be
    // a lie about work that stopped.
    expect(cards[2].status).toBe('pending');
  });

  it('fails the upload card itself when the transfer is what broke', () => {
    const cards = deriveImportStages({
      ...emptyImportRunState('pdf'),
      upload: { phase: 'uploading', percent: 12 },
      failure: { stage: 'uploaded', message: 'Upload failed — check your connection.' },
    });
    expect(cards[0].status).toBe('failed');
    expect(cards[0].error).toBe('Upload failed — check your connection.');
    expect(cards.slice(1).every((c) => c.status === 'pending')).toBe(true);
  });

  it('marks every card done when the run finishes', () => {
    const done: ImportRunState = {
      ...emptyImportRunState('document'),
      upload: { phase: 'complete', percent: 100 },
      materialReady: true,
      generationDone: true,
    };
    expect(deriveImportStages(done).every((c) => c.status === 'done')).toBe(true);
    expect(isImportRunning(done)).toBe(false);
  });
});

describe('headings and the wait hint', () => {
  it('names the kind in the heading', () => {
    expect(importRunHeading('pdf')).toBe('Importing PDF');
    expect(importRunHeading('youtube')).toBe('Importing YouTube video');
  });

  it('gives a range and never a countdown', () => {
    for (const kind of ['pdf', 'youtube', 'photos', 'cards'] as const) {
      const hint = importWaitHint(kind);
      expect(hint.length).toBeGreaterThan(0);
      expect(hint).not.toMatch(/\d+\s*(s|sec|m|min)\b/i);
    }
    expect(importWaitHint('youtube')).toMatch(/video takes longer/i);
  });
});

describe('whereNextCards', () => {
  it('offers the material first, recommended', () => {
    const cards = whereNextCards({ hasMaterial: true, hasPlan: true });
    expect(cards.map((c) => c.id)).toEqual(['material', 'plan']);
    expect(cards[0].recommended).toBe(true);
    expect(cards[1].recommended).toBe(false);
  });

  it('falls back to the set home when the set has no plan', () => {
    const cards = whereNextCards({ hasMaterial: true, hasPlan: false });
    expect(cards.map((c) => c.id)).toEqual(['material', 'setHome']);
    expect(cards[1].title).toBe('Set home');
  });

  it('recommends the remaining card when there is no material to open', () => {
    const cards = whereNextCards({ hasMaterial: false, hasPlan: true });
    expect(cards.map((c) => c.id)).toEqual(['plan']);
    expect(cards[0].recommended).toBe(true);
  });
});

describe('creation progress', () => {
  const rows: CreationEntry[] = [
    { id: 'a', title: 'Lecture 1.pdf', status: 'processing', updatedAt: 3 },
    { id: 'b', title: 'Slides.pptx', status: 'done', updatedAt: 5 },
    { id: 'c', title: 'Broken.docx', status: 'failed', updatedAt: 1 },
    { id: 'd', title: 'Photos', status: 'done', updatedAt: 9 },
  ];

  it('has the four tabs the reference names', () => {
    expect(CREATION_TABS).toEqual(['all', 'processing', 'done', 'failed']);
  });

  it('filters by tab and orders newest first', () => {
    expect(filterCreations(rows, 'all').map((r) => r.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(filterCreations(rows, 'processing').map((r) => r.id)).toEqual(['a']);
    expect(filterCreations(rows, 'done').map((r) => r.id)).toEqual(['d', 'b']);
    expect(filterCreations(rows, 'failed').map((r) => r.id)).toEqual(['c']);
  });

  it('does not mutate the list it was handed', () => {
    const before = rows.map((r) => r.id);
    filterCreations(rows, 'all');
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('counts and summarises', () => {
    expect(countCreations(rows, 'processing')).toBe(1);
    expect(creationsSummary(rows)).toBe('1 processing, 2 done');
    expect(creationsSummary([])).toBe('0 processing, 0 done');
  });
});

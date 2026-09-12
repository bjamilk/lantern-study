/**
 * What a generated deck's pending-save record carries.
 *
 * The bug this guards: `saveGeneratedDeck` built the pending payload with
 * `deckName, description, deckId, courseId, topicId, cards` and no
 * `studySetId`, while `saveGeneratedTest` right below it spread one. So a deck
 * generated from a note INSIDE a study set was filed nowhere: `writeDeck`
 * forwards `studySetId` faithfully, but the record it reads never held one. The
 * set's Cards grid came back empty after a reload and `GET /decks/<id>` had no
 * `study_set_id`. A retry reads the same record, so it lost the set too.
 *
 * The second guard is on the request itself: a nullable id reaches the API as a
 * UUID or null, never as the empty string a screen passing a route param
 * through produces — the server's `optional({ values: 'null' })` runs `isUUID`
 * on `''` and answers 400 "Validation Error", losing the whole save.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createDeckWithCards = vi.fn(async () => ({
  deck: { id: 'deck-1', name: 'From: Note', study_set_id: 'set-1' },
  flashcards: [{ id: 'card-1' }],
  cardCount: 1,
  atomic: true,
}));

vi.mock('./apiEndpoints', () => ({
  createDeckWithCards: (body: unknown) => createDeckWithCards(body as never),
  createPersonalTest: vi.fn(),
}));
vi.mock('./supabase', () => ({
  fetchAllFlashcards: vi.fn(async () => []),
  mapDeckFromApi: (raw: Record<string, unknown>) => ({ id: raw.id, name: raw.name }),
}));

/** A stand-in job store: the save-once guard and the pending record it keeps. */
const recordPendingSave = vi.fn();
vi.mock('../stores/aiJobStore', () => ({
  useAiJobStore: {
    getState: () => ({
      savedRefFor: () => null,
      recordPendingSave,
      claimSave: vi.fn(),
      succeedJob: vi.fn(),
      failJob: vi.fn(),
      jobs: [],
    }),
  },
}));
vi.mock('../stores/flashcardStore', () => ({
  useFlashcardStore: {
    getState: () => ({ updateDecks: vi.fn(), setFlashcards: vi.fn() }),
  },
}));
vi.mock('../utils/appRoutes', () => ({ buildTestDetailPath: (id: string) => `/tests/${id}` }));

import { saveGeneratedDeck } from './jobArtifacts';

const cards = [{ front: 'What is SDOH?', back: 'Social determinants of health' }];

const SET_ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveGeneratedDeck', () => {
  it('records the study set on the pending save, so a retry still files it', async () => {
    await saveGeneratedDeck({
      jobId: 'job-1',
      cards,
      deckName: 'From: Note',
      studySetId: SET_ID,
    });

    expect(recordPendingSave).toHaveBeenCalledTimes(1);
    const [jobId, payload] = recordPendingSave.mock.calls[0] as [string, Record<string, unknown>];
    expect(jobId).toBe('job-1');
    expect(payload).toMatchObject({ kind: 'deck', studySetId: SET_ID });
  });

  it('sends the study set on to the server', async () => {
    await saveGeneratedDeck({
      jobId: 'job-1',
      cards,
      deckName: 'From: Note',
      studySetId: SET_ID,
    });

    expect(createDeckWithCards).toHaveBeenCalledTimes(1);
    expect(createDeckWithCards.mock.calls[0][0]).toMatchObject({ studySetId: SET_ID });
  });

  it('omits the key entirely when there is no set', async () => {
    await saveGeneratedDeck({ jobId: 'job-2', cards, deckName: 'From: Note' });

    const [, payload] = recordPendingSave.mock.calls[0] as [string, Record<string, unknown>];
    expect('studySetId' in payload).toBe(false);
    expect('studySetId' in (createDeckWithCards.mock.calls[0][0] as object)).toBe(false);
  });

  it('sends null, never the empty string, for a nullable id', async () => {
    await saveGeneratedDeck({
      jobId: 'job-3',
      cards,
      deckName: 'From: Note',
      courseId: '',
      studySetId: '',
      topicId: '',
    });

    // '' is not a UUID and not null: the API's validator rejects the whole save
    // with a bare "Validation Error".
    expect(createDeckWithCards.mock.calls[0][0]).toMatchObject({
      courseId: null,
      studySetId: null,
      topicId: null,
    });
  });

  it('never sends a local draft deck id the server would refuse', async () => {
    await saveGeneratedDeck({
      jobId: 'job-4',
      cards,
      deckName: 'From: Note',
      deckId: 'temp_local_1',
    });

    expect('deckId' in (createDeckWithCards.mock.calls[0][0] as object)).toBe(false);
  });
});

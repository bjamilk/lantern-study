/**
 * Saving what a generation produced — once, whole, or not at all.
 *
 * Web used to materialise a generated deck client-side: `POST /decks`, then one
 * `POST /flashcards` per card, then a best-effort `DELETE /decks/:id` if every
 * card happened to fail. Everything in between was a way to lose work. Ten
 * cards where six saved left a deck announcing ten; a tab closed mid-run left a
 * deck with a handful of cards and no way to finish it; a deck whose delete
 * also failed stayed in the library as an empty "From: …" shell. Mobile fixed
 * this in services/jobArtifacts.ts, and this is the same shape:
 *
 *  1. Nothing is created until the cards exist. The AI call finishes first.
 *  2. The save is ONE request (`POST /decks/with-cards`), keyed on the job id.
 *     The server writes the deck and its cards together or writes neither.
 *  3. Nothing is written locally before the server answers. Offline, the
 *     request fails and the library is untouched — the job says so honestly.
 *  4. The generated material is held on the job record until it lands, so
 *     "Try again" after a failed save re-SAVES it. Generating costs a credit
 *     and a wait; saving costs neither, and a student should not pay for the
 *     first because the second failed.
 *
 * The decisions are pure and live in stores/aiJobStore (`planRetry`,
 * `hasUnsavedGeneration`, `targetForResultRef`); this module is the I/O.
 */
import { createDeckWithCards, createPersonalTest } from './apiEndpoints';
import { fetchAllFlashcards, mapDeckFromApi } from './supabase';
import { useAiJobStore, type AiJobResultRef, type GeneratedCard, type PendingAiSave } from '../stores/aiJobStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { buildTestDetailPath } from '../utils/appRoutes';

export interface SaveGeneratedDeckInput {
  /** The job this save belongs to. Its save-once guard is keyed on this. */
  jobId: string;
  /** Cards, already generated. Never call this before they exist. */
  cards: GeneratedCard[];
  /** Save into a deck the student already has, instead of making one. */
  deckId?: string;
  deckName: string;
  description?: string;
  /** File the deck under a course/topic, as the door that opened it promised. */
  courseId?: string | null;
  topicId?: string | null;
  /** Owner, for the local library refresh after the write lands. */
  userId?: string;
}

export interface SavedArtifact {
  ref: AiJobResultRef;
  /** Artefacts that actually persisted — never what was merely generated. */
  saved: number;
}

export interface SaveGeneratedTestInput {
  jobId: string;
  title: string;
  /** The note this was generated from. */
  sourceNoteId?: string;
  /** The deck this was generated from, when the source was a deck. */
  sourceDeckId?: string;
  questions: unknown[];
  /**
   * How the student asked to sit it — practice or exam, and the clock. Sent
   * verbatim into the test's `config`, because a launch hours later (from a
   * link, a notification, or the list) has nowhere else to read it from.
   */
  config?: Record<string, unknown>;
  courseId?: string | null;
  topicId?: string | null;
}

/** The copy a save failure is reported with when the request never landed. */
const COULD_NOT_SAVE =
  "We couldn't save this to your library. Check your connection and try again.";

/**
 * Say why a save failed in words a student can act on.
 *
 * A request that never reached a verdict throws a transport message, which is a
 * fact about a socket and not about their cards. A request the SERVER answered
 * carries its own reason, and that is kept verbatim: it is the only party that
 * knows what was wrong.
 */
const asSaveError = (error: unknown): Error => {
  if (typeof (error as { status?: unknown })?.status === 'number') {
    return error instanceof Error ? error : new Error(COULD_NOT_SAVE);
  }
  return new Error(COULD_NOT_SAVE);
};

/** An id the server actually issued, as opposed to an optimistic local one. */
export const isPersistedId = (id: string | undefined | null): boolean =>
  typeof id === 'string' && id.length > 0 && !id.startsWith('temp_');

/**
 * Persist a generation's cards, in one request.
 *
 * @throws when the save did not land. Nothing local has been written by then,
 *   and the cards stay on the job record so the failure is recoverable with a
 *   second save rather than a second generation.
 */
export async function saveGeneratedDeck(input: SaveGeneratedDeckInput): Promise<SavedArtifact> {
  const jobs = useAiJobStore.getState();

  // Save-once. A job that already wrote its deck returns that same deck, so an
  // interrupted run that comes back cannot produce a second one.
  const already = jobs.savedRefFor(input.jobId);
  if (already) return { ref: already.ref, saved: already.count };

  if (input.cards.length === 0) throw new Error('Nothing was generated to save.');

  const payload: PendingAiSave = {
    kind: 'deck',
    deckName: input.deckName,
    description: input.description,
    deckId: input.deckId,
    courseId: input.courseId,
    topicId: input.topicId,
    cards: input.cards,
  };
  // Recorded BEFORE the attempt: if the tab dies between here and the response,
  // the next load finds the cards and offers to save them.
  jobs.recordPendingSave(input.jobId, payload);

  const saved = await writeDeck(input.jobId, payload, input.userId);
  jobs.claimSave(input.jobId, saved.ref, saved.saved);
  return saved;
}

/** Persist a generated test, in one request, on the same terms as a deck. */
export async function saveGeneratedTest(input: SaveGeneratedTestInput): Promise<SavedArtifact> {
  const jobs = useAiJobStore.getState();

  const already = jobs.savedRefFor(input.jobId);
  if (already) return { ref: already.ref, saved: already.count };

  if (input.questions.length === 0) throw new Error('Nothing was generated to save.');

  const payload: PendingAiSave = {
    kind: 'test',
    title: input.title,
    sourceNoteId: input.sourceNoteId,
    sourceDeckId: input.sourceDeckId,
    questions: input.questions,
    ...(input.config ? { config: input.config } : {}),
    ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
    ...(input.topicId !== undefined ? { topicId: input.topicId } : {}),
  };
  jobs.recordPendingSave(input.jobId, payload);

  const saved = await writeTest(input.jobId, payload);
  jobs.claimSave(input.jobId, saved.ref, saved.saved);
  return saved;
}

/**
 * Save what a job generated but never filed — without generating again.
 *
 * Wired to the panel's "Try again", which is reached after a failed save and
 * after a reload that found generated material with no saved reference
 * (`planResume`). It costs nothing: the AI call already happened and was
 * already charged.
 *
 * @returns where it landed, or null when this job has nothing to save.
 */
export async function retrySaveJob(jobId: string): Promise<AiJobResultRef | null> {
  const jobs = useAiJobStore.getState();

  const already = jobs.savedRefFor(jobId);
  if (already) {
    jobs.succeedJob(jobId);
    return already.ref;
  }

  const payload = useAiJobStore.getState().jobs.find((j) => j.id === jobId)?.pendingSave;
  if (!payload) return null;

  try {
    const saved =
      payload.kind === 'deck' ? await writeDeck(jobId, payload) : await writeTest(jobId, payload);
    useAiJobStore.getState().claimSave(jobId, saved.ref, saved.saved);
    useAiJobStore.getState().succeedJob(jobId);
    return saved.ref;
  } catch (error) {
    // The material stays on the record: the button is still true next time.
    useAiJobStore
      .getState()
      .failJob(jobId, error instanceof Error ? error.message : COULD_NOT_SAVE);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// The writes themselves
// ─────────────────────────────────────────────────────────────

/** The one request that saves a generated deck, and its local landing. */
async function writeDeck(
  jobId: string,
  payload: Extract<PendingAiSave, { kind: 'deck' }>,
  userId?: string
): Promise<SavedArtifact> {
  const response = await createDeckWithCards({
    // The client job id IS the idempotency key: a retried save replays the
    // first write instead of minting a second deck.
    clientKey: jobId,
    ...(payload.deckId ? { deckId: payload.deckId } : {}),
    name: payload.deckName.slice(0, 80),
    description: payload.description,
    ...(payload.courseId !== undefined ? { courseId: payload.courseId } : {}),
    ...(payload.topicId !== undefined ? { topicId: payload.topicId } : {}),
    cards: payload.cards.map((card) => ({
      type: 'BASIC' as const,
      front: card.front,
      back: card.back,
    })),
  } as Parameters<typeof createDeckWithCards>[0]).catch((error: unknown) => {
    throw asSaveError(error);
  });

  const rawDeck = response?.deck as (Record<string, unknown> & { id?: string }) | undefined;
  // The route answers `{ deck, flashcards, cardCount, atomic }`; `cards` is
  // accepted too so a rename on either side cannot turn every successful save
  // into "we couldn't save the cards" over a deck the server holds.
  const rawCards = Array.isArray(response?.flashcards)
    ? response.flashcards
    : Array.isArray((response as { cards?: unknown })?.cards)
      ? ((response as { cards: unknown[] }).cards)
      : [];
  // Counted from the ids that came back, never from what was asked for: the
  // number the student is shown is of cards that exist.
  const saved = rawCards.filter((card) => isPersistedId((card as { id?: string })?.id)).length;

  const deckId = payload.deckId || (typeof rawDeck?.id === 'string' ? rawDeck.id : '');
  if (!isPersistedId(deckId)) throw new Error(COULD_NOT_SAVE);
  if (saved <= 0) {
    throw new Error("We couldn't save the cards. Check your connection and try again.");
  }

  const name = (rawDeck?.name as string) || payload.deckName;

  // Only a response is written locally, and only after it landed. The deck and
  // its cards exist server-side, so nothing is optimistic and nothing queues.
  const store = useFlashcardStore.getState();
  if (rawDeck && !payload.deckId) {
    const deck = mapDeckFromApi(rawDeck);
    store.updateDecks((prev) => (prev.some((d) => d.id === deck.id) ? prev : [...prev, deck]));
  }
  try {
    store.setFlashcards(await fetchAllFlashcards(undefined, userId));
  } catch {
    // The write landed; a failed refresh is a stale list, not lost work. The
    // next library load reads the server copy.
  }

  return { ref: { type: 'deck', id: deckId, route: `/flashcards/deck/${deckId}`, name }, saved };
}

/** The one request that saves a generated test, and its local landing. */
async function writeTest(
  jobId: string,
  payload: Extract<PendingAiSave, { kind: 'test' }>
): Promise<SavedArtifact> {
  // The server keys the job record by ITS id, not this client's: without it the
  // route has nothing to stamp, the job never learns which test it became, and
  // a reload can only send the student to a list.
  const serverJobId = useAiJobStore.getState().jobs.find((j) => j.id === jobId)?.serverJobId;

  const response = await createPersonalTest({
    title: payload.title,
    sourceNoteId: payload.sourceNoteId ?? null,
    sourceDeckId: payload.sourceDeckId ?? null,
    ...(serverJobId ? { sourceJobId: serverJobId } : {}),
    // The route spreads this into the stored config; without it the builder's
    // Practice/Exam and timer choices died at the network boundary.
    ...(payload.config ? { config: payload.config } : {}),
    ...(payload.courseId !== undefined ? { courseId: payload.courseId } : {}),
    ...(payload.topicId !== undefined ? { topicId: payload.topicId } : {}),
    questions: payload.questions,
  } as Parameters<typeof createPersonalTest>[0]).catch((error: unknown) => {
    throw asSaveError(error);
  });

  // The route answers with the mapped session itself (`{ id, title, questions,
  // … }`), not `{ test }`; both are read so the shape of the envelope cannot
  // make a saved test look unsaved.
  const test = ((response as { test?: unknown } | undefined)?.test ?? response) as
    | (Record<string, unknown> & { id?: string })
    | undefined;
  const id = typeof test?.id === 'string' ? test.id : '';
  if (!isPersistedId(id)) throw new Error(COULD_NOT_SAVE);

  const questions = Array.isArray(test?.questions)
    ? (test.questions as unknown[])
    : payload.questions;

  return {
    ref: {
      type: 'test',
      id,
      // The test itself, not the list. A generated test used to hand back
      // `/tests`, so "Open" and the push notification dropped the student on
      // a list of everything and left them to spot which row was theirs.
      route: buildTestDetailPath(id),
      name: (test?.title as string) || payload.title,
    },
    saved: questions.length,
  };
}

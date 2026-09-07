/**
 * Saving what a generation produced — once, whole, or not at all.
 *
 * Every generate button used to save its own way: create a deck, then add the
 * cards one at a time, and hope. Four generations on a phone that lost the
 * network mid-run left four decks — one with ten cards, one with one, two with
 * none — and a sheet that announced "10 flashcards ready · Saved to From: SDOH"
 * over a deck that contained nothing. Nothing cleaned them up, and the next
 * launch read the deck list back from the server, so the cards were gone for
 * good while the empty shells stayed.
 *
 * Rolling the deck back locally was not enough. The store's create is
 * OPTIMISTIC: offline it hands back a `temp_` deck and queues the write, so a
 * rollback deleted the local row while the queued create stayed and minted the
 * empty deck on the server the moment signal came back. The device run of
 * 2026-09-05 caught exactly that — airplane mode, an honest "we couldn't save
 * this" sheet, and an eleventh deck named "From: SDOH · 0 cards" that survived
 * a cold restart.
 *
 * So generated material does not go through the optimistic path at all, and it
 * never enters the sync queue:
 *
 *  1. Nothing is created until the cards exist. The AI call finishes first.
 *  2. The save is ONE request (`POST /decks/with-cards`), keyed on the job id.
 *     The server writes the deck and its cards together or writes neither;
 *     there is no half-saved state left for anything to clean up.
 *  3. Only a response is written locally, through a non-optimistic insert that
 *     queues nothing. Offline, the request fails fast and the library is
 *     untouched — the job fails honestly and says so.
 *  4. The generated material is held on the job record until it lands, so
 *     "Try again" after a failed save re-SAVES it. Generating costs a credit
 *     and a wait; saving costs neither, and the student should not pay for the
 *     first because the second failed.
 *
 * The decisions themselves are pure and live in stores/jobsCore.ts
 * (`planSave`, `planDeckSave`, `planRetry`, `isPersistedId`); this module is
 * the I/O.
 */
import { mapFlashcardsFromApi } from '@lantern/shared';
import { createDeckWithCards, createPersonalTest } from './api';
import { useFlashcardStore, type Deck } from '../stores/flashcardStore';
import { useJobsStore } from '../stores/jobsStore';
import { useNotesStore } from '../stores/notesStore';
import { useTestStore } from '../stores/testStore';
import {
  findJob,
  isPersistedId,
  planDeckSave,
  type GeneratedCard,
  type JobArtifactRef,
  type PendingSave,
} from '../stores/jobsCore';

export type { GeneratedCard } from '../stores/jobsCore';

export interface SaveGeneratedDeckInput {
  /** The job this save belongs to. Its save-once guard is keyed on this. */
  jobId: string;
  userId: string;
  /** Cards, already generated. Never call this before they exist. */
  cards: GeneratedCard[];
  /** Save into a deck the student already has, instead of making one. */
  deckId?: string;
  /** The deck's name — the new deck's title, or the existing one's, for copy. */
  deckName: string;
  description?: string;
}

export interface SavedDeck {
  ref: JobArtifactRef;
  /** Cards that actually persisted — never what was merely generated. */
  saved: number;
}

export interface SaveGeneratedTestInput {
  /** The job this save belongs to. */
  jobId: string;
  /** The test's title, as the student will see it in their Tests list. */
  title: string;
  /** The note this was generated from. */
  sourceNoteId?: string;
  /** The deck this was generated from, when the source was a deck. */
  sourceDeckId?: string;
  /** Question rows, exactly as the generator produced them. */
  questions: unknown[];
}

export interface SavedTest {
  ref: JobArtifactRef;
  /** Questions the server actually took. */
  saved: number;
}

/**
 * Persist a generation's cards, in one request.
 *
 * @throws when the save did not land. Nothing local has been written by then,
 *   nothing is queued, and the message is the one the student sees on the
 *   sheet. The cards themselves are kept on the job record, so the failure is
 *   recoverable with a second save rather than a second generation.
 */
export async function saveGeneratedDeck(input: SaveGeneratedDeckInput): Promise<SavedDeck> {
  const jobs = useJobsStore.getState();

  // Save-once. A job that already wrote its deck returns that same deck, so an
  // interrupted run that comes back cannot produce a second one.
  const already = jobs.savedRefFor(input.jobId);
  if (already) return { ref: already.ref, saved: already.count };

  if (input.cards.length === 0) {
    throw new Error('Nothing was generated to save.');
  }

  const payload: PendingSave = {
    kind: 'deck',
    deckName: input.deckName,
    description: input.description,
    deckId: input.deckId,
    cards: input.cards,
  };
  // Recorded BEFORE the attempt: if the process dies between here and the
  // response, the next launch finds the cards and offers to save them.
  jobs.recordPendingSave(input.jobId, payload);

  const saved = await writeDeck(input.jobId, payload);
  jobs.recordSave(input.jobId, saved.ref, saved.saved);
  return saved;
}

/**
 * Persist a generated test, in one request.
 *
 * @throws when the save did not land, on the same terms as a deck.
 */
export async function saveGeneratedTest(input: SaveGeneratedTestInput): Promise<SavedTest> {
  const jobs = useJobsStore.getState();

  const already = jobs.savedRefFor(input.jobId);
  if (already) return { ref: already.ref, saved: already.count };

  if (input.questions.length === 0) {
    throw new Error('Nothing was generated to save.');
  }

  const payload: PendingSave = {
    kind: 'test',
    title: input.title,
    sourceNoteId: input.sourceNoteId,
    sourceDeckId: input.sourceDeckId,
    questions: input.questions,
  };
  jobs.recordPendingSave(input.jobId, payload);

  const saved = await writeTest(input.jobId, payload);
  jobs.recordSave(input.jobId, saved.ref, saved.saved);
  return saved;
}

/**
 * Save what a job generated but never filed — without generating again.
 *
 * Wired to the sheet's and the Home card's "Save to library". Reached after a
 * failed save, and after a cold start that found generated material with no
 * saved reference (`planResume`). It costs nothing: the AI call already
 * happened and was already charged.
 *
 * @returns where it landed, or null when this job has nothing to save.
 */
export async function retrySaveJob(jobId: string): Promise<JobArtifactRef | null> {
  const jobs = useJobsStore.getState();

  const already = jobs.savedRefFor(jobId);
  if (already) {
    jobs.settleSaved(jobId, already.ref, already.count);
    return already.ref;
  }

  const payload = jobs.pendingSaveFor(jobId);
  if (!payload) return null;

  try {
    const saved =
      payload.kind === 'deck' ? await writeDeck(jobId, payload) : await writeTest(jobId, payload);
    jobs.settleSaved(jobId, saved.ref, saved.saved);
    return saved.ref;
  } catch (error) {
    // The material stays on the record: the button is still true next time.
    jobs.settleSaveFailed(
      jobId,
      error instanceof Error ? error.message : "We couldn't save this to your library."
    );
    throw error;
  }
}

/**
 * Record where a non-deck generation landed (a note, an imported bundle).
 *
 * Same save-once guard, so the notification, the sheet's Open button and the
 * Home card all point at one artefact — and a job that already has one keeps
 * it rather than being given a second.
 */
export function recordJobArtifact(
  jobId: string,
  ref: JobArtifactRef,
  count: number
): JobArtifactRef {
  const jobs = useJobsStore.getState();
  const already = jobs.savedRefFor(jobId);
  if (already) return already.ref;
  jobs.recordSave(jobId, ref, count);
  return ref;
}

// ─────────────────────────────────────────────────────────────
// The writes themselves
// ─────────────────────────────────────────────────────────────

/** The copy a save failure is reported with when the request never landed. */
const COULD_NOT_SAVE =
  "We couldn't save this to your library. Check your connection and try again.";

/**
 * Say why a save failed in words a student can act on.
 *
 * A request that never reached a verdict — airplane mode, a dead socket —
 * throws "Network request failed", which is a fact about a socket and not
 * about their cards. A request the SERVER answered carries its own reason, and
 * that is kept verbatim: it is the only party that knows what was wrong.
 */
const asSaveError = (error: unknown): Error => {
  if (typeof (error as { status?: unknown })?.status === 'number') {
    return error instanceof Error ? error : new Error(COULD_NOT_SAVE);
  }
  return new Error(COULD_NOT_SAVE);
};

/** The one request that saves a generated deck, and its local landing. */
async function writeDeck(
  jobId: string,
  payload: Extract<PendingSave, { kind: 'deck' }>
): Promise<SavedDeck> {
  // No fallback to the optimistic path, and no queued operation: offline this
  // throws, which is the honest answer. A generation that quietly entered the
  // sync queue is what put empty decks in the library.
  const response = await createDeckWithCards({
    clientKey: jobId,
    deckId: payload.deckId,
    name: payload.deckName.slice(0, 80),
    description: payload.description,
    cards: payload.cards,
  }).catch((error: unknown) => {
    throw asSaveError(error);
  });

  const rawDeck = response?.deck as (Record<string, unknown> & { id?: string }) | undefined;
  // The route answers `{ deck, flashcards, cardCount, atomic }`; `cards` is
  // accepted too so a rename on either side cannot turn every successful
  // save into "we couldn't save the cards" over a deck the server holds.
  const rawCards = Array.isArray(response?.flashcards)
    ? response.flashcards
    : Array.isArray(response?.cards)
      ? response.cards
      : [];
  // Counted from the ids that came back, never from what was asked for: the
  // number the student is shown is of cards that exist.
  const saved = rawCards.filter((card) => isPersistedId((card as { id?: string })?.id)).length;

  const plan = planDeckSave({
    requested: payload.cards.length,
    saved,
    // An existing deck is the student's own and is not judged by this run.
    deckId: payload.deckId ?? (typeof rawDeck?.id === 'string' ? rawDeck.id : ''),
  });
  if (plan.action === 'rollback') throw new Error(plan.reason);

  const deckId = payload.deckId ?? (rawDeck?.id as string);
  const deck: Deck = {
    id: deckId,
    name: (rawDeck?.name as string) || payload.deckName,
    description: (rawDeck?.description as string) ?? payload.description,
    user_id: (rawDeck?.user_id as string) ?? (rawDeck?.userId as string),
    course_id: (rawDeck?.course_id as string) ?? (rawDeck?.courseId as string) ?? null,
    topic_id: (rawDeck?.topic_id as string) ?? (rawDeck?.topicId as string) ?? null,
    created_at: (rawDeck?.created_at as string) ?? new Date().toISOString(),
    updated_at: (rawDeck?.updated_at as string) ?? new Date().toISOString(),
  };

  // Non-optimistic: these rows exist server-side, so nothing is queued.
  await useFlashcardStore.getState().insertSavedDeck(deck, mapFlashcardsFromApi(rawCards));

  return {
    ref: { type: 'deck', id: deck.id, name: deck.name },
    saved: plan.resultCount,
  };
}

/**
 * The note this test was generated from, by name.
 *
 * The list prints "From <note>" under a note quiz and the mode sheet names it
 * in place of the bare "Saved test". The title is resolved from the note the
 * save is already linked to, so it is on the row the moment the test lands
 * rather than after the next fetch — and it is sent WITH the save, as the
 * server's fallback for a note whose title it cannot read back itself.
 *
 * Empty string is not a title: a note that has never been named contributes
 * nothing, and "From " with nothing after it is worse than no chip at all.
 */
function noteTitleFor(sourceNoteId: string | undefined): string | undefined {
  if (!sourceNoteId) return undefined;
  const title = useNotesStore
    .getState()
    .notes.find(note => note.id === sourceNoteId)?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

/** The one request that saves a generated test, and its local landing. */
async function writeTest(
  jobId: string,
  payload: Extract<PendingSave, { kind: 'test' }>
): Promise<SavedTest> {
  // The server keys the job record by ITS id, not this client's: without it
  // the route has nothing to stamp, the job never learns which test it became,
  // and its notification and any later catch-up fall back to `jobs/<id>`.
  const serverJobId = findJob(useJobsStore.getState().jobs, jobId)?.serverJobId;
  const sourceNoteTitle = noteTitleFor(payload.sourceNoteId);
  const response = await createPersonalTest({
    clientKey: jobId,
    title: payload.title,
    sourceNoteId: payload.sourceNoteId,
    sourceDeckId: payload.sourceDeckId,
    ...(serverJobId ? { sourceJobId: serverJobId } : {}),
    // The server resolves the note's own title and that always wins; this is
    // the fallback it falls back TO, and without it a test whose note title
    // could not be read back landed with no provenance at all — the row said
    // nothing and the mode sheet said "Saved test".
    ...(sourceNoteTitle ? { config: { sourceNoteTitle } } : {}),
    questions: payload.questions,
  }).catch((error: unknown) => {
    throw asSaveError(error);
  });

  // The route answers with the mapped session itself (`{ id, title, questions,
  // status, … }`), not `{ test }`; both are read so the shape of the envelope
  // cannot make a saved test look unsaved.
  const test = ((response as { test?: unknown } | undefined)?.test ?? response) as
    | (Record<string, unknown> & { id?: string })
    | undefined;
  const id = typeof test?.id === 'string' ? test.id : '';
  if (!isPersistedId(id)) {
    throw new Error(COULD_NOT_SAVE);
  }

  const questions = Array.isArray(test?.questions)
    ? (test.questions as unknown[])
    : payload.questions;

  const inserted = await useTestStore.getState().insertPersonalTest({
    id,
    name: (test?.title as string) || (test?.name as string) || payload.title,
    questions,
    createdAt: (test?.created_at as string) ?? (test?.createdAt as string),
    // Provenance from the save payload so the results chip links to the note
    // immediately, not only after the next fetchTests (build 163 residual).
    sourceNoteId:
      (test?.sourceNoteId as string | undefined) ??
      ((payload as { sourceNoteId?: string }).sourceNoteId ?? undefined),
    // Server first (it reads the note's own row), then the title this device
    // already holds — so the "From <note>" chip is on the freshly saved row
    // immediately, not only after the next fetchTests.
    sourceNoteTitle: (test?.sourceNoteTitle as string | undefined) ?? sourceNoteTitle,
  });

  return {
    ref: { type: 'test', id, name: inserted.name },
    saved: inserted.questionCount,
  };
}

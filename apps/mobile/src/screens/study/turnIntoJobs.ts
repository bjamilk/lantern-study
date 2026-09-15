/**
 * The two Turn-into destinations that RUN a job — flashcards and a practice
 * test — as one function each.
 *
 * They used to live inline in `CourseRoomScreen`, which was fine while a note
 * in a room was the only thing a student could turn into anything. The chat
 * panel can now do it to a single answer, from a modal that is not inside any
 * room, and a second copy of "generate, then save with the right scope" is how
 * two surfaces end up charging differently or filing into different places.
 *
 * Main exports: `startFlashcardsFromNote`, `startTestFromNote`, the
 * `TurnIntoJobScope` shape, and the `turnIntoSourceContent`/`turnIntoSourceTitle`
 * helpers plus `TURN_INTO_CONTENT_LIMIT`.
 * Touches: jobsStore (through the injected `startJob`), studyGoalsStore read at
 * run time, services/ai `aiGenerateFlashcards`, services/notes `generateNoteQuiz`,
 * and services/jobArtifacts for the save. No React and no native modules.
 *
 * Gotchas: both functions return immediately with a job id — the work happens in
 * the `run` callback the jobs store drives, so callers must not treat the return
 * as a finished artefact. `userId` is required because the deck save has nowhere
 * to land without it.
 */
import { normalizeFlashcardCount } from '@lantern/shared/utils';
// The mobile notes service's own `StudyNote`, not the shared one: the room
// hands over exactly what its store holds, and a structurally different twin
// would only force a cast at every call site.
import type { StudyNote } from '../../services/notes';
import type { StartJobSpec } from '../../stores/jobsStore';
import { saveGeneratedDeck, saveGeneratedTest } from '../../services/jobArtifacts';
import { aiGenerateFlashcards } from '../../services/ai';
import { generateNoteQuiz } from '../../services/notes';
import { useStudyGoalsStore } from '../../stores/studyGoalsStore';

/** How much of a note the generator reads. Matches the room's own limit. */
export const TURN_INTO_CONTENT_LIMIT = 8000;

export interface TurnIntoJobScope {
  /** Owner of the artefact. Without it the save has nowhere to land. */
  userId: string;
  courseId?: string;
  studySetId?: string;
}

export type StartJobFn = (spec: StartJobSpec) => string;

/** The text a generator sees — body first, summary as the fallback. */
export function turnIntoSourceContent(note: Pick<StudyNote, 'body' | 'summary'>): string {
  return (note.body || note.summary || '').slice(0, TURN_INTO_CONTENT_LIMIT);
}

export function turnIntoSourceTitle(note: Pick<StudyNote, 'title'>): string {
  return note.title || 'Untitled Note';
}

export function startFlashcardsFromNote(
  note: StudyNote,
  scope: TurnIntoJobScope,
  startJob: StartJobFn
): string {
  const noteTitle = turnIntoSourceTitle(note);
  const content = turnIntoSourceContent(note);
  const count = normalizeFlashcardCount();
  return startJob({
    kind: 'flashcards',
    sourceTitle: noteTitle,
    requestedCount: count,
    run: async ({ jobId, onServerJob, onStage }) => {
      const { flashcards } = await aiGenerateFlashcards(content, {
        count,
        style: 'concise',
        onJobUpdate: (p) => {
          if (p.jobId) onServerJob(p.jobId);
        },
      });
      if (!flashcards.length) {
        throw new Error('Could not generate flashcards from this note.');
      }
      onStage('Saving to your deck');
      const { ref, saved } = await saveGeneratedDeck({
        jobId,
        userId: scope.userId,
        cards: flashcards,
        deckName: `From: ${noteTitle}`,
        description: `Generated from note: ${noteTitle}`,
        courseId: scope.courseId || undefined,
        studySetId: scope.studySetId,
      });
      return { artifact: ref, resultCount: saved };
    },
  });
}

export function startTestFromNote(
  note: StudyNote,
  scope: TurnIntoJobScope,
  startJob: StartJobFn
): string {
  const noteTitle = turnIntoSourceTitle(note);
  return startJob({
    kind: 'test',
    sourceTitle: noteTitle,
    requestedCount: 10,
    requestedCountIsMax: true,
    run: async ({ jobId, onServerJob, onStage }) => {
      const { studyGoal } = useStudyGoalsStore.getState();
      const session = await generateNoteQuiz(note.id, studyGoal, 10, onServerJob);
      if (!session.questions.length) {
        throw new Error('Could not generate a test from this note.');
      }
      onStage('Saving your test');
      const { ref, saved } = await saveGeneratedTest({
        jobId,
        title: `Test · ${noteTitle}`,
        sourceNoteId: note.id,
        questions: session.questions,
        courseId: scope.courseId || undefined,
        studySetId: scope.studySetId,
      });
      return { artifact: ref, resultCount: saved };
    },
  });
}

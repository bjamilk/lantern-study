import { isUserAnswerAttempted, tallyTestAttempt } from '@lantern/shared';
import type {
  TestAttemptTally,
  TestQuestion,
  TestSessionData,
  TestSessionProvenance,
  UserAnswerRecord,
} from '../types';

/**
 * Reading one finished attempt: how it went, and where its questions came from.
 *
 * Pure on purpose — the review screen used to compute all of this inline, which
 * is how "unanswered" ended up folded into "wrong". A question a student never
 * reached is not a question they got wrong, and a screen that says otherwise is
 * accusing them of something they did not do. The split lives here, with tests
 * on it, and the screens read the result.
 */

/**
 * Did the student actually put something down?
 *
 * `isCorrect` alone cannot answer this: an unanswered question and a wrong
 * answer both arrive as `isCorrect: false` once the server has graded them.
 * The presence of a selection/text/pairing is the only honest signal.
 *
 * Delegates to the shared predicate so web, mobile and the server cannot
 * disagree about what "answered" means — the disagreement is exactly how
 * unanswered questions ended up counted as wrong.
 */
export function isAnswerRecorded(record: UserAnswerRecord | undefined | null): boolean {
  return isUserAnswerAttempted(record ?? undefined);
}

/**
 * Split an attempt three ways — correct, incorrect, unanswered — plus the same
 * split again by what the student said before the reveal.
 *
 * The counting itself is `@lantern/shared`'s `tallyTestAttempt`, which the
 * server and mobile also use; this wrapper exists so a web screen can hand it a
 * session and get a tally back. `unspecified` is every answer from a timed exam
 * attempt (which never asks) and every answer recorded before confidence
 * existed — it is not a third confidence level.
 */
export function tallyAttempt(session: {
  questions: TestQuestion[];
  userAnswers: Record<string, UserAnswerRecord>;
}): TestAttemptTally {
  return tallyTestAttempt(session.questions ?? [], session.userAnswers ?? {});
}

/**
 * The one line a results screen owes the student about what they did NOT do.
 * `null` when every question was attempted — silence is the honest state then,
 * not a "0 unanswered" badge.
 */
export function unansweredNote(tally: TestAttemptTally): string | null {
  if (tally.unanswered <= 0) return null;
  const noun = tally.unanswered === 1 ? 'question' : 'questions';
  return `${tally.unanswered} ${noun} left unanswered — not counted as wrong.`;
}

/**
 * Calibration, in a sentence. Answering "sure" and getting it wrong is the one
 * pattern worth naming: it is the gap a student cannot see from a score alone.
 */
export function calibrationNote(tally: TestAttemptTally): string | null {
  const sure = tally.byConfidence.sure;
  const unsure = tally.byConfidence.unsure;
  if (sure.answered === 0 && unsure.answered === 0) return null;
  if (sure.incorrect > 0) {
    const noun = sure.incorrect === 1 ? 'answer' : 'answers';
    return `You were sure about ${sure.incorrect} ${noun} that turned out wrong — start there.`;
  }
  if (unsure.correct > 0) {
    const noun = unsure.correct === 1 ? 'answer' : 'answers';
    return `${unsure.correct} ${noun} you were unsure of were right. You know more than you think.`;
  }
  return null;
}

/**
 * Where the attempt's questions came from, read off the session.
 *
 * The server resolves this into `TestSessionProvenance` for rows it returns;
 * this is the client-side fallback for a session held in memory (a retake, an
 * offline bundle) that has never been round-tripped. Every field is a string
 * or null so a caller can render "From <title>" with no undefined check.
 */
export function readProvenance(
  session: Pick<TestSessionData, 'config'> & {
    provenance?: TestSessionProvenance | null;
  }
): TestSessionProvenance {
  if (session.provenance) return session.provenance;
  const config = session.config ?? ({} as TestSessionData['config']);
  const noteId = config.sourceNoteId ?? null;
  const deckId = config.sourceDeckId ?? null;
  const groupId = config.groupId || null;
  const title =
    config.sourceNoteTitle ??
    config.sourceDeckTitle ??
    config.groupName ??
    null;
  return { noteId, deckId, groupId, title };
}

/** Short label for the source chip on a reviewed question. */
export function provenanceChipLabel(provenance: TestSessionProvenance): string | null {
  if (!provenance.title) return null;
  if (provenance.noteId) return `Note · ${provenance.title}`;
  if (provenance.deckId) return `Deck · ${provenance.title}`;
  if (provenance.groupId) return `Group · ${provenance.title}`;
  return provenance.title;
}

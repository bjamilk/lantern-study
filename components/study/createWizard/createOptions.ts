/**
 * The one place the create wizard turns its answers into the payload.
 *
 * Lifted verbatim out of `CreateFromSource`'s `options()` closure when the
 * wizard was split into one question per step. It is a pure function of a
 * draft so that `components/study/CreateFromSource.payload.test.ts` — written
 * against the untouched component, frozen — can walk it row by row and prove
 * the split changed the screens and nothing else.
 *
 * Touches: `onPickNote`, `onPickTopic` and `onPickDecks` in
 * `CourseWorkspace`, which is the generator call and the credit charge.
 *
 * Gotcha: `quizTypes` travels for every kind, not only the quiz door — the
 * card count rides in `multiple_choice`, and `questionCount` is the sum. Do
 * not "tidy" a field away because one door ignores it.
 */
import {
  QUIZ_FROM_CARDS_COUNT,
  quizTypeCountTotal,
  type CreateFromSourceKind,
  type CreateFromSourceOptions,
  type LessonMode,
  type QuizTypeCounts,
  type RecapLength,
  type RecapStyle,
} from '@lantern/shared';

/** Every answer the wizard holds that can reach the payload. */
export interface WizardDraft {
  counts: QuizTypeCounts;
  title: string;
  focus: string;
  lessonMode: LessonMode;
  recapStyle: RecapStyle;
  recapLength: RecapLength;
  rubricText: string;
}

export function buildCreateOptions(
  kind: CreateFromSourceKind,
  draft: WizardDraft
): CreateFromSourceOptions {
  const quizWizard = kind === 'quiz';
  return {
    questionCount:
      quizTypeCountTotal(draft.counts) || (quizWizard ? QUIZ_FROM_CARDS_COUNT : undefined),
    title: draft.title.trim() || undefined,
    focus: draft.focus.trim() || undefined,
    quizTypes: draft.counts,
    lessonMode: kind === 'lesson' ? draft.lessonMode : undefined,
    recapStyle: kind === 'recap' ? draft.recapStyle : undefined,
    recapLength: kind === 'recap' ? draft.recapLength : undefined,
    rubricText: kind === 'essay' ? draft.rubricText.trim() || undefined : undefined,
  };
}

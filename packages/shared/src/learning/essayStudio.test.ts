import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ESSAY_CRITERIA,
  ESSAY_DISCLAIMER,
  ESSAY_DRAFT_MIN,
  appendEssayAttempt,
  composeEssayNoteBody,
  currentEssayAttempt,
  essayAttemptLabel,
  selectEssayAttempt,
  essayDraftTooThin,
  essayFromMaterial,
  essaySourceNotes,
  essayStudioPriceLine,
  isEssayGraderMissing,
  isEssayNote,
  newEssayNoteTitle,
  normalizeGeneratedEssayReview,
  parseEssayNoteBody,
  parseRubricText,
  resolveEssayStudioNote,
  startEssaySession,
} from './essayStudio';

const DRAFT =
  'Pulmonary embolism is a blockage in a pulmonary artery, usually from a clot that travelled from the legs. Sudden dyspnea and hypoxia are the cues. Treatment starts with anticoagulation unless the clot is massive.';

describe('essay studio', () => {
  it('parses a rubric, grades with or without one, and never dumps the draft', () => {
    expect(parseRubricText('- Definition\n- Treatment\n- Signs')).toHaveLength(3);
    const withRubric = essayFromMaterial({
      draft: DRAFT,
      rubricText: '- Pulmonary embolism\n- Anticoagulation\n- Dyspnea',
    });
    expect(withRubric.provider).toBe('local');
    expect(withRubric.overall).toBeGreaterThan(0);
    expect(withRubric.overall).toBeLessThanOrEqual(100);
    expect(withRubric.feedback).toContain(ESSAY_DISCLAIMER);
    expect(withRubric.feedback.includes(DRAFT.slice(0, 80))).toBe(false);
    expect(withRubric.scores).toHaveLength(3);

    const noRubric = essayFromMaterial({ draft: DRAFT });
    expect(noRubric.scores.map((row) => row.criterionId)).toEqual(
      DEFAULT_ESSAY_CRITERIA.map((row) => row.id)
    );
    expect(noRubric.feedback).toContain(ESSAY_DISCLAIMER);
    expect(noRubric.feedback.includes(DRAFT)).toBe(false);
  });

  it('normalises a model payload onto the rubric and refuses a dumped essay', () => {
    const rubricText = '- Definition\n- Treatment';
    const dumped = normalizeGeneratedEssayReview(
      { overall: 91, feedback: DRAFT, scores: [{ score: 5 }, { score: 4 }] },
      { draft: DRAFT, rubricText }
    );
    expect(dumped.feedback).toContain(ESSAY_DISCLAIMER);
    expect(dumped.feedback.includes(DRAFT.slice(0, 80))).toBe(false);
    expect(dumped.scores).toHaveLength(2);
    expect(dumped.overall).toBe(91);

    const stamped = normalizeGeneratedEssayReview(
      { overall: 40, feedback: 'Needs a clearer treatment paragraph.', scores: [{ score: 2 }, { score: 1 }] },
      { draft: DRAFT, rubricText }
    );
    expect(stamped.feedback.startsWith(ESSAY_DISCLAIMER)).toBe(true);
    expect(stamped.scores[0]?.score).toBe(2);
  });

  it('keeps attempt history on one note and resumes the latest', () => {
    const started = startEssaySession({
      sourceTitle: 'Pulmonary Embolism',
      draft: DRAFT,
      rubricText: '- Definition',
    });
    const review = essayFromMaterial({ draft: DRAFT, rubricText: started.rubricText });
    const next = appendEssayAttempt(started, review, '2026-09-11T12:00:00.000Z');
    expect(next.attempts).toHaveLength(1);
    expect(currentEssayAttempt(next)?.overall).toBe(review.overall);
    const body = composeEssayNoteBody(next);
    expect(isEssayNote({ title: newEssayNoteTitle('Pulmonary Embolism'), body })).toBe(true);
    const parsed = parseEssayNoteBody(body);
    expect(parsed?.attempts).toHaveLength(1);
    expect(parsed?.draft).toBe(DRAFT);
    expect(parsed?.currentIndex).toBe(0);
    const second = appendEssayAttempt(
      { ...next, draft: `${DRAFT} Anticoagulation starts immediately.` },
      { ...review, overall: 64 },
      '2026-09-11T13:00:00.000Z'
    );
    expect(second.currentIndex).toBe(1);
    const first = selectEssayAttempt(second, 0);
    expect(first.currentIndex).toBe(0);
    expect(first.draft).toBe(next.attempts[0]?.body);
    expect(currentEssayAttempt(first)?.overall).toBe(review.overall);
    expect(essayAttemptLabel(second.attempts[1]!, 1)).toBe('Attempt 2 · 64');
    const stored = parseEssayNoteBody(composeEssayNoteBody(first));
    expect(stored?.currentIndex).toBe(0);
    expect(resolveEssayStudioNote({ essays: [{ id: 'e1' }], selectedNoteId: 'e1' })).toEqual({
      action: 'resume',
      noteId: 'e1',
    });
  });

  it('falls back only on a missing generator, never on 503', () => {
    expect(isEssayGraderMissing({ status: 404, message: 'Error' })).toBe(true);
    expect(
      isEssayGraderMissing({
        message: 'Error',
        body: { error: 'Error', message: 'Not found - /api/v1/ai/grade-essay' },
      })
    ).toBe(true);
    expect(isEssayGraderMissing({ status: 503, message: 'Failed to grade the essay.' })).toBe(false);
    expect(essayDraftTooThin('too short')).toBe(true);
    expect(essayDraftTooThin(DRAFT)).toBe(false);
    expect(DRAFT.length).toBeGreaterThan(ESSAY_DRAFT_MIN);
    expect(essayStudioPriceLine()).toMatch(/Grading costs/);
  });

  it('skips essay, recap, lesson and plan notes as draft sources', () => {
    const body = 'Pharmacokinetics is how the body handles a drug over time.'.repeat(2);
    const notes = [
      { id: 'l', title: 'Lecture — 11 Sep', body, sourceType: 'audio' as const },
      { id: 'n', title: 'Pulmonary Embolism', body },
      { id: 'e', title: 'Essay — Draft', body: '```lantern-essay\n{}\n```' },
      { id: 'r', title: 'Recap — Podcast · PE', body: '```lantern-recap\n{}\n```' },
      { id: 's', title: 'Lesson — Explore · PE', body: '```lantern-lesson\n{}\n```' },
      { id: 'p', title: 'Plan — PHARM 212', body: '```lantern-calendar\n{}\n```' },
    ];
    expect(essaySourceNotes(notes).map((note) => note.id)).toEqual(['n', 'l']);
  });
});

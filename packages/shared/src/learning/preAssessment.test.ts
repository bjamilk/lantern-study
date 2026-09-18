import {
  PRE_ASSESSMENT_COVERED_RATIO,
  PRE_ASSESSMENT_MASTERED_RATIO,
  PRE_ASSESSMENT_QUESTION_TARGET,
  preAssessmentCardAction,
  preAssessmentCardLabel,
  preAssessmentStatusUpdates,
  preAssessmentTopicStatus,
  tallyPreAssessment,
} from './preAssessment';
import type { StudySetTopic } from './studySetPlan';

function topic(id: string, status: StudySetTopic['status']): StudySetTopic {
  return {
    id,
    studySetId: 'set-1',
    unitId: 'unit-1',
    title: id,
    position: 10,
    status,
    sourceNoteIds: [],
  };
}

describe('preAssessmentTopicStatus', () => {
  it('asks for ten questions and the two thresholds are the documented ones', () => {
    expect(PRE_ASSESSMENT_QUESTION_TARGET).toBe(10);
    expect(PRE_ASSESSMENT_MASTERED_RATIO).toBe(0.8);
    expect(PRE_ASSESSMENT_COVERED_RATIO).toBe(0.5);
  });

  it('is inclusive at the mastered boundary', () => {
    expect(preAssessmentTopicStatus({ topicId: 't', answered: 5, correct: 4 })).toBe('mastered');
    expect(preAssessmentTopicStatus({ topicId: 't', answered: 10, correct: 8 })).toBe('mastered');
  });

  it('is inclusive at the covered boundary', () => {
    expect(preAssessmentTopicStatus({ topicId: 't', answered: 2, correct: 1 })).toBe('covered');
    expect(preAssessmentTopicStatus({ topicId: 't', answered: 10, correct: 5 })).toBe('covered');
  });

  it('just under a boundary takes the lower verdict', () => {
    expect(preAssessmentTopicStatus({ topicId: 't', answered: 10, correct: 7 })).toBe('covered');
    expect(preAssessmentTopicStatus({ topicId: 't', answered: 10, correct: 4 })).toBeNull();
  });

  it('says nothing about a topic the diagnostic never asked about', () => {
    expect(preAssessmentTopicStatus({ topicId: 't', answered: 0, correct: 0 })).toBeNull();
  });

  it('a clean sweep of one question is mastered, a miss is silence', () => {
    expect(preAssessmentTopicStatus({ topicId: 't', answered: 1, correct: 1 })).toBe('mastered');
    expect(preAssessmentTopicStatus({ topicId: 't', answered: 1, correct: 0 })).toBeNull();
  });
});

describe('preAssessmentStatusUpdates', () => {
  it('moves an unseen topic forward', () => {
    expect(
      preAssessmentStatusUpdates(
        [{ topicId: 'a', answered: 4, correct: 4 }],
        [topic('a', 'unseen')]
      )
    ).toEqual([{ topicId: 'a', status: 'mastered' }]);
  });

  it('never moves a topic backwards', () => {
    expect(
      preAssessmentStatusUpdates(
        [{ topicId: 'a', answered: 10, correct: 6 }],
        [topic('a', 'mastered')]
      )
    ).toEqual([]);
  });

  it('returns nothing when the earned status equals the stored one', () => {
    expect(
      preAssessmentStatusUpdates(
        [{ topicId: 'a', answered: 10, correct: 6 }],
        [topic('a', 'covered')]
      )
    ).toEqual([]);
  });

  it('promotes covered to mastered', () => {
    expect(
      preAssessmentStatusUpdates(
        [{ topicId: 'a', answered: 5, correct: 5 }],
        [topic('a', 'covered')]
      )
    ).toEqual([{ topicId: 'a', status: 'mastered' }]);
  });

  it('drops a score for a topic that is not in this plan', () => {
    expect(
      preAssessmentStatusUpdates(
        [{ topicId: 'ghost', answered: 5, correct: 5 }],
        [topic('a', 'unseen')]
      )
    ).toEqual([]);
  });

  it('takes the first tally for a repeated topic id rather than double-writing', () => {
    expect(
      preAssessmentStatusUpdates(
        [
          { topicId: 'a', answered: 2, correct: 2 },
          { topicId: 'a', answered: 2, correct: 0 },
        ],
        [topic('a', 'unseen')]
      )
    ).toEqual([{ topicId: 'a', status: 'mastered' }]);
  });

  it('leaves a topic alone when the result says nothing', () => {
    expect(
      preAssessmentStatusUpdates(
        [{ topicId: 'a', answered: 10, correct: 1 }],
        [topic('a', 'unseen')]
      )
    ).toEqual([]);
  });
});

describe('tallyPreAssessment', () => {
  it('groups graded answers by their topic', () => {
    expect(
      tallyPreAssessment([
        { topicId: 'a', correct: true },
        { topicId: 'a', correct: false },
        { topicId: 'b', correct: true },
      ])
    ).toEqual([
      { topicId: 'a', answered: 2, correct: 1 },
      { topicId: 'b', answered: 1, correct: 1 },
    ]);
  });

  it('counts an unattributed answer nowhere', () => {
    expect(
      tallyPreAssessment([
        { topicId: null, correct: true },
        { topicId: '  ', correct: true },
        { correct: true },
      ])
    ).toEqual([]);
  });

  it('treats a missing correctness flag as wrong, not as unanswered', () => {
    expect(tallyPreAssessment([{ topicId: 'a', correct: null }])).toEqual([
      { topicId: 'a', answered: 1, correct: 0 },
    ]);
  });
});

describe('preAssessmentCardAction', () => {
  it('offers a start when nothing has been taken', () => {
    expect(preAssessmentCardAction(null)).toBe('start');
    expect(preAssessmentCardAction(undefined)).toBe('start');
    expect(preAssessmentCardAction({ id: '' })).toBe('start');
  });

  it('resumes an unfinished one rather than generating a second', () => {
    expect(preAssessmentCardAction({ id: 't1', completedAt: null })).toBe('resume');
  });

  it('offers a retake once it is finished', () => {
    expect(preAssessmentCardAction({ id: 't1', completedAt: '2026-09-17T00:00:00Z' })).toBe('retake');
  });

  it('labels each action', () => {
    expect(preAssessmentCardLabel('start')).toBe('Continue');
    expect(preAssessmentCardLabel('resume')).toBe('Resume');
    expect(preAssessmentCardLabel('retake')).toBe('Retake');
  });
});

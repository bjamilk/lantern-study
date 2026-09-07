/**
 * What a client may write into `config` when it COMPLETES a session.
 *
 * The whitelist used to be `{ groupId, groupName }`, which meant the two facts
 * a practice sitting needs — that it WAS practice, and what it scored — had
 * nowhere to land: a study session writes no `test_results` row, so History
 * read 0/0 and stamped a red "NOT PASSED · 0%" on a sitting the student had
 * just answered correctly.
 */
import { completionConfigPatch } from './tests';

jest.mock('../middleware/authorizeResource', () => ({
  requireTestOwner: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../middleware/idempotency', () => ({
  idempotencyMiddleware: () => (req: any, _res: any, next: any) => {
    req.runIdempotent = (handler: () => Promise<unknown>) => handler();
    next();
  },
}));

describe('completionConfigPatch', () => {
  it('keeps the study-group attribution it always kept', () => {
    expect(completionConfigPatch({ groupId: 'g1', groupName: 'Pharm' })).toEqual({
      groupId: 'g1',
      groupName: 'Pharm',
    });
    // null is a real answer — "this belongs to no group" — not a missing one.
    expect(completionConfigPatch({ groupId: null, groupName: null })).toEqual({
      groupId: null,
      groupName: null,
    });
  });

  it('records how the sitting was taken, and its pass mark', () => {
    expect(completionConfigPatch({ mode: 'study' })).toEqual({ mode: 'study' });
    expect(completionConfigPatch({ mode: 'test', passingScore: 70 })).toEqual({
      mode: 'test',
      passingScore: 70,
    });
  });

  it('records a practice tally, which no test_results row will ever hold', () => {
    expect(
      completionConfigPatch({
        mode: 'study',
        practiceScore: 75,
        practiceCorrectCount: 3,
        practiceTotalQuestions: 4,
      }),
    ).toEqual({
      mode: 'study',
      practiceScore: 75,
      practiceCorrectCount: 3,
      practiceTotalQuestions: 4,
    });
  });

  it('keeps a genuine zero', () => {
    // A practice sitting that scored nothing must still be able to say so;
    // dropping 0 as falsy would leave the old row's number standing.
    expect(completionConfigPatch({ practiceScore: 0, practiceCorrectCount: 0 })).toEqual({
      practiceScore: 0,
      practiceCorrectCount: 0,
    });
  });

  it('drops everything else, silently, as it always did', () => {
    expect(
      completionConfigPatch({
        questions: [{ id: 'q1' }],
        name: 'Renamed by a client',
        timerDurationMinutes: 999,
        sourceNoteId: 'note-1',
      }),
    ).toEqual({});
  });

  it('refuses nonsense in the keys it does accept', () => {
    expect(
      completionConfigPatch({
        mode: 'cram',
        groupId: 42,
        passingScore: 'seventy',
        practiceScore: Number.NaN,
        practiceCorrectCount: -1,
        practiceTotalQuestions: '4',
      }),
    ).toEqual({});
  });
});

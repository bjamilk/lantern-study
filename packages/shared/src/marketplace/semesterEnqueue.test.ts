import { enqueueSemesterDraftsSequentially, maxSelectablePacks } from './semesterEnqueue';

describe('maxSelectablePacks', () => {
  it('caps at remaining / 5', () => {
    expect(maxSelectablePacks(20)).toBe(4);
    expect(maxSelectablePacks(7)).toBe(1);
    expect(maxSelectablePacks(4)).toBe(0);
  });
});

describe('enqueueSemesterDraftsSequentially', () => {
  it('creates one after another and stops on the first failure', async () => {
    const calls: string[] = [];
    const createDraft = jest.fn(async ({ courseId }: { courseId: string }) => {
      calls.push(courseId);
      if (courseId === 'b') throw new Error('out of credits');
      return { draftId: courseId };
    });
    const result = await enqueueSemesterDraftsSequentially(
      [
        { courseId: 'a', suggestedTitle: 'A' },
        { courseId: 'b', suggestedTitle: 'B' },
        { courseId: 'c', suggestedTitle: 'C' },
      ],
      createDraft,
    );
    expect(calls).toEqual(['a', 'b']);
    expect(result).toEqual({ ok: 1, failed: 1, stopped: true, errors: ['out of credits'] });
    expect(createDraft).toHaveBeenCalledTimes(2);
  });
});

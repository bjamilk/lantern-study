import {
  pickRecommendedTopic,
  studySetPlanProgress,
  studySetProgressPercent,
  topicsFromReadingNotes,
} from './studySetPlan';

describe('study set plan', () => {
  it('builds topics from reading notes', () => {
    const { unit, topics } = topicsFromReadingNotes('set-a', [
      { id: 'n1', title: 'History of AI' },
      { id: 'n2', title: '  ' },
    ]);
    expect(unit.title).toBe('Your materials');
    expect(topics.map((t) => t.title)).toEqual(['History of AI', 'Topic 2']);
  });

  it('picks the next unseen topic in standard mode', () => {
    const topics = [
      { id: '1', studySetId: 's', unitId: 'u', title: 'A', position: 10, status: 'covered' as const, sourceNoteIds: [] },
      { id: '2', studySetId: 's', unitId: 'u', title: 'B', position: 20, status: 'unseen' as const, sourceNoteIds: [] },
    ];
    expect(pickRecommendedTopic(topics, 'standard')?.id).toBe('2');
    expect(pickRecommendedTopic(topics, 'comprehensive')?.id).toBe('1');
  });

  it('counts covered and mastered', () => {
    const progress = studySetPlanProgress([
      { id: '1', studySetId: 's', unitId: 'u', title: 'A', position: 10, status: 'unseen', sourceNoteIds: [] },
      { id: '2', studySetId: 's', unitId: 'u', title: 'B', position: 20, status: 'covered', sourceNoteIds: [] },
      { id: '3', studySetId: 's', unitId: 'u', title: 'C', position: 30, status: 'mastered', sourceNoteIds: [] },
    ]);
    expect(progress).toEqual({ topics: 3, covered: 2, mastered: 1 });
    expect(studySetProgressPercent(progress)).toBe(50);
  });
});

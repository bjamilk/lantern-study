import {
  pickRecommendedTopic,
  studySetPlanProgress,
  studySetProgressPercent,
  topicsFromReadingNotes,
  topicsInUnit,
  topicUnitLabel,
  unitsForTopics,
  unitsFromSourceMaterials,
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

  it('derives units from topics when none are stored', () => {
    const topics = [
      { id: '1', studySetId: 's', unitId: 'u1', title: 'A', position: 10, status: 'unseen' as const, sourceNoteIds: [] },
      { id: '2', studySetId: 's', unitId: 'u1', title: 'B', position: 20, status: 'unseen' as const, sourceNoteIds: [] },
    ];
    expect(unitsForTopics([], topics).map((unit) => unit.id)).toEqual(['u1']);
    expect(topicsInUnit(topics, 'u1').map((topic) => topic.id)).toEqual(['1', '2']);
  });
});

describe('plan band grouping (SF2)', () => {
  const topics = [
    { id: 't1', studySetId: 's', unitId: 's-unit-1', title: 'A', position: 10, status: 'unseen' as const, sourceNoteIds: ['n1'] },
    { id: 't2', studySetId: 's', unitId: 's-unit-1', title: 'B', position: 20, status: 'unseen' as const, sourceNoteIds: ['n1'] },
    { id: 't3', studySetId: 's', unitId: 's-unit-1', title: 'C', position: 30, status: 'unseen' as const, sourceNoteIds: ['n2'] },
  ];
  const materials = [
    { id: 'n1', title: 'AI Foundations' },
    { id: 'n2', title: 'Methods' },
  ];

  it('names the unit the student is standing in', () => {
    const { units, topics: grouped } = unitsFromSourceMaterials(topics, materials);
    expect(units.map((unit) => unit.title)).toEqual(['AI Foundations', 'Methods']);
    expect(topicUnitLabel(grouped, units, grouped[1])).toBe('Topic 2 of 2 from AI Foundations');
    expect(topicUnitLabel(grouped, units, grouped[2])).toBe('Topic 1 of 1 from Methods');
  });

  it('falls back to the bare index when the unit has no name', () => {
    expect(topicUnitLabel(topics, [], topics[0])).toBe('Topic 1 of 3');
  });

  it('leaves topics alone when nothing can be grouped', () => {
    const untitled = unitsFromSourceMaterials(topics, [{ id: 'n1', title: '   ' }, { id: 'n2', title: null }]);
    expect(untitled.units).toEqual([]);
    expect(untitled.topics.map((topic) => topic.unitId)).toEqual(['s-unit-1', 's-unit-1', 's-unit-1']);
  });

  it('keeps a source-less topic under the unit it already had', () => {
    const orphan = { ...topics[0], id: 't0', sourceNoteIds: [] };
    const { topics: grouped } = unitsFromSourceMaterials([orphan, ...topics], materials);
    expect(grouped[0].unitId).toBe('s-unit-1');
    expect(grouped[1].unitId).toBe('s-material-n1');
  });
});

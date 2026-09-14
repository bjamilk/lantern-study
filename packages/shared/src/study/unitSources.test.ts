import { unitSourceLabel, unitSources } from './unitSources';
import type { StudySetTopic } from '../learning/studySetPlan';

function topic(over: Partial<StudySetTopic> & { id: string }): StudySetTopic {
  return {
    studySetId: 'set-1',
    unitId: 'unit-1',
    title: 'Topic',
    position: 10,
    status: 'unseen',
    sourceNoteIds: [],
    ...over,
  };
}

const unit = { id: 'unit-1', title: 'Week 1' };

describe('unitSources', () => {
  it('resolves each topic source against the caller materials', () => {
    const sources = unitSources(
      unit,
      [topic({ id: 't1', sourceNoteIds: ['n1'] }), topic({ id: 't2', position: 20, sourceNoteIds: ['n2'] })],
      [
        { id: 'n1', title: 'Enzymes' },
        { id: 'n2', title: 'Glycolysis' },
      ]
    );
    expect(sources.map((row) => row.title)).toEqual(['Enzymes', 'Glycolysis']);
    expect(sources.every((row) => row.kind === 'note')).toBe(true);
  });

  it('DROPS an id that does not resolve — a chip must never name a deleted or foreign note', () => {
    const sources = unitSources(
      unit,
      [topic({ id: 't1', sourceNoteIds: ['deleted', 'n1'] })],
      [{ id: 'n1', title: 'Enzymes' }]
    );
    expect(sources).toEqual([{ id: 'n1', title: 'Enzymes', kind: 'note' }]);
  });

  it('drops a material whose title is blank rather than drawing an empty chip', () => {
    expect(unitSources(unit, [topic({ id: 't1', sourceNoteIds: ['n1'] })], [{ id: 'n1', title: '   ' }])).toEqual([]);
  });

  it('dedupes by id, keeping first appearance order', () => {
    const sources = unitSources(
      unit,
      [
        topic({ id: 't1', sourceNoteIds: ['n2'] }),
        topic({ id: 't2', position: 20, sourceNoteIds: ['n2', 'n1'] }),
      ],
      [
        { id: 'n1', title: 'Enzymes' },
        { id: 'n2', title: 'Glycolysis' },
      ]
    );
    expect(sources.map((row) => row.id)).toEqual(['n2', 'n1']);
  });

  it('reads every source id on a topic, not just the first', () => {
    const sources = unitSources(
      unit,
      [topic({ id: 't1', sourceNoteIds: ['n1', 'n2'] })],
      [
        { id: 'n1', title: 'Enzymes' },
        { id: 'n2', title: 'Glycolysis' },
      ]
    );
    expect(sources).toHaveLength(2);
  });

  it('ignores topics filed under another unit', () => {
    const sources = unitSources(
      unit,
      [topic({ id: 't1', unitId: 'unit-2', sourceNoteIds: ['n1'] })],
      [{ id: 'n1', title: 'Enzymes' }]
    );
    expect(sources).toEqual([]);
  });

  it('returns nothing when the topics carry no provenance', () => {
    expect(unitSources(unit, [topic({ id: 't1' })], [{ id: 'n1', title: 'Enzymes' }])).toEqual([]);
  });

  describe('kind', () => {
    it('is pdf when the material carries a walkable attachment', () => {
      const [source] = unitSources(
        unit,
        [topic({ id: 't1', sourceNoteIds: ['n1'] })],
        [{ id: 'n1', title: 'Slides', attachments: [{ id: 'a1', type: 'presentation' }] }]
      );
      expect(source.kind).toBe('pdf');
    });

    it('is lecture for an audio-sourced material', () => {
      const [source] = unitSources(
        unit,
        [topic({ id: 't1', sourceNoteIds: ['n1'] })],
        [{ id: 'n1', title: 'Week one', sourceType: 'audio' }]
      );
      expect(source.kind).toBe('lecture');
    });

    it('falls back to note when the caller cannot say what the material is', () => {
      const [source] = unitSources(
        unit,
        [topic({ id: 't1', sourceNoteIds: ['n1'] })],
        [{ id: 'n1', title: 'Enzymes' }]
      );
      expect(source.kind).toBe('note');
    });
  });

  describe('redundancy suppression', () => {
    it('returns nothing when the single source is the unit title', () => {
      expect(
        unitSources(
          { id: 'unit-1', title: 'Enzymes' },
          [topic({ id: 't1', sourceNoteIds: ['n1'] })],
          [{ id: 'n1', title: '  enzymes ' }]
        )
      ).toEqual([]);
    });

    it('keeps both chips when a unit named after one material was fed by two', () => {
      const sources = unitSources(
        { id: 'unit-1', title: 'Enzymes' },
        [topic({ id: 't1', sourceNoteIds: ['n1', 'n2'] })],
        [
          { id: 'n1', title: 'Enzymes' },
          { id: 'n2', title: 'Glycolysis' },
        ]
      );
      expect(sources).toHaveLength(2);
    });

    it('keeps the chip when the single source differs from the unit title', () => {
      const sources = unitSources(
        { id: 'unit-1', title: 'Week 1' },
        [topic({ id: 't1', sourceNoteIds: ['n1'] })],
        [{ id: 'n1', title: 'Enzymes' }]
      );
      expect(sources).toHaveLength(1);
    });
  });

  it('speaks a chip as an open action', () => {
    expect(unitSourceLabel({ id: 'n1', title: 'Enzymes', kind: 'note' })).toBe(
      'Open source material: Enzymes'
    );
  });
});

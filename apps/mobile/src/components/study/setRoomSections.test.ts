import {
  DEFAULT_SET_ROOM_SECTION,
  SET_ROOM_SECTIONS,
  SET_ROOM_TILE_LABELS,
  SET_ROOM_TILE_ORDER,
  isSetRoomSectionId,
  sectionHasBlock,
  sectionsForBlock,
  tileCounts,
  type SetRoomBlockId,
} from './setRoomSections';

describe('set room sections', () => {
  it('is the five named sections in StudyFetch order', () => {
    expect(SET_ROOM_SECTIONS.map((s) => s.id)).toEqual([
      'overview',
      'materials',
      'practice',
      'lectures',
      'plan',
    ]);
    expect(SET_ROOM_SECTIONS.map((s) => s.label)).toEqual([
      'Overview',
      'Materials',
      'Practice',
      'Lectures',
      'Plan',
    ]);
  });

  it('opens on Overview', () => {
    expect(DEFAULT_SET_ROOM_SECTION).toBe('overview');
    expect(isSetRoomSectionId('overview')).toBe(true);
    expect(isSetRoomSectionId('materials')).toBe(true);
    expect(isSetRoomSectionId('nope')).toBe(false);
    expect(isSetRoomSectionId(undefined)).toBe(false);
  });

  it('files every block the room draws, and each one only where it belongs', () => {
    // The whole point of the segment row is that no block is orphaned: a block
    // in no section is content the student can no longer reach.
    const every: SetRoomBlockId[] = [
      'topicBand',
      'recommendedTiles',
      'showMore',
      'setupCards',
      'recentMaterials',
      'classMaterials',
      'import',
      'everything',
      'actionTiles',
      'decks',
      'tests',
      'lessons',
      'recaps',
      'essays',
      'lectureList',
      'record',
      'planBand',
      'courseChips',
    ];
    for (const block of every) {
      expect(sectionsForBlock(block).length).toBeGreaterThan(0);
    }
    const filed = SET_ROOM_SECTIONS.flatMap((s) => s.blocks);
    expect(new Set(filed).size).toBe(every.length);
  });

  it('puts the room’s blocks under the segment that names them', () => {
    expect(sectionHasBlock('overview', 'recommendedTiles')).toBe(true);
    expect(sectionHasBlock('materials', 'recentMaterials')).toBe(true);
    expect(sectionHasBlock('materials', 'import')).toBe(true);
    expect(sectionHasBlock('materials', 'everything')).toBe(true);
    expect(sectionHasBlock('practice', 'actionTiles')).toBe(true);
    expect(sectionHasBlock('practice', 'decks')).toBe(true);
    expect(sectionHasBlock('lectures', 'lectureList')).toBe(true);
    expect(sectionHasBlock('lectures', 'record')).toBe(true);
    expect(sectionHasBlock('plan', 'planBand')).toBe(true);
    expect(sectionHasBlock('plan', 'courseChips')).toBe(true);

    // And not under one that does not.
    expect(sectionHasBlock('overview', 'decks')).toBe(false);
    expect(sectionHasBlock('materials', 'actionTiles')).toBe(false);
    expect(sectionHasBlock('lectures', 'planBand')).toBe(false);
  });

  it('shows the setup cards on both Overview and Plan', () => {
    // An empty set's only content is the syllabus/exam pair; a room that
    // opened on Overview and filed those under Plan alone would open blank.
    expect(sectionsForBlock('setupCards')).toEqual(['overview', 'plan']);
  });
});

describe('set room tiles', () => {
  it('leads with what the set contains, then the tools', () => {
    expect(SET_ROOM_TILE_ORDER.slice(0, 5)).toEqual([
      'import',
      'quiz',
      'cards',
      'lecture',
      'test',
    ]);
    expect(SET_ROOM_TILE_ORDER).toHaveLength(11);
    expect(new Set(SET_ROOM_TILE_ORDER).size).toBe(SET_ROOM_TILE_ORDER.length);
  });

  it('labels every tile with a noun, never a verb phrase', () => {
    for (const id of SET_ROOM_TILE_ORDER) {
      const label = SET_ROOM_TILE_LABELS[id];
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/^(Start|Create|Take|Launch|Add|Open)\b/);
    }
    expect(SET_ROOM_TILE_LABELS.import).toBe('Materials');
    expect(SET_ROOM_TILE_LABELS.lesson).toBe('Tutor');
    expect(SET_ROOM_TILE_LABELS.recap).toBe('Listen');
    expect(SET_ROOM_TILE_LABELS.play).toBe('Arcade');
  });

  it('counts only what the set actually holds', () => {
    const counts = tileCounts({
      materials: 4,
      decks: 2,
      lectures: 3,
      tests: 1,
      lessons: 0,
      recaps: 0,
      essays: 5,
    });
    expect(counts.import).toBe(4);
    expect(counts.cards).toBe(2);
    expect(counts.lecture).toBe(3);
    expect(counts.test).toBe(1);
    expect(counts.essay).toBe(5);
    // Zero is a real answer for a collection that exists.
    expect(counts.lesson).toBe(0);
    expect(counts.recap).toBe(0);
    // A quiz is generated on demand and the companion is a conversation:
    // neither has a collection, so neither may claim a count.
    expect(counts.quiz).toBeUndefined();
    expect(counts.ask).toBeUndefined();
    expect(counts.plan).toBeUndefined();
  });
});

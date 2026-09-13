import {
  browserStore,
  isMaterialSortId,
  isViewMode,
  materialSortKey,
  materialSortLabel,
  readMaterialSort,
  readViewMode,
  sortMaterials,
  viewModeKey,
  writeMaterialSort,
  writeViewMode,
  type KeyValueStore,
} from './viewMode';

/** A `localStorage` stand-in, plus the two ways a real one misbehaves. */
function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

const throwingStore: KeyValueStore = {
  getItem() {
    throw new Error('SecurityError: storage is blocked');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

describe('sortMaterials', () => {
  const items = [
    { id: 'c', title: 'Alpha particles', createdAt: '2026-09-01T10:00:00.000Z' },
    { id: 'a', title: 'zeta decay', createdAt: '2026-09-03T10:00:00.000Z' },
    { id: 'b', title: 'Beta decay', createdAt: '2026-09-02T10:00:00.000Z' },
  ];

  it('puts the most recent first, and the oldest first on request', () => {
    expect(sortMaterials(items, 'newest').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(sortMaterials(items, 'oldest').map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts A–Z without letting case decide', () => {
    // `zeta` lowercase must still sort after `Beta` uppercase: a student reads
    // the alphabet, not the ASCII table.
    expect(sortMaterials(items, 'alpha').map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate the array it was given', () => {
    const original = [...items];
    sortMaterials(items, 'alpha');
    expect(items).toEqual(original);
  });

  it('breaks ties on id so a list does not reshuffle between renders', () => {
    const sameSecond = [
      { id: 'z', title: 'Lecture', createdAt: '2026-09-01T10:00:00.000Z' },
      { id: 'y', title: 'Lecture', createdAt: '2026-09-01T10:00:00.000Z' },
    ];
    expect(sortMaterials(sameSecond, 'newest').map((i) => i.id)).toEqual(['y', 'z']);
    // Same answer from the other input order — which is the whole point.
    expect(sortMaterials([...sameSecond].reverse(), 'newest').map((i) => i.id)).toEqual(['y', 'z']);
    expect(sortMaterials(sameSecond, 'alpha').map((i) => i.id)).toEqual(['y', 'z']);
  });

  it('keeps a material with a missing or unparseable date rather than dropping it', () => {
    const ragged = [
      { id: 'dated', title: 'B', createdAt: '2026-09-01T10:00:00.000Z' },
      { id: 'none', title: 'A' },
      { id: 'junk', title: 'C', createdAt: 'not a date' },
    ];
    expect(sortMaterials(ragged, 'newest')).toHaveLength(3);
    expect(sortMaterials(ragged, 'newest')[0]?.id).toBe('dated');
    expect(sortMaterials(ragged, 'alpha').map((i) => i.id)).toEqual(['none', 'dated', 'junk']);
  });

  it('handles an empty list', () => {
    expect(sortMaterials([], 'newest')).toEqual([]);
  });
});

describe('the remembered view', () => {
  it('falls back to the surface`s own default when nothing is stored', () => {
    const store = memoryStore();
    expect(readViewMode('setRoomMaterials', 'grid', store)).toBe('grid');
    expect(readViewMode('setRoomLectures', 'list', store)).toBe('list');
  });

  it('round-trips a choice', () => {
    const store = memoryStore();
    writeViewMode('setRoomMaterials', 'list', store);
    expect(readViewMode('setRoomMaterials', 'grid', store)).toBe('list');
  });

  it('keys each surface separately', () => {
    const store = memoryStore();
    writeViewMode('setRoomMaterials', 'list', store);
    // The lecture list must not have been switched by the materials grid.
    expect(readViewMode('setRoomLectures', 'grid', store)).toBe('grid');
    expect(viewModeKey('setRoomMaterials')).not.toBe(viewModeKey('setRoomLectures'));
    expect(materialSortKey('setRoomMaterials')).not.toBe(viewModeKey('setRoomMaterials'));
  });

  it('ignores a stored value it does not recognise', () => {
    // A value left by an older build, or by a student editing storage.
    const store = memoryStore({ [viewModeKey('setRoomMaterials')]: 'gallery' });
    expect(readViewMode('setRoomMaterials', 'grid', store)).toBe('grid');
    const sorts = memoryStore({ [materialSortKey('setRoomLectures')]: 'by-vibes' });
    expect(readMaterialSort('setRoomLectures', 'newest', sorts)).toBe('newest');
  });

  it('survives a store that throws on read and on write', () => {
    expect(() => writeViewMode('setRoomMaterials', 'list', throwingStore)).not.toThrow();
    expect(readViewMode('setRoomMaterials', 'grid', throwingStore)).toBe('grid');
    expect(() => writeMaterialSort('setRoomLectures', 'alpha', throwingStore)).not.toThrow();
    expect(readMaterialSort('setRoomLectures', 'newest', throwingStore)).toBe('newest');
  });

  it('survives having no store at all, as on the server', () => {
    expect(readViewMode('setRoomMaterials', 'list', null)).toBe('list');
    expect(() => writeViewMode('setRoomMaterials', 'grid', null)).not.toThrow();
  });

  it('round-trips a sort', () => {
    const store = memoryStore();
    writeMaterialSort('setRoomLectures', 'alpha', store);
    expect(readMaterialSort('setRoomLectures', 'newest', store)).toBe('alpha');
  });
});

describe('labels and guards', () => {
  it('names every sort', () => {
    expect(materialSortLabel('newest')).toBe('Newest first');
    expect(materialSortLabel('oldest')).toBe('Oldest first');
    expect(materialSortLabel('alpha')).toBe('A–Z');
  });

  it('recognises only the real values', () => {
    expect(isViewMode('grid')).toBe(true);
    expect(isViewMode('list')).toBe(true);
    expect(isViewMode('tiles')).toBe(false);
    expect(isViewMode(null)).toBe(false);
    expect(isMaterialSortId('alpha')).toBe(true);
    expect(isMaterialSortId('')).toBe(false);
  });

  it('hands back a usable store, or null, in whatever environment this runs in', () => {
    expect(() => browserStore()).not.toThrow();
  });
});

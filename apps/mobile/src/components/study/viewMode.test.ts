/**
 * The phone's port of the web `viewMode` spec, plus the two things only the
 * phone can get wrong: an AsyncStorage that rejects rather than throws, and a
 * missing native module.
 */
import {
  deviceStore,
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

/** An AsyncStorage stand-in, plus the two ways a real one misbehaves. */
function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
  };
}

/** Rejects, which is how AsyncStorage fails — not a synchronous throw. */
const rejectingStore: KeyValueStore = {
  getItem: () => Promise.reject(new Error('database disk image is malformed')),
  setItem: () => Promise.reject(new Error('SQLITE_FULL')),
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
    // Two recordings made in the same second, both called `Lecture` — which is
    // the default title, so this is the common case and not the exotic one.
    const sameSecond = [
      { id: 'z', title: 'Lecture', createdAt: '2026-09-01T10:00:00.000Z' },
      { id: 'y', title: 'Lecture', createdAt: '2026-09-01T10:00:00.000Z' },
    ];
    expect(sortMaterials(sameSecond, 'newest').map((i) => i.id)).toEqual(['y', 'z']);
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
  it('falls back to the surface`s own default when nothing is stored', async () => {
    const store = memoryStore();
    // Grid for materials, list for lectures — each surface's shape before the
    // toggle existed, so a student who never taps it sees no change.
    await expect(readViewMode('setRoomMaterials', 'grid', store)).resolves.toBe('grid');
    await expect(readViewMode('setRoomLectures', 'list', store)).resolves.toBe('list');
  });

  it('round-trips a choice', async () => {
    const store = memoryStore();
    await writeViewMode('setRoomMaterials', 'list', store);
    await expect(readViewMode('setRoomMaterials', 'grid', store)).resolves.toBe('list');
  });

  it('keys each surface separately', async () => {
    const store = memoryStore();
    await writeViewMode('setRoomMaterials', 'list', store);
    await expect(readViewMode('setRoomLectures', 'grid', store)).resolves.toBe('grid');
    expect(viewModeKey('setRoomMaterials')).not.toBe(viewModeKey('setRoomLectures'));
    expect(materialSortKey('setRoomMaterials')).not.toBe(viewModeKey('setRoomMaterials'));
  });

  it('uses the same keys the web writes, so the two stay one design', () => {
    expect(viewModeKey('setRoomLectures')).toBe('lantern.viewMode.setRoomLectures');
    expect(materialSortKey('setRoomMaterials')).toBe('lantern.materialSort.setRoomMaterials');
  });

  it('ignores a stored value it does not recognise', async () => {
    const store = memoryStore({ [viewModeKey('setRoomMaterials')]: 'gallery' });
    await expect(readViewMode('setRoomMaterials', 'grid', store)).resolves.toBe('grid');
    const sorts = memoryStore({ [materialSortKey('setRoomLectures')]: 'by-vibes' });
    await expect(readMaterialSort('setRoomLectures', 'newest', sorts)).resolves.toBe('newest');
  });

  it('survives a store that rejects on read and on write', async () => {
    await expect(writeViewMode('setRoomMaterials', 'list', rejectingStore)).resolves.toBeUndefined();
    await expect(readViewMode('setRoomMaterials', 'grid', rejectingStore)).resolves.toBe('grid');
    await expect(
      writeMaterialSort('setRoomLectures', 'alpha', rejectingStore)
    ).resolves.toBeUndefined();
    await expect(readMaterialSort('setRoomLectures', 'newest', rejectingStore)).resolves.toBe(
      'newest'
    );
  });

  it('survives having no store at all, as when the native module is missing', async () => {
    await expect(readViewMode('setRoomMaterials', 'list', null)).resolves.toBe('list');
    await expect(writeViewMode('setRoomMaterials', 'grid', null)).resolves.toBeUndefined();
  });

  it('round-trips a sort', async () => {
    const store = memoryStore();
    await writeMaterialSort('setRoomLectures', 'alpha', store);
    await expect(readMaterialSort('setRoomLectures', 'newest', store)).resolves.toBe('alpha');
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
    expect(() => deviceStore()).not.toThrow();
  });
});

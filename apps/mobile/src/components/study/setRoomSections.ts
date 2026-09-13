/**
 * The set room's five sections, and the counts its tiles carry.
 *
 * WHY A MODEL AND NOT `useState` IN THE SCREEN. The set room was one ~7-screen
 * scroll with no jump targets: reaching `Lectures · 2` from the top took five
 * swipes (SF2 mobile evidence §6 item 1). StudyFetch gives a set five named
 * destinations and remembers which one you were on. The fix is a segment row,
 * and a segment row is only honest if the answer to "which blocks does
 * `Materials` show?" lives somewhere a test can read. That is this file: the
 * ids, the labels, the order, and the block→section mapping, with no React and
 * no theme imports so it runs in jest's node environment.
 *
 * A BLOCK MAY BELONG TO TWO SECTIONS. Only `setupCards` does — the "Add your
 * syllabus" / "Exam dates" starter pair. It is the plan's own setup, so it
 * belongs under `Plan`; it is also the only thing an empty set has to offer,
 * so an empty room opening on `Overview` must not be a blank screen. Rather
 * than special-casing that in the screen, the mapping says it twice.
 */

export type SetRoomSectionId = 'overview' | 'materials' | 'practice' | 'lectures' | 'plan';

/**
 * One renderable block of the room. These are the blocks the screen already
 * drew in one scroll; nothing here is new content, it is only filed.
 */
export type SetRoomBlockId =
  // Overview
  | 'topicBand'
  | 'recommendedTiles'
  | 'showMore'
  | 'setupCards'
  // Materials
  | 'recentMaterials'
  | 'classMaterials'
  | 'import'
  | 'everything'
  // Practice
  | 'actionTiles'
  | 'decks'
  | 'tests'
  | 'lessons'
  | 'recaps'
  | 'essays'
  // Lectures
  | 'lectureList'
  | 'record'
  // Plan
  | 'planBand'
  | 'courseChips';

export interface SetRoomSection {
  id: SetRoomSectionId;
  /** The segment's word. A noun, never a verb phrase. */
  label: string;
  /** Spoken form where the word alone is ambiguous out of context. */
  accessibilityLabel: string;
  /** Which blocks this section draws, in the order it draws them. */
  blocks: readonly SetRoomBlockId[];
}

export const SET_ROOM_SECTIONS: readonly SetRoomSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    accessibilityLabel: 'Overview of this set',
    blocks: ['setupCards', 'topicBand', 'recommendedTiles', 'showMore'],
  },
  {
    id: 'materials',
    label: 'Materials',
    accessibilityLabel: 'Materials in this set',
    blocks: ['recentMaterials', 'classMaterials', 'import', 'everything'],
  },
  {
    id: 'practice',
    label: 'Practice',
    accessibilityLabel: 'Practice in this set',
    blocks: ['actionTiles', 'decks', 'tests', 'lessons', 'recaps', 'essays'],
  },
  {
    id: 'lectures',
    label: 'Lectures',
    accessibilityLabel: 'Lectures in this set',
    blocks: ['lectureList', 'record'],
  },
  {
    id: 'plan',
    label: 'Plan',
    accessibilityLabel: 'Study plan for this set',
    blocks: ['planBand', 'courseChips', 'setupCards'],
  },
];

/** Where a room opens when this phone has no memory of it yet. */
export const DEFAULT_SET_ROOM_SECTION: SetRoomSectionId = 'overview';

export function isSetRoomSectionId(value: unknown): value is SetRoomSectionId {
  return SET_ROOM_SECTIONS.some((section) => section.id === value);
}

/** Does `sectionId` draw `blockId`? The screen's only render predicate. */
export function sectionHasBlock(sectionId: SetRoomSectionId, blockId: SetRoomBlockId): boolean {
  const section = SET_ROOM_SECTIONS.find((row) => row.id === sectionId);
  return Boolean(section?.blocks.includes(blockId));
}

/** Every section that draws `blockId`, in section order. */
export function sectionsForBlock(blockId: SetRoomBlockId): SetRoomSectionId[] {
  return SET_ROOM_SECTIONS.filter((section) => section.blocks.includes(blockId)).map((s) => s.id);
}

/* ------------------------------------------------------------------ tiles */

/**
 * The room's tiles, in StudyFetch's order where it maps.
 *
 * These ids are `StudySetHomeToolId`s so the screen can keep handing them to
 * the handler it already has; the ORDER and the LABELS are this file's,
 * because StudyFetch's hub leads with what a set contains (`Materials`,
 * `Quiz`, `Flashcards`, `Lectures`, `Tests`) and only then offers the tools,
 * and because every label there is a noun. Lantern's were verb phrases —
 * `Start a tutor session`, `Create flashcards` — which wrap on a 2-up grid and
 * read as instructions rather than as places (evidence §4.1).
 */
export type SetRoomTileId =
  | 'import'
  | 'quiz'
  | 'cards'
  | 'lecture'
  | 'test'
  | 'ask'
  | 'lesson'
  | 'recap'
  | 'play'
  | 'plan'
  | 'essay';

export const SET_ROOM_TILE_ORDER: readonly SetRoomTileId[] = [
  'import',
  'quiz',
  'cards',
  'lecture',
  'test',
  'ask',
  'lesson',
  'recap',
  'play',
  'plan',
  'essay',
];

/** The noun on the tile. Overrides the shared tool's verb-phrase label. */
export const SET_ROOM_TILE_LABELS: Readonly<Record<SetRoomTileId, string>> = {
  import: 'Materials',
  quiz: 'Quiz',
  cards: 'Flashcards',
  lecture: 'Lectures',
  test: 'Tests',
  ask: 'Ask Lantern',
  lesson: 'Tutor',
  recap: 'Listen',
  play: 'Arcade',
  plan: 'Plan',
  essay: 'Essay',
};

/** What the room has already loaded, which is the only source of a count. */
export interface SetRoomCountSource {
  materials: number;
  decks: number;
  lectures: number;
  tests: number;
  lessons: number;
  recaps: number;
  essays: number;
}

/**
 * The count pill for each tile, or `undefined` where there is nothing true to
 * say.
 *
 * `quiz` and `ask` have no collection behind them — a quiz is generated on
 * demand and the companion is a conversation — so they carry no pill rather
 * than a `0` that would read as "this set has no quizzes". Zero IS drawn for
 * the collections that exist, because "Flashcards 0" is the honest answer to
 * "what does this set contain?" and is exactly the thing the room could not
 * say before (evidence §6 item 6).
 */
export function tileCounts(set: SetRoomCountSource): Partial<Record<SetRoomTileId, number>> {
  return {
    import: set.materials,
    cards: set.decks,
    lecture: set.lectures,
    test: set.tests,
    lesson: set.lessons,
    recap: set.recaps,
    essay: set.essays,
  };
}

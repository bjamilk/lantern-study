/**
 * Personal study sets — the default container on the Study tab.
 *
 * A set can sit under a course later. Creating one does not require a course.
 */
export const STUDY_SET_TITLE_MAX = 80;
export const STUDY_SET_TITLE_MIN = 1;
export const STUDY_SET_DESCRIPTION_MAX = 280;

export function normalizeStudySetTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

export function isValidStudySetTitle(title: string): boolean {
  const next = normalizeStudySetTitle(title);
  return next.length >= STUDY_SET_TITLE_MIN && next.length <= STUDY_SET_TITLE_MAX;
}

export function studySetLabel(set: { title?: string | null }): string {
  const title = normalizeStudySetTitle(set.title ?? '');
  return title || 'Study set';
}

export function filedStudySetId(item: {
  studySetId?: string | null;
  study_set_id?: string | null;
}): string | null {
  return item.studySetId ?? item.study_set_id ?? null;
}

export function materialsForStudySet<
  T extends { studySetId?: string | null; study_set_id?: string | null },
>(items: readonly T[], studySetId: string): T[] {
  return items.filter((item) => filedStudySetId(item) === studySetId);
}

export function testsFiledInStudySet<
  T extends {
    studySetId?: string | null;
    sourceNoteId?: string | null;
    sourceDeckId?: string | null;
    deckId?: string | null;
  },
>(
  tests: readonly T[],
  studySetId: string,
  noteIds: ReadonlySet<string>,
  deckIds: ReadonlySet<string>
): T[] {
  return tests.filter((test) => {
    if (test.studySetId === studySetId) return true;
    if (test.sourceNoteId && noteIds.has(test.sourceNoteId)) return true;
    if (test.sourceDeckId && deckIds.has(test.sourceDeckId)) return true;
    if (test.deckId && deckIds.has(test.deckId)) return true;
    return false;
  });
}

/** Last-opened set if it still exists; otherwise the first set. */
export function pickOpenStudySetId(
  sets: readonly { id: string }[],
  lastId?: string | null
): string | null {
  if (lastId && sets.some((set) => set.id === lastId)) return lastId;
  return sets[0]?.id ?? null;
}

/** Stamp course and/or set on a newly created note, deck, or plan. */
export function studySetNotePayload(input: {
  courseId?: string | null;
  studySetId?: string | null;
}): { courseId?: string; studySetId?: string } {
  return {
    ...(input.courseId ? { courseId: input.courseId } : {}),
    ...(input.studySetId ? { studySetId: input.studySetId } : {}),
  };
}

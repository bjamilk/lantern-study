/**
 * Which section of a set room this phone was last on, per set.
 *
 * A segment row that forgets is worse than no segment row: the student taps
 * `Lectures`, opens one, comes back and is on `Overview` again, four swipes
 * from where they were. StudyFetch remembers each of its five set tabs, so
 * this does too.
 *
 * In memory for the session, not AsyncStorage. The memory this protects is
 * "the trip I am on", and a section restored a week later — pointing at a
 * `Lectures` tab of a set whose lectures have since been deleted — is a
 * surprise rather than a convenience. The set the room OPENS on is already
 * persisted elsewhere (`studySetStore.touchOpened`); this is one level below.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import {
  DEFAULT_SET_ROOM_SECTION,
  isSetRoomSectionId,
  type SetRoomSectionId,
} from '../components/study/setRoomSections';

interface SetRoomUiStore {
  /** setId → the section that set was last left on. */
  sectionBySet: Record<string, SetRoomSectionId>;
  /** setId → the artefact shelf its library was last left on (`cards`, …). */
  kindBySet: Record<string, string>;
  /** The remembered section, or the default for a set never opened here. */
  sectionFor: (setId: string | null | undefined) => SetRoomSectionId;
  setSection: (setId: string | null | undefined, section: SetRoomSectionId) => void;
  /** The remembered shelf, or `null` for a set whose library is unvisited. */
  kindFor: (setId: string | null | undefined) => string | null;
  setKind: (setId: string | null | undefined, kind: string) => void;
}

export const useSetRoomUiStore = create<SetRoomUiStore>((set, get) => ({
  sectionBySet: {},
  kindBySet: {},
  sectionFor: (setId) => {
    if (!setId) return DEFAULT_SET_ROOM_SECTION;
    const remembered = get().sectionBySet[setId];
    return isSetRoomSectionId(remembered) ? remembered : DEFAULT_SET_ROOM_SECTION;
  },
  // Writing the value already stored would hand every subscriber a brand new
  // `sectionBySet` object for no news at all — and the contextual row is a
  // subscriber now. A screen re-adopting the same segment must be free.
  setSection: (setId, section) => {
    if (!setId || !isSetRoomSectionId(section)) return;
    if (get().sectionBySet[setId] === section) return;
    set((state) => ({ sectionBySet: { ...state.sectionBySet, [setId]: section } }));
  },
  kindFor: (setId) => (setId ? get().kindBySet[setId] ?? null : null),
  setKind: (setId, kind) => {
    if (!setId || !kind) return;
    if (get().kindBySet[setId] === kind) return;
    set((state) => ({ kindBySet: { ...state.kindBySet, [setId]: kind } }));
  },
}));

/**
 * The focused route's params as the CONTEXTUAL ROW should read them: with
 * `segment` and `kind` replaced by what the set's screens are actually showing.
 *
 * The row used to read those straight off the params, which worked only while
 * the screens published their selection back into them — the mirror that
 * crash-looped build 205 (navigation/segmentParamSync.ts). The params are now
 * an inbox the screens only read, so they go stale the moment the student uses
 * a screen's OWN segment row, and a row reading them would light the wrong pill
 * and plan a dead `scrollToTop` against the door it lit.
 *
 * Overlaying both keys for any set-scoped route is deliberate: a `kind` on the
 * room's params (or a `segment` on the library's) matches no door on that row,
 * so it costs nothing and keeps this from having to know the route table.
 */
export function visibleSetParams(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const setId = typeof params?.studySetId === 'string' ? params.studySetId : null;
  if (!params || !setId) return params;
  const { sectionBySet, kindBySet } = useSetRoomUiStore.getState();
  const section = sectionBySet[setId];
  const kind = kindBySet[setId];
  if (!section && !kind) return params;
  return {
    ...params,
    ...(section ? { segment: section } : {}),
    ...(kind ? { kind } : {}),
  };
}

/** {@link visibleSetParams}, subscribed, for the row that draws the pill. */
export function useVisibleSetParams(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const setId = typeof params?.studySetId === 'string' ? params.studySetId : null;
  const section = useSetRoomUiStore((s) => (setId ? s.sectionBySet[setId] : undefined));
  const kind = useSetRoomUiStore((s) => (setId ? s.kindBySet[setId] : undefined));
  // Memoised on the PRIMITIVES: a fresh object per render would rebuild the
  // row's press callback on every render, which is the class of mistake this
  // whole module exists to stop.
  return useMemo(() => {
    if (!params || !setId || (!section && !kind)) return params;
    return {
      ...params,
      ...(section ? { segment: section } : {}),
      ...(kind ? { kind } : {}),
    };
  }, [params, setId, section, kind]);
}

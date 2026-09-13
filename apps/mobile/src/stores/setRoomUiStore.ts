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
import { create } from 'zustand';
import {
  DEFAULT_SET_ROOM_SECTION,
  isSetRoomSectionId,
  type SetRoomSectionId,
} from '../components/study/setRoomSections';

interface SetRoomUiStore {
  /** setId → the section that set was last left on. */
  sectionBySet: Record<string, SetRoomSectionId>;
  /** The remembered section, or the default for a set never opened here. */
  sectionFor: (setId: string | null | undefined) => SetRoomSectionId;
  setSection: (setId: string | null | undefined, section: SetRoomSectionId) => void;
}

export const useSetRoomUiStore = create<SetRoomUiStore>((set, get) => ({
  sectionBySet: {},
  sectionFor: (setId) => {
    if (!setId) return DEFAULT_SET_ROOM_SECTION;
    const remembered = get().sectionBySet[setId];
    return isSetRoomSectionId(remembered) ? remembered : DEFAULT_SET_ROOM_SECTION;
  },
  setSection: (setId, section) => {
    if (!setId || !isSetRoomSectionId(section)) return;
    set((state) => ({ sectionBySet: { ...state.sectionBySet, [setId]: section } }));
  },
}));

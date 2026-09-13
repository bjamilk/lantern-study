/**
 * The set row's two same-route doors, end to end: the ACTIVE PILL must be the
 * segment actually on screen, and a press from any other segment must be a
 * navigate that the screen can hear.
 *
 * Build 204's device pass found the pill and the screen disagreeing: pressing
 * `Materials` recoloured the pill (the row reads params, which the merge DID
 * change) while the room stayed on Overview. The row's half of that contract is
 * asserted here; the screens' half is `segmentParamSync.test.ts`.
 */
import { CONTEXTUAL_BARS, activeItem, planContextualPress } from './contextualBars';
import { adoptSegmentRequest, readSegmentRequest } from './segmentParamSync';
import { isSetRoomSectionId } from '../components/study/setRoomSections';
import { useSetRoomUiStore, visibleSetParams } from '../stores/setRoomUiStore';

beforeEach(() => {
  useSetRoomUiStore.setState({ sectionBySet: {}, kindBySet: {} });
});

const SET = { studySetId: 'set-1' };

function itemById(id: string) {
  const found = CONTEXTUAL_BARS.CourseRoom?.items.find((item) => item.id === id);
  if (!found) throw new Error(`no set-row item ${id}`);
  return found;
}

describe('the active pill is the segment actually shown', () => {
  it('lights Materials only when the room is on the materials segment', () => {
    expect(activeItem('CourseRoom', { ...SET, segment: 'materials' })?.id).toBe('materials');
    expect(activeItem('CourseRoom', { ...SET, segment: 'overview' })?.id).not.toBe('materials');
    expect(activeItem('CourseRoom', { ...SET, segment: 'practice' })?.id).not.toBe('materials');
  });

  it('lights Flashcards and Tests by the library kind they each name', () => {
    expect(activeItem('StudySetLibrary', { ...SET, kind: 'cards' })?.id).toBe('flashcards');
    expect(activeItem('StudySetLibrary', { ...SET, kind: 'tests' })?.id).toBe('tests');
  });
});

describe('a press from another segment navigates', () => {
  it('Materials from Overview navigates with the segment param', () => {
    const plan = planContextualPress({
      focusedRoute: 'CourseRoom',
      item: itemById('materials'),
      focusedParams: { ...SET, segment: 'overview' },
    });
    expect(plan).toEqual({
      kind: 'navigate',
      route: 'CourseRoom',
      params: { segment: 'materials', studySetId: 'set-1' },
    });
    // …and the room adopts it once, which is the half that was missing.
    const params = { ...SET, segment: 'materials' };
    expect(
      adoptSegmentRequest({
        request: readSegmentRequest(params, 'segment', isSetRoomSectionId),
        lastTicket: null,
        current: 'overview',
      }),
    ).toMatchObject({ segment: 'materials', alreadyShown: false });
  });

  it('Tests from the Cards list navigates with the tests kind', () => {
    const plan = planContextualPress({
      focusedRoute: 'StudySetLibrary',
      item: itemById('tests'),
      focusedParams: { ...SET, kind: 'cards' },
    });
    expect(plan).toMatchObject({
      kind: 'navigate',
      route: 'StudySetLibrary',
      params: { kind: 'tests' },
    });
  });

  it('is a scroll-to-top only when the door IS the segment on screen', () => {
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        item: itemById('materials'),
        focusedParams: { ...SET, segment: 'materials' },
      }),
    ).toEqual({ kind: 'scrollToTop' });
  });

  it('stays pressable after the room`s own segment row moves away', () => {
    // The screen no longer publishes anything back — the params still say
    // `materials` — so the row reads the STORE for what is on screen. Without
    // that overlay this door would plan a dead `scrollToTop`.
    useSetRoomUiStore.getState().setSection('set-1', 'practice');
    const stale = { ...SET, segment: 'materials' };
    expect(visibleSetParams(stale)).toMatchObject({ segment: 'practice' });
    expect(activeItem('CourseRoom', visibleSetParams(stale))?.id).not.toBe('materials');
    expect(
      planContextualPress({
        focusedRoute: 'CourseRoom',
        item: itemById('materials'),
        focusedParams: visibleSetParams(stale),
      }),
    ).toMatchObject({ kind: 'navigate', params: { segment: 'materials' } });
  });

  it('lights the shelf the set library is actually showing', () => {
    useSetRoomUiStore.getState().setKind('set-1', 'tests');
    const stale = { ...SET, kind: 'cards' };
    expect(activeItem('StudySetLibrary', visibleSetParams(stale))?.id).toBe('tests');
  });
});

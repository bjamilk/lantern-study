/**
 * The segment sync has to SETTLE, and the only honest way to show that is to
 * run it the way React does: effects fire after a commit, off THAT commit's
 * snapshot, and any state they set causes another commit.
 *
 * Build 205's adopt+publish pair passed a test that called the two functions by
 * hand, in the order that converges (adopt, then publish with the ALREADY
 * adopted value). The device runs them both off the pre-adopt snapshot, where
 * they revert each other for ever — `Maximum update depth exceeded`,
 * `CourseRoomScreen`, 3/3. So the harness below is the test: it renders in a
 * loop with a hard budget, and a design that needs a second commit to stop is a
 * design that failed.
 */
import {
  adoptSegmentRequest,
  initialSegment,
  readSegmentRequest,
} from './segmentParamSync';

type Section = 'overview' | 'materials' | 'practice';
const isSection = (value: unknown): value is Section =>
  value === 'overview' || value === 'materials' || value === 'practice';

/** How many commits one event may cost before we call it a loop. */
const BUDGET = 20;

/**
 * One mounted screen: `section` state, a remembered-segment store, and the
 * adopt effect — the screen's whole half of the contract, minus the JSX.
 */
function mountScreen(params: Record<string, unknown>, remembered: Section) {
  const store = { section: initialSegment(params.segment, isSection, remembered) };
  const state = { section: store.section };
  let routeParams = params;
  let lastTicket: unknown = params;
  /** Commits since the last event; the loop detector. */
  let commits = 0;
  /** Scroll-to-top requests: a press of the door you are standing in. */
  let scrolls = 0;

  function settle() {
    commits = 0;
    for (;;) {
      commits += 1;
      if (commits > BUDGET) {
        throw new Error(`no fixed point: ${commits} commits, section=${state.section}`);
      }
      // The effect reads the snapshot this commit rendered with.
      const snapshot = { section: state.section, params: routeParams };
      const adopted = adoptSegmentRequest({
        request: readSegmentRequest(snapshot.params, 'segment', isSection),
        lastTicket,
        current: snapshot.section,
      });
      if (!adopted) return;
      lastTicket = adopted.ticket;
      if (adopted.alreadyShown) {
        scrolls += 1;
        return;
      }
      state.section = adopted.segment;
      store.section = adopted.segment;
      // State changed, so React commits again and the effect gets another look.
    }
  }

  settle();
  return {
    get section() {
      return state.section;
    },
    get remembered() {
      return store.section;
    },
    get commits() {
      return commits;
    },
    get scrolls() {
      return scrolls;
    },
    /** A door press: React Navigation merges into a NEW params object. */
    press(segment: Section) {
      routeParams = { ...routeParams, segment };
      settle();
    },
    /** The screen's own segment row: state and store, params untouched. */
    selectOnScreen(segment: Section) {
      state.section = segment;
      store.section = segment;
      settle();
    },
  };
}

describe('initialSegment', () => {
  it('prefers an explicit param over the remembered segment', () => {
    expect(initialSegment('materials', isSection, 'practice')).toBe('materials');
  });

  it('keeps the remembered segment when no param was passed', () => {
    expect(initialSegment(undefined, isSection, 'practice')).toBe('practice');
  });

  it('ignores a param that names nothing real', () => {
    expect(initialSegment('lectures-2', isSection, 'overview')).toBe('overview');
    expect(initialSegment(7, isSection, 'overview')).toBe('overview');
  });
});

describe('readSegmentRequest', () => {
  it('reads a bare param, ticketed by the params object itself', () => {
    const params = { studySetId: 'set-1', segment: 'materials' };
    const request = readSegmentRequest(params, 'segment', isSection);
    expect(request).toEqual({ segment: 'materials', ticket: params });
  });

  it('reads a ticketed ask, ticketed by its nonce', () => {
    const params = { segment: { segment: 'materials', nonce: 7 } };
    expect(readSegmentRequest(params, 'segment', isSection)?.ticket).toBe('segment#7');
    // A second press of the same door is a DIFFERENT ticket.
    expect(
      readSegmentRequest({ segment: { segment: 'materials', nonce: 8 } }, 'segment', isSection)
        ?.ticket,
    ).toBe('segment#8');
  });

  it('is null for an absent, bogus or unreadable ask', () => {
    expect(readSegmentRequest({ studySetId: 'set-1' }, 'segment', isSection)).toBeNull();
    expect(readSegmentRequest({ segment: 'plan' }, 'segment', isSection)).toBeNull();
    expect(readSegmentRequest({ segment: { nonce: 1 } }, 'segment', isSection)).toBeNull();
    expect(readSegmentRequest(undefined, 'segment', isSection)).toBeNull();
  });
});

describe('adoptSegmentRequest', () => {
  it('adopts an ask once and never again on the same ticket', () => {
    const request = { segment: 'materials' as Section, ticket: 'ticket-1' };
    expect(adoptSegmentRequest({ request, lastTicket: null, current: 'overview' })).toEqual({
      segment: 'materials',
      ticket: 'ticket-1',
      alreadyShown: false,
    });
    expect(
      adoptSegmentRequest({ request, lastTicket: 'ticket-1', current: 'materials' }),
    ).toBeNull();
  });

  it('hears a press of the door you are standing in, and moves nothing', () => {
    const adopted = adoptSegmentRequest({
      request: { segment: 'materials' as Section, ticket: 'ticket-2' },
      lastTicket: 'ticket-1',
      current: 'materials',
    });
    expect(adopted).toMatchObject({ segment: 'materials', alreadyShown: true });
  });
});

describe('the mounted screen reaches a fixed point', () => {
  it('settles on mount with nothing to adopt', () => {
    const screen = mountScreen({ studySetId: 'set-1' }, 'overview');
    expect(screen.section).toBe('overview');
    expect(screen.commits).toBe(1);
  });

  it('adopts a bar press in one extra commit and stops', () => {
    // The crash: `Materials` pressed while the room is on Overview.
    const screen = mountScreen({ studySetId: 'set-1' }, 'overview');
    screen.press('materials');
    expect(screen.section).toBe('materials');
    expect(screen.remembered).toBe('materials');
    // One commit to adopt, one to see there is nothing left to do.
    expect(screen.commits).toBe(2);
  });

  it('hears a SECOND press of the same door, and still stops', () => {
    const screen = mountScreen({ studySetId: 'set-1' }, 'overview');
    screen.press('materials');
    screen.press('materials');
    expect(screen.section).toBe('materials');
    expect(screen.scrolls).toBe(1);
    expect(screen.commits).toBe(1);
  });

  it('lets the screen`s own row move away, and stays settled', () => {
    // The case the publish half existed for: the params still say `materials`,
    // and nothing chases them back.
    const screen = mountScreen({ studySetId: 'set-1', segment: 'materials' }, 'overview');
    expect(screen.section).toBe('materials');
    screen.selectOnScreen('practice');
    expect(screen.section).toBe('practice');
    expect(screen.remembered).toBe('practice');
    expect(screen.commits).toBe(1);
  });

  it('re-opens the door after the row moved away', () => {
    const screen = mountScreen({ studySetId: 'set-1', segment: 'materials' }, 'overview');
    screen.selectOnScreen('practice');
    screen.press('materials');
    expect(screen.section).toBe('materials');
    expect(screen.commits).toBe(2);
  });
});

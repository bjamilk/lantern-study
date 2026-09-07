import { learnTailPadding } from './noteLearnScroll';

describe('learnTailPadding', () => {
  it('leaves a viewport of room below a short Learn panel', () => {
    // 800 tall scroller, a 200 tall panel: 600 of tail is what lets the
    // panel's heading travel all the way to the top.
    expect(learnTailPadding({ base: 100, viewportHeight: 800, panelHeight: 200 })).toBe(600);
  });

  it('never returns less than the chrome clearance it was given', () => {
    // A panel taller than the screen can already scroll its own heading up, so
    // the only requirement left is that the last card clears the two bars.
    expect(learnTailPadding({ base: 120, viewportHeight: 800, panelHeight: 900 })).toBe(120);
    expect(learnTailPadding({ base: 120, viewportHeight: 800, panelHeight: 700 })).toBe(120);
  });

  it('is exactly the clearance until both measurements have arrived', () => {
    // The first frames, and the view-only note where no panel is rendered at
    // all: never a screen's worth of empty space under the note.
    expect(learnTailPadding({ base: 96, viewportHeight: 0, panelHeight: 0 })).toBe(96);
    expect(learnTailPadding({ base: 96, viewportHeight: 800, panelHeight: 0 })).toBe(96);
    expect(learnTailPadding({ base: 96, viewportHeight: 0, panelHeight: 200 })).toBe(96);
  });

  it('treats a non-finite or negative measurement as no measurement', () => {
    expect(learnTailPadding({ base: 96, viewportHeight: NaN, panelHeight: 200 })).toBe(96);
    expect(learnTailPadding({ base: -5, viewportHeight: 800, panelHeight: 200 })).toBe(600);
    expect(learnTailPadding({ base: 96, viewportHeight: 800, panelHeight: -200 })).toBe(96);
  });
});

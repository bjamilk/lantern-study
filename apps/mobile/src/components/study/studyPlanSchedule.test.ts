/**
 * `View schedule` in the Study plan Details sheet must open the CALENDAR.
 *
 * The panel (`StudyPlanPanel.tsx`) is deliberately dumb: its footer button only
 * calls the `onViewSchedule` prop, so the destination is decided by the screen
 * that renders it. That split is what let a device pass report the button
 * "landing on the plan setup screen" — there is no route assertion anywhere
 * between the button and the navigator, so a wrong target would ship green.
 *
 * This is a source-text guard rather than a render test because the handler is
 * an inline arrow inside a screen that pulls in the whole study data layer;
 * mounting it to observe one `navigation.navigate` costs far more than it
 * proves. What matters is the mapping, and the mapping is readable.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');
const courseRoom = readFileSync(join(SRC, 'screens', 'study', 'CourseRoomScreen.tsx'), 'utf8');
const navTypes = readFileSync(join(SRC, 'navigation', 'types.ts'), 'utf8');
const navigator = readFileSync(join(SRC, 'navigation', 'RootNavigator.tsx'), 'utf8');
const panel = readFileSync(join(__dirname, 'StudyPlanPanel.tsx'), 'utf8');

/** The `onViewSchedule={...}` prop value as written on the screen. */
function viewScheduleHandler(): string {
  const start = courseRoom.indexOf('onViewSchedule={() =>');
  expect(start).toBeGreaterThan(-1);
  // Up to the next prop on the same JSX element is plenty for a navigate call.
  return courseRoom.slice(start, start + 400);
}

describe('View schedule target', () => {
  it('is the calendar route, not the plan setup screen', () => {
    const handler = viewScheduleHandler();
    expect(handler).toContain("navigation.navigate('StudyCalendar'");
    // The setup/outline routes are the wrong destinations this guards against.
    expect(handler).not.toContain("navigate('StudySetup'");
    expect(handler).not.toContain("manageOutlineCourseId");
  });

  it('carries the set and course so the calendar resolves the right exam date', () => {
    const handler = viewScheduleHandler();
    expect(handler).toContain('studySetId');
    expect(handler).toContain('courseId');
  });

  it('keeps the panel itself free of navigation, so this mapping is the only one', () => {
    expect(panel).toContain('onViewSchedule');
    expect(panel).not.toContain('navigation.navigate');
  });

  it('routes to a screen the navigator actually registers', () => {
    expect(navTypes).toContain('StudyCalendar: {');
    expect(navigator).toContain('name="StudyCalendar"');
  });
});

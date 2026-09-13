/**
 * A set with nothing in it must still reach its own schedule.
 *
 * `View schedule` lives in one place only: the Study plan `Details` sheet. Two
 * separate gates used to hide that sheet from a brand-new set — the panel
 * returned `null` when its model was empty, and the screen returned the setup
 * cards INSTEAD of the panel rather than alongside it. Between them, the set
 * whose owner is most likely to be planning was the one set that could not open
 * the calendar (device pass SF3, check 2).
 *
 * A source-text guard rather than a render test, for the reason
 * `studyPlanSchedule.test.ts` gives: the panel sits inside a screen that pulls
 * in the whole study data layer, and mounting it to observe one button costs
 * far more than it proves. What matters is that neither gate comes back, and
 * both gates are single, greppable lines.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');
const panel = readFileSync(join(__dirname, 'StudyPlanPanel.tsx'), 'utf8');
const courseRoom = readFileSync(join(SRC, 'screens', 'study', 'CourseRoomScreen.tsx'), 'utf8');

describe('the Details door on an empty set', () => {
  it('the panel no longer unmounts itself when the plan is empty', () => {
    expect(panel).not.toContain('if (model.empty) return null');
    // The empty case hides the spine and the bar, and nothing else.
    expect(panel).toContain('{model.empty ? null : (');
  });

  it('the panel still draws Details, and Details still opens the sheet', () => {
    expect(panel).toContain('Details');
    expect(panel).toContain('setDetailsOpen(true)');
    expect(panel).toContain('View schedule');
  });

  it('the sheet reads its counts off the model, so an empty set reads 0', () => {
    // `detailLabel` is `${topics} Topics · ${covered} Covered · …` — computed,
    // never hardcoded, so the empty panel says 0 rather than guessing.
    expect(panel).toContain('{model.detailLabel}');
  });

  it('the screen renders the panel for an empty set instead of only the setup cards', () => {
    const start = courseRoom.indexOf('if (empty) {');
    expect(start).toBeGreaterThan(-1);
    const branch = courseRoom.slice(start, start + 2000);
    // The old gate: setup cards or nothing.
    expect(branch).not.toContain('if (!showSetup) return null');
    expect(branch).toContain('if (!showSetup && !showPlan) return null');
    expect(branch).toContain('<StudyPlanPanel');
    expect(branch).toContain('onViewSchedule={onViewSchedule}');
  });
});

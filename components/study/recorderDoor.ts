/**
 * The Record door's one piece of logic, on web.
 *
 * Recording has no screen of its own — a lecture is recorded INTO a note — so
 * the Study hub tile and the Home tile both create a note and open the editor
 * with its recorder in reach. The title has to be recognisable in a notes list
 * a week later, which means a date.
 *
 * The format mirrors mobile's `apps/mobile/src/screens/study/recorderDoor.ts`
 * exactly ("Lecture — 6 Sep"), so the same student meets the same note on both
 * platforms; it is duplicated rather than imported because the mobile helper
 * lives in the mobile app, not in `packages/shared`. If it ever moves to
 * shared, both should import it from there and this file should go.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** e.g. "Lecture — 6 Sep". `now` is injectable so the test is not date-bound. */
export function newLectureNoteTitle(now: Date = new Date()): string {
  return `Lecture — ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

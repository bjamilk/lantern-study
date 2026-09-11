/**
 * How long a lecture has actually been recording.
 *
 * The arithmetic lives in `@lantern/shared` so the studio timer and this
 * banner cannot drift. This file stays so existing imports keep working.
 */

export {
  elapsedRecordingMs,
  elapsedRecordingSeconds,
  pausedTotalAfterResume,
  type RecordingClock,
} from '@lantern/shared/learning';

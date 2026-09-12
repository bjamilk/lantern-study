/**
 * What the lecture studio shows before it shows anything else.
 *
 * On build 193 every lecture opened from the Library or a set room landed on
 * the consent screen — "I can record this lecture." with a Start button — and
 * the whole reading surface, tab row included, sat in the branch that screen
 * replaced. A lecture with enhanced notes on it was therefore unreachable on
 * Android. This is the one decision that branch now asks, kept pure so it can
 * be tested without mounting the recorder.
 */
import { showLectureConsentGate, type LectureTabSource } from '@lantern/shared/learning/lectureStudio';

export interface LectureStudioViewInput {
  source: LectureTabSource;
  /** The student ticked the consent box in this session. */
  consented: boolean;
  /** The recorder store's status. Anything but `idle` means a take is in flight. */
  status: string;
}

export interface LectureStudioView {
  /** The full-screen consent door: only for a lecture with nothing to read. */
  showConsent: boolean;
  /** The tab row and the panes behind it. */
  showTabs: boolean;
  /** The slim consent bar above the tabs, so recording is still one tap away. */
  showConsentBar: boolean;
}

export function lectureStudioView(input: LectureStudioViewInput): LectureStudioView {
  const idle = input.status === 'idle';
  const showConsent = showLectureConsentGate({
    source: input.source,
    consented: input.consented,
    idle,
  });
  return {
    showConsent,
    showTabs: !showConsent,
    showConsentBar: !showConsent && !input.consented && idle,
  };
}

/**
 * A take owns the pane.
 *
 * While the recorder is running the student is typing into My Notes, so every
 * other lecture tab is unselectable — flipping a class typist onto a read-only
 * surface mid-sentence is how a sentence gets lost. Pure and import-free so
 * mobile's node-environment jest can hold the rule directly.
 */
import type { LectureTabId } from '@lantern/shared';

export function isLectureTabLocked(tab: LectureTabId, recording: boolean): boolean {
  return recording === true && tab !== 'notes';
}

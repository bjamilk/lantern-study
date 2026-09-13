import { Share } from 'react-native';
// The `/study` SUBPATH, not the bare package: this package's jest maps
// `@lantern/shared/*` to the shared source but has no mapping for the bare
// specifier, so a bare import here compiles and then fails to resolve under
// test. `@lantern/shared/design` is imported the same way for the same reason.
import { buildStudySetShareLink, type StudySetShareInput } from '@lantern/shared/study';

/**
 * "Share" on mobile: the OS share sheet, carrying the set's link and the same
 * honest caveat the web toast shows.
 *
 * `Share` from react-native — no new dependency; the community post screen
 * already shares this way. The sentences come from `@lantern/shared`'s
 * `shareLink` so the two clients cannot drift: mobile's settings screen used
 * to tell students "Anyone with the link can open this set", which is false
 * (the set's SELECT policy is owner-only and `visibility` is never read).
 */

export type ShareStudySetInput = Omit<StudySetShareInput, 'origin'>;

export interface ShareStudySetResult {
  /** What was offered to the sheet, so a caller can assert on it. */
  url: string;
  /** False when the student dismissed the sheet or it could not open. */
  shared: boolean;
}

/**
 * Opens the share sheet. Never throws: a dismissed sheet and a sheet that
 * cannot open are both "nothing happened", not an error the student should be
 * shown a red banner for.
 */
export async function shareStudySet(input: ShareStudySetInput): Promise<ShareStudySetResult> {
  // No `origin`: a phone has no `window.location`, and the link has to be the
  // public web one anyway — a `lanternstudy://` deep link pasted into a chat
  // is unopenable by anyone without the app.
  const share = buildStudySetShareLink({ ...input, origin: null });
  try {
    const result = await Share.share({ message: share.message, title: share.title });
    return { url: share.url, shared: result.action === Share.sharedAction };
  } catch {
    return { url: share.url, shared: false };
  }
}

export default shareStudySet;

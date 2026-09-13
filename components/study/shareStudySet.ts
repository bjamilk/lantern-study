import { buildStudySetShareLink, type StudySetShareInput } from '@lantern/shared';
import { useToastStore } from '../../stores/toastStore';

/**
 * "Share" on web: copy the set's link, then say honestly what that link does.
 *
 * The sentences are NOT written here — `@lantern/shared`'s `shareLink` owns
 * them so the mobile share sheet cannot promise something the web toast does
 * not (it used to: mobile said "Anyone with the link can open this set", which
 * is false — see that module's comment). This file is only the side effects.
 */

export type ShareStudySetInput = Omit<StudySetShareInput, 'origin'>;

/**
 * Clipboard with a fallback, because `navigator.clipboard` is undefined in any
 * non-secure context and rejects when the document is not focused. Returning a
 * boolean rather than throwing lets the caller degrade to showing the URL,
 * which is still a link the student can select by hand.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path rather than failing the whole action.
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    // Off-screen, not `display:none` — a hidden field cannot be selected.
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copies the link and toasts. Safe to call from a menu item or a button; it
 * never throws, because a failed copy is a message, not an error state.
 */
export async function shareStudySet(input: ShareStudySetInput): Promise<void> {
  const share = buildStudySetShareLink({
    ...input,
    origin: typeof window === 'undefined' ? null : window.location.origin,
  });
  const { showToast } = useToastStore.getState();
  const copied = await copyText(share.url);
  if (copied) {
    showToast(share.toast, 'success');
    return;
  }
  // No clipboard: show the link itself so the action still ends with the
  // student holding the URL, rather than with a house error.
  showToast(share.url, 'info');
}

export default shareStudySet;

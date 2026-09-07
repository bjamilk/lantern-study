/**
 * The invite LINK for a community, and what the student is told after tapping
 * "Copy invite link".
 *
 * Build 172 defect: the kebab item said "Copy invite link" and called
 * `Share.share`. Dismissing the share sheet — which is what happens when a
 * student expects a copy and gets a chooser — left the Android clipboard
 * empty, with nothing on screen to say so. The link had never been near the
 * clipboard.
 *
 * So the copy is written HERE, in node-testable form, and the screen only
 * renders it:
 *
 *   - the link is built from the community SLUG (the public URL the web app
 *     serves at `/discover/c/<slug>`), never from an id;
 *   - a copy that fails says so AND carries the link inline, because a toast
 *     saying only "could not copy" leaves the student with no way to get it;
 *   - a community with no slug yields no link at all, rather than a plausible
 *     URL that 404s for whoever opens it.
 */
import { communityShareUrl } from '@lantern/shared/network';

/**
 * The public invite link, or `null` when there is no slug to build one from.
 * `communityShareUrl` is the SHARED builder web uses for the same URL — this
 * only guards the empty case it cannot see.
 */
export function communityInviteLink(slug: string | null | undefined): string | null {
  const trimmed = typeof slug === 'string' ? slug.trim() : '';
  if (!trimmed) return null;
  return communityShareUrl(trimmed);
}

export interface InviteCopyOutcome {
  message: string;
  tone: 'success' | 'error';
}

/** What the toast says once the clipboard write has settled. */
export function inviteCopyOutcome(copied: boolean, link: string): InviteCopyOutcome {
  return copied
    ? { message: 'Link copied', tone: 'success' }
    : { message: `Could not copy — here is the link: ${link}`, tone: 'error' };
}

/** Shown when the community has no slug, so no link exists to copy. */
export const INVITE_LINK_UNAVAILABLE = 'This community has no invite link yet.';

/** The kebab item that opens the share sheet, beside the one that copies. */
export const INVITE_SHARE_LABEL = 'Share invite link';

/** The read-only line on Manage that shows a founder the slug their link uses. */
export function communitySlugLine(slug: string | null | undefined): string {
  const trimmed = typeof slug === 'string' ? slug.trim() : '';
  return trimmed ? `Invite link: ${communityShareUrl(trimmed)}` : INVITE_LINK_UNAVAILABLE;
}

/**
 * The manage screen copies an invite CODE, not a link, and used to toast
 * "Copied" whether or not the write landed. Same rule as the link: say it
 * failed, and carry the thing that was meant to be copied.
 */
export function inviteCodeCopyFailure(code: string): string {
  return `Could not copy — here is the code: ${code}`;
}

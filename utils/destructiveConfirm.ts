/**
 * Confirm copy for destructive web actions.
 *
 * The rule this enforces: a web flow that destroys or irreversibly changes the
 * user's data must ask first, through the in-app confirm primitive
 * (`confirmDialog`) — never the browser's native `confirm()` chrome — and the
 * prompt must NAME the specific thing at stake and say what happens. Several
 * screens shipped a bare `confirm()` (or, worse, an unconfirmed ✕) for deleting
 * a savings goal, deleting a listing, or withdrawing a job application; this
 * planner is the single place their copy and danger styling are decided, so the
 * rule can be tested and cannot silently regress per-screen.
 *
 * Every planner returns `danger: true` for a truly destructive/irreversible
 * action. Unblocking is reversible (you can block again), so it is a plain
 * confirm — still in-app, but not styled as danger.
 */

export interface ConfirmCopy {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

/** Format a naira amount the same way the budget screens do. */
function naira(amount: number): string {
  return `₦${Math.max(0, Math.round(amount)).toLocaleString('en-NG')}`;
}

/** Fall back to a generic noun when a title is missing, never to an empty gap. */
function orGeneric(title: string | null | undefined, generic: string): string {
  const trimmed = title?.trim();
  return trimmed ? `"${trimmed}"` : generic;
}

/**
 * Delete a savings goal. The money saved toward it returns to the wallet, but
 * the goal and its progress are gone — so the prompt names the goal and states
 * both effects.
 */
export function planDeleteSavingsGoalConfirm(goal: {
  name?: string | null;
  currentAmount?: number | null;
}): ConfirmCopy {
  const label = orGeneric(goal.name, 'this savings goal');
  const saved = goal.currentAmount && goal.currentAmount > 0
    ? ` The ${naira(goal.currentAmount)} saved toward it returns to your wallet.`
    : '';
  return {
    title: 'Delete savings goal?',
    message: `Delete ${label}? The goal and its progress are removed and this cannot be undone.${saved}`,
    confirmLabel: 'Delete goal',
    cancelLabel: 'Keep goal',
    danger: true,
  };
}

/** Delete a marketplace listing — permanent. */
export function planDeleteListingConfirm(listing: {
  title?: string | null;
}): ConfirmCopy {
  const label = orGeneric(listing.title, 'this listing');
  return {
    title: 'Delete listing?',
    message: `Delete ${label}? It is removed from the marketplace and this cannot be undone.`,
    confirmLabel: 'Delete listing',
    cancelLabel: 'Keep listing',
    danger: true,
  };
}

/** Withdraw a job application — permanent, and blocks re-applying. */
export function planWithdrawApplicationConfirm(job: {
  title?: string | null;
}): ConfirmCopy {
  const label = orGeneric(job.title, 'this application');
  const suffix = job.title?.trim() ? ' application' : '';
  return {
    title: 'Withdraw application?',
    message: `Withdraw ${label}${suffix}? This cannot be undone and you will not be able to re-apply to this job.`,
    confirmLabel: 'Withdraw',
    cancelLabel: 'Keep application',
    danger: true,
  };
}

/** Unblock a user — reversible, so a plain (non-danger) confirm. */
export function planUnblockUserConfirm(user: {
  name?: string | null;
}): ConfirmCopy {
  const name = user.name?.trim() || 'this person';
  return {
    title: 'Unblock user?',
    message: `Unblock ${name}? They will be able to message you again.`,
    confirmLabel: 'Unblock',
    cancelLabel: 'Cancel',
    danger: false,
  };
}

/**
 * Permanently delete a group and every sub-group under it. Irreversible. The
 * scores already earned stay in the student's own history; they simply stop
 * rolling up under Group performance once the group is gone.
 */
export function planDeleteGroupConfirm(group: {
  name?: string | null;
}): ConfirmCopy {
  const label = orGeneric(group.name, 'this group');
  return {
    title: 'Delete group?',
    message: `Delete ${label} and all of its sub-groups? This cannot be undone. Past test scores stay in your history, but they will no longer appear under Group performance.`,
    confirmLabel: 'Delete group',
    cancelLabel: 'Keep group',
    danger: true,
  };
}

/**
 * Delete a downloaded (offline) test bundle. This removes only the local copy —
 * you can download it again while online — so it is a plain confirm, not danger.
 */
export function planDeleteOfflineBundleConfirm(bundle: {
  name?: string | null;
}): ConfirmCopy {
  const label = orGeneric(bundle.name, 'this download');
  return {
    title: 'Delete download?',
    message: `Delete the downloaded bundle ${label}? You can download it again while you're online.`,
    confirmLabel: 'Delete download',
    cancelLabel: 'Keep download',
    danger: false,
  };
}

/**
 * Revoke a pending group invitation (by email or phone). Reversible — you can
 * invite the person again — so it is a plain confirm.
 */
export function planRevokeInvitationConfirm(invite: {
  invitee?: string | null;
}): ConfirmCopy {
  const who = invite.invitee?.trim() || 'this person';
  return {
    title: 'Revoke invitation?',
    message: `Revoke the invitation for ${who}? They will not be able to join with it, but you can invite them again later.`,
    confirmLabel: 'Revoke',
    cancelLabel: 'Keep invitation',
    danger: false,
  };
}

/**
 * Discard the session already open in the runner so a new one can start. Its
 * progress is never recorded, so this is a danger confirm.
 */
export function planDiscardActiveSessionConfirm(): ConfirmCopy {
  return {
    title: 'Discard active session?',
    message: 'You already have a session open. Starting a new one discards it — its progress will not be recorded and this cannot be undone.',
    confirmLabel: 'Discard & start new',
    cancelLabel: 'Keep session',
    danger: true,
  };
}

/**
 * Cancel the session in progress. Progress is lost and nothing is recorded.
 */
export function planCancelSessionConfirm(): ConfirmCopy {
  return {
    title: 'Cancel session?',
    message: 'Cancel this session? Your progress will be lost, nothing is recorded, and this cannot be undone.',
    confirmLabel: 'Cancel session',
    cancelLabel: 'Keep going',
    danger: true,
  };
}

/**
 * Discard a saved (paused) session from the list. Its progress is never
 * recorded.
 */
export function planDiscardSavedSessionConfirm(): ConfirmCopy {
  return {
    title: 'Discard saved session?',
    message: 'Discard this saved session? Its progress will not be recorded and this cannot be undone.',
    confirmLabel: 'Discard session',
    cancelLabel: 'Keep session',
    danger: true,
  };
}

/**
 * Reset every setting to its default. Study data (questions, results, cards) is
 * untouched, but the current preferences are replaced and cannot be restored.
 */
export function planResetSettingsConfirm(): ConfirmCopy {
  return {
    title: 'Reset all settings?',
    message: 'Reset all settings to their defaults? This replaces your current preferences and cannot be undone. Your study data will not be affected.',
    confirmLabel: 'Reset settings',
    cancelLabel: 'Keep settings',
    danger: true,
  };
}

/**
 * Start playing a duel the opponent just accepted. Nothing is destroyed — the
 * only alternative is opening the challenges list to start later — so this is a
 * plain (non-danger) confirm. Names the opponent so the prompt says who.
 */
export function planStartDuelConfirm(duel: {
  opponentName?: string | null;
}): ConfirmCopy {
  const who = duel.opponentName?.trim() || 'Your opponent';
  return {
    title: 'Start the duel?',
    message: `${who} accepted your duel. Start playing now?`,
    confirmLabel: 'Start playing',
    cancelLabel: 'Later',
    danger: false,
  };
}

/**
 * Accept a group invite and join the chat. Joining is reversible — you can
 * leave the group afterwards — so this is a plain (non-danger) confirm.
 */
export function planAcceptGroupInviteConfirm(): ConfirmCopy {
  return {
    title: 'Join this group?',
    message: 'Accept this invite and join the group chat?',
    confirmLabel: 'Join group',
    cancelLabel: 'Not now',
    danger: false,
  };
}

/**
 * Decline a group invite. Declining consumes the invite on the server — it is
 * removed and cannot be used to join later — so, unlike revoking your own
 * outgoing invitation, this is a destructive (danger) confirm.
 */
export function planDeclineGroupInviteConfirm(): ConfirmCopy {
  return {
    title: 'Decline invite?',
    message: 'Decline this group invite? It is removed and you will not be able to use it to join later.',
    confirmLabel: 'Decline invite',
    cancelLabel: 'Keep invite',
    danger: true,
  };
}

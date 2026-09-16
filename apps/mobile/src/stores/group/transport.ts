// ===========================================
// Lantern Study Mobile - Group store: transport
// ===========================================
//
// Purpose: every call the chat surfaces make to the outside world. Thin
// wrappers over `services/api` plus the two chat-specific retry policies, so
// the store never reaches the network directly and a reviewer can read the
// whole request surface of chat in one file.
//
// Touches: `services/api` only, and `withTransientRetry` from
// @lantern/shared/utils for the two list fetches that carry it. No state, no
// mapping, no AsyncStorage.
//
// Gotchas:
// - These are PASS-THROUGH wrappers: the argument lists and return values are
//   the API client's, unchanged, and none of them map a row. Adding a default
//   or a `.catch()` here would hide a failure the store is expected to
//   classify (`listError` vs `error`, queueable vs rejected).
// - Only `fetchDmThreads` and `fetchDirectMessages` retry, with the same
//   400 ms delay they had inline. Nothing else gained a retry in the move: a
//   send must not retry here, because the outbox owns that decision.
// - `sendGroupMessage` / `sendDirectMessage` are used by BOTH the optimistic
//   send and the outbox flush; they must stay a single definition, or a queued
//   send and a live send can drift apart.
//
// Moved verbatim out of `stores/groupStore.ts` (lane M2).

import { withTransientRetry } from '@lantern/shared/utils';
import * as api from '../../services/api';

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** @internal */
export const fetchGroups: typeof api.fetchGroups = (...args) => api.fetchGroups(...args);
/** @internal */
export const fetchGroup: typeof api.fetchGroup = (...args) => api.fetchGroup(...args);
/** @internal */
export const createGroup: typeof api.createGroup = (...args) => api.createGroup(...args);
/** @internal */
export const updateGroup: typeof api.updateGroup = (...args) => api.updateGroup(...args);
/** @internal */
export const deleteGroup: typeof api.deleteGroup = (...args) => api.deleteGroup(...args);
/** @internal */
export const leaveGroup: typeof api.leaveGroup = (...args) => api.leaveGroup(...args);
/** @internal */
export const uploadGroupAvatar: typeof api.uploadGroupAvatar = (...args) =>
  api.uploadGroupAvatar(...args);

// ---------------------------------------------------------------------------
// Members and roles
// ---------------------------------------------------------------------------

/** @internal */
export const fetchGroupMembers: typeof api.fetchGroupMembers = (...args) =>
  api.fetchGroupMembers(...args);
/** @internal */
export const promoteGroupAdmin: typeof api.promoteGroupAdmin = (...args) =>
  api.promoteGroupAdmin(...args);
/** @internal */
export const demoteGroupAdmin: typeof api.demoteGroupAdmin = (...args) =>
  api.demoteGroupAdmin(...args);
/** @internal */
export const removeGroupMember: typeof api.removeGroupMember = (...args) =>
  api.removeGroupMember(...args);

// ---------------------------------------------------------------------------
// Group messages
// ---------------------------------------------------------------------------

/** @internal */
export const fetchMessages: typeof api.fetchMessages = (...args) => api.fetchMessages(...args);
/** @internal */
export const fetchGroupThread: typeof api.fetchGroupThread = (...args) =>
  api.fetchGroupThread(...args);
/**
 * The one group send. Both the optimistic path and the outbox flush call it.
 * @internal
 */
export const sendGroupMessage: typeof api.sendMessage = (...args) => api.sendMessage(...args);
/** @internal */
export const editGroupMessage: typeof api.editGroupMessage = (...args) =>
  api.editGroupMessage(...args);
/** @internal */
export const removeGroupMessage: typeof api.removeGroupMessage = (...args) =>
  api.removeGroupMessage(...args);
/** @internal */
export const updateMessage: typeof api.updateMessage = (...args) => api.updateMessage(...args);
/** @internal */
export const fetchGroupUnreadCounts: typeof api.fetchGroupUnreadCounts = (...args) =>
  api.fetchGroupUnreadCounts(...args);
/** @internal */
export const markGroupAsRead: typeof api.markGroupAsRead = (...args) =>
  api.markGroupAsRead(...args);

// ---------------------------------------------------------------------------
// Questions and votes
// ---------------------------------------------------------------------------

/** @internal */
export const updateQuestionStatus: typeof api.updateQuestionStatus = (...args) =>
  api.updateQuestionStatus(...args);
/** @internal */
export const fetchUserVotesForGroup: typeof api.fetchUserVotesForGroup = (...args) =>
  api.fetchUserVotesForGroup(...args);
/** @internal */
export const voteOnMessage: typeof api.voteOnMessage = (...args) => api.voteOnMessage(...args);
/** @internal */
export const removeVote: typeof api.removeVote = (...args) => api.removeVote(...args);

// ---------------------------------------------------------------------------
// Direct messages
// ---------------------------------------------------------------------------

/**
 * Retried, as it was inline: the inbox is the first thing a cold launch shows
 * and a single dropped packet rendered it as an empty account.
 * @internal
 */
export const fetchDMThreads = (userId: string) =>
  withTransientRetry(() => api.fetchDMThreads(userId), { delayMs: 400 });
/** @internal */
export const fetchDmThread: typeof api.fetchDmThread = (...args) => api.fetchDmThread(...args);
/** Retried, as it was inline. @internal */
export const fetchDirectMessages = (userId: string, otherUserId: string) =>
  withTransientRetry(() => api.fetchDirectMessages(userId, otherUserId), { delayMs: 400 });
/**
 * The one DM send. Both the optimistic path and the outbox flush call it.
 * @internal
 */
export const sendDirectMessage: typeof api.sendDirectMessage = (...args) =>
  api.sendDirectMessage(...args);
/** @internal */
export const editDirectMessage: typeof api.editDirectMessage = (...args) =>
  api.editDirectMessage(...args);
/** @internal */
export const removeDirectMessage: typeof api.removeDirectMessage = (...args) =>
  api.removeDirectMessage(...args);
/** @internal */
export const fetchDMUnreadCounts: typeof api.fetchDMUnreadCounts = (...args) =>
  api.fetchDMUnreadCounts(...args);
/** @internal */
export const markDMAsRead: typeof api.markDMAsRead = (...args) => api.markDMAsRead(...args);
/** @internal */
export const archiveDmThread: typeof api.archiveDmThread = (...args) =>
  api.archiveDmThread(...args);
/** @internal */
export const unarchiveDmThread: typeof api.unarchiveDmThread = (...args) =>
  api.unarchiveDmThread(...args);
/** @internal */
export const deleteDmThread: typeof api.deleteDmThread = (...args) => api.deleteDmThread(...args);

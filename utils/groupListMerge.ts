/**
 * Folding a freshly fetched group list into the one already on screen (web).
 *
 * Exports: `mergeFetchedGroups`.
 *
 * Touches: nothing — pure. The row → `Group` mapping itself is NOT here: it is
 * `mapGroupRow` in `@lantern/shared/groups`, the same mapper the API server and
 * mobile run (refactor R2). This module owns only the merge rule.
 *
 * Gotchas:
 *  - The list endpoint does not return rosters, pending members or invited
 *    phone numbers, so those must be carried over from the previous state or a
 *    refresh blanks an @mention roster.
 *  - Anything the server omits falls back to the group we already had. The two
 *    inline copies this replaced disagreed about that: the membership-change
 *    copy carried `courseId`/`visibility`/`communityId` over (added after a
 *    refresh emptied the community column right after joining a channel), the
 *    bootstrap copy did not, and NEITHER carried `communitySurface` — so every
 *    refresh silently re-rendered a community study group as a board.
 *  - The fallback is "anything the server OMITS", never "anything falsy". The
 *    API sends `community_id` / `community_surface` / `course_id` as literal
 *    `null`, so `mapGroupRow` resolves the fallback by key presence
 *    (`resolveNullable`); a student who detaches a group from its community
 *    would otherwise see it resurrected by the very next refresh.
 *  - `unreadCount` comes from the freshly fetched map only. A stale count on
 *    the row, or the previous state's count, would both be wrong here.
 */

import { mapGroupRow } from '@lantern/shared/groups';
import type { Group } from '../types';

/** Local-only fields the web `Group` carries that the API never returns. */
type MergeableGroup = Group & { pendingMembers?: unknown[] };

export function mergeFetchedGroups(
  fetched: any[] | null | undefined,
  previous: readonly Group[],
  unreadCounts: Record<string, number> = {},
): Group[] {
  const prevById = new Map((previous || []).map((g) => [g.id, g as MergeableGroup]));

  return (fetched || []).map((row: any) => {
    const existing = prevById.get(row.id);
    const mapped = mapGroupRow(row, {
      unreadCounts,
      fallback: existing
        ? {
            adminIds: existing.adminIds,
            permissions: existing.permissions,
            courseId: existing.courseId,
            visibility: existing.visibility,
            communityId: existing.communityId,
            communitySurface: existing.communitySurface,
            memberCount: existing.memberCount,
          }
        : undefined,
    });

    return {
      ...mapped,
      questionCount: mapped.questionCount ?? existing?.questionCount,
      tags: mapped.tags ?? existing?.tags,
      // Same rule as `members`: the list endpoint omits these, so a refresh
      // would otherwise blank an @mention roster's email index and the
      // moderator badges. `??` is safe here — the mapper returns `undefined`
      // only when the key was absent.
      memberEmails: mapped.memberEmails ?? existing?.memberEmails,
      moderatorIds: mapped.moderatorIds ?? existing?.moderatorIds,
      unreadCount: unreadCounts[row.id] || 0,
      pendingMembers: existing?.pendingMembers || [],
      invitedPhoneNumbers: existing?.invitedPhoneNumbers || [],
      // Keep loaded member rosters so @mentions keep working.
      members: existing?.members?.length ? existing.members : [],
    } as Group;
  });
}

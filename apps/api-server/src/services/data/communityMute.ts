/**
 * data/communityMute.ts — the one guard every write into a community passes.
 *
 * ## Purpose
 *
 * `assertNotMutedInCommunity` moved verbatim out of `services/supabase.ts`
 * module scope (monolith lane M1d, step 15) because it has TWO callers in
 * different sections: `createBoardRepost` (now `data/boardActions.ts`) and
 * `sendMessage` (still in the monolith's CHAT INTERNALS section, which lane
 * M1d step 17 moves). A module of its own keeps one copy and keeps both
 * importers leaves.
 *
 * ## What it touches
 *
 * Tables: `community_members` (a single `muted_until` read), and only once the
 * `communityMemberMute` capability says migration 20260908120000 is applied.
 *
 * ## The gotcha — it is deliberately NOT injectable
 *
 * This is a plain module function, not a method and not a `deps` entry. The
 * board test harnesses drive the write paths by calling
 * `SupabaseService.prototype.<m>.call(self, …)` on a bare object, and a check
 * a harness can forget to stub is a check that is silently missing from the
 * test. Keeping it a static import is what makes
 * `supabase.communityMute.test.ts` able to prove the guard runs at all — that
 * suite has no way to stub it, so the only way it can observe the 403 is if
 * the real thing executed.
 */
import {
  COMMUNITY_MODERATION_COPY,
  isCommunityMemberMuted,
} from "@lantern/shared/network";

import {
  hasCommunityMemberMute,
  isMissingColumnError,
  markCommunityMemberMuteMissing,
} from "../schemaCapabilities";

/**
 * A live community mute (20260908120000) blocks EVERY write into that
 * community — a board post, a board comment, a repost, the lounge and every
 * text channel — because all of them arrive at `sendMessage` /
 * `createBoardRepost` with a `communityId` from `resolveBoardContext`.
 * Reading is never blocked. Zero queries while the migration is unapplied,
 * one membership read after it.
 *
 * A module-level function, not a method: the board test harnesses call the
 * prototype on a bare object, and a check that a harness can forget to stub
 * is a check that is silently missing in the test.
 *
 * Throws a 403 with the same copy both clients show on a disabled composer,
 * so a stale client that still lets a muted member type gets the same
 * sentence the fresh one shows up front.
 */
export async function assertNotMutedInCommunity(
  db: unknown,
  userId: string,
  communityId: string | null,
): Promise<void> {
  if (!communityId) return;
  if (!(await hasCommunityMemberMute(db))) return;
  const { data, error } = await (db as any)
    .from("community_members")
    .select("muted_until")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .is("opted_out_at", null)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) {
      markCommunityMemberMuteMissing();
      return;
    }
    throw error;
  }
  const mutedUntil =
    (data as { muted_until?: string | null } | null)?.muted_until ?? null;
  if (isCommunityMemberMuted(mutedUntil)) {
    throw Object.assign(new Error(COMMUNITY_MODERATION_COPY.mutedTitle), {
      statusCode: 403,
    });
  }
}

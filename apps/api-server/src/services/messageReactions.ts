/**
 * The reaction WRITE path — group messages and DMs, favorite included.
 *
 * Why this lives outside `SupabaseService.addMessageReaction`
 * ----------------------------------------------------------
 * The shipped write was a PostgREST upsert:
 *
 *   .upsert({ group_message_id, user_id, emoji },
 *           { onConflict: 'group_message_id,user_id,emoji', ignoreDuplicates: true })
 *
 * which PostgREST turns into `INSERT ... ON CONFLICT (group_message_id,
 * user_id, emoji) DO NOTHING`. `20260830120000` never gives those columns a
 * unique CONSTRAINT — it gives them a PARTIAL unique index:
 *
 *   CREATE UNIQUE INDEX uq_message_reactions_group
 *     ON message_reactions (group_message_id, user_id, emoji)
 *     WHERE group_message_id IS NOT NULL;
 *
 * Postgres will only infer a partial index for `ON CONFLICT` when the
 * statement repeats the index predicate (`ON CONFLICT (...) WHERE ...`), and
 * PostgREST has no way to send one. So every single reaction write raised
 * 42P10 `there is no unique or exclusion constraint matching the ON CONFLICT
 * specification`, which nothing caught, so the global handler answered 500
 * "Something went wrong" — the exact toast a student saw when they tapped
 * Favorite on a board post. Bookmark on the same row kept working because
 * `message_bookmarks` has a real `PRIMARY KEY (user_id, message_id)`, and the
 * same upsert against a real constraint is fine.
 *
 * The fix is a plain INSERT with the duplicate treated as success. A second
 * tap of the same emoji by the same person is a no-op either way, and the
 * partial unique index is still what enforces that — 23505 is the index doing
 * its job, not a failure. This needs no migration, which matters: the founder
 * hand-applies those and the API always deploys first.
 */
import type { DataLayer } from './data';

export type ReactionScope = 'group' | 'dm';

/**
 * Shown verbatim by both clients. A reaction that cannot be written has to say
 * so in words a student can act on ("Try again"), because the generic 500 copy
 * told them nothing and read like the whole screen had broken.
 */
export const REACTION_SAVE_FAILED = "Couldn't save your reaction. Try again.";
export const REACTION_REMOVE_FAILED = "Couldn't remove your reaction. Try again.";
/** Before `20260830120000` is applied the control degrades, it does not break. */
export const REACTIONS_UNAVAILABLE = 'Reactions are not available yet';

/** The parent column for a scope. One table serves both message kinds. */
export function reactionParentColumn(scope: ReactionScope): string {
  return scope === 'dm' ? 'dm_message_id' : 'group_message_id';
}

/** `message_reactions` (or `messages.reactions`) is not applied yet. */
export function isMissingReactionSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === 'PGRST205' || code === '42703';
}

/**
 * The partial unique index refusing a second identical reaction. That is the
 * desired end state, not an error: the row the caller wanted already exists.
 */
export function isDuplicateReaction(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/** An error the route turns into a status code plus client-safe copy. */
export class ReactionWriteError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ReactionWriteError';
    this.statusCode = statusCode;
  }
}

/**
 * Add one reaction and return the authoritative counts.
 *
 * Idempotent by design: the caller may tap twice, and an offline retry may
 * deliver the same write twice, so a duplicate resolves to the same 200 with
 * the same counts rather than an error the client would have to special-case.
 *
 * Authorization is the caller's job (`getAuthorizedGroupMessage` /
 * `getAuthorizedDmMessage`) — this only writes.
 */
export async function addMessageReaction(
  layer: DataLayer,
  messageId: string,
  userId: string,
  emoji: string,
  scope: ReactionScope = 'group'
): Promise<{ reactions: Record<string, number> }> {
  const { error } = await layer
    .getClient()
    .from('message_reactions')
    .insert({ [reactionParentColumn(scope)]: messageId, user_id: userId, emoji });

  if (error && !isDuplicateReaction(error)) {
    if (isMissingReactionSchema(error)) {
      throw new ReactionWriteError(REACTIONS_UNAVAILABLE, 503);
    }
    throw new ReactionWriteError(REACTION_SAVE_FAILED, 500);
  }

  // The AFTER INSERT trigger has already recounted the parent, so this read is
  // the true map — including the duplicate case, where it is unchanged.
  return layer.groupMessages.readMessageReactions(messageId, scope);
}

/**
 * Remove one reaction and return the authoritative counts. Removing something
 * that is not there is a no-op, for the same reason the add is idempotent.
 */
export async function removeMessageReaction(
  layer: DataLayer,
  messageId: string,
  userId: string,
  emoji: string,
  scope: ReactionScope = 'group'
): Promise<{ reactions: Record<string, number> }> {
  const { error } = await layer
    .getClient()
    .from('message_reactions')
    .delete()
    .eq(reactionParentColumn(scope), messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji);

  if (error) {
    if (isMissingReactionSchema(error)) {
      throw new ReactionWriteError(REACTIONS_UNAVAILABLE, 503);
    }
    throw new ReactionWriteError(REACTION_REMOVE_FAILED, 500);
  }

  return layer.groupMessages.readMessageReactions(messageId, scope);
}

/**
 * Board action state (§6 Repost, §7 Bookmark) read off a raw API/realtime row.
 *
 * Lives in utils, away from the store, so the rule below can be tested without
 * the supabase client and the whole store graph.
 */

import type { BoardQuotedPost } from '@lantern/shared/network';

/** The shape `mapApiMessage` merges these into. Structural on purpose. */
export type BoardActionFields = {
  clientMessageId?: string;
  repostCount?: number;
  repostOf?: BoardQuotedPost | null;
  repostedByMe?: boolean;
  bookmarked?: boolean;
};

/**
 * Every key is OMITTED, not set to `undefined`, when the payload does not
 * carry it.
 *
 * That is load-bearing rather than tidy. `mergeGroupMessage` merges an
 * incoming realtime row with `{ ...prev, ...message }`, and an explicit
 * `undefined` WINS that spread. None of this state lives on the `messages`
 * row — `repostCount` and `repostOf` are computed per page and
 * `repostedByMe` / `bookmarked` per viewer — so a reaction UPDATE arriving
 * over the channel carries none of it. Setting the keys to `undefined` would
 * therefore blank the repost count and un-fill the bookmark icon on a card
 * that had both a moment earlier, every time anyone favorited anything.
 *
 * The same reasoning applies to a comment thread fetch, which returns rows the
 * board-page hydration never ran on.
 */
export function boardActionFields(row: unknown): BoardActionFields {
  const m = (row ?? {}) as Record<string, unknown>;
  const fields: BoardActionFields = {};
  const clientMessageId = m.clientMessageId ?? m.client_message_id;
  if (typeof clientMessageId === 'string' && clientMessageId) {
    fields.clientMessageId = clientMessageId;
  }
  if (typeof m.repostCount === 'number') fields.repostCount = m.repostCount;
  if (m.repostOf !== undefined) {
    fields.repostOf = (m.repostOf as BoardQuotedPost | null) ?? null;
  }
  if (typeof m.repostedByMe === 'boolean') fields.repostedByMe = m.repostedByMe;
  if (typeof m.bookmarked === 'boolean') fields.bookmarked = m.bookmarked;
  return fields;
}

/**
 * data/mappers.ts — shared row→DTO mappers for the data layer.
 *
 * ## Purpose
 *
 * Extracted from `services/supabase.ts` (monolith lane M1, step 4). The
 * structural assessment found the chat-message row mapper written out THREE
 * times in the monolith — in the group-message page loader, the thread loader
 * and the question-pool loader — which is the only real duplication in the
 * 42k-line target set (`TEAM-S1-api-structure.md` §2). Three copies of a
 * serialiser is three places for a field to be added and two places for it to
 * be forgotten, and that is exactly what had already happened here (see the
 * KNOWN ISSUE below).
 *
 * ## What it touches
 *
 * No tables and no client: these are pure functions over rows that a caller
 * has already read. `mapChatMessageRow` takes the output of
 * `SupabaseService.normalizeMessageRecord` as a VALUE rather than calling it,
 * because that method still depends on `this.parseMessageContent` and
 * `this.normalizeStorageUrl`, which live in sections not yet extracted.
 *
 * ## The gotcha
 *
 * `mapProfileSender` is the one serialiser every board, DM and group message
 * sender passes through, and the `scrubEmailFromDisplayName` call in it is
 * load-bearing: a `profiles` row created from an email sign-up can hold the
 * address itself as the display name, so removing that scrub publishes user
 * email addresses in chat.
 *
 * The normalized record is spread LAST on purpose — it must win over the
 * envelope fields, as it did in all three original copies.
 */
import { scrubEmailFromDisplayName } from "@lantern/shared/utils/displayNames";

import { Message } from "../../types";

export type ProfileSenderRow = {
  id?: string;
  name?: string;
  username?: string;
  avatar_url?: string;
};

export function mapProfileSender(
  profile: ProfileSenderRow | null | undefined,
  senderId: string,
) {
  return {
    id: profile?.id || senderId,
    // Never an address: a profiles row created from an email sign-up can hold
    // the address itself, and this is the one serialiser every board, DM and
    // group message sender passes through.
    name: scrubEmailFromDisplayName(profile?.name) || "Unknown",
    username: profile?.username || undefined,
    avatarUrl: profile?.avatar_url,
    points: 0,
    badges: [],
    stats: {},
  };
}

export function resolveNestedProfile(
  profiles: unknown,
): ProfileSenderRow | null {
  if (Array.isArray(profiles)) return (profiles[0] as ProfileSenderRow) ?? null;
  return (profiles as ProfileSenderRow) ?? null;
}

/**
 * The chat-message envelope: everything a `messages` row contributes to a
 * `Message` DTO apart from the content itself, which arrives already parsed in
 * `normalized`.
 *
 * KNOWN ISSUE (tracked, found during monolith lane M1): the three copies this
 * replaces were NOT identical. The group-message page loader and the thread
 * loader both emit `senderId`; the question-pool loader
 * (`getGroupQuestionPool`) omits it, so a question read from the pool carries
 * a `sender.id` but no top-level `senderId`. That looks like a copy-paste
 * omission rather than a decision, but this extraction is behaviour-preserving
 * so the difference is kept exactly, behind `options.includeSenderId`, instead
 * of being quietly fixed here. Adding the field is a one-line change once
 * someone has checked what the question-pool clients do with it.
 */
export function mapChatMessageRow(
  row: any,
  normalized: Partial<Message> & { type: "TEXT" | "QUESTION" },
  options: { includeSenderId?: boolean } = {},
): Message {
  const { includeSenderId = true } = options;
  return {
    id: row.id,
    groupId: row.group_id,
    sender: mapProfileSender(
      resolveNestedProfile(row.profiles),
      row.sender_id,
    ),
    ...(includeSenderId ? { senderId: row.sender_id } : {}),
    timestamp: row.timestamp
      ? new Date(row.timestamp).toISOString()
      : new Date().toISOString(),
    flaggedAsSimilarUserIds: row.flagged_as_similar_user_ids || [],
    upvotes: row.upvotes || 0,
    downvotes: row.downvotes || 0,
    isArchived: row.is_archived || false,
    ...normalized,
  } as Message;
}

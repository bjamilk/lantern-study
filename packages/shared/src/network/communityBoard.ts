/**
 * Community boards — Phase 1.
 *
 * A community channel stops being a chat and becomes a BOARD: a top-down,
 * newest-first list of post cards, each with reactions and a comment thread
 * folded underneath, one server-side pinned post, and a collapsed
 * "Write a post" composer. Every study affordance leaves; the destination is a
 * STUDY GROUP created from the community, which lives in Chat.
 *
 * Founder decisions (2026-09-02) encoded here:
 *  1. The lounge STAYS a live chat. It is not a board, it has no board surface
 *     and no enum value — it is derived from `communities.lounge_group_id`.
 *     A community therefore has exactly one conversational room plus N boards.
 *  2. Any member may create a board in Phase 1 (roles are display-only).
 *  3. No push per board post — the unread badge only; @mentions still notify.
 *  4. The lounge is displayed as `General`, without the `#` glyph the boards
 *     use, so the one chat room reads differently from the boards at a glance.
 *
 * Everything here is pure. Both clients and the API render a board from these
 * types, this copy object and these helpers so they cannot describe the same
 * row two different ways (§8 parity rules). Mobile imports via the
 * `@lantern/shared/network` subpath, never the bare package.
 */

import type { CommunityChannel, CommunityRole, CommunityStudyGroup } from './communityServer';
import { COMMUNITY_COPY, COMMUNITY_LOUNGE_CHANNEL_NAME } from './communityServer';
import type { Group } from '../types';
import { memberCountLabel } from './communityLabels';
import { normalizeReactions } from '../chat/reactions';

/** Maximum length of a post's optional title. Mirrors the API validator. */
export const BOARD_POST_SUBJECT_MAX = 120;
/** Posts fetched per page. Never infinite scroll — an explicit "Load older". */
export const BOARD_PAGE_SIZE = 20;
/** Low-data mode halves the page: 20 cards is a materially bigger fetch. */
export const BOARD_PAGE_SIZE_LOW_DATA = 10;
/** Longest voice note a board post may carry, in seconds. */
export const BOARD_VOICE_NOTE_MAX_SECONDS = 120;
/**
 * Comment notifications fan out to the root author plus prior repliers only,
 * and never beyond this many people (§3.9).
 */
export const BOARD_COMMENT_NOTIFY_MAX = 50;
/** Milliseconds the freshly posted card stays highlighted (static if reduced motion). */
export const BOARD_NEW_POST_HIGHLIGHT_MS = 1200;

// ---------------------------------------------------------------------------
// Twitter-shaped board actions (Phase 1). Every limit below is re-checked
// server-side; a limit that lives only in a client is a review blocker
// (§9.3 rule 3).
// ---------------------------------------------------------------------------

/**
 * Favorite is a REACTION with the emoji pinned — not a new table and not a new
 * endpoint. `❤️` is already inside `CHAT_REACTION_EMOJI`, so
 * `POST`/`DELETE /messages/:id/reactions` accept it with no validator change,
 * `sync_message_reaction_counts` keeps the count, and the parent UPDATE rides
 * the realtime channel both clients already subscribe to.
 */
export const BOARD_FAVORITE_EMOJI = '\u2764\ufe0f';

/**
 * The ONE binding order for the action row, rendered from this array on both
 * platforms so they cannot diverge (§9.3 rule 1).
 */
export const BOARD_ACTION_ROW_ORDER = [
  'comment',
  'repost',
  'favorite',
  'bookmark',
  'share',
] as const;
export type BoardAction = (typeof BOARD_ACTION_ROW_ORDER)[number];

/**
 * A repost row's `client_message_id`. The partial unique index
 * `(group_id, sender_id, client_message_id) WHERE client_message_id IS NOT NULL`
 * (20260711170000) makes "one repost per person per post" a DATABASE
 * guarantee: a second attempt raises 23505, which the API answers 409.
 *
 * The server refuses this prefix on the ordinary send path, so no other write
 * can occupy the slot or forge the discriminator (see `isBoardRepostRow`).
 */
export const BOARD_REPOST_CLIENT_ID_PREFIX = 'repost:';
/** Longest optional comment on a repost. */
export const BOARD_REPOST_QUOTE_MAX = 280;
/** Longest snippet of the quoted original carried in a repost embed. */
export const BOARD_QUOTE_SNIPPET_MAX = 140;
/** You cannot bump your own post while it is still near the top. */
export const BOARD_REPOST_SELF_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Reposts one person may make on one board in an hour (§6.3 rule 6). */
export const BOARD_REPOST_PER_BOARD_HOURLY_MAX = 5;

/** One limit for a board photo, enforced in both composers AND on the server. */
export const BOARD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const BOARD_IMAGE_MAX_DIMENSION = 1600;

/**
 * A GIF's own, SMALLER cap.
 *
 * Founder decision: a GIF is an uploaded `.gif` from the gallery, and it has
 * to animate — so it goes to storage byte-for-byte. Any canvas or
 * `ImageManipulator` round trip keeps frame one and throws the rest away, and
 * the "GIF" that arrives is a still: a failure that looks perfect to whoever
 * posted it. The server already agrees — `normalizeImageForStorage` detects a
 * multi-frame GIF and passes it through untouched.
 *
 * Passthrough is exactly why the cap is lower than a photo's. Nothing resizes
 * it and its static first-frame thumb is no substitute, so EVERY reader pays
 * the whole file. At the 10 MB photo cap that is ₦3–₦5 per reader per view on
 * Nigerian mobile data, against ₦0.01–₦0.13 for a photo.
 *
 * Lives here, not in a client, because a limit defined on one platform is how
 * the composers drifted the last time (web 8 MB, shared 10 MB, server 10 MB
 * for the same photo).
 */
export const BOARD_GIF_MAX_BYTES = 5 * 1024 * 1024;

/** Saved posts page size, and the ceiling the API clamps `limit` to. */
export const BOARD_BOOKMARKS_PAGE_SIZE = 20;
export const BOARD_BOOKMARKS_PAGE_SIZE_MAX = 50;
/** Ids accepted in one device-local bookmark import. */
export const BOARD_BOOKMARK_IMPORT_MAX = 200;

/**
 * Where a shared board link points. Deliberately a constant and not a runtime
 * origin: a link minted inside the Android app must open the website, not
 * `exp://`.
 */
export const BOARD_SHARE_ORIGIN = 'https://lanternstudy.com';

/**
 * One card on a board. A post is `messages.type = 'TEXT'` with
 * `thread_root_id IS NULL`; a comment is the same row with `thread_root_id`
 * set. `messages.type` is deliberately NOT widened in Phase 1.
 */
export interface BoardPost {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl: string | null;
  subject: string | null;
  text: string;
  timestamp: string;
  editedAt: string | null;
  removedAt: string | null;
  replyCount: number;
  reactions: Record<string, number>;
  pinnedAt: string | null;
  pinnedBy: string | null;
  /** Legacy rows posted before this board existed. */
  isLegacyQuestion: boolean;
  /** Present only when isLegacyQuestion — the stem, for the read-only card. */
  legacyQuestionStem: string | null;
  /**
   * The post's photo, carried on `messages.image_url`. Legacy posts keep theirs
   * as markdown inside `text`, so a card reads `imageUrl ?? <parsed from text>`
   * — `image_url` is the FIRST encoding to be written, not a third one.
   */
  imageUrl: string | null;
  /** `reactions[BOARD_FAVORITE_EMOJI]`, precomputed so a card never re-derives it. */
  favoriteCount: number;
  favorited: boolean;
  /** Private to the viewer. There is no "how many people saved this", anywhere. */
  bookmarked: boolean;
  repostCount: number;
  repostedByMe: boolean;
  /** Non-null only on a repost row (§6.2). */
  repostOf: BoardQuotedPost | null;
}

/**
 * The original a repost points at. TEXT ONLY — it carries `hasImage` /
 * `hasAudio` flags and never a media URL, so a repost card downloads zero
 * bytes of media exactly like every other list card (§5.5, §6.5).
 */
export interface BoardQuotedPost {
  id: string;
  senderName: string;
  timestamp: string;
  subject: string | null;
  /** `boardQuoteSnippet` of the body with its media markdown stripped. */
  snippet: string;
  hasImage: boolean;
  hasAudio: boolean;
  /** Set when the original was taken down: the embed says so, with no writes. */
  removedAt: string | null;
}

/**
 * A row in "Saved posts". Bookmarks span boards, so each entry carries the
 * board context the list has to render — the post alone cannot say where it
 * came from.
 */
export interface BoardBookmarkEntry {
  post: BoardPost;
  groupId: string;
  boardName: string;
  communitySlug: string | null;
  communityName: string | null;
  savedAt: string;
}

export const COMMUNITY_BOARD_COPY = {
  composerPlaceholder: 'Write a post',
  subjectPlaceholder: 'Title (optional)',
  post: 'Post',
  posting: 'Posting…',
  notSent: 'Not sent · Retry',
  comment: 'Comment',
  comments: (n: number) => (n === 1 ? '1 comment' : `${n} comments`),
  commentsTitle: 'Comments',
  commentPlaceholder: 'Write a comment',
  pinnedLabel: 'PINNED',
  pin: 'Pin to top',
  unpin: 'Unpin',
  pinUnavailable: 'Pinning is not available yet',
  /**
   * The device-local "Save for me" that Bookmark replaces. It survives Phase 1
   * on purpose: §2's degrade rule says that on a database without
   * `message_bookmarks` the clients hide Bookmark and keep today's local save
   * working, so the copy has to still exist. It is deleted in Phase 2, once
   * the one-time import has run everywhere.
   */
  saveForMe: 'Save for me',
  saved: 'Saved',
  copyText: 'Copy text',
  reportPost: 'Report post',
  editPost: 'Edit post',
  deletePost: 'Delete post',
  postRemoved: 'Post removed',
  loadOlder: 'Load older posts',
  newPosts: (n: number) => (n === 1 ? '1 new post' : `${n} new posts`),
  emptyBoard: 'No posts yet. Post the timetable, a past-question drive, an exam-week plan.',
  studyNudge: 'Studying together? Start a study group — it opens in Chat.',
  legacyQuestion: 'Question · study questions live in study groups',
  openStudyGroup: 'Start a study group about this',
  photoTapToLoad: 'Photo · tap to load',
  voiceNote: 'Voice note',
  /**
   * Shown when a stored media reference cannot be re-signed for display — the
   * object is gone, or the viewer has lost access to the board that owns it.
   * Both clients render this chip rather than a broken image (web) or nothing
   * at all (mobile), so the reader is told what happened.
   */
  photoUnavailable: 'Photo unavailable',
  voiceNoteUnavailable: 'Voice note unavailable',
  /** The gap between "you asked for it" and "it is signed and downloading". */
  photoLoading: 'Photo · loading…',
  voiceNoteLoading: 'Voice note · loading…',
  boardOf: (community: string) => community,
  // --- board header overflow (§4.1), in the one binding order ---
  searchBoard: 'Search this board',
  muteBoard: 'Mute notifications',
  aboutBoard: 'About this board',
  reportBoard: 'Report board',
  leaveBoard: 'Leave board',
  // --- errors surfaced by the degrade path (§3.1) ---
  studyGroupsUnavailable: 'Study groups are not available yet',
  subjectTooLong: `Title must be ${BOARD_POST_SUBJECT_MAX} characters or fewer`,
  // --- the action row (§9.1), in BOARD_ACTION_ROW_ORDER ---
  /**
   * Favorite replaces the emoji React on BOARD surfaces only. Group chat and
   * DMs keep the full picker and `reactionAccessibilityLabel` — the same
   * component, the same table, six render sites, three of which are not
   * boards.
   */
  favorite: 'Favorite',
  favorited: 'Favorited',
  repost: 'Repost',
  reposted: 'Reposted',
  undoRepost: 'Undo repost',
  repostedBy: (name: string) => `${name || 'Someone'} reposted`,
  repostQuotePlaceholder: 'Add a comment (optional)',
  repostAlready: 'You already reposted this post',
  repostOwnTooSoon: 'You can repost your own post after a day',
  repostOfRepost: 'Repost the original post instead',
  repostNotSameBoard: 'A post can only be reposted on its own board',
  repostNotAPost: 'Only a post can be reposted, not a comment',
  repostRemoved: 'That post was removed',
  repostTooMany: 'You have reposted a lot on this board. Try again later.',
  repostUnavailable: 'Reposting is not available yet',
  repostQuoteTooLong: `A repost comment must be ${BOARD_REPOST_QUOTE_MAX} characters or fewer`,
  quotedRemoved: 'This post was removed',
  quotedUnavailable: 'This post is no longer available',
  bookmark: 'Bookmark',
  bookmarked: 'Bookmarked',
  savedPosts: 'Saved posts',
  savedPostsEmpty:
    'Nothing saved yet. Bookmark a post to keep it — timetables, past-question drives, exam plans.',
  bookmarksUnavailable: 'Bookmarks are not available yet',
  share: 'Share',
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  shareFailed: 'Could not share that link',
  // --- what a non-member sees on a shared link (§8.3). No post content, ever. ---
  notAMemberTitle: 'This post is in a board you are not in',
  notAMemberBody: (community: string) => `Join ${community} to open it.`,
  notAMemberUnknown: 'Only members of this board can open this link.',
  // --- the one-photo composer (§5.3) ---
  removePhoto: 'Remove photo',
  photoAttached: 'Photo attached',
  imageTooLarge: 'That photo is too large. Pick one under 10 MB.',
  invalidImage: 'That photo could not be attached',
  /** Refused BEFORE any bytes leave the device — see `BOARD_GIF_MAX_BYTES`. */
  gifTooLarge: 'That GIF is too large. Pick one under 5 MB.',
  /** The badge on a GIF chip: words, never colour alone (§9.1). */
  gif: 'GIF',
} as const;

/**
 * The ONE rule that decides the surface. Keys off the GROUP, never off which
 * screen mounted it — a board group also appears in GET /groups, which is the
 * whole reason the Chat-tab bypass exists.
 *
 * The community lounge is the single derived exception: it carries a
 * `communityId` but stays a live chat, so callers that hold the community's
 * `loungeGroupId` must exclude it themselves (see `isCommunityBoardGroup`).
 */
export function isCommunityBoard(
  group: Pick<Group, 'communityId' | 'communitySurface'>,
): boolean {
  return !!group.communityId && group.communitySurface !== 'study_group';
}

/**
 * `isCommunityBoard` with founder decision 1 applied: the community's lounge
 * (`communities.lounge_group_id`) is a live chat, never a board. Clients that
 * know the lounge id — the community page, the chat list filter and the
 * GroupChat redirect — must use this, not the bare rule.
 */
export function isCommunityBoardGroup(
  group: Pick<Group, 'id' | 'communityId' | 'communitySurface'>,
  loungeGroupId: string | null | undefined,
): boolean {
  if (loungeGroupId && group.id === loungeGroupId) return false;
  return isCommunityBoard(group);
}

/**
 * Every lounge this session can positively name, plus the communities those
 * answers were actually resolved for. The second set is what makes the
 * difference between "not a lounge" and "we do not know yet".
 */
export interface KnownCommunityLounges {
  loungeGroupIds: ReadonlySet<string>;
  resolvedCommunityIds: ReadonlySet<string>;
}

/**
 * `isCommunityBoardGroup` over the viewer's whole set of communities — the
 * rule the chat list, the Chat-tab redirect and the channel router need,
 * because each of them spans every community the viewer belongs to.
 *
 * A group whose community has NOT been resolved answers `false`: a lounge
 * wrongly called a board vanishes from Chat and opens as a post board, which
 * is unrecoverable without the user finding the community page, while a board
 * briefly listed in Chat still redirects to its board on tap. Fail toward the
 * chat, never toward the board.
 */
export function isCommunityBoardGroupIn(
  group: Pick<Group, 'id' | 'communityId' | 'communitySurface'>,
  known: KnownCommunityLounges,
): boolean {
  if (!isCommunityBoard(group)) return false;
  if (known.loungeGroupIds.has(group.id)) return false;
  return known.resolvedCommunityIds.has(group.communityId as string);
}

/** The community General chat — Campus is the door; Chat home keeps the card. */
export function isCampusLoungeGroupIn(
  group: Pick<Group, 'id'>,
  known: KnownCommunityLounges,
): boolean {
  return known.loungeGroupIds.has(group.id);
}

/**
 * Rows the Chat inbox must not list: boards (never chats) and lounges
 * (Campus is the door). Study groups stay.
 */
export function isHiddenFromChatInbox(
  group: Pick<Group, 'id' | 'communityId' | 'communitySurface'>,
  known: KnownCommunityLounges,
): boolean {
  return isCommunityBoardGroupIn(group, known) || isCampusLoungeGroupIn(group, known);
}

/**
 * `General` for the lounge (a chat, not a board — founder decision 4), else
 * `# name`: the hash is what tells a board apart from the one chat room at a
 * glance.
 */
export function boardDisplayName(b: Pick<CommunityChannel, 'isLounge' | 'name'>): string {
  return b.isLounge ? COMMUNITY_LOUNGE_CHANNEL_NAME : `# ${b.name}`;
}

/**
 * How long ago, compactly: `now`, `4m`, `2h`, `3d`, `5w`. Used by the board
 * subtitle and by every post card's byline, so the two platforms cannot format
 * the same instant differently.
 */
export function boardRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const seconds = Math.floor((now - ts) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/**
 * joined → "N new · last post 2h", or the member count when nothing has been
 * posted; unjoined → "N members · Tap to join". The lounge keeps its own
 * "Everyone in this community" line: it is a chat, not a board.
 */
export function boardSubtitle(b: CommunityChannel, now: number = Date.now()): string {
  if (b.isLounge) return COMMUNITY_COPY.loungeSubtitle;
  if (!b.isMember) {
    return `${memberCountLabel(b.memberCount)} · ${COMMUNITY_COPY.tapToJoin}`;
  }
  const parts: string[] = [];
  const unread = Number.isFinite(b.unreadCount) ? Math.max(0, Math.floor(b.unreadCount)) : 0;
  if (unread > 0) parts.push(`${unread} new`);
  const last = boardRelativeTime(b.lastMessageTime, now);
  if (last) parts.push(`last post ${last}`);
  return parts.length ? parts.join(' · ') : memberCountLabel(b.memberCount);
}

/** "12 members · 40 questions · Opens in Chat" */
export function studyGroupSubtitle(g: CommunityStudyGroup): string {
  const questions = Number.isFinite(g.questionCount) ? Math.max(0, Math.floor(g.questionCount)) : 0;
  return [
    memberCountLabel(g.memberCount),
    `${questions.toLocaleString()} ${questions === 1 ? 'question' : 'questions'}`,
    COMMUNITY_COPY.opensInChat,
  ].join(' · ');
}

/**
 * Who may pin: the community owner (`communities.created_by`), a community
 * admin/moderator, or an admin of the board group itself. Everyone else gets
 * no pin control on the client and a 403 from the API.
 */
export function canPinOnBoard(input: {
  role: CommunityRole | null;
  adminIds: string[];
  userId: string;
}): boolean {
  if (!input.userId) return false;
  if (input.role === 'owner' || input.role === 'admin' || input.role === 'moderator') return true;
  return Array.isArray(input.adminIds) && input.adminIds.includes(input.userId);
}

/** 10 posts a page in low-data mode, 20 otherwise (§8 parity rule 5). */
export function boardPageSize(lowDataMode: boolean): number {
  return lowDataMode ? BOARD_PAGE_SIZE_LOW_DATA : BOARD_PAGE_SIZE;
}

/**
 * Trim and validate a post title. Returns the value to send (null when blank)
 * or an error to show — client-side and server-side reject the same input.
 */
export function validateBoardSubject(
  raw: string | null | undefined,
): { subject: string | null; error: null } | { subject: null; error: string } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { subject: null, error: null };
  if (trimmed.length > BOARD_POST_SUBJECT_MAX) {
    return { subject: null, error: COMMUNITY_BOARD_COPY.subjectTooLong };
  }
  return { subject: trimmed, error: null };
}

/**
 * The screen-reader label for a post card (§9):
 * "<author>, <relative time>, <subject or first 60 chars of body>, <n> comments".
 */
export function boardPostAccessibilityLabel(
  post: Pick<
    BoardPost,
    'senderName' | 'timestamp' | 'subject' | 'text' | 'replyCount' | 'removedAt'
  >,
  now: number = Date.now(),
): string {
  const when = boardRelativeTime(post.timestamp, now);
  const body = post.removedAt
    ? COMMUNITY_BOARD_COPY.postRemoved
    : (post.subject?.trim() || (post.text ?? '').trim().slice(0, 60) || COMMUNITY_BOARD_COPY.post);
  const replies = Number.isFinite(post.replyCount) ? Math.max(0, Math.floor(post.replyCount)) : 0;
  return [post.senderName || 'Someone', when, body, COMMUNITY_BOARD_COPY.comments(replies)]
    .filter((part): part is string => !!part)
    .join(', ');
}

/** "Pinned post: <author>, <subject or snippet>" (§9). */
export function pinnedPostAccessibilityLabel(
  post: Pick<BoardPost, 'senderName' | 'subject' | 'text'>,
): string {
  const body = post.subject?.trim() || (post.text ?? '').trim().slice(0, 60);
  return `Pinned post: ${post.senderName || 'Someone'}, ${body}`;
}

/** "👍 reaction, 3, selected" (§9). */
export function reactionAccessibilityLabel(
  emoji: string,
  count: number,
  selected: boolean,
): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `${emoji} reaction, ${n}, ${selected ? 'selected' : 'not selected'}`;
}

/**
 * Every board notification links here, never to `/chat/:groupId` (§3.9).
 * A slug that cannot be resolved falls back to `/discover` rather than to the
 * Chat tab, which is exactly the surface a board must never open in.
 */
export function boardDeepLinkPath(
  slug: string | null | undefined,
  groupId: string,
): string {
  if (!slug) return '/discover';
  return `/discover/c/${encodeURIComponent(slug)}/ch/${encodeURIComponent(groupId)}`;
}


// ---------------------------------------------------------------------------
// Favorite (§4) — a reaction with the emoji pinned. No new table, no new route.
// ---------------------------------------------------------------------------

/**
 * How many people favorited a post. Every other emoji already on the row is
 * counted by nobody on a board surface and deleted by nobody either: a
 * 👍→❤️ fold would make un-favoriting ambiguous, because you cannot remove a
 * reaction you never placed (§4.4).
 */
export function boardFavoriteCount(reactions: unknown): number {
  return normalizeReactions(reactions)[BOARD_FAVORITE_EMOJI] ?? 0;
}

/**
 * Did the viewer favorite this post? `mine` is one row of the existing
 * `GET /messages/group/:groupId/user-reactions` map, which both boards already
 * fetch on mount.
 */
export function isBoardFavorited(mine?: readonly string[] | null): boolean {
  return Array.isArray(mine) && mine.includes(BOARD_FAVORITE_EMOJI);
}

// ---------------------------------------------------------------------------
// Repost (§6) — a same-board bump. An ordinary `messages` row, zero migrations.
// ---------------------------------------------------------------------------

/** `repost:<originalId>` — the value that makes the unique index do the work. */
export function boardRepostClientId(originalId: string): string {
  return `${BOARD_REPOST_CLIENT_ID_PREFIX}${originalId}`;
}

/** The inverse. Returns null for any client id that is not a repost key. */
export function boardRepostOriginalId(
  clientMessageId: string | null | undefined,
): string | null {
  if (typeof clientMessageId !== 'string') return null;
  if (!clientMessageId.startsWith(BOARD_REPOST_CLIENT_ID_PREFIX)) return null;
  const id = clientMessageId.slice(BOARD_REPOST_CLIENT_ID_PREFIX.length).trim();
  return id || null;
}

/**
 * The repost discriminator:
 * `reply_to_message_id IS NOT NULL AND thread_root_id IS NULL AND client_message_id LIKE 'repost:%'`.
 *
 * Why all three clauses are needed, and why none of them is decoration:
 *
 *  - a COMMENT always carries `thread_root_id`, because the only write path
 *    that sets `reply_to_message_id` also sets
 *    `COALESCE(parent.thread_root_id, parent.id)` and 20260728140000
 *    backfilled every pre-existing reply. So clauses 1+2 already exclude every
 *    comment the server can write today;
 *  - both columns are `ON DELETE SET NULL`. Hard-deleting a root post (account
 *    deletion cascades through `messages.sender_id`) leaves a NESTED comment
 *    with `reply_to_message_id` still pointing at its sibling and
 *    `thread_root_id` nulled — clauses 1+2 alone would call that orphan a
 *    repost and render someone's reply as a bump of a post that no longer
 *    exists. Clause 3 excludes it;
 *  - clause 3 is only trustworthy because `client_message_id` is
 *    client-supplied: the server REFUSES the `repost:` prefix on the ordinary
 *    send path, so the prefix cannot be forged onto a comment.
 */
export function isBoardRepostRow(row: {
  replyToMessageId?: string | null;
  threadRootId?: string | null;
  clientMessageId?: string | null;
}): boolean {
  if (!row?.replyToMessageId) return false;
  if (row.threadRootId) return false;
  return boardRepostOriginalId(row.clientMessageId) !== null;
}

/** Why a repost was refused. The same typed reasons on both platforms (§9.3 rule 6). */
export type BoardRepostRefusal =
  | 'already'
  | 'ownTooSoon'
  | 'isRepost'
  | 'removed'
  | 'notSameBoard'
  | 'tooMany'
  | 'unavailable';

/**
 * Can this viewer repost this post? The server re-checks every rule, so
 * calling the endpoint directly with curl is refused too (§6.3, acceptance
 * criterion 17).
 */
export function canRepostBoardPost(input: {
  post: Pick<BoardPost, 'senderId' | 'timestamp' | 'removedAt' | 'repostedByMe' | 'repostOf'>;
  viewerId: string;
  now?: number;
}): { ok: true } | { ok: false; reason: BoardRepostRefusal } {
  const { post, viewerId } = input;
  const now = input.now ?? Date.now();
  if (post.removedAt) return { ok: false, reason: 'removed' };
  if (post.repostOf) return { ok: false, reason: 'isRepost' };
  if (post.repostedByMe) return { ok: false, reason: 'already' };
  if (viewerId && post.senderId === viewerId) {
    const postedAt = Date.parse(post.timestamp);
    if (Number.isFinite(postedAt) && now - postedAt < BOARD_REPOST_SELF_COOLDOWN_MS) {
      return { ok: false, reason: 'ownTooSoon' };
    }
  }
  return { ok: true };
}

/**
 * How the repost control should render for this viewer, on both platforms.
 *
 * The rule that matters: a refusal DIMS the control, it never disables it.
 * On device the icon was grey and inert, and there was no way to find out
 * why — the refusal copy below existed but nothing could ever reach it,
 * because a disabled control never fires its press. Dimmed-and-pressable is
 * the only shape in which the reason gets said out loud.
 */
export function boardRepostControlState(
  verdict: { ok: true } | { ok: false; reason: BoardRepostRefusal },
  repostedByMe: boolean,
): { pressable: true; dimmed: boolean } {
  // Pressable is not conditional: every state of this control has something
  // to say — repost, undo, or the reason it cannot happen right now.
  return { pressable: true, dimmed: !verdict.ok && !repostedByMe };
}

/** One refusal reason → the one string both platforms show for it. */
export function boardRepostRefusalCopy(reason: BoardRepostRefusal): string {
  switch (reason) {
    case 'already':
      return COMMUNITY_BOARD_COPY.repostAlready;
    case 'ownTooSoon':
      return COMMUNITY_BOARD_COPY.repostOwnTooSoon;
    case 'isRepost':
      return COMMUNITY_BOARD_COPY.repostOfRepost;
    case 'removed':
      return COMMUNITY_BOARD_COPY.repostRemoved;
    case 'notSameBoard':
      return COMMUNITY_BOARD_COPY.repostNotSameBoard;
    case 'tooMany':
      return COMMUNITY_BOARD_COPY.repostTooMany;
    case 'unavailable':
    default:
      return COMMUNITY_BOARD_COPY.repostUnavailable;
  }
}

const BOARD_IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
const BOARD_AUDIO_MARKDOWN_RE = /\[audio\]\((https?:\/\/[^)\s]+)\)/gi;

/**
 * The quoted original's body, media stripped and truncated. Built on the same
 * strip web's `boardPostText` and mobile's `splitBoardBody` use, so a signed
 * media URL can never ride inside a repost embed (§6.5) — and never inside a
 * share payload either.
 */
export function boardQuoteSnippet(
  text: string | null | undefined,
  max: number = BOARD_QUOTE_SNIPPET_MAX,
): string {
  const stripped = (text ?? '')
    .replace(BOARD_IMAGE_MARKDOWN_RE, '')
    .replace(BOARD_AUDIO_MARKDOWN_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  const limit = Math.max(1, Math.floor(max));
  if (stripped.length <= limit) return stripped;
  return `${stripped.slice(0, limit - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Share (§8) — a link, never content.
// ---------------------------------------------------------------------------

/**
 * The deep link to ONE post. Falls back to the board link with no postId, and
 * to `/discover` with no slug — never to `/chat/:groupId`, which is exactly
 * the surface a board must not open in.
 */
export function boardPostDeepLinkPath(
  slug: string | null | undefined,
  groupId: string,
  postId?: string | null,
): string {
  const board = boardDeepLinkPath(slug, groupId);
  if (!slug || !postId) return board;
  return `${board}/p/${encodeURIComponent(postId)}`;
}

/**
 * The absolute link a student pastes into WhatsApp.
 *
 * Deliberately NOT unfurlable: the web app has no server-side renderer, so a
 * paste shows the site title and nothing about the post. That is CORRECT for
 * members-only content — do not add per-post Open Graph tags in a later SEO
 * pass (§8.3). The ACL decides what the recipient gets; the link previews
 * nothing.
 */
export function boardPostShareUrl(
  slug: string | null | undefined,
  groupId: string,
  postId: string,
  origin: string = BOARD_SHARE_ORIGIN,
): string {
  const base = (origin || BOARD_SHARE_ORIGIN).replace(/\/+$/, '');
  return `${base}${boardPostDeepLinkPath(slug, groupId, postId)}`;
}

/**
 * Everything the OS share sheet is given: a title and a URL, and NOTHING else.
 * Never `post.text`, never a body snippet, never a media URL — a signed
 * storage URL in a share payload is a members-only object leaving the board.
 */
export function boardSharePayload(
  post: Pick<BoardPost, 'id' | 'subject'>,
  ctx: { slug: string | null | undefined; groupId: string; boardName: string },
): { title: string; url: string } {
  const subject = (post.subject ?? '').trim();
  const boardName = (ctx.boardName ?? '').trim();
  return {
    title: subject || (boardName ? `Post in # ${boardName}` : COMMUNITY_BOARD_COPY.post),
    url: boardPostShareUrl(ctx.slug, ctx.groupId, post.id),
  };
}

/**
 * The storage prefix a board photo MUST live under. The path IS the ACL:
 * `canAccessStorageObject` resolves `note-files/{owner}/chat/{groupId}/…` to
 * `isGroupMember(groupId, viewer)`, and storage RLS
 * (`note_files_chat_group_select`, 20260704100300) mirrors it.
 */
export function boardImageUploadPrefix(userId: string, groupId: string): string {
  return `${userId}/chat/${groupId}/`;
}

/**
 * Is this URL a photo THIS user uploaded for THIS board? Re-checked on the
 * server before `messages.image_url` is written: without it a client could
 * point `image_url` at another group's object, and the reader's own signed-URL
 * request would then be refused — a permanently broken image — or, worse,
 * point it at an object the board's members should not be able to name.
 *
 * `parse` is `parseStorageObjectUrl`, passed in so this module stays free of
 * the storage-config import chain.
 */
export function isBoardImageUrlAllowed(input: {
  url: string;
  userId: string;
  groupId: string;
  parse: (url: string) => { bucket: string; path: string } | null;
}): boolean {
  const { url, userId, groupId, parse } = input;
  if (typeof url !== 'string' || !url.trim()) return false;
  if (!userId || !groupId) return false;
  const parsed = parse(url);
  if (!parsed) return false;
  if (parsed.bucket !== 'note-files') return false;
  return parsed.path.startsWith(boardImageUploadPrefix(userId, groupId));
}

// ---------------------------------------------------------------------------
// Accessibility labels (§9.2) — here so both platforms announce identically.
// State is carried by words as well as by an outline-vs-solid icon; never by
// colour alone.
// ---------------------------------------------------------------------------

function safeCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

/** "Favorite, 12, favorited" / "Favorite, 12, not favorited". */
export function boardFavoriteAccessibilityLabel(count: number, mine: boolean): string {
  return `${COMMUNITY_BOARD_COPY.favorite}, ${safeCount(count)}, ${mine ? 'favorited' : 'not favorited'}`;
}

/** "Repost, 2, you reposted this" / "Repost, 2, not reposted". */
export function boardRepostAccessibilityLabel(count: number, mine: boolean): string {
  return `${COMMUNITY_BOARD_COPY.repost}, ${safeCount(count)}, ${mine ? 'you reposted this' : 'not reposted'}`;
}

/** "Bookmark, saved" / "Bookmark, not saved". */
export function boardBookmarkAccessibilityLabel(saved: boolean): string {
  return `${COMMUNITY_BOARD_COPY.bookmark}, ${saved ? 'saved' : 'not saved'}`;
}

/** "Comment, 3" — the count is hidden at zero visually, never in the label. */
export function boardCommentAccessibilityLabel(count: number): string {
  return `${COMMUNITY_BOARD_COPY.comment}, ${safeCount(count)}`;
}

/** "Share post". */
export function boardShareAccessibilityLabel(): string {
  return 'Share post';
}

/** How many characters of a post seed a study-group name from "Start a study group about this". */
export const BOARD_STUDY_GROUP_NAME_MAX = 40;

/**
 * Prefill for "Start a study group about this": the post's title, else the
 * first ~40 characters of its body, trimmed at a word boundary.
 */
export function studyGroupNameFromPost(
  post: Pick<BoardPost, 'subject' | 'text'>,
): string {
  const subject = (post.subject ?? '').trim();
  if (subject) return subject.slice(0, BOARD_STUDY_GROUP_NAME_MAX).trim();
  const body = (post.text ?? '').replace(/\s+/g, ' ').trim();
  if (!body) return '';
  if (body.length <= BOARD_STUDY_GROUP_NAME_MAX) return body;
  const cut = body.slice(0, BOARD_STUDY_GROUP_NAME_MAX);
  // Only back off to a word boundary when the cut landed mid-word.
  if (body[BOARD_STUDY_GROUP_NAME_MAX] === ' ') return cut.trim();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * The plain TEXT reply a board keeps as a pointer to the study group a post
 * spawned (§7). An ordinary message — no schema change.
 */
export function studyGroupAnnouncement(actorName: string, groupName: string): string {
  return `${actorName || 'Someone'} started a study group: ${groupName}`;
}

// ---------------------------------------------------------------------------
// Deprecated aliases — one release only, so no call site breaks mid-refactor.
// ---------------------------------------------------------------------------

/** @deprecated Use `boardDisplayName`. */
export const channelDisplayName = boardDisplayName;

/** @deprecated Use `boardSubtitle(channel, now)`. */
export function channelSubtitle(ch: CommunityChannel): string {
  return boardSubtitle(ch, Date.now());
}

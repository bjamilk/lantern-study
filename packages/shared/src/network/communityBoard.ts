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
  react: 'React',
  pinnedLabel: 'PINNED',
  pin: 'Pin to top',
  unpin: 'Unpin',
  pinUnavailable: 'Pinning is not available yet',
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

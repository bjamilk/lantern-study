/**
 * The board composer and a board card's actions, as data.
 *
 * Every permission decision here is DELEGATED to
 * `@lantern/shared/network` (communityGovernance.ts) — `canPostOnBoard`,
 * `canPostBoardKind` and `boardPostRules`. Nothing here compares a role or
 * invents a rule of its own: the API re-decides each of them from the same
 * helpers, so a control this file hides is a request the server would have
 * refused, and a control it shows is one the server will honour.
 *
 * The ONE input that is not a role is `boardAdmin` (see `BoardPostActionInput`)
 * — because the server's PIN rule credits `groups.admin_ids` as well as the
 * community role, while its removal and announcement rules do not. Even that
 * is not a rule of its own: it decides WHICH role `boardPostRules` is asked
 * about, never what the answer means.
 *
 * It exists so mobile jest can hold the two matrices in node — which kinds a
 * composer may offer, and which actions a card may show — without mounting a
 * screen.
 *
 * WHAT IS DELIBERATELY ABSENT: "Mark answered". `boardPostRules` computes
 * `canMarkAnswered` and this file passes it through in `boardPostActions`, but
 * the composer/card matrix below never turns it into a menu row, because the
 * API has no route that writes `messages.answered_message_id` — the column
 * exists (migration 20260908120000) and the read path maps it, and that is
 * all. A menu row that cannot change anything is a dead feature, and this
 * codebase has shipped three of those already.
 */
import {
  BOARD_POST_KINDS,
  BOARD_POST_KIND_DEFAULT,
  COMMUNITY_MODERATION_COPY,
  boardPostKindMeta,
  boardPostRules,
  canPostOnBoard,
  isModeratingRole,
  normalizeBoardPostKind,
  type BoardPostKind,
  type BoardPostPermissions,
  type CommunityRole,
} from '@lantern/shared/network';

export interface BoardComposerInput {
  /** The viewer's role in the COMMUNITY the board belongs to. */
  role?: CommunityRole | null;
  /** Membership of the board's group — a board is posted to, not watched. */
  isMember: boolean;
  /** `community_members.muted_until` for the viewer. */
  mutedUntil?: string | null;
  now?: number;
}

export interface BoardComposerModel {
  /** The kinds the picker may offer, in BOARD_POST_KINDS order. */
  kinds: BoardPostKind[];
  /** Whether the composer accepts anything at all right now. */
  canPost: boolean;
  /**
   * Why not, in the student's words — one of the three shared sentences, never
   * a raw error. Null when they can post.
   */
  refusal: string | null;
  /** Whether a picker is worth drawing: one kind is not a choice. */
  showPicker: boolean;
}

/** The one sentence for each refusal `canPostOnBoard` can return. */
export function boardComposerRefusalCopy(
  reason: 'not_member' | 'muted' | 'restricted_kind'
): string {
  if (reason === 'muted') return COMMUNITY_MODERATION_COPY.mutedBody;
  if (reason === 'restricted_kind') return COMMUNITY_MODERATION_COPY.restrictedKind;
  return COMMUNITY_MODERATION_COPY.notMember;
}

/**
 * What the composer may offer.
 *
 * A muted member or a non-member gets NO kinds — not a greyed-out picker over
 * a box they cannot send from. A plain member gets everything except
 * Announcement, which `canPostBoardKind` reserves for moderators; the picker
 * is hidden entirely when only one kind survives, because a single-option
 * chooser is chrome pretending to be a choice.
 */
export function buildBoardComposerModel(input: BoardComposerInput): BoardComposerModel {
  const gate = canPostOnBoard({
    role: input.role ?? null,
    isMember: input.isMember,
    mutedUntil: input.mutedUntil ?? null,
    // Asked about the DEFAULT kind, so `restricted_kind` can never be the
    // reason here: "you cannot post an announcement" must not read as "you
    // cannot post".
    postKind: BOARD_POST_KIND_DEFAULT,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });

  if (!gate.ok) {
    return {
      kinds: [],
      canPost: false,
      refusal: boardComposerRefusalCopy(gate.reason),
      showPicker: false,
    };
  }

  const kinds = BOARD_POST_KINDS.filter(
    (kind) =>
      canPostOnBoard({
        role: input.role ?? null,
        isMember: input.isMember,
        mutedUntil: input.mutedUntil ?? null,
        postKind: kind,
        ...(input.now !== undefined ? { now: input.now } : {}),
      }).ok
  );

  return {
    kinds: [...kinds],
    canPost: kinds.length > 0,
    refusal: null,
    showPicker: kinds.length > 1,
  };
}

/**
 * The kind the composer should hold after the model changed.
 *
 * A moderator who picks Announcement and is then demoted mid-session must not
 * keep a selection the server will refuse — the selection falls back to the
 * default rather than silently sending as something else.
 */
export function resolveComposerKind(
  selected: BoardPostKind | string | null | undefined,
  model: Pick<BoardComposerModel, 'kinds'>
): BoardPostKind {
  const normalized = normalizeBoardPostKind(selected);
  if (model.kinds.includes(normalized)) return normalized;
  return model.kinds[0] ?? BOARD_POST_KIND_DEFAULT;
}

/** The picker's label and glyph — straight from the shared kind meta. */
export function boardPostKindLabel(kind: BoardPostKind | string): string {
  return boardPostKindMeta(kind).label;
}

export interface BoardPostActionInput {
  /**
   * The viewer is an ADMIN OF THIS GROUP (`groups.admin_ids`) — which is not
   * the same thing as a community role.
   *
   * The server's two rules are deliberately different, and the client must
   * match each one rather than pick a favourite:
   *  - PIN is `canPinOnBoard({ role, adminIds, userId })` — a community
   *    moderator OR a board admin (services/supabase.ts, setMessagePin).
   *  - REMOVE and ANNOUNCE are the COMMUNITY role alone
   *    (services/communityModeration.ts removePost, and `canPostBoardKind`
   *    in the send path).
   * Upgrading the role wholesale would offer a board admin a Remove that the
   * API answers 403 to; ignoring the flag would hide Pin from someone the API
   * would have let pin.
   */
  boardAdmin?: boolean;
  /**
   * A PLATFORM admin, which is a different thing from `boardAdmin`: it widens
   * REMOVE (the one thing `communityModeration.removePost` grants them) and
   * never pin. Passed straight through to `boardPostRules`.
   */
  isPlatformAdmin?: boolean;
  senderId: string;
  viewerId: string;
  postKind?: BoardPostKind | string | null;
  pinnedAt?: string | null;
  removedAt?: string | null;
  answeredMessageId?: string | null;
  mutedUntil?: string | null;
  now?: number;
}

export interface BoardPostActions extends BoardPostPermissions {
  /**
   * Removal that carries a REASON and hits
   * `DELETE /communities/:id/posts/:postId` — a moderator taking down someone
   * else's post. An author deleting their own keeps using the message-delete
   * path, which is what `canRemove && isAuthor` means here.
   */
  canModerateRemove: boolean;
  isAuthor: boolean;
}

/**
 * One card's actions. `boardPostRules` decides all six permissions; the only
 * thing added is WHICH removal endpoint a Remove tap belongs to.
 */
export function boardPostActions(
  role: CommunityRole | null | undefined,
  post: BoardPostActionInput
): BoardPostActions {
  const rules = boardPostRules(role, post);
  const isAuthor = !!post.senderId && post.senderId === post.viewerId;
  // The pin half only — see `boardAdmin` above. Still `boardPostRules`, asked
  // about the role the pin endpoint would credit this viewer with, so the
  // "already pinned / removed" conditions stay in ONE place.
  const asBoardAdmin =
    post.boardAdmin && !isModeratingRole(role ?? null)
      ? boardPostRules('moderator', post)
      : null;
  return {
    ...rules,
    canPin: rules.canPin || !!asBoardAdmin?.canPin,
    canUnpin: rules.canUnpin || !!asBoardAdmin?.canUnpin,
    isAuthor,
    canModerateRemove: rules.canRemove && !isAuthor,
  };
}

/** Whether this post pins itself to the top of the board list. */
export function isAnnouncement(postKind: BoardPostKind | string | null | undefined): boolean {
  return normalizeBoardPostKind(postKind) === 'announcement';
}

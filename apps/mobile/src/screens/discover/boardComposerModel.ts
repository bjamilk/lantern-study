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
 * MARK ANSWERED — what is wired on mobile, and what is not. `boardPostRules`
 * computes `canMarkAnswered`, this file surfaces it — with the derived answered
 * state — through `boardPostActions`, and the API owns the route that writes
 * `messages.answered_message_id`
 * (POST /communities/:id/posts/:postId/answered, migration 20260908120000;
 * `endpoints.markCommunityPostAnswered`).
 *
 * REACHABLE on mobile today: exactly one thing — CLEARING an accepted answer,
 * through `CommunityBoardScreen`'s "Clear accepted answer" row, live now that
 * `mapApiMessage`/`boardActionFields` map `answered_message_id` onto
 * `Message.answeredMessageId` so the answered map actually seeds. Un-answering
 * needs no reply, only the question id, which the card already has.
 *
 * NOT on mobile: the answered BADGE. `deriveBoardAnsweredState` is the one
 * derivation behind it, and web's card and thread render it, but no mobile
 * component draws it — `boardPostActions` is this file's only caller, so on
 * mobile the derivation currently decides a menu row and nothing visual. Do
 * not describe a mobile badge until a mobile card renders one.
 *
 * NOT yet reachable on mobile: ACCEPTING a specific reply. That means pointing
 * at ONE reply, and a reply can only be pointed at where it is shown — never on
 * the board card, which does not render the thread. It belongs on the reply's
 * OWN long-press inside the thread; `replyAnswerMenuAction` below is the pure,
 * tested matrix for that row, but `CommunityPostScreen` does not mount it yet,
 * so from mobile a question gains its accepted answer on web or via the API,
 * and mobile reads and clears it. Do not describe the accept path as wired
 * until a thread screen calls `replyAnswerMenuAction`.
 *
 * The rule that outlived the old dead-feature note still binds: a menu row must
 * be able to CHANGE something. `replyAnswerMenuAction` never yields a no-op — it
 * hides for a viewer who cannot mark, offers `clear` only on the reply that is
 * currently accepted, and offers `mark` only on a reply that is not already it.
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
  /** Whether this post reads as an answered question — see `deriveBoardAnsweredState`. */
  isAnswered: boolean;
  /** The accepted reply's id, or null. Only ever set on an answerable, live post. */
  acceptedAnswerId: string | null;
}

/**
 * One card's actions. `boardPostRules` decides all six permissions; this adds
 * WHICH removal endpoint a Remove tap belongs to, and folds in the answered
 * state derived from the post's `answeredMessageId` so a card resolves
 * "can I accept an answer?" and "is one already accepted?" from a single call.
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
  const answered = deriveBoardAnsweredState(post);
  return {
    ...rules,
    canPin: rules.canPin || !!asBoardAdmin?.canPin,
    canUnpin: rules.canUnpin || !!asBoardAdmin?.canUnpin,
    isAuthor,
    canModerateRemove: rules.canRemove && !isAuthor,
    isAnswered: answered.isAnswered,
    acceptedAnswerId: answered.acceptedAnswerId,
  };
}

/** The answered state of a board post, as data — for the card and the thread. */
export interface BoardAnsweredState {
  /** Only a question can be answered; nothing else ever reads as answered. */
  isAnswerable: boolean;
  /** The id of the reply accepted as the answer, or null. */
  acceptedAnswerId: string | null;
  /** Whether the question reads as answered right now. */
  isAnswered: boolean;
}

/**
 * Does this post read as an answered question, and if so, which reply answered
 * it? The ONE derivation the card badge, the thread's "Answered" banner and the
 * per-reply "Answer" badge all agree through.
 *
 * A removed post reads as NOT answered whatever its column says: the card is a
 * tombstone, and "Answered" over "Removed by a moderator" is nonsense. Only an
 * answerable kind (a question) can carry an accepted answer — a discussion with
 * a stray `answered_message_id` is not a question and does not read as one.
 */
export function deriveBoardAnsweredState(input: {
  postKind?: BoardPostKind | string | null;
  answeredMessageId?: string | null;
  removedAt?: string | null;
}): BoardAnsweredState {
  const isAnswerable = boardPostKindMeta(normalizeBoardPostKind(input.postKind)).answerable;
  const removed = !!input.removedAt;
  const raw = typeof input.answeredMessageId === 'string' ? input.answeredMessageId : null;
  const acceptedAnswerId = isAnswerable && !removed && raw ? raw : null;
  return {
    isAnswerable,
    acceptedAnswerId,
    isAnswered: acceptedAnswerId !== null,
  };
}

/** The answered-related row a single reply's long-press should show, if any. */
export type ReplyAnswerAction =
  | { show: false }
  | { show: true; kind: 'mark'; answerMessageId: string }
  | { show: true; kind: 'clear' };

/**
 * What the ACCEPT/CLEAR row on one reply does — the pure matrix the thread's
 * reply long-press is drawn from. This is where "Mark answered" actually lives,
 * because this is the only place a specific reply can be pointed at.
 *
 * The one invariant: every row it returns CHANGES the accepted answer.
 *  - Hidden entirely for a viewer the shared `canMarkAnswered` refuses — they
 *    still SEE the badge (that comes from `deriveBoardAnsweredState`, no
 *    permission), they just cannot move it.
 *  - `clear` only on the reply that is currently accepted: clearing anything
 *    else is already clear, a row that does nothing.
 *  - `mark` only on a reply that is NOT already the accepted one — marking the
 *    accepted reply as the answer again is the definitional no-op this codebase
 *    keeps shipping. Marking a reply while a DIFFERENT one is accepted is a real
 *    change (it moves the answer), so that row stays.
 *  - Nothing to point at (an empty reply id) shows nothing.
 */
export function replyAnswerMenuAction(input: {
  /** `boardPostRules(role, question).canMarkAnswered` for the reply's question. */
  canMarkAnswered: boolean;
  /** This reply's own message id. */
  replyId: string;
  /** The question's currently accepted answer id (from `deriveBoardAnsweredState`). */
  acceptedAnswerId: string | null;
}): ReplyAnswerAction {
  if (!input.canMarkAnswered) return { show: false };
  const replyId = typeof input.replyId === 'string' ? input.replyId : '';
  if (!replyId) return { show: false };
  if (input.acceptedAnswerId === replyId) return { show: true, kind: 'clear' };
  return { show: true, kind: 'mark', answerMessageId: replyId };
}

/** Whether this post pins itself to the top of the board list. */
export function isAnnouncement(postKind: BoardPostKind | string | null | undefined): boolean {
  return normalizeBoardPostKind(postKind) === 'announcement';
}

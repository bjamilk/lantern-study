import {
  boardComposerRefusalCopy,
  boardPostActions,
  buildBoardComposerModel,
  deriveBoardAnsweredState,
  isAnnouncement,
  replyAnswerMenuAction,
  resolveComposerKind,
} from './boardComposerModel';
import { COMMUNITY_MODERATION_COPY } from '@lantern/shared/network';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const MUTED_UNTIL = '2026-09-08T18:00:00.000Z';
const EXPIRED_MUTE = '2026-09-08T06:00:00.000Z';

describe('buildBoardComposerModel — the kind availability matrix', () => {
  it('offers every kind but Announcement to a plain member', () => {
    const model = buildBoardComposerModel({ role: 'member', isMember: true, now: NOW });
    expect(model.kinds).toEqual(['discussion', 'question', 'event']);
    expect(model.canPost).toBe(true);
    expect(model.showPicker).toBe(true);
    expect(model.refusal).toBeNull();
  });

  it.each(['owner', 'admin', 'moderator'] as const)('offers Announcement to a %s', (role) => {
    const model = buildBoardComposerModel({ role, isMember: true, now: NOW });
    expect(model.kinds).toEqual(['discussion', 'question', 'announcement', 'event']);
  });

  it('offers nothing to a non-member and says why', () => {
    const model = buildBoardComposerModel({ role: null, isMember: false, now: NOW });
    expect(model.kinds).toEqual([]);
    expect(model.canPost).toBe(false);
    expect(model.showPicker).toBe(false);
    expect(model.refusal).toBe(COMMUNITY_MODERATION_COPY.notMember);
  });

  it('offers nothing to a muted member, and says a mute is not a ban', () => {
    const model = buildBoardComposerModel({
      role: 'member',
      isMember: true,
      mutedUntil: MUTED_UNTIL,
      now: NOW,
    });
    expect(model.canPost).toBe(false);
    expect(model.refusal).toBe(COMMUNITY_MODERATION_COPY.mutedBody);
  });

  it('a mute that has expired is not a mute', () => {
    const model = buildBoardComposerModel({
      role: 'member',
      isMember: true,
      mutedUntil: EXPIRED_MUTE,
      now: NOW,
    });
    expect(model.canPost).toBe(true);
    expect(model.kinds).toContain('discussion');
  });

  it('a muted MODERATOR is refused too — muting outranks the badge', () => {
    const model = buildBoardComposerModel({
      role: 'moderator',
      isMember: true,
      mutedUntil: MUTED_UNTIL,
      now: NOW,
    });
    expect(model.kinds).toEqual([]);
    expect(model.refusal).toBe(COMMUNITY_MODERATION_COPY.mutedBody);
  });

  it('never blames the restricted kind for a plain refusal to post', () => {
    const model = buildBoardComposerModel({ role: 'member', isMember: false, now: NOW });
    expect(model.refusal).not.toBe(COMMUNITY_MODERATION_COPY.restrictedKind);
  });
});

describe('boardComposerRefusalCopy', () => {
  it('names the three refusals in the student’s words', () => {
    expect(boardComposerRefusalCopy('muted')).toBe(COMMUNITY_MODERATION_COPY.mutedBody);
    expect(boardComposerRefusalCopy('not_member')).toBe(COMMUNITY_MODERATION_COPY.notMember);
    expect(boardComposerRefusalCopy('restricted_kind')).toBe(
      COMMUNITY_MODERATION_COPY.restrictedKind
    );
  });
});

describe('resolveComposerKind', () => {
  const moderator = buildBoardComposerModel({ role: 'moderator', isMember: true, now: NOW });
  const member = buildBoardComposerModel({ role: 'member', isMember: true, now: NOW });

  it('keeps a selection the model still offers', () => {
    expect(resolveComposerKind('announcement', moderator)).toBe('announcement');
  });

  it('drops a selection the viewer may no longer post', () => {
    expect(resolveComposerKind('announcement', member)).toBe('discussion');
  });

  it('falls back to the default for junk and for an empty model', () => {
    expect(resolveComposerKind('poll', member)).toBe('discussion');
    expect(resolveComposerKind(null, { kinds: [] })).toBe('discussion');
  });
});

describe('boardPostActions', () => {
  const base = { senderId: 'author', viewerId: 'viewer', now: NOW };

  it('lets a moderator pin, and never offers pin and unpin at once', () => {
    const unpinned = boardPostActions('moderator', base);
    expect(unpinned.canPin).toBe(true);
    expect(unpinned.canUnpin).toBe(false);
    const pinned = boardPostActions('moderator', { ...base, pinnedAt: '2026-09-08T10:00:00Z' });
    expect(pinned.canPin).toBe(false);
    expect(pinned.canUnpin).toBe(true);
  });

  it('routes an author’s own removal away from the moderation endpoint', () => {
    const own = boardPostActions('member', { ...base, senderId: 'viewer' });
    expect(own.canRemove).toBe(true);
    expect(own.isAuthor).toBe(true);
    expect(own.canModerateRemove).toBe(false);
  });

  it('gives a moderator the reasoned removal of someone else’s post', () => {
    const other = boardPostActions('moderator', base);
    expect(other.canModerateRemove).toBe(true);
  });

  it('offers nothing on an already-removed post, and no self-report', () => {
    const removed = boardPostActions('moderator', { ...base, removedAt: '2026-09-08T11:00:00Z' });
    expect(removed.canRemove).toBe(false);
    expect(removed.canPin).toBe(false);
    expect(removed.canComment).toBe(false);
    expect(removed.canReport).toBe(false);
    expect(boardPostActions('member', { ...base, senderId: 'viewer' }).canReport).toBe(false);
  });

  it('a muted member still reads and reports, and cannot comment', () => {
    const muted = boardPostActions('member', { ...base, mutedUntil: MUTED_UNTIL });
    expect(muted.canComment).toBe(false);
    expect(muted.canReport).toBe(true);
  });
});

describe('isAnnouncement', () => {
  it('is true only for the pinned kind', () => {
    expect(isAnnouncement('announcement')).toBe(true);
    expect(isAnnouncement('discussion')).toBe(false);
    expect(isAnnouncement(null)).toBe(false);
    expect(isAnnouncement('poll')).toBe(false);
  });
});

describe('boardPostActions — a board admin who is not a community moderator', () => {
  const base = { senderId: 'author', viewerId: 'viewer', now: NOW, boardAdmin: true };

  it('may pin, because the pin endpoint credits groups.admin_ids', () => {
    expect(boardPostActions('member', base).canPin).toBe(true);
    expect(boardPostActions('member', { ...base, pinnedAt: '2026-09-08T10:00:00Z' }).canUnpin).toBe(
      true
    );
  });

  it('may NOT remove someone else’s post — that rule is the community role alone', () => {
    const actions = boardPostActions('member', base);
    expect(actions.canModerateRemove).toBe(false);
    expect(actions.canRemove).toBe(false);
  });

  it('still cannot pin a removed post', () => {
    expect(boardPostActions('member', { ...base, removedAt: '2026-09-08T11:00:00Z' }).canPin).toBe(
      false
    );
  });

  it('changes nothing for a viewer who is not a board admin', () => {
    expect(boardPostActions('member', { ...base, boardAdmin: false }).canPin).toBe(false);
  });
});

describe('deriveBoardAnsweredState — one answered derivation for card and thread', () => {
  it('reads an answered question as answered, and names the accepted reply', () => {
    const state = deriveBoardAnsweredState({ postKind: 'question', answeredMessageId: 'reply-7' });
    expect(state.isAnswerable).toBe(true);
    expect(state.isAnswered).toBe(true);
    expect(state.acceptedAnswerId).toBe('reply-7');
  });

  it('an unanswered question is answerable but not answered', () => {
    const state = deriveBoardAnsweredState({ postKind: 'question', answeredMessageId: null });
    expect(state.isAnswerable).toBe(true);
    expect(state.isAnswered).toBe(false);
    expect(state.acceptedAnswerId).toBeNull();
  });

  it('a non-question never reads as answered, even with a stray answer id', () => {
    const state = deriveBoardAnsweredState({ postKind: 'discussion', answeredMessageId: 'reply-7' });
    expect(state.isAnswerable).toBe(false);
    expect(state.isAnswered).toBe(false);
    expect(state.acceptedAnswerId).toBeNull();
  });

  it('a removed question is a tombstone, never answered', () => {
    const state = deriveBoardAnsweredState({
      postKind: 'question',
      answeredMessageId: 'reply-7',
      removedAt: '2026-09-08T11:00:00Z',
    });
    expect(state.isAnswered).toBe(false);
    expect(state.acceptedAnswerId).toBeNull();
  });

  it('an empty answer id is not an answer', () => {
    expect(deriveBoardAnsweredState({ postKind: 'question', answeredMessageId: '' }).isAnswered).toBe(
      false
    );
  });

  it('a legacy post with no kind is a discussion, so never answered', () => {
    expect(
      deriveBoardAnsweredState({ postKind: null, answeredMessageId: 'reply-7' }).isAnswered
    ).toBe(false);
  });
});

describe('boardPostActions — answered state folded in', () => {
  const base = { senderId: 'author', viewerId: 'viewer', now: NOW };

  it('surfaces the accepted answer on a question card', () => {
    const actions = boardPostActions('member', {
      ...base,
      postKind: 'question',
      answeredMessageId: 'reply-9',
    });
    expect(actions.isAnswered).toBe(true);
    expect(actions.acceptedAnswerId).toBe('reply-9');
  });

  it('an answerable card the viewer cannot mark still reads as answered', () => {
    const actions = boardPostActions('member', {
      ...base,
      postKind: 'question',
      answeredMessageId: 'reply-9',
    });
    // A plain member is neither author nor moderator here.
    expect(actions.canMarkAnswered).toBe(false);
    expect(actions.isAnswered).toBe(true);
  });

  it('a removed answered question drops both the answer and the mark control', () => {
    const actions = boardPostActions('moderator', {
      ...base,
      postKind: 'question',
      answeredMessageId: 'reply-9',
      removedAt: '2026-09-08T11:00:00Z',
    });
    expect(actions.isAnswered).toBe(false);
    expect(actions.acceptedAnswerId).toBeNull();
    expect(actions.canMarkAnswered).toBe(false);
  });
});

describe('replyAnswerMenuAction — the reply long-press matrix', () => {
  it('hides the row from a viewer who cannot mark, however the answer stands', () => {
    expect(
      replyAnswerMenuAction({ canMarkAnswered: false, replyId: 'r1', acceptedAnswerId: null })
    ).toEqual({ show: false });
    expect(
      replyAnswerMenuAction({ canMarkAnswered: false, replyId: 'r1', acceptedAnswerId: 'r1' })
    ).toEqual({ show: false });
  });

  it('offers Mark on a reply that is not the accepted one', () => {
    expect(
      replyAnswerMenuAction({ canMarkAnswered: true, replyId: 'r1', acceptedAnswerId: null })
    ).toEqual({ show: true, kind: 'mark', answerMessageId: 'r1' });
  });

  it('offers Clear only on the reply that IS the accepted answer', () => {
    expect(
      replyAnswerMenuAction({ canMarkAnswered: true, replyId: 'r1', acceptedAnswerId: 'r1' })
    ).toEqual({ show: true, kind: 'clear' });
  });

  it('moving the answer to a different reply is Mark, not a no-op', () => {
    // A question already answered by r2; long-pressing r1 must offer to MOVE it.
    expect(
      replyAnswerMenuAction({ canMarkAnswered: true, replyId: 'r1', acceptedAnswerId: 'r2' })
    ).toEqual({ show: true, kind: 'mark', answerMessageId: 'r1' });
  });

  it('never marks the accepted reply as its own answer again (the dead no-op)', () => {
    const action = replyAnswerMenuAction({
      canMarkAnswered: true,
      replyId: 'r1',
      acceptedAnswerId: 'r1',
    });
    expect(action).not.toEqual({ show: true, kind: 'mark', answerMessageId: 'r1' });
  });

  it('shows nothing when there is no reply to point at', () => {
    expect(
      replyAnswerMenuAction({ canMarkAnswered: true, replyId: '', acceptedAnswerId: null })
    ).toEqual({ show: false });
  });
});

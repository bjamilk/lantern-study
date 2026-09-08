import { boardActionFields } from './boardMessageFields';

/**
 * The rule these tests exist for is a merge rule, not a mapping rule.
 *
 * `groupStore.mergeGroupMessage` folds an incoming realtime row into the
 * cached one with `{ ...prev, ...message }`. An explicit `undefined` WINS that
 * spread. None of the board action state lives on the `messages` row —
 * `repostCount` / `repostOf` are computed per page, `repostedByMe` /
 * `bookmarked` per viewer — so a realtime UPDATE (someone favorited a post)
 * carries none of it. Emitting the keys as `undefined` would blank the repost
 * count and un-fill the bookmark icon on every card, every time anyone
 * reacted to anything.
 */
describe('boardActionFields', () => {
  it('emits NO keys at all for a row that carries none', () => {
    const fields = boardActionFields({ id: 'm1', text: 'hello' });
    expect(Object.keys(fields)).toEqual([]);
    // The distinction the spread depends on: absent, not present-and-undefined.
    expect('bookmarked' in fields).toBe(false);
    expect('repostCount' in fields).toBe(false);
  });

  it('survives a merge without clobbering what the board page already knew', () => {
    const cached = { id: 'm1', repostCount: 3, bookmarked: true, repostedByMe: true };
    const realtimeUpdate = { id: 'm1', reactions: { '❤️': 4 } };
    const merged = { ...cached, ...boardActionFields(realtimeUpdate) };
    expect(merged.repostCount).toBe(3);
    expect(merged.bookmarked).toBe(true);
    expect(merged.repostedByMe).toBe(true);
  });

  it('does let a real value through, including a falsy one', () => {
    const cached = { repostCount: 3, bookmarked: true, repostedByMe: true };
    const page = { repostCount: 0, bookmarked: false, repostedByMe: false };
    const merged = { ...cached, ...boardActionFields(page) };
    expect(merged.repostCount).toBe(0);
    expect(merged.bookmarked).toBe(false);
    expect(merged.repostedByMe).toBe(false);
  });

  it('reads the repost embed, and normalises an unresolvable one to null', () => {
    // The server sends `repostOf: null` when the quoted id does not resolve
    // (the author's account was deleted and ON DELETE SET NULL fired) — the
    // client renders "This post is no longer available" for exactly that.
    expect(boardActionFields({ repostOf: null }).repostOf).toBeNull();
    expect(boardActionFields({ repostOf: { id: 'orig' } }).repostOf).toEqual({ id: 'orig' });
  });

  it('accepts client_message_id in either casing', () => {
    expect(boardActionFields({ client_message_id: 'repost:a' }).clientMessageId).toBe('repost:a');
    expect(boardActionFields({ clientMessageId: 'repost:b' }).clientMessageId).toBe('repost:b');
  });

  it('ignores an empty or non-string client id rather than storing a lie', () => {
    expect('clientMessageId' in boardActionFields({ client_message_id: '' })).toBe(false);
    expect('clientMessageId' in boardActionFields({ client_message_id: 42 })).toBe(false);
  });

  it('ignores a non-boolean bookmarked and a non-numeric repostCount', () => {
    expect('bookmarked' in boardActionFields({ bookmarked: 'yes' })).toBe(false);
    expect('repostCount' in boardActionFields({ repostCount: '2' })).toBe(false);
  });

  it('does not throw on null or a non-object row', () => {
    expect(boardActionFields(null)).toEqual({});
    expect(boardActionFields(undefined)).toEqual({});
  });

  /**
   * The accepted-answer id is the field the board's "Clear accepted answer"
   * row and the whole answered-state seed hang on. If the mapper stops emitting
   * it the key never reaches a `Message`, `CommunityBoardScreen`'s
   * `'answeredMessageId' in post` seed guard is never true, the answered map
   * stays empty forever and the clear row can never render — the exact dead
   * state this round fixed. Each assertion below fails if the mapping is removed.
   */
  describe('answeredMessageId', () => {
    it('maps a realtime (snake_case) accepted answer', () => {
      const fields = boardActionFields({ id: 'm1', answered_message_id: 'reply-7' });
      expect(fields.answeredMessageId).toBe('reply-7');
      expect('answeredMessageId' in fields).toBe(true);
    });

    it('maps an HTTP (camelCase) accepted answer', () => {
      expect(boardActionFields({ answeredMessageId: 'reply-9' }).answeredMessageId).toBe('reply-9');
    });

    it('carries a null CLEAR through as a present key, never dropped', () => {
      // A realtime row for a cleared question carries the real column: `null`.
      // Presence, not truthiness — the board treats a present null as "no
      // accepted answer, authoritatively", distinct from "row said nothing".
      const fields = boardActionFields({ id: 'm1', answered_message_id: null });
      expect('answeredMessageId' in fields).toBe(true);
      expect(fields.answeredMessageId).toBeNull();
    });

    it('OMITS the key entirely when the row carries neither casing', () => {
      // The merge contract: a reaction UPDATE that never mentions the answer
      // must not blank a known one. Absent, not present-and-undefined.
      const fields = boardActionFields({ id: 'm1', reactions: { '❤️': 4 } });
      expect('answeredMessageId' in fields).toBe(false);
    });

    it('survives a merge without clobbering a known answer', () => {
      const cached = { id: 'm1', answeredMessageId: 'reply-7' };
      const realtimeReaction = { id: 'm1', reactions: { '👍': 2 } };
      const merged = { ...cached, ...boardActionFields(realtimeReaction) };
      expect(merged.answeredMessageId).toBe('reply-7');
    });

    it('lets a real clear win the merge', () => {
      const cached = { id: 'm1', answeredMessageId: 'reply-7' };
      const cleared = { id: 'm1', answered_message_id: null };
      const merged = { ...cached, ...boardActionFields(cleared) };
      expect(merged.answeredMessageId).toBeNull();
    });
  });
});

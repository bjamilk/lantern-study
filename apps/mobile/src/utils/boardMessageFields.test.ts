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
});

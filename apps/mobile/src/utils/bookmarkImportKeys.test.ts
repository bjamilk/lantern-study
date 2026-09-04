/**
 * The one-time import of the device-local "Save for me" saves (§7.3).
 *
 * The guard under test is not defensive tidying. `GroupChatScreen` and
 * `DirectMessageScreen` write the IDENTICAL AsyncStorage key shape
 * (`lantern_starred_msgs:{userId}:{chatId}`) for their own stars, so importing
 * every key would turn a starred CHAT message into a board bookmark — a row
 * that "Saved posts" would then list and no surface could open, because
 * `PUT /messages/:id/bookmark` answers `not_a_board_post` for exactly that
 * message.
 */
import { parseStarredIds, selectBoardStarKeys } from './bookmarkImportKeys';

const KEYS = [
  'lantern_starred_msgs:u1:board-1',
  'lantern_starred_msgs:u1:chat-1',
  'lantern_starred_msgs:u1:dm-1',
  // Another account on a shared phone.
  'lantern_starred_msgs:u2:board-1',
  // Unrelated app state.
  'lantern:board:saved:u1',
  'lantern_offline_bundle',
];

describe('selectBoardStarKeys', () => {
  const isBoard = (id: string) => id.startsWith('board-');

  it('keeps only this user’s BOARD keys', () => {
    expect(selectBoardStarKeys(KEYS, 'u1', isBoard)).toEqual([
      'lantern_starred_msgs:u1:board-1',
    ]);
  });

  it('never imports a starred chat or DM message', () => {
    const picked = selectBoardStarKeys(KEYS, 'u1', isBoard);
    expect(picked).not.toContain('lantern_starred_msgs:u1:chat-1');
    expect(picked).not.toContain('lantern_starred_msgs:u1:dm-1');
  });

  it('never imports another account’s saves off a shared phone', () => {
    expect(selectBoardStarKeys(KEYS, 'u1', isBoard)).not.toContain(
      'lantern_starred_msgs:u2:board-1'
    );
  });

  it('imports nothing while the community’s lounge pointer is unresolved', () => {
    // `isCommunityBoardGroupIn` refuses to guess: an unresolved community's
    // groups are treated as chats until the pointer has loaded. Deferring is
    // correct — the import is idempotent and runs again next launch.
    expect(selectBoardStarKeys(KEYS, 'u1', () => false)).toEqual([]);
  });

  it('ignores a key with no group id after the prefix', () => {
    expect(selectBoardStarKeys(['lantern_starred_msgs:u1:'], 'u1', () => true)).toEqual([]);
  });
});

describe('parseStarredIds', () => {
  it('reads the stored array', () => {
    expect(parseStarredIds('["a","b"]')).toEqual(['a', 'b']);
  });

  it('contributes nothing for a corrupt or absent entry rather than throwing', () => {
    expect(parseStarredIds(null)).toEqual([]);
    expect(parseStarredIds('')).toEqual([]);
    expect(parseStarredIds('{not json')).toEqual([]);
    expect(parseStarredIds('{"a":1}')).toEqual([]);
  });

  it('drops non-string members instead of sending them to the server', () => {
    expect(parseStarredIds('["a",null,3,"b"]')).toEqual(['a', 'b']);
  });
});

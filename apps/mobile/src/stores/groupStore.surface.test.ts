/**
 * Public-surface lock for the group store (lane M2).
 *
 * `stores/groupStore.ts` is about to be split into `stores/group/*` behind a
 * re-export shim, exactly as `stores/marketplaceStore.ts` was. 104 files import
 * this module, so the refactor is only safe if nothing a consumer can observe
 * moves or changes shape. This test is written against the UNTOUCHED file and
 * re-run after every extraction step; it pins the four observable things:
 *
 * 1. the exact set of store state keys,
 * 2. the arity of every store action (a changed arity is a changed call
 *    contract, and most callers pass positional arguments),
 * 3. the module's named runtime exports,
 * 4. the AsyncStorage key strings, asserted through the real load/save actions
 *    so they stay byte-identical — a renamed key silently orphans every
 *    student's cached chat list.
 *
 * Deliberately NOT asserted: behaviour. The mapping/persistence/outbox tests do
 * that. This file only proves the shape survived the move.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiRemove: jest.fn(async () => undefined),
  },
}));
jest.mock('../services/api', () => ({ __esModule: true }));
jest.mock('../services/syncService', () => ({
  __esModule: true,
  syncService: { registerHandler: jest.fn(), queueOperation: jest.fn() },
}));
// groupStore constructs `DeliveryIntentRegistry` at module scope; the shared
// utils stand-in used by mobile's jest setup does not carry it, and widening
// that stand-in would change every suite.
jest.mock('@lantern/shared/utils', () => ({
  __esModule: true,
  ...jest.requireActual('@lantern/shared/utils'),
  DeliveryIntentRegistry: class {},
}));
// jest's moduleNameMapper maps `@lantern/shared/<subpath>` but not the bare
// package (see the shared-imports/jest note): mock it virtually rather than
// widen the mapper for one test.
jest.mock('@lantern/shared', () => ({ __esModule: true, isTransientSyncError: () => false }), {
  virtual: true,
});
jest.mock('expo-crypto', () => ({ __esModule: true, randomUUID: () => 'uuid' }));
jest.mock('./authStore', () => ({
  __esModule: true,
  useAuthStore: { getState: () => ({ user: null, profileName: null }) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as groupStoreModule from './groupStore';
import { useGroupStore } from './groupStore';

/** Baseline captured from the pre-split store (main @ ef947980). */
const STATE_KEYS = [
  'activeDmThreadId',
  'activeGroupId',
  'addDirectMessage',
  'appendGroupMessage',
  'applyPeerChatRead',
  'archiveDmThread',
  'archiveGroup',
  'createGroup',
  'currentGroup',
  'deleteDmThread',
  'deleteGroup',
  'demoteAdmin',
  'demoteGroupAdmin',
  'directMessages',
  'dmHistoryClearedAtByThread',
  'dmThreads',
  'dmUnreadCounts',
  'editDirectMessage',
  'editGroupMessage',
  'error',
  'fetchDMUnreadCounts',
  'fetchDirectMessagesForThread',
  'fetchDmThreads',
  'fetchGroupMembers',
  'fetchGroupUnreadCounts',
  'fetchGroups',
  'fetchMessages',
  'fetchThread',
  'fetchUserVotesForGroup',
  'flagMessageAsSimilar',
  'getActiveDmThreads',
  'getBreadcrumbs',
  'getMessagesForGroups',
  'getParentGroup',
  'getSubgroups',
  'getSubgroupsWithLevel',
  'getTopLevelGroups',
  'groupUnreadCounts',
  'groups',
  'hydrateGroup',
  'isLoading',
  'isLoadingMessages',
  'isLoadingMore',
  'leaveGroup',
  'listError',
  'loadFromStorage',
  'loadMoreMessages',
  'markDMAsRead',
  'markGroupAsRead',
  'mergeDirectMessage',
  'mergeGroupMessage',
  'messagePagination',
  'messages',
  'messagesCache',
  'patchDirectMessageInState',
  'patchMessageInState',
  'promoteGroupAdmin',
  'promoteToAdmin',
  'removeDirectMessage',
  'removeDmThread',
  'removeGroupMessage',
  'removeMember',
  'retryFailedDirectMessage',
  'retryFailedMessage',
  'saveToStorage',
  'selectGroup',
  'sendDirectMessageTo',
  'sendMessage',
  'setActiveDmThreadId',
  'submitQuestion',
  'unarchiveDmThread',
  'updateGroupDetails',
  'userVotes',
  'voteOnMessage',
];

/** `<action>/<Function.length>` — a changed arity is a changed call contract. */
const ACTION_ARITIES = [
  'addDirectMessage/2',
  'appendGroupMessage/2',
  'applyPeerChatRead/1',
  'archiveDmThread/2',
  'archiveGroup/1',
  'createGroup/5',
  'deleteDmThread/2',
  'deleteGroup/1',
  'demoteAdmin/2',
  'demoteGroupAdmin/2',
  'editDirectMessage/3',
  'editGroupMessage/3',
  'fetchDMUnreadCounts/1',
  'fetchDirectMessagesForThread/3',
  'fetchDmThreads/1',
  'fetchGroupMembers/1',
  'fetchGroupUnreadCounts/1',
  'fetchGroups/1',
  'fetchMessages/2',
  'fetchThread/2',
  'fetchUserVotesForGroup/2',
  'flagMessageAsSimilar/3',
  'getActiveDmThreads/0',
  'getBreadcrumbs/1',
  'getMessagesForGroups/1',
  'getParentGroup/1',
  'getSubgroups/1',
  'getSubgroupsWithLevel/1',
  'getTopLevelGroups/0',
  'hydrateGroup/1',
  'leaveGroup/2',
  'loadFromStorage/0',
  'loadMoreMessages/2',
  'markDMAsRead/2',
  'markGroupAsRead/2',
  'mergeDirectMessage/2',
  'mergeGroupMessage/2',
  'patchDirectMessageInState/3',
  'patchMessageInState/2',
  'promoteGroupAdmin/2',
  'promoteToAdmin/2',
  'removeDirectMessage/2',
  'removeDmThread/1',
  'removeGroupMessage/2',
  'removeMember/2',
  'retryFailedDirectMessage/3',
  'retryFailedMessage/3',
  'saveToStorage/0',
  'selectGroup/1',
  'sendDirectMessageTo/5',
  'sendMessage/5',
  'setActiveDmThreadId/1',
  'submitQuestion/2',
  'unarchiveDmThread/2',
  'updateGroupDetails/4',
  'voteOnMessage/4',
];

/** Named runtime exports of the module all 104 importers reach. */
const MODULE_EXPORTS = [
  'MESSAGES_CACHE_MAX_CONVERSATIONS',
  'MESSAGES_CACHE_MAX_PER_CONVERSATION',
  'boundMessagesCache',
  'clearMessagesCacheRecency',
  'mapApiMessage',
  'touchMessagesCache',
  'useGroupStore',
];

describe('group store public surface', () => {
  it('exposes exactly these state keys', () => {
    expect(Object.keys(useGroupStore.getState()).sort()).toEqual(STATE_KEYS);
  });

  it('exposes exactly these action arities', () => {
    const arities = Object.entries(useGroupStore.getState())
      .filter(([, value]) => typeof value === 'function')
      .map(([name, value]) => `${name}/${(value as (...args: unknown[]) => unknown).length}`)
      .sort();
    expect(arities).toEqual(ACTION_ARITIES);
  });

  it('exposes exactly these module exports', () => {
    expect(Object.keys(groupStoreModule).sort()).toEqual(MODULE_EXPORTS);
  });

  it('keeps the AsyncStorage keys byte-identical', async () => {
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();

    await useGroupStore.getState().loadFromStorage();
    expect((AsyncStorage.getItem as jest.Mock).mock.calls.map(([key]) => key).sort()).toEqual([
      'lantern_groups',
      'lantern_messages',
    ]);

    await useGroupStore.getState().saveToStorage();
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.map(([key]) => key).sort()).toEqual([
      'lantern_groups',
      'lantern_messages',
    ]);
  });
});

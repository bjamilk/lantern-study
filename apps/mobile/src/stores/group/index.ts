// ===========================================
// Lantern Study Mobile - Group store: public surface
// ===========================================
//
// Purpose: the one export list every chat surface reaches (through the
// `stores/groupStore.ts` shim). Layers live behind this file and nothing
// outside the folder should import them directly:
//
// - `types.ts`       — the shapes all layers agree on. No runtime.
// - `mapping.ts`     — pure row→model mappers and merge rules.
// - `persistence.ts` — the AsyncStorage blobs and the bounded message cache.
// - `transport.ts`   — thin wrappers over services/api. No state access.
// - `outbox.ts`      — the syncService('message') handler and the group send.
// - `state.ts`       — the zustand store; it composes everything above.
//
// Gotcha: 104 files import this surface. It is pinned by
// `stores/groupStore.surface.test.ts` — adding to it is fine, changing or
// removing an entry is a breaking change to every chat screen.

export { useGroupStore } from './state';
export { mapApiMessage } from './mapping';
export {
  boundMessagesCache,
  clearMessagesCacheRecency,
  touchMessagesCache,
  MESSAGES_CACHE_MAX_CONVERSATIONS,
  MESSAGES_CACHE_MAX_PER_CONVERSATION,
} from './persistence';
export type {
  CreateGroupInput,
  DirectMessage,
  DMThread,
  Group,
  GroupMember,
  GroupPermissions,
  Message,
} from './types';

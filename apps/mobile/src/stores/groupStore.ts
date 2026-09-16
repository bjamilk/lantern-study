/**
 * Groups store — re-export shim.
 *
 * The store used to be one ~3.1k-line file. It is now five layers under
 * `stores/group/`:
 *
 * - `group/types.ts`       — the shapes all the layers agree on. No runtime.
 * - `group/mapping.ts`     — pure row→model mappers, the optimistic-row
 *   reconciliation and the realtime merge rules. `mapApiMessage` lives here
 *   and is still the ONE message mapper.
 * - `group/persistence.ts` — the `lantern_groups` / `lantern_messages`
 *   AsyncStorage blobs and the F8 bound on the message cache.
 * - `group/transport.ts`   — thin wrappers over services/api. No state.
 * - `group/outbox.ts`      — the optimistic group send and the syncService
 *   `'message'` handler that flushes what it queues.
 * - `group/state.ts`       — the zustand store; it composes the layers above.
 *
 * This file stays so every existing import path (`stores/groupStore`, and the
 * `jest.mock('./groupStore')` / `mapApiMessage` imports the board store and the
 * F8 cache tests use) keeps resolving — 104 files reach the store and none of
 * them had to move. It adds nothing of its own: the export list lives in
 * `group/index.ts` and is pinned by `groupStore.surface.test.ts`.
 *
 * New code may import from `./group` directly.
 */
export * from './group';

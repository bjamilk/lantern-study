/**
 * Marketplace Store — re-export shim.
 *
 * The store used to be one ~2.5k-line file. It is now three layers under
 * `stores/marketplace/`:
 *
 * - `marketplace/transport.ts` — every call out: services/api, the offline
 *   queue (services/syncService) and the per-user AsyncStorage cache. Thin, no
 *   state access.
 * - `marketplace/mapping.ts`   — pure row→model mappers, the badge predicates
 *   and the browse catalog derived from the shared taxonomy.
 * - `marketplace/state.ts`     — the zustand store: UI state, optimistic
 *   writes, request sequencing; it composes the two layers above.
 * - `marketplace/types.ts`     — the shapes the three agree on.
 *
 * This file stays so every existing import path (`stores/marketplaceStore`,
 * including `jest.mock('./marketplaceStore')` in the sign-out tests and the
 * lazy `import('./marketplaceStore')` in authStore) keeps resolving. It adds
 * nothing of its own: the export list lives in `marketplace/index.ts` and is
 * pinned by `marketplaceStore.surface.test.ts`.
 *
 * New code may import from `./marketplace` directly.
 */
export * from './marketplace';

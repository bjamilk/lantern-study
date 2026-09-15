/**
 * Community store (web) — the one fetch shared by the community column, the
 * community page and the chat header's `in <Community>` link.
 *
 * Same shape as the mobile store (spec §4.2 / §5.2): `loadCommunity(slug)`,
 * `loadChannels(id)`, `loadMine()`, `invalidate(id)`. In-flight requests are
 * deduplicated so the column and the page mounting together cost one round
 * trip, not two.
 *
 * Exports: `useCommunityStore` — `myCommunities` (+ `myLoadedAt`),
 * `detailBySlug`, `channelsById`; actions `loadMine`, `loadCommunity`,
 * `loadChannels`, `invalidate`, `reset`.
 *
 * Touches: services/supabase (`fetchMyCommunities`, `fetchCommunity`,
 * `fetchCommunityChannels`). Nothing is persisted — everything is memory-only,
 * with `myCommunities` held behind a 5-minute TTL and detail/channels cached
 * until explicitly invalidated.
 *
 * Gotchas:
 *  - `inflight` is a module-level Map keyed by slug/id, shared across users. It
 *    is NOT cleared by `reset()`, so a request started before a sign-out can
 *    still resolve into the new session's store; call `reset()` on account
 *    switch and treat an immediately-following load as possibly deduped.
 *  - `invalidate` deliberately keeps the cached detail (dropping it blanked the
 *    page for the length of the refetch) — it only drops channels and expires
 *    the memberships TTL.
 *  - `loadCommunity` / `loadChannels` reject on failure; callers must catch.
 *    There is no error state in the store.
 */
import { create } from 'zustand';
import type { CommunityChannels, CommunityDetail, MyCommunity } from '@lantern/shared/network';
import { fetchCommunity, fetchCommunityChannels, fetchMyCommunities } from '../services/supabase';

const MY_COMMUNITIES_TTL_MS = 5 * 60 * 1000;

const inflight = new Map<string, Promise<unknown>>();

function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = run().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

interface CommunityStoreState {
  myCommunities: MyCommunity[];
  myLoadedAt: number;
  detailBySlug: Record<string, CommunityDetail>;
  channelsById: Record<string, CommunityChannels>;
  /** Memberships (used to resolve `communityId → { slug, name }` for the chat header link). */
  loadMine: (force?: boolean) => Promise<void>;
  loadCommunity: (slug: string) => Promise<CommunityDetail>;
  loadChannels: (communityId: string) => Promise<CommunityChannels>;
  /**
   * Drop the cached channels for one community (after join/leave, create
   * channel, lounge mint). The detail is deliberately KEPT: the page and the
   * column render their bodies behind it, so dropping it blanked them for the
   * length of the refetch — and permanently if the refetch failed. Callers
   * follow this with a `loadCommunity`, which overwrites it when the fresh
   * one lands.
   */
  invalidate: (communityId: string) => void;
  /** Sign-out / account switch. */
  reset: () => void;
}

export const useCommunityStore = create<CommunityStoreState>()((set, get) => ({
  myCommunities: [],
  myLoadedAt: 0,
  detailBySlug: {},
  channelsById: {},

  loadMine: async (force = false) => {
    const { myLoadedAt } = get();
    if (!force && myLoadedAt && Date.now() - myLoadedAt < MY_COMMUNITIES_TTL_MS) return;
    const mine = await dedupe('mine', () => fetchMyCommunities());
    set({ myCommunities: Array.isArray(mine) ? mine : [], myLoadedAt: Date.now() });
  },

  loadCommunity: async (slug) => {
    const detail = await dedupe(`community:${slug}`, () => fetchCommunity(slug));
    set((state) => ({ detailBySlug: { ...state.detailBySlug, [slug]: detail } }));
    return detail;
  },

  loadChannels: async (communityId) => {
    const payload = await dedupe(`channels:${communityId}`, () => fetchCommunityChannels(communityId));
    set((state) => ({ channelsById: { ...state.channelsById, [communityId]: payload } }));
    return payload;
  },

  invalidate: (communityId) => {
    set((state) => {
      const channelsById = { ...state.channelsById };
      delete channelsById[communityId];
      return { channelsById, myLoadedAt: 0 };
    });
  },

  reset: () => set({ myCommunities: [], myLoadedAt: 0, detailBySlug: {}, channelsById: {} }),
}));

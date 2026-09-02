/**
 * Community store (web) — the one fetch shared by the community column, the
 * community page and the chat header's `in <Community>` link.
 *
 * Same shape as the mobile store (spec §4.2 / §5.2): `loadCommunity(slug)`,
 * `loadChannels(id)`, `loadMine()`, `invalidate(id)`. In-flight requests are
 * deduplicated so the column and the page mounting together cost one round
 * trip, not two.
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

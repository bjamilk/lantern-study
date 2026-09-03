import { create } from 'zustand';
import type { CommunityChannels, CommunityDetail, MyCommunity } from '@lantern/shared/network';
import { fetchCommunity, fetchCommunityChannels, fetchMyCommunities } from '../services/api';
import { findMyCommunity } from '../utils/communityOverlay';

/** `loadMine()` reuses the membership list for this long unless forced. */
const MINE_TTL_MS = 60_000;

interface CommunityState {
  myCommunities: MyCommunity[];
  myLoadedAt: number;
  /** Slug → last fetched detail (first paint; screens refetch on focus). */
  detailBySlug: Record<string, CommunityDetail>;
  /** Community id → last fetched server view. */
  channelsById: Record<string, CommunityChannels>;
  /**
   * The membership list. GroupChatScreen uses it to resolve a group's
   * `communityId` to `{ slug, name }` for the `in <Community> ›` link when a
   * channel is opened from the plain chat list.
   */
  loadMine: (force?: boolean) => Promise<void>;
  loadCommunity: (slug: string) => Promise<CommunityDetail>;
  loadChannels: (communityId: string) => Promise<CommunityChannels>;
  /**
   * Drop the cached server view for a community so the next load refetches.
   * The detail is deliberately KEPT: screens render their whole body behind
   * it, so dropping it emptied the page for the length of the refetch — and
   * permanently if that refetch failed. Every caller follows this with a
   * `loadCommunity`, which overwrites the detail once the fresh one lands.
   */
  invalidate: (communityId: string) => void;
  /**
   * `communityId → CommunityDetail` via the membership list's slug. Used where
   * only a group is known (GroupInfoModal's lounge check). Null when the
   * viewer is not a member of that community.
   */
  resolveCommunity: (communityId: string) => Promise<CommunityDetail | null>;
}

let mineInFlight: Promise<void> | null = null;

export const useCommunityStore = create<CommunityState>((set, get) => ({
  myCommunities: [],
  myLoadedAt: 0,
  detailBySlug: {},
  channelsById: {},

  loadMine: async (force = false) => {
    const { myLoadedAt } = get();
    if (!force && myLoadedAt > 0 && Date.now() - myLoadedAt < MINE_TTL_MS) return;
    if (mineInFlight) return mineInFlight;
    mineInFlight = fetchMyCommunities()
      .then((mine) => {
        set({ myCommunities: mine, myLoadedAt: Date.now() });
      })
      .finally(() => {
        mineInFlight = null;
      });
    return mineInFlight;
  },

  loadCommunity: async (slug) => {
    const detail = await fetchCommunity(slug);
    set((state) => ({ detailBySlug: { ...state.detailBySlug, [slug]: detail } }));
    return detail;
  },

  loadChannels: async (communityId) => {
    const channels = await fetchCommunityChannels(communityId);
    set((state) => ({ channelsById: { ...state.channelsById, [communityId]: channels } }));
    return channels;
  },

  invalidate: (communityId) => {
    set((state) => {
      const channelsById = { ...state.channelsById };
      delete channelsById[communityId];
      return { channelsById, myLoadedAt: 0 };
    });
  },

  resolveCommunity: async (communityId) => {
    const cached = Object.values(get().detailBySlug).find((d) => d.id === communityId);
    if (cached) return cached;
    await get().loadMine();
    const hit = findMyCommunity(get().myCommunities, communityId);
    if (!hit) return null;
    return get().loadCommunity(hit.slug);
  },
}));

/** Sync selector: is this group id the `# lounge` of any community we know? */
export function selectIsLoungeGroup(state: CommunityState, groupId: string): boolean {
  if (!groupId) return false;
  for (const detail of Object.values(state.detailBySlug)) {
    if (detail.lounge_group_id === groupId) return true;
  }
  for (const channels of Object.values(state.channelsById)) {
    if (channels.loungeGroupId === groupId) return true;
  }
  return false;
}

/** Sync selector: `communityId → { slug, name }` from the membership list. */

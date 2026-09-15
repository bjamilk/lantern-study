/**
 * In-memory cache of the viewer's communities, each community's detail and its
 * channel/server view, plus the selectors that decide whether a group id is a
 * community lounge.
 *
 * Main exports: `useCommunityStore` (`loadMine`, `loadCommunity`,
 * `loadChannels`, `invalidate`, `resolveCommunity`), `selectIsLoungeGroup`,
 * `collectLoungeGroupIds`, `collectKnownLounges`.
 *
 * Touches: services/api (`fetchMyCommunities`, `fetchCommunity`,
 * `fetchCommunityChannels`) and utils/communityOverlay. No persistence and no
 * native modules — everything here is lost on app restart.
 *
 * Gotchas: not user-scoped and never cleared on sign-out, so an account switch
 * within one process leaves the previous account's communities cached until
 * something forces a reload. `loadMine` is single-flighted through a
 * module-level `mineInFlight` and served from a 60s TTL unless forced.
 * `collectLoungeGroupIds` must be called with the two records (memoised by the
 * caller), never built inside a zustand selector — a fresh Set per render never
 * settles.
 */
import { create } from 'zustand';
import type {
  CommunityChannels,
  CommunityDetail,
  KnownCommunityLounges,
  MyCommunity,
} from '@lantern/shared/network';
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

/**
 * Every lounge group id this session knows about.
 *
 * Founder decision 1 (2026-09-02): the lounge STAYS a live chat, so it must be
 * excluded wherever `isCommunityBoard` would otherwise claim it — the chat-list
 * filter, the GroupChat redirect and the CommunityChannel router. Callers pass
 * the two records straight from the store and memoise on them; building the set
 * inside a zustand selector would return a fresh Set every render and never
 * settle (the same trap `GroupChatScreen` documents for `selectMyCommunity`).
 *
 * This set alone is NOT enough for the chat list or the redirect: an empty set
 * on a cold start is indistinguishable from "this community has no lounge".
 * Those callers use `collectKnownLounges`, which also reports which
 * communities have actually been resolved.
 */
export function collectLoungeGroupIds(
  detailBySlug: CommunityState['detailBySlug'],
  channelsById: CommunityState['channelsById']
): Set<string> {
  const ids = new Set<string>();
  for (const detail of Object.values(detailBySlug)) {
    if (detail.lounge_group_id) ids.add(detail.lounge_group_id);
  }
  for (const channels of Object.values(channelsById)) {
    if (channels.loungeGroupId) ids.add(channels.loungeGroupId);
  }
  return ids;
}

/**
 * The lounge ids this session knows, PLUS the communities it has actually
 * resolved — including every community on the membership list, which loads
 * early and now carries `lounge_group_id`. Callers that must not guess
 * "board" (the chat list, the GroupChat redirect, the channel router) use
 * this rather than the bare id set.
 */
export function collectKnownLounges(
  detailBySlug: CommunityState['detailBySlug'],
  channelsById: CommunityState['channelsById'],
  myCommunities: CommunityState['myCommunities']
): KnownCommunityLounges {
  const loungeGroupIds = collectLoungeGroupIds(detailBySlug, channelsById);
  const resolvedCommunityIds = new Set<string>();
  for (const detail of Object.values(detailBySlug)) {
    if (detail.id) resolvedCommunityIds.add(detail.id);
  }
  for (const channels of Object.values(channelsById)) {
    if (channels.communityId) resolvedCommunityIds.add(channels.communityId);
  }
  for (const mine of myCommunities) {
    // `undefined` = a payload from before the membership list carried the
    // pointer (a stale cache entry across a deploy): still unresolved, so the
    // caller keeps treating that community's groups as chats.
    if (mine.lounge_group_id === undefined) continue;
    resolvedCommunityIds.add(mine.id);
    if (mine.lounge_group_id) loungeGroupIds.add(mine.lounge_group_id);
  }
  return { loungeGroupIds, resolvedCommunityIds };
}

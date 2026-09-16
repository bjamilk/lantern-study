/**
 * Communities: the one navigation contract, and the five effects that keep the
 * community column, its URL and the chats list agreeing with each other.
 *
 * Exports: `useCommunityNavigation`. The §7 board-handoff rule that used to sit
 *  inside the same JSX tree is next door, in utils/boardHandoff.ts.
 * Touches: `stores/communityStore` (loadMine / invalidate / detail), the UI
 *  store's `activeCommunity`, `stores/groupStore` (the just-joined stub and the
 *  post-join refetch), `services/supabase` (joinDiscoverableGroup,
 *  openCommunityLounge, fetchGroups), and `window.location` where
 *  the code already read it.
 * Gotchas:
 *  - Moved verbatim out of App.tsx (M7), comments and FIXED markers included.
 *  - The five effects register HERE, in the order they were written in App.tsx,
 *    and that order is behaviour: the column-close effect must see a mode
 *    change before the slug-seed effect re-seeds `activeCommunity` from the
 *    URL, or a community page flickers closed. Relative to the rest of App.tsx
 *    they now all sit at this hook's call site, which is why the call is placed
 *    immediately after `useLocation()` — everything they used to be interleaved
 *    with (the library title, the session-expired registration, the suspension
 *    clear, the previous-path ref) touches none of the state they touch.
 *  - `communityActionBusy` is a ref, not state, on purpose: it has to block the
 *    second click in the SAME tick, before any re-render.
 *  - Its contract test is apps/web/src/useCommunityNavigation.test.ts.
 */
import React, { useEffect } from 'react';
import { AppMode } from '../types';
import type { ChatItem, Group, User } from '../types';
import type { Location } from 'react-router-dom';
import { COMMUNITY_COPY } from '@lantern/shared/network';
import type { CommunityDetail, MyCommunity } from '@lantern/shared/network';
import { useCommunityStore } from '../stores/communityStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import type { ActiveCommunity, StudyRoomJoin } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { fetchGroups, joinDiscoverableGroup, openCommunityLounge } from '../services/supabase';
import { parseAppRoute } from '../utils/appRoutes';
import type { AppRouteParams, ParsedAppRoute } from '../utils/appRoutes';
import type { ToastType } from '../components/ui/ToastBanner';
import type { CommunityNavigate } from '../components/community/communityNavigation';

/** Exactly what App.tsx hands this hook. Wide because the code it holds was. */
export interface UseCommunityNavigationParams {
    appMode: AppMode;
    currentUser: User | null;
    location: Location<unknown>;
    groups: Group[];
    selectedChat: ChatItem | null;
    setSelectedChat: (chat: ChatItem | null) => void;
    selectedChatIsBoard: boolean;
    myCommunities: MyCommunity[];
    activeCommunity: ActiveCommunity | null;
    activeCommunityDetail: CommunityDetail | undefined;
    setActiveCommunity: (community: ActiveCommunity | null) => void;
    handleSelectChat: (chat: ChatItem, options?: { keepSurface?: boolean }) => void;
    handleInitiateDm: (otherUserId: string) => Promise<void>;
    setAppMode: (mode: AppMode) => void;
    navigateTo: (mode: AppMode, params?: AppRouteParams, options?: { replace?: boolean }) => void;
    showToast: (message: string, type?: ToastType) => void;
    setDiscoverSection: React.Dispatch<
        React.SetStateAction<'marketplace' | 'groups' | 'communities' | 'people' | 'rooms'>
    >;
    setStudyRoomJoin: (join: StudyRoomJoin | null) => void;
    setSelectedStudyRoomId: (id: string | null) => void;
    setCreateLabCommunity: React.Dispatch<
        React.SetStateAction<{ id: string; name: string; courseId: string | null } | null>
    >;
    setCreateLabOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setCreateGroupPreset: React.Dispatch<React.SetStateAction<{
        communityId: string;
        communityName: string;
        communitySlug: string;
        communitySurface: 'board' | 'study_group';
        prefillName?: string;
        announceInGroupId?: string;
    } | null>>;
    setCreateGroupReturnMode: React.Dispatch<React.SetStateAction<AppMode>>;
}

/** What App.tsx reads back. */
export interface UseCommunityNavigationResult {
    communityRoute: ParsedAppRoute | null;
    communityChannelId: string | null;
    selectedChatCommunityId: string | null;
    handleCommunityNavigate: CommunityNavigate;
    openCommunityChannel: (params: Record<string, unknown>) => void;
    openDiscoverGroup: (params?: Record<string, unknown>) => void;
}

export function useCommunityNavigation({
    appMode,
    currentUser,
    location,
    groups,
    selectedChat,
    setSelectedChat,
    selectedChatIsBoard,
    myCommunities,
    activeCommunity,
    activeCommunityDetail,
    setActiveCommunity,
    handleSelectChat,
    handleInitiateDm,
    setAppMode,
    navigateTo,
    showToast,
    setDiscoverSection,
    setStudyRoomJoin,
    setSelectedStudyRoomId,
    setCreateLabCommunity,
    setCreateLabOpen,
    setCreateGroupPreset,
    setCreateGroupReturnMode,
}: UseCommunityNavigationParams): UseCommunityNavigationResult {
    // Re-entrancy guard for the community actions that hit the server and then
    // navigate (join channel, open/mint lounge, open study group). A ref, not
    // state: it must block the second click within the same tick, before any
    // re-render, or a double tap mints or joins twice.
    const communityActionBusy = React.useRef(false);
    // The community column lives only on the community's own modes (its home,
    // its channels, a room opened from it). Anything else closes it.
    useEffect(() => {
        if (appMode === AppMode.COMMUNITY_DETAIL || appMode === AppMode.STUDY_ROOM) return;
        // Route hydration seeds the community a microtask before it flips the
        // mode; a render in between must not wipe what it just set.
        if (parseAppRoute(window.location.pathname).mode === AppMode.COMMUNITY_DETAIL) return;
        if (useUIStore.getState().activeCommunity) setActiveCommunity(null);
    }, [appMode, setActiveCommunity]);
    // The membership list carries each community's lounge pointer, so the chat
    // list can tell a lounge from a board on a cold page load. Until it lands,
    // a community's groups stay chats — never the reverse (§0a decision 1).
    // Driven by `currentUser?.id` alone: memberships are per account, and the
    // store dedupes, so a re-run on any other dep would be a wasted round trip.
    React.useEffect(() => {
        if (!currentUser?.id) return;
        void useCommunityStore.getState().loadMine().catch(() => {});
    }, [currentUser?.id]);
    /** Chat id whose community membership has already been re-requested once (F9). */
    const boardSlugResolveRef = React.useRef<string | null>(null);
    // Closing the Chat-tab bypass (spec §5.2 / §4.5): a board reached by a
    // direct route replaces itself with the community page, which renders the
    // board. It is not refused and it never falls back to a chat.
    // Driven by `selectedChatIsBoard` + `selectedChat`: a board can only become
    // selected through the chats list or a direct route, and both change those.
    // FIXED (F9): when the slug could not be resolved this effect only
    // re-requested memberships and returned, while AppMode.CHAT renders the
    // loading fallback for a board — so a membership that never loaded (offline,
    // or the student had been removed from the community) left a PERMANENT
    // spinner with no way back. It now asks for memberships exactly once per
    // board, and when the reload finishes with the slug still missing it says so
    // and returns to the chats list. The give-up runs off the reload's own
    // settle, not off a `myCommunities` change, because the case that produced
    // the spinner is the one where that array never changes at all.
    useEffect(() => {
        if (!selectedChatIsBoard || !selectedChat) return;
        const chatId = selectedChat.id;
        const communityId = (selectedChat as unknown as Group).communityId;
        const slug = myCommunities.find((c) => c.id === communityId)?.slug;
        if (!slug) {
            if (boardSlugResolveRef.current === chatId) return;
            boardSlugResolveRef.current = chatId;
            let cancelled = false;
            void useCommunityStore
                .getState()
                .loadMine()
                .catch(() => {})
                .finally(() => {
                    if (cancelled) return;
                    const resolved = useCommunityStore
                        .getState()
                        .myCommunities.find((c) => c.id === communityId)?.slug;
                    if (resolved) return;
                    // Still nothing: this board is not reachable for this user.
                    boardSlugResolveRef.current = null;
                    setSelectedChat(null);
                    navigateTo(AppMode.CHAT, {}, { replace: true });
                    showToast(
                        'That board could not be opened. You may have left the community, or you are offline.',
                        'error'
                    );
                });
            return () => {
                cancelled = true;
            };
        }
        boardSlugResolveRef.current = null;
        const postId = parseAppRoute(window.location.pathname).params.postId;
        navigateTo(AppMode.COMMUNITY_DETAIL, {
            slug,
            groupId: selectedChat.id,
            ...(postId ? { postId } : {}),
        });
    }, [selectedChatIsBoard, selectedChat, myCommunities, navigateTo, setSelectedChat, showToast]);
    // A community channel opened from the plain chats list shows `in <Community>`
    // in its header; memberships resolve the id to a name + slug.
    const selectedChatCommunityId =
        selectedChat?.chatType === 'group' ? (selectedChat.communityId ?? null) : null;
    useEffect(() => {
        if (!selectedChatCommunityId || !currentUser?.id) return;
        void useCommunityStore.getState().loadMine().catch(() => {});
    }, [selectedChatCommunityId, currentUser?.id]);
    // `/discover/c/:slug/ch/:groupId` — the community owns its chat, so the
    // channel id is read from the URL, never from a switch to AppMode.CHAT.
    const communityRoute = appMode === AppMode.COMMUNITY_DETAIL ? parseAppRoute(location.pathname) : null;
    const communityChannelId = communityRoute?.params?.groupId ?? null;
    const communityRouteSlug = communityRoute?.params?.slug ?? null;
    // Belt and braces for the column: whatever path led here, the community
    // page always has an active community matching its URL (the column then
    // resolves the placeholder by slug).
    useEffect(() => {
        if (!communityRouteSlug) return;
        const current = useUIStore.getState().activeCommunity;
        if (!current || current.slug !== communityRouteSlug) {
            setActiveCommunity({ id: '', slug: communityRouteSlug, name: '', loungeGroupId: null });
        }
    }, [communityRouteSlug, setActiveCommunity]);
    // A just-joined discoverable group is not in `groups[]` until the next
    // fetch; this stand-in carries enough (communityId above all) for the
    // chat and the community column to render until the store reconciles.
    const buildDiscoverGroupStub = (params: Record<string, unknown>) => ({
        id: String(params.groupId),
        name: String(params.groupName || 'Group'),
        members: [] as User[],
        adminIds: [] as string[],
        unreadCount: 0,
        description: '',
        communityId: params.communityId ? String(params.communityId) : null,
        visibility: (params.communityId ? 'community' : 'public') as 'community' | 'public',
        memberCount: typeof params.memberCount === 'number' ? params.memberCount : undefined,
    });
    // Opening a group found in Discover. Already a member: select it and switch
    // to Chat. Just joined (`params.joined`): insert the stub first, because the
    // group list has not refetched yet. Neither joined nor known: do nothing —
    // selecting a group the user is not in would render an empty chat.
    const openDiscoverGroup = (params?: Record<string, unknown>) => {
        const groupId = String(params?.groupId || '');
        if (!groupId) return;
        const target = groups.find((x) => x.id === groupId);
        if (target) {
            handleSelectChat({ ...target, chatType: 'group' });
            setAppMode(AppMode.CHAT);
            return;
        }
        if (!params?.joined) return;
        const stub = buildDiscoverGroupStub(params);
        useGroupStore.getState().updateGroups((prev) =>
            prev.some((g) => g.id === groupId) ? prev : [...prev, stub]
        );
        handleSelectChat({ ...stub, chatType: 'group' });
        setAppMode(AppMode.CHAT);
    };
    /**
     * Open a channel INSIDE its community (founder rule §0a): the group is
     * selected through the same path the chats list uses — read-marking,
     * unread reset and realtime attach behave identically — but the app stays
     * on the community's own URL, `/discover/c/:slug/ch/:groupId`.
     */
    const openCommunityChannel = (params: Record<string, unknown>) => {
        const groupId = String(params.groupId || '');
        if (!groupId) return;
        const slug = String(
            params.communitySlug || activeCommunity?.slug || parseAppRoute(location.pathname).params?.slug || ''
        );
        if (!slug) {
            openDiscoverGroup(params);
            return;
        }
        let target = useGroupStore.getState().groups.find((x) => x.id === groupId);
        if (!target) {
            if (!params.joined) return;
            const stub = buildDiscoverGroupStub(params);
            useGroupStore.getState().updateGroups((prev) =>
                prev.some((g) => g.id === groupId) ? prev : [...prev, stub]
            );
            target = stub;
        }
        handleSelectChat({ ...target, chatType: 'group' }, { keepSurface: true });
        navigateTo(AppMode.COMMUNITY_DETAIL, { slug, groupId });
    };
    // The members list is rendered by a lazy screen, so the anchor may not exist
    // when the navigation completes: poll for it 20 times at 100 ms, then give
    // up silently (the user is already on the right page either way).
    const scrollToCommunityMembers = () => {
        let tries = 0;
        const tick = () => {
            const el = document.getElementById('community-members');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            if (tries++ < 20) window.setTimeout(tick, 100);
        };
        tick();
    };
    // The one navigation contract for the community column and page (spec §5.1).
    const handleCommunityNavigate: CommunityNavigate = async (screen, params = {}) => {
        const slugParam = String(params.slug || params.communitySlug || activeCommunity?.slug || '');
        switch (screen) {
            case 'Dashboard':
                navigateTo(AppMode.DASHBOARD);
                return;
            case 'Discover':
                setDiscoverSection('communities');
                navigateTo(AppMode.DISCOVER);
                return;
            case 'Home':
                if (slugParam) navigateTo(AppMode.COMMUNITY_DETAIL, { slug: slugParam });
                return;
            case 'CloseCommunity':
                setActiveCommunity(null);
                navigateTo(AppMode.CHAT, {});
                return;
            case 'Members':
                if (!slugParam) return;
                if (appMode !== AppMode.COMMUNITY_DETAIL || communityChannelId) {
                    navigateTo(AppMode.COMMUNITY_DETAIL, { slug: slugParam });
                }
                scrollToCommunityMembers();
                return;
            case 'DirectMessages':
                if (params?.userId) handleInitiateDm(String(params.userId));
                return;
            case 'GroupChat':
                openCommunityChannel(params);
                return;
            case 'JoinChannel': {
                const groupId = String(params.groupId || '');
                const communityId = String(params.communityId || '');
                if (!groupId || communityActionBusy.current) return;
                // Guests see public channels but join the community first (§6,
                // same as mobile's "Join the community to open" alert).
                if (activeCommunityDetail && activeCommunityDetail.id === communityId && !activeCommunityDetail.isMember) {
                    showToast(COMMUNITY_COPY.joinToOpen, 'info');
                    return;
                }
                communityActionBusy.current = true;
                try {
                    await joinDiscoverableGroup(groupId);
                    if (communityId) useCommunityStore.getState().invalidate(communityId);
                    openCommunityChannel({ ...params, joined: true });
                } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Could not join this channel', 'error');
                } finally {
                    communityActionBusy.current = false;
                }
                return;
            }
            case 'OpenLounge': {
                const communityId = String(params.communityId || activeCommunity?.id || '');
                if (!communityId || communityActionBusy.current) return;
                const known = useUIStore.getState().activeCommunity;
                const loungeId = known?.id === communityId ? known.loungeGroupId : null;
                const inStore = loungeId
                    ? useGroupStore.getState().groups.find((g) => g.id === loungeId && !g.isArchived)
                    : undefined;
                if (inStore) {
                    openCommunityChannel({
                        groupId: inStore.id,
                        groupName: inStore.name,
                        communityId,
                        communitySlug: slugParam,
                        joined: true,
                    });
                    return;
                }
                communityActionBusy.current = true;
                try {
                    // Idempotent: mints on first use, joins the caller either way.
                    const lounge = await openCommunityLounge(communityId);
                    const current = useUIStore.getState().activeCommunity;
                    if (current && current.id === communityId && current.loungeGroupId !== lounge.groupId) {
                        setActiveCommunity({ ...current, loungeGroupId: lounge.groupId });
                    }
                    useCommunityStore.getState().invalidate(communityId);
                    // Pull the real group in before selecting it. Minting the
                    // lounge joins the caller server-side, but the local groups
                    // list does not know that yet, so without this the first tap
                    // selected a stub with no members or messages and the pane
                    // stayed on the community home while the URL said channel.
                    // Mobile has always done this (CommunityDetailScreen).
                    const userId = useAuthStore.getState().currentUser?.id;
                    if (userId) {
                        try {
                            const refreshed = await fetchGroups(userId);
                            if (refreshed) useGroupStore.getState().setGroups(refreshed);
                        } catch {
                            // A failed refresh still opens the channel: the stub
                            // below keeps the tap working, and hydration retries.
                        }
                    }
                    openCommunityChannel({
                        groupId: lounge.groupId,
                        groupName: lounge.name,
                        communityId,
                        communitySlug: slugParam,
                        joined: true,
                    });
                } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Could not open the community chat', 'error');
                } finally {
                    communityActionBusy.current = false;
                }
                return;
            }
            case 'StudyRoom':
                if (params.roomId) {
                    setStudyRoomJoin(null);
                    setSelectedStudyRoomId(String(params.roomId));
                    navigateTo(AppMode.STUDY_ROOM, { roomId: String(params.roomId) });
                } else {
                    setSelectedStudyRoomId(null);
                    setStudyRoomJoin({
                        communityId: params.communityId ? String(params.communityId) : null,
                        courseId: params.courseId ? String(params.courseId) : null,
                        topic: params.topic ? String(params.topic) : null,
                    });
                    navigateTo(AppMode.STUDY_ROOM, {});
                }
                return;
            case 'CreateLab':
                setCreateLabCommunity({
                    id: String(params.communityId || activeCommunity?.id || ''),
                    name: String(params.communityName || activeCommunity?.name || activeCommunityDetail?.name || 'Community'),
                    courseId: params.courseId ? String(params.courseId) : null,
                });
                setCreateLabOpen(true);
                return;
            case 'OpenStudyGroup': {
                // A study group lives in Chat with the full study surface (§7).
                // Unjoined rows join first, then land in Chat — never on a board.
                const groupId = String(params.groupId || '');
                if (!groupId || communityActionBusy.current) return;
                const communityId = String(params.communityId || '');
                const openInChat = () => {
                    const target = useGroupStore.getState().groups.find((x) => x.id === groupId);
                    if (target) handleSelectChat({ ...target, chatType: 'group' });
                    navigateTo(AppMode.CHAT, {});
                };
                if (params.joined) {
                    openInChat();
                    return;
                }
                communityActionBusy.current = true;
                try {
                    await joinDiscoverableGroup(groupId);
                    if (communityId) useCommunityStore.getState().invalidate(communityId);
                    const userId = useAuthStore.getState().currentUser?.id;
                    if (userId) {
                        try {
                            const refreshed = await fetchGroups(userId);
                            if (refreshed) useGroupStore.getState().setGroups(refreshed);
                        } catch {
                            // A failed refresh still opens Chat; hydration retries.
                        }
                    }
                    openInChat();
                } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Could not open this study group', 'error');
                } finally {
                    communityActionBusy.current = false;
                }
                return;
            }
            case 'CreateGroup':
            case 'StartStudyGroup':
                setCreateGroupPreset({
                    communityId: String(params.communityId || activeCommunity?.id || ''),
                    communityName: String(params.communityName || activeCommunity?.name || activeCommunityDetail?.name || 'Community'),
                    communitySlug: slugParam,
                    communitySurface:
                        screen === 'StartStudyGroup' || params.communitySurface === 'study_group'
                            ? 'study_group'
                            : 'board',
                    prefillName: params.prefillName ? String(params.prefillName) : undefined,
                    announceInGroupId: params.announceInGroupId
                        ? String(params.announceInGroupId)
                        : undefined,
                });
                setCreateGroupReturnMode(AppMode.COMMUNITY_DETAIL);
                navigateTo(AppMode.CREATE_GROUP);
                return;
            default:
                return;
        }
    };

    return {
        communityRoute,
        communityChannelId,
        selectedChatCommunityId,
        handleCommunityNavigate,
        openCommunityChannel,
        openDiscoverGroup,
    };
}

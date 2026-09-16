/**
 * Group CRUD, membership and admin mutations, extracted verbatim from
 * `hooks/useGroupHandlers.ts`.
 *
 * Exports: useGroupMutations({ … }) — create (group and subgroup), enter, update
 *  details and avatar, invite / accept / decline / revoke, promote / demote,
 *  remove member, leave, delete, archive, approve / reject, plus
 *  `refreshGroupMembersInState` (@internal — the composer's group-info opener
 *  calls it to bust the roster cache) and `getAllSubgroupIDs`.
 * Touches: services/supabase (the group, membership, admin and invite endpoints),
 *  services/gamificationStreak, confirmStore for the destructive prompts,
 *  toastStore, appNavigation, and — through its parameters — the group, auth and
 *  UI store slices.
 * Gotchas:
 *  - Delete and revoke go through `planDeleteGroupConfirm` /
 *    `planRevokeInvitationConfirm`, which own the wording AND the subgroup
 *    cascade count. Deleting a parent deletes its whole subtree, which is what
 *    `getAllSubgroupIDs` is for.
 *  - Several handlers patch BOTH the list row and the open selection; a group the
 *    student is looking at while it changes must not keep rendering the old row.
 *  - `handleCreateGroup` stages the created group in `pendingCreatedGroupRef`, so
 *    the "enter group" step can open it without refetching.
 */
import { useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { User, Group, Message, AppMode, GroupPermissions } from '../../types';
import { useGroupStore } from '../../stores/groupStore';
import { useUIStore } from '../../stores/uiStore';
import { useToastStore } from '../../stores/toastStore';
import { mapGroupRow, mapGroupRows } from '@lantern/shared/groups';
import { formatActorLabel } from '@lantern/shared/utils';
import { initialUserStats } from '../../utils/helpers';
import { BADGE_DEFINITIONS } from '../../gamification';
import {
    createGroup, fetchGroups, fetchGroupMembers, addGroupMember, addGroupMembersBatch,
    uploadGroupAvatar, acceptGroupInvite, declineGroupInvite,
    createNotification, updateUserProfile, deleteGroup, updateGroup,
    promoteGroupAdmin, demoteGroupAdmin, removeGroupMember, leaveGroup,
    fetchUserVotesForGroup, fetchMessages, markGroupAsRead,
} from '../../services/supabase';
import { confirmDialog } from '../../stores/confirmStore';
import { planDeleteGroupConfirm, planRevokeInvitationConfirm } from '../../utils/destructiveConfirm';
import { syncGamificationProgress } from '../../services/gamificationStreak';
import { navigateForAppMode } from '../../utils/appNavigation';
import { mergeFetchedGroups } from '../../utils/groupListMerge';
import { mapApiGroupMembers } from './normalisers';
import type { AddNotification, AuthStoreState, GroupStoreState, HandleSelectChat, UIStoreState } from './types';

export interface UseGroupMutationsParams
    extends Pick<AuthStoreState, 'currentUser' | 'setCurrentUser'>,
        Pick<GroupStoreState, 'groups' | 'updateGroups' | 'updateMessages'>,
        Pick<
            UIStoreState,
            'selectedChat' | 'setSelectedChat' | 'setAppMode' | 'openModal' | 'closeModal' | 'setSubgroupParentId'
        > {
    users: User[];
    handleSelectChat: HandleSelectChat;
    addNotification: AddNotification;
}

export function useGroupMutations({
    currentUser,
    setCurrentUser,
    users,
    groups,
    updateGroups,
    updateMessages,
    selectedChat,
    setSelectedChat,
    setAppMode,
    openModal,
    closeModal,
    setSubgroupParentId,
    handleSelectChat,
    addNotification,
}: UseGroupMutationsParams) {
    /** Staged by handleCreateGroup so handleEnterCreatedGroup can open it without a refetch. */
    const pendingCreatedGroupRef = useRef<any>(null);
    const handleCloseCreateGroupModal = useCallback(() => {
        closeModal('createGroup');
        setSubgroupParentId(undefined);
    }, [closeModal, setSubgroupParentId]);

    // ── Group creation ────────────────────────────────────────────────────────
    // Subgroup: created with no members (the creator only), appended locally and opened right
    // away; the emails string is kept as `memberEmails` for the invite UI, not sent as members.
    const handleCreateSubGroup = useCallback(async (name: string, description: string, memberEmailsStr: string, parentId?: string, courseId?: string | null) => {
        if (!currentUser) return;
      
        try {
            const groupData = {
                name,
                description,
                avatar_url: undefined,
                permissions: {},
                invite_id: uuidv4().substring(0, 8),
                parent_id: parentId,
                ...(courseId !== undefined ? { courseId } : {}),
            };
            
            const newGroup = await createGroup(groupData, currentUser.id, []);
            
            const mappedGroup: Group = {
                id: newGroup.id,
                name: newGroup.name,
                description: newGroup.description,
                avatarUrl: newGroup.avatarUrl,
                members: [currentUser],
                adminIds: newGroup.adminIds || [currentUser.id],
                parentId: newGroup.parentId,
                memberEmails: [currentUser.email!, ...memberEmailsStr.split(',').map(e => e.trim()).filter(Boolean)],
                inviteId: newGroup.inviteId,
                courseId: newGroup.courseId ?? newGroup.course_id ?? courseId ?? null,
                unreadCount: 0,
                pendingMembers: [],
                isArchived: newGroup.isArchived,
            };
            
            updateGroups(prev => [...prev, mappedGroup]);
            handleSelectChat({ ...mappedGroup, chatType: 'group' });
            updateMessages(prev => ({...prev, [mappedGroup.id]: []}));
            handleCloseCreateGroupModal();
        } catch (error) {
            console.error('Failed to create subgroup:', error);
            alert('Failed to create subgroup. Please try again.');
        }
    }, [currentUser, updateGroups, handleSelectChat, updateMessages, handleCloseCreateGroupModal]);

    // Full group creation. Avatar upload is best-effort and never fails the create (the group
    // already exists by then). Afterwards the whole groups list is refetched and remapped —
    // field-for-field the same mapping as the bootstrap and membership-realtime paths — and
    // navigation is DEFERRED into pendingCreatedGroupRef so the create screen can show its
    // invite-link step before handleEnterCreatedGroup opens the chat.
    const handleCreateGroup = useCallback(async (details: { name: string; description: string; avatarFile: File | null; memberIds: string[]; permissions: GroupPermissions; courseId?: string | null; visibility?: 'private' | 'community' | 'public'; communityId?: string | null; communitySurface?: 'board' | 'study_group' }) => {
        if (!currentUser) return;

        try {
            const groupData = {
                name: details.name,
                description: details.description,
                avatar_url: undefined as string | undefined,
                permissions: details.permissions,
                invite_id: uuidv4().substring(0, 8),
                parent_id: undefined,
                ...(details.courseId !== undefined ? { courseId: details.courseId } : {}),
                ...(details.visibility ? { visibility: details.visibility } : {}),
                ...(details.communityId !== undefined ? { communityId: details.communityId } : {}),
                // Board vs study group (spec §3.7). Ignored server-side without
                // a communityId; 'study_group' 503s pre-migration.
                ...(details.communitySurface ? { communitySurface: details.communitySurface } : {}),
            };
            const newGroup = await createGroup(groupData, currentUser.id, details.memberIds);

            if (details.avatarFile) {
                try {
                    const { compressImage } = await import('../../utils/imageCompression');
                    const base64Avatar = await compressImage(details.avatarFile, {
                        maxWidth: 150,
                        maxHeight: 150,
                        quality: 0.7,
                        outputType: 'base64',
                    }) as string;
                    await uploadGroupAvatar(
                        newGroup.id,
                        'avatar.webp',
                        base64Avatar.includes(',') ? base64Avatar.split(',')[1]! : base64Avatar,
                        'image/webp'
                    );
                } catch (avatarError) {
                    console.warn('Group created but avatar upload failed:', avatarError);
                }
            }
            
            // Fetch groups and members for the new group in parallel
            const [fetchedGroups, fetchedMembers] = await Promise.all([
                fetchGroups(currentUser.id),
                fetchGroupMembers(newGroup.id, { bustCache: details.memberIds.length > 0 }),
            ]);

            const mappedMembers = mapApiGroupMembers(fetchedMembers);

            // The row → `Group` mapping is `mapGroupRows` (@lantern/shared/groups);
            // only the merge with local state (unread, pending members, an
            // already-loaded roster) belongs here.
            updateGroups((prev) => {
                const prevById = new Map(prev.map((g) => [g.id, g]));
                return mapGroupRows(fetchedGroups).map((g) => {
                    const existing = prevById.get(g.id);
                    return {
                        ...g,
                        unreadCount: existing?.unreadCount || 0,
                        pendingMembers: existing?.pendingMembers || [],
                        invitedPhoneNumbers: existing?.invitedPhoneNumbers || [],
                        members: g.id === newGroup.id
                            ? mappedMembers
                            : (existing?.members?.length ? existing.members : []),
                    };
                });
            });
            
            // What the creator just asked for is the fallback for anything the
            // create response omits (a pre-migration server answers without
            // `community_surface`, and the row is written before we see it).
            const mappedNewGroup = {
                ...mapGroupRow(newGroup, {
                    viewerId: currentUser.id,
                    fallback: {
                        adminIds: [currentUser.id],
                        courseId: details.courseId ?? null,
                        visibility: details.visibility,
                        communityId: details.communityId ?? null,
                        communitySurface: details.communitySurface ?? null,
                    },
                }),
                unreadCount: 0,
                pendingMembers: [],
                invitedPhoneNumbers: [],
                members: mappedMembers,
                chatType: 'group' as const
            };

            // Defer navigation so CreateGroupScreen can show invite link success step
            updateMessages(prev => ({ ...prev, [newGroup.id]: [] }));
            pendingCreatedGroupRef.current = mappedNewGroup;

            // Gamification is server-owned: syncGamificationProgress returns the authoritative
            // points/badges/stats and any newly awarded badges to announce. `updatedStats`
            // below is a leftover local projection and is not used.
            if (currentUser) {
                const updatedStats = {
                    ...currentUser.stats,
                    groupsCreated: (currentUser.stats.groupsCreated || 0) + 1,
                };

                void syncGamificationProgress()
                    .then((synced) => {
                        setCurrentUser({
                            ...currentUser,
                            points: synced.points,
                            badges: synced.badges,
                            stats: synced.stats,
                        });
                        (synced.awardedBadges || []).forEach(badge => {
                            const badgeDef = BADGE_DEFINITIONS[badge.id];
                            const levelInfo = badgeDef?.levels.find(l => l.level === badge.level);
                            addNotification(`Badge Unlocked: ${badge.name}! You've earned ${levelInfo?.points || 0} points.`);
                        });
                    })
                    .catch(error => console.error('Failed to sync gamification after group create:', error));
            }

            return {
                id: mappedNewGroup.id,
                name: mappedNewGroup.name,
                inviteId: mappedNewGroup.inviteId || groupData.invite_id,
            };
        } catch (error) {
            console.error('Error creating group:', error);
            alert('Failed to create group. Please try again.');
            throw error;
        }
    }, [currentUser, setCurrentUser, updateGroups, updateMessages, addNotification]);

    // Second half of the deferred navigation: prefers the fully-mapped group stashed by
    // handleCreateGroup, and falls back to a minimal shell if the ref was already consumed
    // (e.g. a reload between the two steps).
    const handleEnterCreatedGroup = useCallback((summary: { id: string; name: string; inviteId: string }) => {
        const pending = pendingCreatedGroupRef.current;
        const group =
            pending && pending.id === summary.id
                ? pending
                : {
                      id: summary.id,
                      name: summary.name,
                      inviteId: summary.inviteId,
                      members: currentUser ? [currentUser] : [],
                      adminIds: currentUser ? [currentUser.id] : [],
                      unreadCount: 0,
                      pendingMembers: [],
                      invitedPhoneNumbers: [],
                      chatType: 'group' as const,
                  };
        pendingCreatedGroupRef.current = null;
        handleSelectChat(group);
        setAppMode(AppMode.CHAT);
    }, [currentUser, handleSelectChat, setAppMode]);

    const onOpenCreateSubGroupModal = useCallback((parentId: string) => {
        setSubgroupParentId(parentId);
        openModal('createGroup');
    }, [setSubgroupParentId, openModal]);

    // ── Group settings ────────────────────────────────────────────────────────
    // Server-first, then patch both the list row and the open selection. `communityId` uses
    // an `'communityId' in discovery` check rather than a truthiness test so an explicit null
    // (detach from community) is sent, while an absent key leaves it unchanged.
    const handleUpdateGroupDetails = useCallback(async (
        groupId: string,
        name: string,
        description: string,
        discovery?: { visibility?: 'private' | 'community' | 'public'; communityId?: string | null }
    ) => {
        try {
            await updateGroup(groupId, {
                name,
                description,
                ...(discovery?.visibility ? { visibility: discovery.visibility } : {}),
                ...(discovery && 'communityId' in discovery ? { communityId: discovery.communityId ?? null } : {}),
            });
            updateGroups(prev => prev.map(g => g.id === groupId ? {
                ...g,
                name,
                description,
                ...(discovery?.visibility ? { visibility: discovery.visibility } : {}),
                ...(discovery && 'communityId' in discovery ? { communityId: discovery.communityId ?? null } : {}),
            } : g));
            if (selectedChat?.id === groupId) {
                setSelectedChat(prev => {
                    if (prev?.chatType === 'group') {
                        return {
                            ...prev,
                            name,
                            description,
                            ...(discovery?.visibility ? { visibility: discovery.visibility } : {}),
                            ...(discovery && 'communityId' in discovery ? { communityId: discovery.communityId ?? null } : {}),
                        };
                    }
                    return prev;
                });
            }
            useToastStore.getState().showToast('Group details updated.', 'success');
        } catch (error) {
            useToastStore.getState().showToast(
                error instanceof Error ? error.message : 'Could not update group details.',
                'error'
            );
        }
    }, [selectedChat, updateGroups, setSelectedChat]);

    // Strips the data-URL prefix and uploads the raw base64 with its real content type; the
    // stored value is always the returned URL, never the data URL. Rethrows so the picker can
    // show the failure.
    const handleUpdateGroupAvatar = useCallback(async (groupId: string, avatarDataUrl: string) => {
        try {
            const base64Data = avatarDataUrl.includes(',')
                ? avatarDataUrl.split(',')[1]!
                : avatarDataUrl;
            const mimeMatch = avatarDataUrl.match(/^data:([^;]+);/);
            const contentType = mimeMatch?.[1] || 'image/webp';
            const uploaded = await uploadGroupAvatar(
                groupId,
                contentType === 'image/png' ? 'avatar.png' : 'avatar.webp',
                base64Data,
                contentType
            );
            const avatarUrl = uploaded.avatarUrl;
            updateGroups(prevGroups =>
                prevGroups.map(group =>
                    group.id === groupId ? { ...group, avatarUrl } : group
                )
            );
            if (selectedChat?.id === groupId) {
                setSelectedChat(prev => {
                    if (prev?.chatType === 'group') {
                        return { ...prev, avatarUrl };
                    }
                    return prev;
                });
            }
        } catch (error) {
            console.error('Failed to upload group avatar:', error);
            throw error;
        }
    }, [selectedChat, updateGroups, setSelectedChat]);

    // ── Membership & admin ────────────────────────────────────────────────────
    // Roster writes always go to BOTH the groups list and the open selection, which hold
    // separate copies; updating only one leaves @mentions or the member sheet stale.
    const applyGroupMembersToState = useCallback((groupId: string, mappedMembers: User[]) => {
        updateGroups(prevGroups => prevGroups.map(g =>
            g.id === groupId ? { ...g, members: mappedMembers } : g
        ));
        setSelectedChat(prevSelected => {
            if (prevSelected && prevSelected.id === groupId && prevSelected.chatType === 'group') {
                return { ...prevSelected, members: mappedMembers };
            }
            return prevSelected;
        });
    }, [updateGroups, setSelectedChat]);

    const refreshGroupMembersInState = useCallback(async (groupId: string) => {
        const fetchedMembers = await fetchGroupMembers(groupId, { bustCache: true });
        const mappedMembers = mapApiGroupMembers(fetchedMembers);
        applyGroupMembersToState(groupId, mappedMembers);
        return mappedMembers;
    }, [applyGroupMembersToState]);

    // Batch invite. Invites are PENDING until accepted, so the roster is refetched rather
    // than optimistically extended — an invitee must not appear as a member. A response with
    // neither invited nor already-pending entries is treated as a failure and rethrown.
    const handleInviteMembers = useCallback(async (groupId: string, userIdsToAdd: string[]) => {
        if (userIdsToAdd.length === 0) {
            closeModal('addMembers');
            return;
        }

        try {
            const result = await addGroupMembersBatch(groupId, userIdsToAdd);
            const invited = result?.invited?.length ? result.invited : (result?.added || []);
            const alreadyPending = result?.alreadyPending || [];

            if (!invited.length && !alreadyPending.length) {
                throw new Error(
                    result?.failed?.length
                        ? 'Failed to send invites. Please try again.'
                        : 'No new invites were sent (they may already be in the group).'
                );
            }

            // Invites are pending until accepted — refresh active members only (do not force-add).
            const mappedMembers = mapApiGroupMembers(
                await fetchGroupMembers(groupId, { bustCache: true })
            );
            applyGroupMembersToState(groupId, mappedMembers);
        } catch (error) {
            console.error('Error inviting members to group:', error);
            throw error;
        }
    }, [applyGroupMembersToState, closeModal]);

    // Accepting an invite refetches the whole list and folds it into the one on
    // screen, then overwrites the roster of the group just joined.
    // FIXED (F9): this used to be a hand-written full REPLACE (`setGroups`) of a
    // sixth inline copy of the group mapper, with `unreadCount: 0` hardcoded on
    // every row — so accepting one invite wiped the unread badge on every OTHER
    // group until the next unread-count fetch, and dropped `communitySurface`
    // the way the two copies R2 deleted did. It now goes through the shared
    // `mergeFetchedGroups`, carrying each group's existing unread count over
    // rather than issuing a second request for counts that have not changed.
    const handleAcceptGroupInvite = useCallback(async (groupId: string) => {
        if (!currentUser) throw new Error('Not signed in');
        const group = await acceptGroupInvite(groupId);
        const [fetchedGroups, fetchedMembers] = await Promise.all([
            fetchGroups(currentUser.id),
            fetchGroupMembers(groupId, { bustCache: true }),
        ]);
        const mappedMembers = mapApiGroupMembers(fetchedMembers);
        updateGroups((prev) => {
            const carriedUnread = Object.fromEntries(
                prev.map((g) => [g.id, g.unreadCount || 0])
            ) as Record<string, number>;
            return mergeFetchedGroups(fetchedGroups, prev, carriedUnread).map((g) =>
                g.id === groupId ? { ...g, members: mappedMembers } : g
            );
        });
        return group;
    }, [currentUser, updateGroups]);

    const handleDeclineGroupInvite = useCallback(async (groupId: string) => {
        await declineGroupInvite(groupId);
    }, []);

    // KNOWN ISSUE (tracked, deferred F9: needs a schema change — the API has no
    // group-invite revoke endpoint at all. `routes/groups.ts` exposes create /
    // accept / decline and nothing that cancels a pending invite, and the email
    // and phone invitations are not even stored as rows a client could address.
    // Communities have `revokeInvite` (routes/communities.ts:207); groups have
    // no equivalent to call): both revoke handlers only filter the invitee out
    // of local state after the confirm — there is no server call, so the
    // invitation is still live and the entry reappears on the next groups fetch.
    const handleRevokeInvitation = useCallback(async (groupId: string, email: string) => {
        if (!(await confirmDialog(planRevokeInvitationConfirm({ invitee: email })))) return;
        updateGroups(prev => prev.map(g => {
            if (g.id === groupId) {
                return { ...g, memberEmails: (g.memberEmails || []).filter(e => e !== email) };
            }
            return g;
        }));
    }, [updateGroups]);

    const handleRevokePhoneInvitation = useCallback(async (groupId: string, phoneNumber: string) => {
        if (!(await confirmDialog(planRevokeInvitationConfirm({ invitee: phoneNumber })))) return;
        updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, invitedPhoneNumbers: (g.invitedPhoneNumbers || []).filter(p => p !== phoneNumber) } : g));
    }, [updateGroups]);

    // Promote / demote: server-first, and local state is only patched from the adminIds the
    // server returns. Demote refuses to remove the last admin (the same rule the leave and
    // remove-member handlers enforce), and notifies the affected user unless it is self.
    const handlePromoteToAdmin = useCallback(async (groupId: string, userId: string) => {
        const group = groups.find(g => g.id === groupId);
        const user = users.find(u => u.id === userId);

        try {
            const updatedGroup = await promoteGroupAdmin(groupId, userId);
            if (updatedGroup?.adminIds) {
                updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, adminIds: updatedGroup.adminIds } : g));
                if (selectedChat?.id === groupId && selectedChat?.chatType === 'group') {
                    setSelectedChat(prev => prev?.chatType === 'group' ? { ...prev, adminIds: updatedGroup.adminIds } : prev);
                }
            }
        } catch (error) {
            console.error('Failed to promote admin:', error);
            alert('Failed to promote member to admin.');
            return;
        }

        if (group && user && currentUser && userId !== currentUser.id) {
            try {
                createNotification({
                    user_id: userId,
                    message: `You've been promoted to admin in "${group.name}" by ${formatActorLabel(currentUser)}`,
                    link: `/chat/${groupId}`
                }).catch(error => console.error('Failed to create promotion notification:', error));
            } catch (error) {
                console.error('Failed to create promotion notification:', error);
            }
        }
    }, [groups, users, currentUser, selectedChat, updateGroups, setSelectedChat]);

    const handleDemoteAdmin = useCallback(async (groupId: string, userId: string) => {
        const groupToUpdate = groups.find(g => g.id === groupId);
        if (!groupToUpdate) return;
    
        if (groupToUpdate.adminIds.length <= 1 && groupToUpdate.adminIds.includes(userId)) {
            alert("Cannot demote the only admin of the group.");
            return;
        }

        try {
            const updatedGroup = await demoteGroupAdmin(groupId, userId);
            const newAdminIds = updatedGroup?.adminIds || groupToUpdate.adminIds.filter(id => id !== userId);
            updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, adminIds: newAdminIds } : g));
            if (selectedChat?.id === groupId) {
                setSelectedChat(prev => prev?.chatType === 'group' ? { ...prev, adminIds: newAdminIds } : prev);
            }

            const user = users.find(u => u.id === userId);
            if (groupToUpdate && user && currentUser && userId !== currentUser.id) {
                createNotification({
                    user_id: userId,
                    message: `You've been demoted from admin in "${groupToUpdate.name}" by ${formatActorLabel(currentUser)}`,
                    link: `/chat/${groupId}`
                }).catch(error => console.error('Failed to create demotion notification:', error));
            }
        } catch (error) {
            console.error('Failed to demote admin:', error);
            alert('Failed to demote admin.');
        }
    }, [groups, users, currentUser, selectedChat, updateGroups, setSelectedChat]);

    // Remove member: never self, never the last admin, always confirmed. Server-first; on
    // success the member is dropped from both the roster and adminIds locally.
    const handleRemoveGroupMember = useCallback(async (groupId: string, userId: string) => {
        if (!currentUser || userId === currentUser.id) return;
        const group = groups.find((g) => g.id === groupId) ||
          (selectedChat?.chatType === 'group' && selectedChat.id === groupId ? selectedChat : null);
        if (!group) return;

        const member =
          (group.members || []).find((m) => m.id === userId) ||
          users.find((u) => u.id === userId);
        const memberName = member?.name || 'this member';

        if (
          Array.isArray(group.adminIds) &&
          group.adminIds.includes(userId) &&
          group.adminIds.length <= 1
        ) {
          useToastStore.getState().showToast('Cannot remove the only admin of the group.', 'error');
          return;
        }

        const confirmed = await confirmDialog({
          title: 'Remove member',
          message: `Remove ${memberName} from "${group.name}"?`,
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!confirmed) return;

        try {
          await removeGroupMember(groupId, userId);
          const nextMembers = (group.members || []).filter((m) => m.id !== userId);
          const nextAdminIds = (group.adminIds || []).filter((id) => id !== userId);
          updateGroups((prev) =>
            prev.map((g) =>
              g.id === groupId ? { ...g, members: nextMembers, adminIds: nextAdminIds } : g
            )
          );
          if (selectedChat?.chatType === 'group' && selectedChat.id === groupId) {
            setSelectedChat((prev) =>
              prev?.chatType === 'group'
                ? { ...prev, members: nextMembers, adminIds: nextAdminIds }
                : prev
            );
          }
          useToastStore.getState().showToast(`${memberName} was removed from the group.`, 'success');
        } catch (error) {
          console.error('Failed to remove group member:', error);
          useToastStore
            .getState()
            .showToast(
              error instanceof Error ? error.message : 'Failed to remove member.',
              'error'
            );
        }
    }, [currentUser, groups, users, selectedChat, updateGroups, setSelectedChat]);

    // Leave: blocked for the sole admin (a group must never be left adminless), confirmed,
    // then server-first. On success the group and its cached messages are dropped and the
    // chat is deselected if it was open.
    const handleLeaveGroup = useCallback(async (groupId: string) => {
        if (!currentUser) return;
        const group = groups.find((g) => g.id === groupId) ||
          (selectedChat?.chatType === 'group' && selectedChat.id === groupId ? selectedChat : null);
        if (!group) return;

        const isSoleAdmin =
          Array.isArray(group.adminIds) &&
          group.adminIds.includes(currentUser.id) &&
          group.adminIds.length <= 1;
        if (isSoleAdmin) {
          useToastStore.getState().showToast(
            'Cannot leave as the only admin. Promote another member first.',
            'error',
          );
          return;
        }

        const confirmed = await confirmDialog({
          title: 'Leave group',
          message: `Leave "${group.name}"? You will lose access until someone invites you again.`,
          confirmLabel: 'Leave',
          danger: true,
        });
        if (!confirmed) return;

        try {
          await leaveGroup(groupId);
          updateGroups((prev) => prev.filter((g) => g.id !== groupId));
          updateMessages((prev) => {
            const next = { ...prev };
            delete next[groupId];
            return next;
          });
          if (selectedChat?.chatType === 'group' && selectedChat.id === groupId) {
            setSelectedChat(null);
          }
          closeModal('groupInfo');
          useToastStore.getState().showToast(`You left "${group.name}".`, 'success');
        } catch (error) {
          console.error('Failed to leave group:', error);
          useToastStore
            .getState()
            .showToast(
              error instanceof Error ? error.message : 'Failed to leave group.',
              'error',
            );
        }
    }, [currentUser, groups, selectedChat, updateGroups, updateMessages, setSelectedChat, closeModal]);

    // ── Group deletion / archive ──────────────────────────────────────────────
    // Recursive descendant walk — deleting a group must take its whole subgroup subtree, not
    // just its direct children. Also used by the test launcher to gather source groups.
    const getAllSubgroupIDs = useCallback((parentId: string, allGroups: Group[]): string[] => {
        const subgroupIDs: string[] = [];
        const directSubgroups = allGroups.filter(g => g.parentId === parentId);
        for (const subgroup of directSubgroups) {
            subgroupIDs.push(subgroup.id);
            subgroupIDs.push(...getAllSubgroupIDs(subgroup.id, allGroups));
        }
        return subgroupIDs;
    }, []);

    // Deletes the group and every descendant, sequentially so a failure part-way leaves the
    // rest intact and the local state untouched (the store is only pruned after the loop).
    // Member notifications are fire-and-forget and each is individually caught.
    const handleDeleteGroup = useCallback(async (groupId: string) => {
        const group = groups.find(g => g.id === groupId);
        if (!(await confirmDialog(planDeleteGroupConfirm({ name: group?.name })))) return;
        {
            const idsToDelete = [groupId, ...getAllSubgroupIDs(groupId, groups)];

            try {
                for (const id of idsToDelete) {
                    await deleteGroup(id);
                }
                
                if (group && currentUser) {
                    group.members.forEach(async (member) => {
                        if (member.id !== currentUser.id) {
                            try {
                                await createNotification({
                                    user_id: member.id,
                                    message: `The group "${group.name}" has been permanently deleted by ${formatActorLabel(currentUser)}`,
                                    link: `/dashboard`
                                });
                            } catch (error) {
                                console.error('Failed to create deletion notification:', error);
                            }
                        }
                    });
                }
                
                updateGroups(prevGroups => prevGroups.filter(g => !idsToDelete.includes(g.id)));
                
                updateMessages(prevMessages => {
                    const newMessages = { ...prevMessages };
                    idsToDelete.forEach(id => {
                        delete newMessages[id];
                    });
                    return newMessages;
                });
                
                if (selectedChat && idsToDelete.includes(selectedChat.id)) {
                    setSelectedChat(null);
                }
                closeModal('groupInfo');
            } catch (error) {
                console.error('Error deleting group:', error);
                alert('Failed to delete group. Please try again.');
            }
        }
    }, [groups, currentUser, selectedChat, getAllSubgroupIDs, updateGroups, updateMessages, setSelectedChat, closeModal]);

    // Archive toggle: server-first, then patch the list and the open selection. Unlike
    // delete, this does not cascade to subgroups.
    const handleToggleArchiveGroup = useCallback(async (groupId: string) => {
        const group = groups.find(g => g.id === groupId);
        if (!group) return;

        const isArchiving = !group.isArchived;
        
        try {
            await updateGroup(groupId, { isArchived: isArchiving });
            
            updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, isArchived: isArchiving } : g));
            if (selectedChat?.id === groupId) {
                setSelectedChat(prev => {
                    if (prev?.chatType === 'group') {
                        return { ...prev, isArchived: isArchiving };
                    }
                    return prev;
                });
            }

            if (currentUser) {
                group.members.forEach(async (member) => {
                    if (member.id !== currentUser.id) {
                        try {
                            await createNotification({
                                user_id: member.id,
                                message: `The group "${group.name}" has been ${isArchiving ? 'archived' : 'unarchived'} by ${formatActorLabel(currentUser)}`,
                                link: `/chat/${groupId}`
                            });
                        } catch (error) {
                            console.error('Failed to create archive notification:', error);
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error toggling archive status:', error);
            alert('Failed to update group archive status. Please try again.');
        }
    }, [groups, currentUser, selectedChat, updateGroups, setSelectedChat]);

    // Join-request approve / reject.
    // KNOWN ISSUE (tracked, deferred F9 · E3 M2: needs a schema change AND a
    // product decision. There is no group join-request table or endpoint — the
    // API has no join-request route, and `pendingMembers` is hardcoded `[]` by
    // every group mapper, so the GroupInfoModal section these drive can never
    // render. E3 M2's own advice is "wire to real endpoints, or delete the
    // handlers, props and the modal section": which of those happens is a
    // product call about whether private groups get a join-request flow at all,
    // and both halves reach outside this lane's files): both handlers move the
    // pending member around in LOCAL state only and send a notification — there
    // is no membership API call, so an approved member is not actually added to
    // the group and the pending row returns on the next groups fetch.
    const handleApproveMember = useCallback((groupId: string, userId: string) => {
        updateGroups(prev => prev.map(g => {
            if (g.id === groupId) {
                const memberToApprove = g.pendingMembers?.find(m => m.id === userId);
                if (!memberToApprove) return g;
                return {
                    ...g,
                    pendingMembers: (g.pendingMembers || []).filter(m => m.id !== userId),
                    members: [...g.members, memberToApprove]
                };
            }
            return g;
        }));

        const group = groups.find(g => g.id === groupId);
        const user = users.find(u => u.id === userId);
        if (group && user && currentUser && userId !== currentUser.id) {
            try {
                createNotification({
                    user_id: userId,
                    message: `Your request to join "${group.name}" has been approved by ${formatActorLabel(currentUser)}`,
                    link: `/chat/${groupId}`
                }).catch(error => console.error('Failed to create approval notification:', error));
            } catch (error) {
                console.error('Failed to create approval notification:', error);
            }
        }
    }, [groups, users, currentUser, updateGroups]);

    const handleRejectMember = useCallback((groupId: string, userId: string) => {
        updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, pendingMembers: (g.pendingMembers || []).filter(m => m.id !== userId) } : g));

        const group = groups.find(g => g.id === groupId);
        const user = users.find(u => u.id === userId);
        if (group && user && currentUser && userId !== currentUser.id) {
            try {
                createNotification({
                    user_id: userId,
                    message: `Your request to join "${group.name}" has been declined by ${formatActorLabel(currentUser)}`,
                    link: `/chat/${groupId}`
                }).catch(error => console.error('Failed to create rejection notification:', error));
            } catch (error) {
                console.error('Failed to create rejection notification:', error);
            }
        }
    }, [groups, users, currentUser, updateGroups]);

    return {
        handleCloseCreateGroupModal,
        handleCreateSubGroup,
        handleCreateGroup,
        handleEnterCreatedGroup,
        onOpenCreateSubGroupModal,
        handleUpdateGroupDetails,
        handleUpdateGroupAvatar,
        /** @internal — the composer's group-info opener busts the roster cache with this. */
        refreshGroupMembersInState,
        handleInviteMembers,
        handleAcceptGroupInvite,
        handleDeclineGroupInvite,
        handleRevokeInvitation,
        handleRevokePhoneInvitation,
        handlePromoteToAdmin,
        handleDemoteAdmin,
        handleRemoveGroupMember,
        handleLeaveGroup,
        getAllSubgroupIDs,
        handleDeleteGroup,
        handleToggleArchiveGroup,
        handleApproveMember,
        handleRejectMember,
    };
}

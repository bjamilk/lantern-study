/**
 * Manage this community — roles, mutes and invite links, on the CAMPUS stack
 * so Back returns to the community (founder rule §0a; nothing nests).
 *
 * Reached from the community header for whoever `resolveManageAccess` says
 * manages the room: the owner (roles AND moderation), an admin or a moderator
 * (moderation), and a platform admin — the only moderation an auto-derived
 * campus room has, because it has no owner.
 *
 * WHAT THIS SCREEN DOES NOT SHOW, AND WHY
 * ---------------------------------------
 * 1. A member's CURRENT mute. `GET /communities/:id/members` selects
 *    `user_id, source, role, joined_at, profiles(...)` and no `muted_until`,
 *    so the roster cannot say who is muted. The row therefore claims nothing
 *    and only reports mutes this session applied. Unmute stays offered for the
 *    same reason: unmuting someone who is not muted clears an empty field.
 * 2. Removed posts. There is no route that lists them — removal is a soft
 *    `DELETE /communities/:id/posts/:postId` and the tombstone is read off the
 *    board itself. A tab that could only ever say "nothing here" is a dead
 *    feature, and this codebase has shipped three of those already.
 *
 * Every mute and invite call answers a typed NOT_ENABLED failure until
 * migration 20260908120000 is hand-applied; that reads as
 * "Not switched on for this campus yet", never as a raw error. Roles predate
 * that migration and work either way.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { seedMuteState } from '@lantern/shared/network';
import { ActivityIndicator, Alert, FlatList, Pressable, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  COMMUNITY_COPY,
  COMMUNITY_MODERATION_COPY,
  requestFailureSentence,
  type AssignableCommunityRole,
  type CommunityMember,
  type CommunityMuteDurationId,
  type CommunityRole,
} from '@lantern/shared/network';
import {
  COMMUNITY_NOT_ENABLED_COPY,
  isNotEnabledError,
  type CommunityInviteSummary,
} from '@lantern/shared/api';
import { resolveAvatarSrc } from '@lantern/shared/utils';
import {
  createCommunityInvite,
  fetchCommunityMembers,
  listCommunityInvites,
  muteCommunityMember,
  revokeCommunityInvite,
  setCommunityMemberRole,
  unmuteCommunityMember,
} from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useCommunityStore } from '../../stores/communityStore';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { useToastStore } from '../../stores/toastStore';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { ActionSheet, BackButton, type ActionSheetItem } from '../../components/ui';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { RoleBadge } from '../../components/community';
import { ReportContentSheet } from '../../components/moderation/ReportContentSheet';
import { AppIcon } from '../../components/ui/AppIcon';
import { communitySlugLine, inviteCodeCopyFailure } from './communityInviteModel';
import {
  MANAGE_COPY,
  MUTE_DURATIONS,
  inviteShareText,
  inviteSummaryLine,
  memberActions,
  memberMuteLabel,
  resolveManageAccess,
} from './communityManageModel';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Params = { slug: string; communityId?: string; name?: string };

type Tab = 'members' | 'invites';

const MEMBERS_PAGE = 30;

const roleActionLabel = (role: AssignableCommunityRole): string =>
  role === 'member' ? 'Make member' : role === 'admin' ? 'Make admin' : 'Make moderator';

export function CommunityManageScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params: Params };
}) {
  const { slug } = route.params;
  const viewerId = useAuthStore((s) => s.user?.id) ?? '';
  const isPlatformAdmin = usePlatformAdmin();
  const { lowDataMode } = useLowDataMode();
  const listBottomPadding = useScreenBottomPadding();

  const detail = useCommunityStore((s) => s.detailBySlug[slug]);
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);

  const communityId = route.params.communityId ?? detail?.id ?? null;
  const communityName = route.params.name ?? detail?.name ?? 'Community';
  const viewerRole: CommunityRole | null = detail?.viewerRole ?? null;

  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  /**
   * What the SERVER said about a mute, per member, this session. Never
   * inferred: the roster carries no mute state, so an absent entry means
   * "unknown", not "not muted".
   */
  const [muteState, setMuteState] = useState<Record<string, string | null>>({});

  const [invites, setInvites] = useState<CommunityInviteSummary[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitesNotEnabled, setInvitesNotEnabled] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);

  const [target, setTarget] = useState<CommunityMember | null>(null);
  const [muteTarget, setMuteTarget] = useState<CommunityMember | null>(null);
  const [reportTarget, setReportTarget] = useState<CommunityMember | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const access = useMemo(
    () => resolveManageAccess({ id: viewerId, role: viewerRole, isPlatformAdmin }),
    [viewerId, viewerRole, isPlatformAdmin]
  );

  // A deep link (or a cold start on this route) carries only the slug.
  useEffect(() => {
    if (detail) return;
    void loadCommunity(slug).catch(() => undefined);
  }, [detail, slug, loadCommunity]);

  const loadMembers = useCallback(
    async (next: string | null) => {
      if (!communityId) return;
      try {
        const page = await fetchCommunityMembers(communityId, {
          limit: MEMBERS_PAGE,
          cursor: next ?? undefined,
        });
        setMembers((prev) => {
          if (!next) return page.members;
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...page.members.filter((m) => !seen.has(m.id))];
        });
        // Seed from the roster's `mutedUntil` (moderators only) so an earlier
        // session's mute shows its Unmute now, not only after a fresh mute.
        setMuteState((prev) => seedMuteState(prev, page.members));
        setCursor(page.nextCursor);
        setMemberError(null);
      } catch (err) {
        setMemberError(requestFailureSentence(err));
      }
    },
    [communityId]
  );

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    setLoadingMembers(true);
    void loadMembers(null).finally(() => {
      if (!cancelled) setLoadingMembers(false);
    });
    return () => {
      cancelled = true;
    };
  }, [communityId, loadMembers]);

  const loadInvites = useCallback(async () => {
    if (!communityId) return;
    setLoadingInvites(true);
    setInviteError(null);
    try {
      const rows = await listCommunityInvites(communityId);
      setInvites(rows);
      setInvitesNotEnabled(false);
    } catch (err) {
      // The one product-specific case: the migration behind invites has not
      // been applied to this database yet.
      if (isNotEnabledError(err)) {
        setInvitesNotEnabled(true);
        setInvites([]);
      } else {
        setInviteError(requestFailureSentence(err));
      }
    } finally {
      setLoadingInvites(false);
    }
  }, [communityId]);

  useEffect(() => {
    if (tab === 'invites') void loadInvites();
  }, [tab, loadInvites]);

  // ------------------------------------------------------------- moderation

  const toast = (message: string, kind: 'success' | 'error' = 'success') =>
    useToastStore.getState().showToast(message, kind);

  const failureCopy = (err: unknown): string =>
    isNotEnabledError(err) ? COMMUNITY_NOT_ENABLED_COPY : requestFailureSentence(err);

  const changeRole = useCallback(
    async (member: CommunityMember, role: AssignableCommunityRole) => {
      if (!communityId) return;
      setBusyMemberId(member.id);
      try {
        const result = await setCommunityMemberRole(communityId, member.id, role);
        setMembers((prev) =>
          prev.map((m) => (m.id === member.id ? { ...m, role: result.role as CommunityRole } : m))
        );
        toast(COMMUNITY_MODERATION_COPY.roleChanged);
      } catch (err) {
        toast(failureCopy(err), 'error');
      } finally {
        setBusyMemberId(null);
      }
    },
    [communityId]
  );

  const applyMute = useCallback(
    async (member: CommunityMember, duration: CommunityMuteDurationId) => {
      if (!communityId) return;
      setBusyMemberId(member.id);
      try {
        const result = await muteCommunityMember(communityId, member.id, { duration });
        setMuteState((prev) => ({ ...prev, [member.id]: result.mutedUntil }));
        toast(memberMuteLabel(result.mutedUntil) ?? 'Muted');
      } catch (err) {
        toast(failureCopy(err), 'error');
      } finally {
        setBusyMemberId(null);
      }
    },
    [communityId]
  );

  const liftMute = useCallback(
    async (member: CommunityMember) => {
      if (!communityId) return;
      setBusyMemberId(member.id);
      try {
        await unmuteCommunityMember(communityId, member.id);
        setMuteState((prev) => ({ ...prev, [member.id]: null }));
        toast('Unmuted');
      } catch (err) {
        toast(failureCopy(err), 'error');
      } finally {
        setBusyMemberId(null);
      }
    },
    [communityId]
  );

  // ---------------------------------------------------------------- invites

  const mintInvite = useCallback(async () => {
    if (!communityId || inviteBusy) return;
    setInviteBusy(true);
    try {
      // No options: the server's own default TTL and use cap are the clamped,
      // shared ones (COMMUNITY_INVITE_TTL_MS_DEFAULT / _MAX_USES_DEFAULT), and
      // a second set of numbers on the phone is a second thing to keep in step.
      const created = await createCommunityInvite(communityId);
      setInvitesNotEnabled(false);
      setInvites((prev) => [
        {
          code: created.code,
          expiresAt: created.expiresAt,
          maxUses: created.maxUses,
          uses: created.uses,
          createdAt: new Date().toISOString(),
          createdBy: viewerId,
        },
        ...prev,
      ]);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      toast(status === 409 ? MANAGE_COPY.inviteAtMax : failureCopy(err), 'error');
    } finally {
      setInviteBusy(false);
    }
  }, [communityId, inviteBusy, viewerId]);

  const shareInvite = useCallback(
    async (code: string) => {
      try {
        await Share.share({ message: inviteShareText(communityName, code) });
      } catch {
        // The share sheet was dismissed or is unavailable; nothing to surface.
      }
    },
    [communityName]
  );

  const revokeInvite = useCallback(
    (code: string) => {
      if (!communityId) return;
      Alert.alert('Revoke this link?', 'Anyone still holding it will not be able to join.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: MANAGE_COPY.inviteRevoke,
          style: 'destructive',
          onPress: () => {
            void revokeCommunityInvite(communityId, code)
              .then(() => setInvites((prev) => prev.filter((i) => i.code !== code)))
              .catch((err: unknown) => toast(failureCopy(err), 'error'));
          },
        },
      ]);
    },
    [communityId]
  );

  // ----------------------------------------------------------------- sheets

  const memberMenu: ActionSheetItem[] = useMemo(() => {
    const member = target;
    if (!member) return [];
    const actions = memberActions(
      { id: viewerId, role: viewerRole, isPlatformAdmin },
      { id: member.id, role: member.role }
    );
    const items: ActionSheetItem[] = [];
    for (const role of actions.roles) {
      items.push({
        label: roleActionLabel(role),
        icon: 'shield-checkmark',
        onPress: () => void changeRole(member, role),
      });
    }
    if (actions.canMute) {
      items.push({
        label: 'Mute…',
        icon: 'volume-mute',
        onPress: () => setMuteTarget(member),
      });
    }
    if (actions.canUnmute) {
      items.push({
        label: MANAGE_COPY.unmute,
        icon: 'volume-medium',
        onPress: () => void liftMute(member),
      });
    }
    if (actions.canReport) {
      items.push({
        label: MANAGE_COPY.report,
        icon: 'flag',
        onPress: () => setReportTarget(member),
      });
    }
    if (items.length === 0 && actions.refusal) {
      items.push({
        label:
          actions.refusal === 'self'
            ? COMMUNITY_MODERATION_COPY.cannotModerateSelf
            : actions.refusal === 'peer'
              ? COMMUNITY_MODERATION_COPY.cannotModeratePeer
              : COMMUNITY_MODERATION_COPY.onlyOwner,
        icon: 'information-circle',
        disabled: true,
        onPress: () => undefined,
      });
    }
    return items;
  }, [target, viewerId, viewerRole, isPlatformAdmin, changeRole, liftMute]);

  // ----------------------------------------------------------------- render

  if (!access.canManage) {
    return (
      <Screen bottom="none">
        <View className="flex-row items-center h-[56px] pr-2 border-b border-lantern-border">
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
          <Text className="flex-1 text-heading font-semibold text-lantern-text">
            {MANAGE_COPY.title}
          </Text>
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-body text-lantern-text-secondary">
            {COMMUNITY_MODERATION_COPY.onlyOwner}
          </Text>
        </View>
      </Screen>
    );
  }

  const renderMember = ({ item }: { item: CommunityMember }) => {
    const muteLabel = memberMuteLabel(muteState[item.id]);
    const busy = busyMemberId === item.id;
    return (
      <Pressable
        onPress={() => setTarget(item)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.role}. Manage`}
        accessibilityState={{ disabled: busy, busy }}
        className="flex-row items-center px-4 min-h-[56px] py-2 border-b border-lantern-border active:bg-lantern-background-secondary"
      >
        <ResolvedAvatar
          name={item.name}
          uri={resolveAvatarSrc(item.avatarUrl, lowDataMode)}
          size={32}
          decorative
        />
        <View className="flex-1 min-w-0 ml-3">
          <View className="flex-row items-center">
            <Text className="text-body font-medium text-lantern-text shrink" numberOfLines={1}>
              {item.name}
            </Text>
            <RoleBadge role={item.role} />
          </View>
          {muteLabel ? (
            <Text className="mt-0.5 text-caption text-lantern-error" numberOfLines={1}>
              {muteLabel}
            </Text>
          ) : item.programme ? (
            <Text className="mt-0.5 text-caption text-lantern-text-tertiary" numberOfLines={1}>
              {item.programme}
            </Text>
          ) : null}
        </View>
        {busy ? (
          <ActivityIndicator size="small" color="#6366f1" />
        ) : (
          <AppIcon name="chevron-forward" size={16} color="#94a3b8" />
        )}
      </Pressable>
    );
  };

  const renderInvite = ({ item }: { item: CommunityInviteSummary }) => (
    <View className="px-4 py-3 border-b border-lantern-border">
      <Text className="text-body font-semibold tracking-widest text-lantern-text">
        {item.code}
      </Text>
      <Text className="mt-0.5 text-caption text-lantern-text-tertiary">
        {inviteSummaryLine(item)}
      </Text>
      <View className="flex-row items-center gap-4 mt-1">
        <Pressable
          onPress={() => void shareInvite(item.code)}
          accessibilityRole="button"
          accessibilityLabel={`${MANAGE_COPY.inviteShare} ${item.code}`}
          className="min-h-[44px] justify-center"
        >
          <Text className="text-caption font-semibold text-lantern-primary-text">
            {MANAGE_COPY.inviteShare}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            // A refused clipboard write used to resolve `false` (or reject)
            // into nothing, so the toast claimed a copy that never happened.
            void Clipboard.setStringAsync(item.code)
              .then((ok) =>
                ok !== false
                  ? toast(MANAGE_COPY.inviteCopied)
                  : toast(inviteCodeCopyFailure(item.code), 'error')
              )
              .catch(() => toast(inviteCodeCopyFailure(item.code), 'error'));
          }}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${item.code}`}
          className="min-h-[44px] justify-center"
        >
          <Text className="text-caption font-semibold text-lantern-primary-text">Copy code</Text>
        </Pressable>
        <Pressable
          onPress={() => revokeInvite(item.code)}
          accessibilityRole="button"
          accessibilityLabel={`${MANAGE_COPY.inviteRevoke} ${item.code}`}
          className="min-h-[44px] justify-center"
        >
          <Text className="text-caption font-semibold text-lantern-error">
            {MANAGE_COPY.inviteRevoke}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Screen bottom="none">
      <View className="border-b border-lantern-border">
        <View className="flex-row items-center h-[56px] pr-4">
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
          <View className="flex-1 min-w-0">
            <Text className="text-heading font-semibold text-lantern-text" numberOfLines={1}>
              {MANAGE_COPY.title}
            </Text>
            <Text className="text-caption text-lantern-text-tertiary" numberOfLines={1}>
              {communityName}
            </Text>
            {/* The public link this community's slug produces, spelled out and
                selectable: a founder asked to "send the link" had nowhere to
                read it, because the slug only ever existed in the route. */}
            <Text
              className="text-caption text-lantern-text-tertiary"
              selectable
              numberOfLines={2}
            >
              {communitySlugLine(slug)}
            </Text>
          </View>
        </View>
        <View className="flex-row px-2" accessibilityRole="tablist">
          {(['members', 'invites'] as const).map((value) => {
            const selected = value === tab;
            const label = value === 'members' ? MANAGE_COPY.membersTab : MANAGE_COPY.invitesTab;
            return (
              <Pressable
                key={value}
                onPress={() => setTab(value)}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                style={{ minHeight: 44 }}
                className="flex-1 items-center justify-center"
              >
                <Text
                  className={`text-body ${
                    selected
                      ? 'font-bold text-lantern-primary-text'
                      : 'font-medium text-lantern-text-secondary'
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tab === 'members' ? (
        loadingMembers ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#6366f1" />
          </View>
        ) : (
          <FlatList
            data={members}
            keyExtractor={(item) => item.id}
            renderItem={renderMember}
            contentContainerStyle={{ paddingBottom: listBottomPadding }}
            ListHeaderComponent={
              <View className="px-4 pt-3 pb-1">
                {memberError ? (
                  <Text className="text-caption text-lantern-error">{memberError}</Text>
                ) : (
                  <Text className="text-caption text-lantern-text-tertiary">
                    {MANAGE_COPY.muteStateUnknown}
                  </Text>
                )}
              </View>
            }
            ListEmptyComponent={
              memberError ? null : (
                <Text className="mx-4 mt-3 text-caption text-lantern-text-tertiary">
                  {COMMUNITY_COPY.sectionMembers}: none yet.
                </Text>
              )
            }
            ListFooterComponent={
              cursor ? (
                <Pressable
                  onPress={() => {
                    if (loadingMore) return;
                    setLoadingMore(true);
                    void loadMembers(cursor).finally(() => setLoadingMore(false));
                  }}
                  disabled={loadingMore}
                  accessibilityRole="button"
                  accessibilityLabel="Load more members"
                  accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
                  className="mx-4 mt-3 min-h-[44px] items-center justify-center rounded-lg bg-lantern-background-secondary"
                >
                  {loadingMore ? (
                    <ActivityIndicator color="#6366f1" />
                  ) : (
                    <Text className="text-body font-semibold text-lantern-primary-text">
                      Load more
                    </Text>
                  )}
                </Pressable>
              ) : null
            }
          />
        )
      ) : loadingInvites ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : (
        <FlatList
          data={invites}
          keyExtractor={(item) => item.code}
          renderItem={renderInvite}
          contentContainerStyle={{ paddingBottom: listBottomPadding }}
          ListHeaderComponent={
            <View className="px-4 pt-3">
              {invitesNotEnabled ? (
                <Text className="text-caption text-lantern-text-secondary">
                  {COMMUNITY_NOT_ENABLED_COPY}
                </Text>
              ) : inviteError ? (
                <Text className="text-caption text-lantern-error">{inviteError}</Text>
              ) : (
                <Pressable
                  onPress={() => void mintInvite()}
                  disabled={inviteBusy}
                  accessibilityRole="button"
                  accessibilityLabel={MANAGE_COPY.inviteCreate}
                  accessibilityState={{ disabled: inviteBusy, busy: inviteBusy }}
                  style={{ minHeight: 48 }}
                  className="flex-row items-center justify-center rounded-2xl bg-lantern-primary-fill px-4"
                >
                  {inviteBusy ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text className="text-body font-semibold text-white">
                      {MANAGE_COPY.inviteCreate}
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          }
          ListEmptyComponent={
            invitesNotEnabled || inviteError ? null : (
              <Text className="mx-4 mt-3 text-caption text-lantern-text-tertiary">
                {MANAGE_COPY.inviteEmpty}
              </Text>
            )
          }
        />
      )}

      <ActionSheet
        visible={!!target}
        title={target?.name}
        items={memberMenu.map((item) => ({
          ...item,
          onPress: () => {
            setTarget(null);
            item.onPress();
          },
        }))}
        onClose={() => setTarget(null)}
      />

      <ActionSheet
        visible={!!muteTarget}
        title={muteTarget ? `Mute ${muteTarget.name}` : undefined}
        items={MUTE_DURATIONS.map((option) => ({
          label: option.label,
          icon: 'volume-mute' as const,
          onPress: () => {
            const member = muteTarget;
            setMuteTarget(null);
            if (member) void applyMute(member, option.id);
          },
        }))}
        onClose={() => setMuteTarget(null)}
      />

      <ReportContentSheet
        visible={!!reportTarget}
        targetType="community_member"
        targetId={reportTarget?.id ?? ''}
        targetLabel={reportTarget?.name}
        onClose={() => setReportTarget(null)}
      />
    </Screen>
  );
}

export default CommunityManageScreen;

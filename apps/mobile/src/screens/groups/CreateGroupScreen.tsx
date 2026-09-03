import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  COMMUNITY_COPY,
  studyGroupAnnouncement,
  studyGroupsLiveInChatCopy,
} from '@lantern/shared/network';
import { useAuthStore } from '../../stores';
import { useGroupStore, type GroupPermissions } from '../../stores/groupStore';
import { useCommunityStore } from '../../stores/communityStore';
import { useToastStore } from '../../stores/toastStore';
import * as api from '../../services/api';
import { Button, ScreenHeader, Avatar } from '../../components/ui';
import { CoursePicker } from '../../components/CoursePicker';
import { GroupDiscoverabilityFields, type GroupDiscoveryValue } from '../discover/GroupDiscoverabilityFields';
import type { ChatStackParamList } from '../../navigation/types';

type CreateGroupParams = ChatStackParamList['CreateGroup'];

/**
 * Structural so the same screen registers on BOTH the Chat stack and the
 * Market stack (a community's "New channel", spec §4.1/§4.6). `getState` is
 * how we tell which stack we are on when it is time to land in the new chat.
 */
type Props = {
  navigation: {
    goBack: () => void;
    replace: (screen: string, params?: Record<string, unknown>) => void;
    getState: () => { routeNames?: string[] } | undefined;
    getParent?: () => { navigate: (tab: string, params?: Record<string, unknown>) => void } | undefined;
  };
  route: { params?: CreateGroupParams };
};

interface SearchResult {
  id: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name: string;
  avatar_url?: string | null;
}

const DEFAULT_PERMISSIONS: GroupPermissions = {
  canSendMessages: true,
  canAddMembers: true,
  canEditSettings: false,
  canApproveMembers: false,
};

function PermissionToggle({
  label,
  enabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-3 border-b border-lantern-border">
      <Text className="text-sm font-medium text-lantern-text flex-1 pr-3">{label}</Text>
      <Switch value={enabled} onValueChange={onChange} trackColor={{ true: '#6366f1' }} />
    </View>
  );
}

function StepFooter({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="px-4 pt-2 border-t border-lantern-border dark:border-lantern-border bg-lantern-background"
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      {children}
    </View>
  );
}

export function CreateGroupScreen({ navigation, route }: Props) {
  const user = useAuthStore(s => s.user);
  const createGroup = useGroupStore(s => s.createGroup);
  const parentId = route.params?.parentId;
  const parentName = route.params?.parentName;
  const isSubGroup = !!parentId;
  // A channel is a group locked to one community; the listing is not a choice.
  const communityId = route.params?.communityId;
  const communityName = route.params?.communityName;
  const communitySlug = route.params?.communitySlug;
  /**
   * Which surface the new group takes inside the community (§4.6). Defaults to
   * 'board' whenever a community is set, so every existing caller is unchanged.
   * 'study_group' is the destination for everything a board removes: it opens
   * in Chat with questions, tests and games intact, and stays listed here.
   */
  const communitySurface: 'board' | 'study_group' = communityId
    ? (route.params?.communitySurface ?? 'board')
    : 'board';
  const isStudyGroup = !!communityId && communitySurface === 'study_group';
  /** The board a "Start a study group about this" came from, if any. */
  const announceInGroupId = route.params?.announceInGroupId;
  const lockedCommunity = useMemo(
    () => (communityId && communityName ? { id: communityId, name: communityName } : null),
    [communityId, communityName]
  );

  const [step, setStep] = useState<'select_members' | 'group_details'>('select_members');
  const [selectedUsers, setSelectedUsers] = useState<SearchResult[]>([]);
  // "Start a study group about this" prefills the name from the post.
  const [groupName, setGroupName] = useState(route.params?.seedName ?? '');
  const [groupDescription, setGroupDescription] = useState('');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<GroupDiscoveryValue>(() =>
    communityId
      ? { visibility: 'community', communityId }
      : { visibility: 'private', communityId: null }
  );
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [permissions, setPermissions] = useState<GroupPermissions>(DEFAULT_PERMISSIONS);
  const [permissionsExpanded, setPermissionsExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const searchRequestRef = useRef(0);

  const selectedUserIds = useMemo(() => selectedUsers.map(u => u.id), [selectedUsers]);
  const selectedUserIdSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);

  const permissionsSummary = useMemo(() => {
    const parts: string[] = [];
    if (permissions.canSendMessages) parts.push('send messages');
    if (permissions.canAddMembers) parts.push('add members');
    if (permissions.canEditSettings) parts.push('edit info');
    if (permissions.canApproveMembers) parts.push('approve members');
    if (parts.length === 0) return 'Members have limited permissions';
    return `Members can ${parts.join(', ')}`;
  }, [permissions]);

  useEffect(() => {
    if (searchTerm.trim().replace(/^@+/, '').length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const requestId = ++searchRequestRef.current;
    const query = searchTerm.trim();
    const timeoutId = setTimeout(async () => {
      try {
        const data = await api.searchUsers(query, 20);
        if (requestId !== searchRequestRef.current) return;
        const filtered = (data || [])
          .map((u): SearchResult => ({
            id: u.id,
            name: u.name,
            username: u.username ?? null,
            first_name: null,
            last_name: null,
            avatar_url: u.avatar_url ?? null,
          }))
          .filter(u => !selectedUserIdSet.has(u.id) && u.id !== user?.id);
        setSearchResults(filtered);
      } catch {
        if (requestId !== searchRequestRef.current) return;
        setSearchResults([]);
      } finally {
        if (requestId === searchRequestRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, selectedUserIdSet, user?.id]);

  const handleUserSelect = (picked: SearchResult) => {
    setSelectedUsers(prev => [...prev, picked]);
    setSearchTerm('');
    setSearchResults([]);
  };

  const handleUserRemove = (userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
  };

  const handlePickAvatar = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to set a group avatar.');
      return;
    }

    setPickingAvatar(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: false,
        exif: false,
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const { prepareImageBase64ForUpload } = await import('../../utils/prepareImage');
      const prepared = await prepareImageBase64ForUpload(asset.uri, 'avatar', {
        fileName: asset.fileName || 'group-avatar.jpg',
        mimeType: asset.mimeType,
      });
      setAvatarUrl(`data:${prepared.contentType};base64,${prepared.base64Data}`);
    } catch (e: unknown) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not set avatar');
    } finally {
      setPickingAvatar(false);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!user?.id || !groupName.trim()) {
      Alert.alert('Group name required', 'Please enter a group name.');
      return;
    }

    setIsCreating(true);
    try {
      const ownerName =
        user.user_metadata?.name || user.user_metadata?.full_name || user.email || 'User';

      const created = await createGroup({
        name: groupName.trim(),
        description: groupDescription.trim() || undefined,
        avatarUrl: avatarUrl || undefined,
        ownerId: user.id,
        ownerName,
        permissions,
        parentId,
        courseId,
        visibility: discovery.visibility,
        communityId: discovery.communityId,
        ...(communityId ? { communitySurface } : {}),
        memberIds: selectedUserIds,
        memberDetails: selectedUsers.map(u => ({
          id: u.id,
          name: u.name || u.username || 'User',
          avatarUrl: u.avatar_url || undefined,
        })),
      });

      if (communityId) {
        // The community's board list is stale now; it refetches on focus.
        useCommunityStore.getState().invalidate(communityId);

        if (isStudyGroup) {
          // §7: the handoff is SHOWN, not inferred — the user physically
          // changes tab, and the toast says where the group went.
          if (announceInGroupId) {
            // The board keeps a plain TEXT pointer to the group a post spawned.
            void useGroupStore
              .getState()
              .sendMessage(
                announceInGroupId,
                studyGroupAnnouncement(ownerName, created.name),
                user.id,
                undefined,
                { plainText: true }
              )
              .catch(() => undefined);
          }
          const parent = navigation.getParent?.();
          const params = {
            groupId: created.id,
            groupName: created.name,
            openAddMembers: true,
            communitySlug,
            communityName,
          };
          if (parent) parent.navigate('ChatTab', { screen: 'GroupChat', params });
          else navigation.replace('GroupChat', params);
          useToastStore.getState().showToast(COMMUNITY_COPY.createdInChat(created.name), 'success');
          return;
        }

        const onMarketStack = navigation
          .getState()
          ?.routeNames?.includes('CommunityChannel');
        if (onMarketStack && communitySlug && communityName) {
          // Founder rule (spec §0a): a board stays on the community's stack.
          navigation.replace('CommunityChannel', {
            groupId: created.id,
            groupName: created.name,
            communitySlug,
            communityName,
            communityId,
          });
          return;
        }
        navigation.replace('GroupChat', {
          groupId: created.id,
          groupName: created.name,
          communitySlug,
          communityName,
        });
        return;
      }
      navigation.replace('GroupChat', {
        groupId: created.id,
        groupName: created.name,
        openAddMembers: true,
      });
    } catch (error) {
      // Pre-migration the API answers 503 `Study groups are not available yet`
      // (§3.1). Surfacing the server's own sentence is the difference between
      // a degrade and a mystery.
      Alert.alert(
        'Error',
        error instanceof Error && error.message
          ? error.message
          : 'Failed to create group. Please try again.'
      );
    } finally {
      setIsCreating(false);
    }
  }, [
    user,
    groupName,
    groupDescription,
    avatarUrl,
    permissions,
    courseId,
    selectedUserIds,
    selectedUsers,
    parentId,
    createGroup,
    navigation,
    communityId,
    communityName,
    communitySlug,
    communitySurface,
    isStudyGroup,
    announceInGroupId,
  ]);

  if (step === 'select_members') {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
        <ScreenHeader
          title={
            lockedCommunity
              ? isStudyGroup
                ? COMMUNITY_COPY.newStudyGroupTitle(lockedCommunity.name)
                : COMMUNITY_COPY.newBoardTitle(lockedCommunity.name)
              : isSubGroup
                ? 'New Sub-group'
                : 'New Group'
          }
          subtitle={
            isSubGroup
              ? parentName
                ? `Inside "${parentName}"`
                : 'Add members by @username'
              : 'Add members by @username'
          }
          right={
            <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
              Cancel
            </Button>
          }
        />

        <ScrollView className="flex-1 px-4" keyboardShouldPersistTaps="handled">
          <View className="flex-row items-center border border-lantern-border rounded-2xl px-3 bg-lantern-surface mt-2 mb-3">
            <Ionicons name="search" size={18} color="#94a3b8" />
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search by name or @username…"
              placeholderTextColor="#94a3b8"
              autoFocus
              className="flex-1 py-3 px-2 text-lantern-text"
            />
          </View>

          <View className="min-h-[48px] justify-center">
            {isSearching ? <ActivityIndicator color="#6366f1" /> : null}
          </View>

          {!isSearching && searchTerm.length >= 2 && searchResults.length === 0 ? (
            <View className="items-center py-8">
              <Ionicons name="people-outline" size={40} color="#94a3b8" />
              <Text className="text-sm text-lantern-text-secondary mt-2 text-center">
                No users found matching &quot;{searchTerm}&quot;
              </Text>
            </View>
          ) : null}

          {searchResults.map(u => (
            <Pressable
              key={u.id}
              onPress={() => handleUserSelect(u)}
              className="flex-row items-center p-3 mb-2 rounded-2xl bg-lantern-surface border border-lantern-border active:opacity-90"
            >
              <Avatar name={u.name} size={40} />
              <View className="flex-1 ml-3 min-w-0">
                <Text className="font-semibold text-lantern-text" numberOfLines={1}>
                  {u.name}
                </Text>
                {u.username ? (
                  <Text className="text-sm text-lantern-primary">@{u.username}</Text>
                ) : null}
              </View>
              <Ionicons name="add-circle-outline" size={22} color="#6366f1" />
            </Pressable>
          ))}

          {selectedUsers.length > 0 ? (
            <View className="mt-4 p-4 rounded-2xl bg-lantern-surface border border-lantern-border mb-4">
              <Text className="text-sm font-semibold text-lantern-text mb-3">
                Selected ({selectedUsers.length})
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {selectedUsers.map(u => (
                  <Pressable
                    key={u.id}
                    onPress={() => handleUserRemove(u.id)}
                    className="flex-row items-center bg-lantern-primary-background px-3 py-1.5 rounded-full"
                  >
                    <Text className="text-sm text-lantern-primary-dark mr-1">
                      {u.username ? `@${u.username}` : u.name}
                    </Text>
                    <Ionicons name="close" size={14} color="#6366f1" />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>

        <StepFooter>
          <Button fullWidth onPress={() => setStep('group_details')}>
            Next
          </Button>
          {selectedUsers.length === 0 ? (
            <Text className="text-xs text-lantern-text-secondary text-center mt-2">
              You can add members later
            </Text>
          ) : null}
        </StepFooter>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
      <ScreenHeader
        title={
          lockedCommunity
            ? isStudyGroup
              ? COMMUNITY_COPY.newStudyGroupTitle(lockedCommunity.name)
              : COMMUNITY_COPY.newBoardTitle(lockedCommunity.name)
            : isSubGroup
              ? 'Sub-group Details'
              : 'Group Details'
        }
        subtitle={
          isSubGroup && parentName
            ? `Inside "${parentName}" · ${selectedUsers.length + 1} members`
            : `${selectedUsers.length + 1} members`
        }
        right={
          <Button variant="ghost" size="sm" onPress={() => setStep('select_members')}>
            Back
          </Button>
        }
      />

      <ScrollView className="flex-1 px-4" keyboardShouldPersistTaps="handled">
        <View className="items-center py-4">
          <Pressable
            onPress={handlePickAvatar}
            disabled={pickingAvatar}
            className="relative w-24 h-24 rounded-full bg-lantern-background-secondary items-center justify-center mb-4 overflow-hidden active:opacity-90"
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} className="w-full h-full" />
            ) : (
              <Ionicons name="people" size={40} color="#94a3b8" />
            )}
            <View className="absolute inset-0 bg-black/30 items-center justify-center">
              {pickingAvatar ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="camera" size={28} color="#fff" />
              )}
            </View>
          </Pressable>
          <TextInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder={isSubGroup ? 'Sub-group name (required)' : 'Group name (required)'}
            placeholderTextColor="#94a3b8"
            className="w-full text-center text-lg font-semibold border-b-2 border-lantern-border py-2 text-lantern-text mb-3"
          />
          <TextInput
            value={groupDescription}
            onChangeText={setGroupDescription}
            placeholder="Optional description"
            placeholderTextColor="#94a3b8"
            multiline
            numberOfLines={2}
            className="w-full text-center text-sm border border-lantern-border rounded-xl px-3 py-2 text-lantern-text bg-lantern-surface"
          />
        </View>

        <View className="p-4 rounded-2xl bg-lantern-surface border border-lantern-border mb-4">
          <Text className="font-semibold text-lantern-text">Course</Text>
          <Text className="text-sm text-lantern-text-secondary mt-0.5 mb-3">
            Optional — tests and questions from this group file under it.
          </Text>
          <CoursePicker
            value={courseId}
            onChange={course => setCourseId(course?.id ?? null)}
            placeholder="Choose the course this group studies"
            title="Course for this group"
          />
        </View>

        {!isSubGroup ? (
          <View className="p-4 rounded-2xl bg-lantern-surface border border-lantern-border mb-4">
            <GroupDiscoverabilityFields
              value={discovery}
              onChange={setDiscovery}
              lockedCommunity={lockedCommunity}
            />
          </View>
        ) : null}

        <View className="p-4 rounded-2xl bg-lantern-surface border border-lantern-border mb-4">
          <Pressable
            onPress={() => setPermissionsExpanded(v => !v)}
            className="flex-row items-center active:opacity-90"
          >
            <View className="flex-1 min-w-0 pr-3">
              <Text className="font-semibold text-lantern-text">Member permissions</Text>
              {!permissionsExpanded ? (
                <Text
                  className="text-sm text-lantern-text-secondary mt-0.5"
                  numberOfLines={1}
                >
                  {permissionsSummary}
                </Text>
              ) : null}
            </View>
            <Ionicons
              name={permissionsExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color="#94a3b8"
            />
          </Pressable>

          {permissionsExpanded ? (
            <View className="mt-2">
              <PermissionToggle
                label="Send messages"
                enabled={permissions.canSendMessages}
                onChange={val => setPermissions(p => ({ ...p, canSendMessages: val }))}
              />
              <PermissionToggle
                label="Add other members"
                enabled={permissions.canAddMembers}
                onChange={val => setPermissions(p => ({ ...p, canAddMembers: val }))}
              />
              <PermissionToggle
                label="Edit group info"
                enabled={permissions.canEditSettings}
                onChange={val => setPermissions(p => ({ ...p, canEditSettings: val }))}
              />
              <PermissionToggle
                label="Approve new members"
                enabled={permissions.canApproveMembers}
                onChange={val => setPermissions(p => ({ ...p, canApproveMembers: val }))}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      <StepFooter>
        {/* §4.6: the no-silent-disappearance contract, in copy. It is the one
            place a member is told where the study apparatus went, so it is
            not optional. */}
        {isStudyGroup && lockedCommunity ? (
          <Text className="text-xs text-lantern-text-secondary mb-2">
            {studyGroupsLiveInChatCopy(lockedCommunity.name)}
          </Text>
        ) : null}
        <Button fullWidth loading={isCreating} disabled={!groupName.trim()} onPress={handleCreate}>
          {lockedCommunity
            ? isStudyGroup
              ? COMMUNITY_COPY.startStudyGroup
              : COMMUNITY_COPY.createBoard
            : isSubGroup
              ? 'Create Sub-group'
              : 'Create Group'}
        </Button>
      </StepFooter>
    </SafeAreaView>
  );
}

export default CreateGroupScreen;

// ===========================================
// Lantern Study Mobile - Group Info Modal
// ===========================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Group, GroupMember } from '../stores/groupStore';
import { uploadGroupAvatar } from '../services/api';
import { GroupInviteLinkPanel } from './GroupInviteLinkPanel';
import { useTheme } from '../theme';
import type { ThemeColors } from '../theme';
import { ReportContentSheet } from './moderation/ReportContentSheet';
import { GroupDiscoverabilityFields, type GroupDiscoveryValue } from '../screens/discover/GroupDiscoverabilityFields';

type TabType = 'details' | 'members' | 'danger';

interface GroupInfoModalProps {
  visible: boolean;
  onClose: () => void;
  group: Group;
  currentUserId: string;
  onUpdateDetails: (
    groupId: string,
    name: string,
    description: string,
    discovery?: { visibility?: 'private' | 'community' | 'public'; communityId?: string | null }
  ) => void;
  onPromoteToAdmin: (groupId: string, userId: string) => void;
  onDemoteAdmin: (groupId: string, userId: string) => void;
  onRemoveMember: (groupId: string, userId: string) => void;
  onLeaveGroup: (groupId: string) => void;
  onArchiveGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onAddMembers: () => void;
  onChallenge: (member: GroupMember) => void;
  onCreateSubgroup?: () => void;
  onAvatarUpdated?: (groupId: string, avatarUrl: string) => void;
}

export default function GroupInfoModal({
  visible,
  onClose,
  group,
  currentUserId,
  onUpdateDetails,
  onPromoteToAdmin,
  onDemoteAdmin,
  onRemoveMember,
  onLeaveGroup,
  onArchiveGroup,
  onDeleteGroup,
  onAddMembers,
  onChallenge,
  onCreateSubgroup,
  onAvatarUpdated,
}: GroupInfoModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [hasChanges, setHasChanges] = useState(false);
  const [discovery, setDiscovery] = useState<GroupDiscoveryValue>({
    visibility: group.visibility || 'private',
    communityId: group.communityId ?? null,
  });
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // The modal stays mounted and is reused for every group, so this state would
  // otherwise keep whichever group was opened first. That is not just cosmetic:
  // the Details tab showed the previous group's name and description, and
  // saving from there would have renamed the wrong group.
  //
  // Keyed on the group id and the open transition rather than on `group` itself
  // — resetting on every store mutation would wipe edits mid-typing.
  useEffect(() => {
    if (!visible) return;
    setName(group.name);
    setDescription(group.description || '');
    setHasChanges(false);
    setDiscovery({
      visibility: group.visibility || 'private',
      communityId: group.communityId ?? null,
    });
    setAvatarPreview(null);
    setActiveTab('details');
  }, [visible, group.id]);

  const currentUserMember = group.members.find(m => m.userId === currentUserId);
  const isAdmin = currentUserMember?.role === 'owner' || currentUserMember?.role === 'admin';
  const isOwner = currentUserMember?.role === 'owner';
  /** Report group to Lantern moderation (Phase 1 · E). */
  const [showReportGroup, setShowReportGroup] = useState(false);
  const isSoleAdmin =
    Boolean(isAdmin) &&
    (group.adminIds?.length
      ? group.adminIds.length <= 1 && group.adminIds.includes(currentUserId)
      : group.members.filter((m) => m.role === 'owner' || m.role === 'admin').length <= 1);

  const handleChangeAvatar = async () => {
    if (!isAdmin || uploadingAvatar) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to set a group avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: false,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploadingAvatar(true);
    try {
      const asset = result.assets[0];
      const { prepareImageBase64ForUpload } = await import('../utils/prepareImage');
      const prepared = await prepareImageBase64ForUpload(asset.uri, 'avatar', {
        fileName: asset.fileName || 'group-avatar.jpg',
        mimeType: asset.mimeType,
      });
      const uploaded = await uploadGroupAvatar(group.id, {
        fileName: prepared.fileName,
        base64Data: prepared.base64Data,
        contentType: prepared.contentType,
      });
      setAvatarPreview(uploaded.url || uploaded.avatarUrl);
      onAvatarUpdated?.(group.id, uploaded.avatarUrl);
      Alert.alert('Success', 'Group avatar updated');
    } catch (error) {
      Alert.alert(
        'Upload failed',
        error instanceof Error ? error.message : 'Could not update group avatar'
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveDetails = () => {
    onUpdateDetails(group.id, name, description, discovery);
    setHasChanges(false);
    Alert.alert('Success', 'Group details updated');
  };

  const handleArchive = () => {
    Alert.alert(
      group.isArchived ? 'Unarchive Group' : 'Archive Group',
      group.isArchived 
        ? 'This will restore the group for all members.'
        : 'This will hide the group from all members. Messages will be disabled.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: group.isArchived ? 'Unarchive' : 'Archive', 
          onPress: () => {
            onArchiveGroup(group.id);
            onClose();
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Group',
      'This is permanent and cannot be undone. Group chat data will be removed. Past test scores stay in your history, but they won’t appear under Group performance after the group is gone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: () => {
            onDeleteGroup(group.id);
            onClose();
          },
        },
      ]
    );
  };

  const handleLeave = () => {
    if (isSoleAdmin) {
      Alert.alert(
        'Cannot leave',
        'You are the only admin. Promote another member before leaving.',
      );
      return;
    }
    Alert.alert(
      'Leave Group',
      `Leave "${group.name}"? You will lose access until someone invites you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => onLeaveGroup(group.id),
        },
      ],
    );
  };

  const handlePromote = (member: GroupMember) => {
    Alert.alert(
      'Promote to Admin',
      `Make ${member.name} an admin?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Promote', onPress: () => onPromoteToAdmin(group.id, member.userId) },
      ]
    );
  };

  const handleDemote = (member: GroupMember) => {
    Alert.alert(
      'Remove Admin',
      `Remove admin privileges from ${member.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => onDemoteAdmin(group.id, member.userId) },
      ]
    );
  };

  const handleRemove = (member: GroupMember) => {
    Alert.alert(
      'Remove Member',
      `Remove ${member.name} from the group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => onRemoveMember(group.id, member.userId) },
      ]
    );
  };

  const renderTab = (tab: TabType, label: string, icon: string) => (
    <TouchableOpacity
      style={[styles.tab, { borderBottomColor: activeTab === tab ? colors.primary : 'transparent' }]}
      onPress={() => setActiveTab(tab)}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: activeTab === tab }}
    >
      <Ionicons 
        name={icon as any} 
        size={18} 
        color={activeTab === tab ? colors.primary : colors.textSecondary} 
      />
      <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : colors.textSecondary }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderDetailsTab = () => (
    <View style={styles.tabContent}>
      {/* Group Avatar */}
      <View style={styles.avatarSection}>
        <Image
          source={{ uri: avatarPreview || group.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(group.name)}&background=6366f1&color=fff&size=100` }}
          style={styles.groupAvatar}
        />
        {isAdmin && (
          <TouchableOpacity
            style={styles.changeAvatarButton}
            onPress={() => void handleChangeAvatar()}
            disabled={uploadingAvatar}
            accessibilityRole="button"
            accessibilityLabel={uploadingAvatar ? 'Uploading group photo' : 'Change group photo'}
            accessibilityState={{ disabled: uploadingAvatar, busy: uploadingAvatar }}
          >
            {uploadingAvatar ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <Ionicons name="camera" size={16} color="#ffffff" />
                <Text style={styles.changeAvatarText}>Change</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Group Name */}
      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, { color: colors.text }]}>Group Name</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }, !isAdmin && { opacity: 0.6 }]}
          value={name}
          onChangeText={(text) => {
            setName(text);
            setHasChanges(true);
          }}
          editable={isAdmin}
          placeholderTextColor={colors.inputPlaceholder}
        />
      </View>

      {/* Description */}
      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, { color: colors.text }]}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }, !isAdmin && { opacity: 0.6 }]}
          value={description}
          onChangeText={(text) => {
            setDescription(text);
            setHasChanges(true);
          }}
          editable={isAdmin}
          multiline
          numberOfLines={3}
          placeholderTextColor={colors.inputPlaceholder}
          placeholder="Add a description..."
        />
      </View>

      {isAdmin ? (
        <View style={{ marginBottom: 16 }}>
          <GroupDiscoverabilityFields
            value={discovery}
            onChange={(next) => {
              setDiscovery(next);
              setHasChanges(true);
            }}
          />
        </View>
      ) : null}

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{group.memberCount}</Text>
          <Text style={styles.statLabel}>Members</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {group.createdAt && !Number.isNaN(Date.parse(group.createdAt))
              ? new Date(group.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : '—'}
          </Text>
          <Text style={styles.statLabel}>Created</Text>
        </View>
      </View>

      {/* Save Button */}
      {isAdmin && hasChanges && (
        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleSaveDetails}
          accessibilityRole="button"
          accessibilityLabel="Save group details"
        >
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>
      )}

      {/* Create Sub-group */}
      {isAdmin && onCreateSubgroup ? (
        <TouchableOpacity
          style={styles.createSubgroupButton}
          onPress={onCreateSubgroup}
          accessibilityRole="button"
          accessibilityLabel="Create sub-group"
        >
          <Ionicons name="git-network" size={20} color="#ffffff" />
          <Text style={styles.createSubgroupText}>Create Sub-group</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderMembersTab = () => (
    <View style={styles.tabContent}>
      {/* Add Members Button */}
      {isAdmin && (
        <TouchableOpacity
          style={styles.addMembersButton}
          onPress={onAddMembers}
          accessibilityRole="button"
          accessibilityLabel="Add or invite members"
        >
          <Ionicons name="person-add" size={20} color="#ffffff" />
          <Text style={styles.addMembersText}>Add or Invite Members</Text>
        </TouchableOpacity>
      )}

      {/* Same panel AddMembersModal shows — the link is worth reaching from the
          roster too, without going through the add-members flow first. */}
      {isAdmin && <GroupInviteLinkPanel groupName={group.name} inviteId={group.inviteId} />}

      {/* Members List */}
      <Text style={styles.sectionTitle}>
        Members ({group.members.length})
      </Text>
      
      {group.members.map((member) => (
        <View key={member.id} style={styles.memberItem}>
          <View style={styles.memberInfo}>
            <Image
              source={{ uri: member.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=6366f1&color=fff` }}
              style={styles.memberAvatar}
            />
            <View>
              <View style={styles.memberNameRow}>
                <Text style={styles.memberName}>{member.name}</Text>
                {member.userId === currentUserId && (
                  <Text style={styles.youBadge}>(You)</Text>
                )}
              </View>
              <View style={styles.roleBadge}>
                {member.role === 'owner' && (
                  <View style={styles.ownerBadge}>
                    <Ionicons name="star" size={10} color="#fbbf24" />
                    <Text style={styles.ownerBadgeText}>Owner</Text>
                  </View>
                )}
                {member.role === 'admin' && (
                  <View style={styles.adminBadge}>
                    <Ionicons name="shield-checkmark" size={10} color="#6366f1" />
                    <Text style={styles.adminBadgeText}>Admin</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Member Actions */}
          {member.userId !== currentUserId && (
            <View style={styles.memberActions}>
              {/* Challenge Button */}
              <TouchableOpacity
                style={styles.actionIcon}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Challenge ${member.name}`}
                onPress={() => onChallenge(member)}
              >
                <Ionicons name="game-controller" size={18} color="#ef4444" />
              </TouchableOpacity>

              {/* Admin Actions */}
              {isOwner && member.role !== 'owner' && (
                <>
                  {member.role === 'admin' ? (
                    <TouchableOpacity
                      style={styles.actionIcon}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove admin from ${member.name}`}
                      onPress={() => handleDemote(member)}
                    >
                      <Ionicons name="arrow-down" size={18} color="#f59e0b" />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.actionIcon}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Make ${member.name} an admin`}
                      onPress={() => handlePromote(member)}
                    >
                      <Ionicons name="arrow-up" size={18} color="#10b981" />
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Remove Member */}
              {isAdmin && member.role !== 'owner' && (
                <TouchableOpacity
                  style={styles.actionIcon}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${member.name} from group`}
                  onPress={() => handleRemove(member)}
                >
                  <Ionicons name="close-circle" size={18} color="#ef4444" />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );

  const renderDangerTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.dangerSection}>
        <View style={styles.dangerHeader}>
          <Ionicons name="exit-outline" size={24} color="#f97316" />
          <View style={styles.dangerInfo}>
            <Text style={styles.dangerTitle}>Leave Group</Text>
            <Text style={styles.dangerDescription}>
              {isSoleAdmin
                ? 'Promote another admin before leaving'
                : 'You will lose access until invited again'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[
            styles.dangerButton,
            { backgroundColor: isSoleAdmin ? '#fdba74' : '#f97316' },
          ]}
          onPress={handleLeave}
          disabled={isSoleAdmin}
          accessibilityRole="button"
          accessibilityLabel="Leave group"
          accessibilityHint={
            isSoleAdmin ? 'Unavailable: promote another admin before leaving' : undefined
          }
          accessibilityState={{ disabled: isSoleAdmin }}
        >
          <Ionicons name="exit-outline" size={18} color="#ffffff" />
          <Text style={styles.dangerButtonText}>Leave Group</Text>
        </TouchableOpacity>
      </View>

      {/* Archive Section — any member */}
      <View style={styles.dangerSection}>
        <View style={styles.dangerHeader}>
          <Ionicons name="archive" size={24} color="#f59e0b" />
          <View style={styles.dangerInfo}>
            <Text style={styles.dangerTitle}>
              {group.isArchived ? 'Unarchive Group' : 'Archive Group'}
            </Text>
            <Text style={styles.dangerDescription}>
              {group.isArchived
                ? 'Restore the group for all members'
                : 'Hide group and disable new messages'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.dangerButton, styles.archiveButton]}
          accessibilityRole="button"
          accessibilityLabel={group.isArchived ? 'Unarchive group' : 'Archive group'}
          onPress={handleArchive}
        >
          <Ionicons name="archive" size={18} color="#ffffff" />
          <Text style={styles.dangerButtonText}>
            {group.isArchived ? 'Unarchive' : 'Archive'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Report Section — any member; routes to Lantern moderation (Phase 1 · E) */}
      <View style={styles.dangerSection}>
        <View style={styles.dangerHeader}>
          <Ionicons name="flag-outline" size={24} color="#f59e0b" />
          <View style={styles.dangerInfo}>
            <Text style={styles.dangerTitle}>Report Group</Text>
            <Text style={styles.dangerDescription}>
              Leaked exams, scams, harassment or other rule-breaking — reported confidentially to Lantern
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.dangerButton, styles.archiveButton]}
          accessibilityRole="button"
          accessibilityLabel="Report group"
          onPress={() => setShowReportGroup(true)}
        >
          <Ionicons name="flag-outline" size={18} color="#ffffff" />
          <Text style={styles.dangerButtonText}>Report Group</Text>
        </TouchableOpacity>
      </View>

      {isOwner ? (
          <View style={[styles.dangerSection, styles.deleteSection]}>
            <View style={styles.dangerHeader}>
              <Ionicons name="trash" size={24} color="#ef4444" />
              <View style={styles.dangerInfo}>
                <Text style={[styles.dangerTitle, styles.deleteTitle]}>
                  Delete Group
                </Text>
                <Text style={styles.dangerDescription}>
                  Permanently delete group, messages, and all data
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              style={[styles.dangerButton, styles.deleteButton]}
              accessibilityRole="button"
              accessibilityLabel="Delete group permanently"
              onPress={handleDelete}
            >
              <Ionicons name="trash" size={18} color="#ffffff" />
              <Text style={styles.dangerButtonText}>Delete Permanently</Text>
            </TouchableOpacity>
          </View>
      ) : null}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
        <View style={[styles.container, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>Group Settings</Text>
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.background }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close group info"
              onPress={onClose}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
            {renderTab('details', 'Details', 'information-circle')}
            {renderTab('members', 'Members', 'people')}
            {renderTab('danger', 'Danger', 'warning')}
          </View>

          {/* Content */}
          <ScrollView 
            style={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {activeTab === 'details' && renderDetailsTab()}
            {activeTab === 'members' && renderMembersTab()}
            {activeTab === 'danger' && renderDangerTab()}
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </View>
      <ReportContentSheet
        visible={showReportGroup}
        targetType="group"
        targetId={group.id}
        targetLabel={group.name}
        onClose={() => setShowReportGroup(false)}
      />
    </Modal>
  );
}

/**
 * Built per-theme rather than at module scope: every colour in here used to be a
 * baked dark-mode hex, so the sheet stayed dark navy while the rest of the app
 * was in light mode. Saturated button fills (primary, warning, error, the sky
 * accent) keep white text in both themes on purpose.
 */
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    minHeight: '60%',
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginHorizontal: 20,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: colors.primary,
  },
  tabText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  activeTabText: {
    color: colors.primary,
    fontWeight: '600',
  },
  scrollContent: {
    flex: 1,
  },
  tabContent: {
    padding: 20,
    paddingBottom: 40,
  },
  // Details Tab
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  groupAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 12,
  },
  changeAvatarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  changeAvatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: colors.inputText,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    gap: 20,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  createSubgroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0ea5e9',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    gap: 8,
  },
  createSubgroupText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Members Tab
  addMembersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    marginBottom: 20,
  },
  addMembersText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  youBadge: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  roleBadge: {
    flexDirection: 'row',
    marginTop: 2,
  },
  ownerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.warning}20`,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  ownerBadgeText: {
    fontSize: 11,
    color: colors.warning,
    fontWeight: '500',
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryBackground,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  adminBadgeText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '500',
  },
  memberActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Danger Tab
  noAccessContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noAccessText: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
  dangerSection: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
  deleteSection: {
    borderLeftColor: colors.error,
  },
  dangerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  dangerInfo: {
    flex: 1,
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.warning,
    marginBottom: 4,
  },
  deleteTitle: {
    color: colors.error,
  },
  dangerDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  archiveButton: {
    backgroundColor: colors.warning,
  },
  deleteButton: {
    backgroundColor: colors.error,
  },
  dangerButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});

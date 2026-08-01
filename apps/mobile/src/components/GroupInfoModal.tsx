// ===========================================
// Lantern Study Mobile - Group Info Modal
// ===========================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Group, GroupMember } from '../stores/groupStore';
import { uploadGroupAvatar } from '../services/api';
import { ResolvedAvatar } from './ResolvedAvatar';
import { useTheme } from '../theme';

type TabType = 'details' | 'members' | 'danger';

interface GroupInfoModalProps {
  visible: boolean;
  onClose: () => void;
  group: Group;
  currentUserId: string;
  onUpdateDetails: (groupId: string, name: string, description: string) => void;
  onPromoteToAdmin: (groupId: string, userId: string) => void;
  onDemoteAdmin: (groupId: string, userId: string) => void;
  onRemoveMember: (groupId: string, userId: string) => void;
  onLeaveGroup: (groupId: string) => void;
  onArchiveGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onAddMembers: () => void;
  onChallenge: (member: GroupMember) => void;
  onCreateSubgroup?: () => void;
  onMessageMember?: (member: GroupMember) => void;
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
  onMessageMember,
  onAvatarUpdated,
}: GroupInfoModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [hasChanges, setHasChanges] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const { colors } = useTheme();

  const currentUserMember = group.members.find(m => m.userId === currentUserId);
  const isAdmin = currentUserMember?.role === 'owner' || currentUserMember?.role === 'admin';
  const isOwner = currentUserMember?.role === 'owner';
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
    onUpdateDetails(group.id, name, description);
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
        <ResolvedAvatar
          name={group.name}
          uri={
            avatarPreview ||
            group.avatarUrl ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(group.name)}&background=6366f1&color=fff&size=100`
          }
          size={80}
        />
        {isAdmin && (
          <TouchableOpacity
            style={[styles.changeAvatarButton, { backgroundColor: colors.primary }]}
            onPress={() => void handleChangeAvatar()}
            disabled={uploadingAvatar}
          >
            {uploadingAvatar ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <>
                <Ionicons name="camera" size={16} color={colors.textInverse} />
                <Text style={[styles.changeAvatarText, { color: colors.textInverse }]}>Change</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Group Name */}
      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Group Name</Text>
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
        <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Description</Text>
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

      {/* Stats */}
      <View style={[styles.statsRow, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>{group.memberCount}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Members</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {group.createdAt && !Number.isNaN(Date.parse(group.createdAt))
              ? new Date(group.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : '—'}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Created</Text>
        </View>
      </View>

      {/* Save Button */}
      {isAdmin && hasChanges && (
        <TouchableOpacity style={[styles.saveButton, { backgroundColor: colors.primary }]} onPress={handleSaveDetails}>
          <Text style={[styles.saveButtonText, { color: colors.textInverse }]}>Save Changes</Text>
        </TouchableOpacity>
      )}

      {/* Create Sub-group */}
      {isAdmin && onCreateSubgroup ? (
        <TouchableOpacity
          style={[styles.createSubgroupButton, { backgroundColor: colors.info }]}
          onPress={onCreateSubgroup}
        >
          <Ionicons name="git-network" size={20} color={colors.textInverse} />
          <Text style={[styles.createSubgroupText, { color: colors.textInverse }]}>Create Sub-group</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderMembersTab = () => (
    <View style={styles.tabContent}>
      {/* Add Members Button */}
      {isAdmin && (
        <TouchableOpacity
          style={[styles.addMembersButton, { backgroundColor: colors.primary }]}
          onPress={onAddMembers}
        >
          <Ionicons name="person-add" size={20} color={colors.textInverse} />
          <Text style={[styles.addMembersText, { color: colors.textInverse }]}>
            Add or Invite Members
          </Text>
        </TouchableOpacity>
      )}

      {/* Members List */}
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Members ({group.members.length})
      </Text>
      
      {group.members.map((member) => (
        <View
          key={member.id}
          style={[styles.memberItem, { backgroundColor: colors.backgroundSecondary }]}
        >
          <View style={styles.memberInfo}>
            <ResolvedAvatar
              name={member.name}
              uri={
                member.avatarUrl ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=6366f1&color=fff`
              }
              size={40}
            />
            <View>
              <View style={styles.memberNameRow}>
                <Text style={[styles.memberName, { color: colors.text }]}>{member.name}</Text>
                {member.userId === currentUserId && (
                  <Text style={[styles.youBadge, { color: colors.textSecondary }]}>(You)</Text>
                )}
              </View>
              <View style={styles.roleBadge}>
                {member.role === 'owner' && (
                  <View style={[styles.ownerBadge, { backgroundColor: colors.warningBackground }]}>
                    <Ionicons name="star" size={10} color={colors.warning} />
                    <Text style={[styles.ownerBadgeText, { color: colors.warning }]}>Owner</Text>
                  </View>
                )}
                {member.role === 'admin' && (
                  <View style={[styles.adminBadge, { backgroundColor: colors.primaryBackground }]}>
                    <Ionicons name="shield-checkmark" size={10} color={colors.primary} />
                    <Text style={[styles.adminBadgeText, { color: colors.primary }]}>Admin</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Member Actions */}
          {member.userId !== currentUserId && (
            <View style={styles.memberActions}>
              {/* Message Button */}
              {onMessageMember && (
                <TouchableOpacity
                  style={[styles.actionIcon, { backgroundColor: colors.card }]}
                  onPress={() => onMessageMember(member)}
                >
                  <Ionicons name="chatbubble" size={18} color={colors.primary} />
                </TouchableOpacity>
              )}

              {/* Challenge Button */}
              <TouchableOpacity
                style={[styles.actionIcon, { backgroundColor: colors.card }]}
                onPress={() => onChallenge(member)}
              >
                <Ionicons name="game-controller" size={18} color={colors.error} />
              </TouchableOpacity>

              {/* Admin Actions */}
              {isOwner && member.role !== 'owner' && (
                <>
                  {member.role === 'admin' ? (
                    <TouchableOpacity
                      style={[styles.actionIcon, { backgroundColor: colors.card }]}
                      onPress={() => handleDemote(member)}
                    >
                      <Ionicons name="arrow-down" size={18} color={colors.warning} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.actionIcon, { backgroundColor: colors.card }]}
                      onPress={() => handlePromote(member)}
                    >
                      <Ionicons name="arrow-up" size={18} color={colors.success} />
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Remove Member */}
              {isAdmin && member.role !== 'owner' && (
                <TouchableOpacity
                  style={[styles.actionIcon, { backgroundColor: colors.card }]}
                  onPress={() => handleRemove(member)}
                >
                  <Ionicons name="close-circle" size={18} color={colors.error} />
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
      <View
        style={[
          styles.dangerSection,
          {
            backgroundColor: colors.warningBackground,
            borderLeftColor: '#f97316',
          },
        ]}
      >
        <View style={styles.dangerHeader}>
          <Ionicons name="exit-outline" size={24} color="#f97316" />
          <View style={styles.dangerInfo}>
            <Text style={[styles.dangerTitle, { color: '#ea580c' }]}>Leave Group</Text>
            <Text style={[styles.dangerDescription, { color: colors.textSecondary }]}>
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
        >
          <Ionicons name="exit-outline" size={18} color="#ffffff" />
          <Text style={styles.dangerButtonText}>Leave Group</Text>
        </TouchableOpacity>
      </View>

      {/* Archive Section — any member */}
      <View
        style={[
          styles.dangerSection,
          {
            backgroundColor: colors.warningBackground,
            borderLeftColor: colors.warning,
          },
        ]}
      >
        <View style={styles.dangerHeader}>
          <Ionicons name="archive" size={24} color={colors.warning} />
          <View style={styles.dangerInfo}>
            <Text style={[styles.dangerTitle, { color: colors.warning }]}>
              {group.isArchived ? 'Unarchive Group' : 'Archive Group'}
            </Text>
            <Text style={[styles.dangerDescription, { color: colors.textSecondary }]}>
              {group.isArchived
                ? 'Restore the group for all members'
                : 'Hide group and disable new messages'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.dangerButton, { backgroundColor: colors.warning }]}
          onPress={handleArchive}
        >
          <Ionicons name="archive" size={18} color="#ffffff" />
          <Text style={styles.dangerButtonText}>
            {group.isArchived ? 'Unarchive' : 'Archive'}
          </Text>
        </TouchableOpacity>
      </View>

      {isOwner ? (
          <View
            style={[
              styles.dangerSection,
              {
                backgroundColor: colors.errorBackground,
                borderLeftColor: colors.error,
              },
            ]}
          >
            <View style={styles.dangerHeader}>
              <Ionicons name="trash" size={24} color={colors.error} />
              <View style={styles.dangerInfo}>
                <Text style={[styles.dangerTitle, { color: colors.error }]}>
                  Delete Group
                </Text>
                <Text style={[styles.dangerDescription, { color: colors.textSecondary }]}>
                  Permanently delete group, messages, and all data
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              style={[styles.dangerButton, { backgroundColor: colors.error }]}
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
      <View style={[styles.overlay, { backgroundColor: colors.modalOverlay }]}>
        <View style={[styles.container, { backgroundColor: colors.modalBackground }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>Group Settings</Text>
            <TouchableOpacity style={[styles.closeButton, { backgroundColor: colors.backgroundSecondary }]} onPress={onClose}>
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    minHeight: '60%',
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
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
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
  tabText: {
    fontSize: 14,
  },
  scrollContent: {
    flex: 1,
  },
  tabContent: {
    padding: 20,
    paddingBottom: 40,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  changeAvatarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    marginTop: 12,
  },
  changeAvatarText: {
    fontSize: 14,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  statsRow: {
    flexDirection: 'row',
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
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  saveButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  createSubgroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    gap: 8,
  },
  createSubgroupText: {
    fontSize: 16,
    fontWeight: '600',
  },
  addMembersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    marginBottom: 20,
  },
  addMembersText: {
    fontSize: 16,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
  },
  youBadge: {
    fontSize: 12,
  },
  roleBadge: {
    flexDirection: 'row',
    marginTop: 2,
  },
  ownerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  ownerBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  adminBadgeText: {
    fontSize: 11,
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerSection: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
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
    marginBottom: 4,
  },
  dangerDescription: {
    fontSize: 13,
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
  dangerButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});

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
  Image,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Group, GroupMember } from '../stores/groupStore';
import { uploadGroupAvatar } from '../services/api';
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
        <Image
          source={{ uri: avatarPreview || group.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(group.name)}&background=6366f1&color=fff&size=100` }}
          style={styles.groupAvatar}
        />
        {isAdmin && (
          <TouchableOpacity
            style={styles.changeAvatarButton}
            onPress={() => void handleChangeAvatar()}
            disabled={uploadingAvatar}
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
        <TouchableOpacity style={styles.saveButton} onPress={handleSaveDetails}>
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>
      )}

      {/* Create Sub-group */}
      {isAdmin && onCreateSubgroup ? (
        <TouchableOpacity style={styles.createSubgroupButton} onPress={onCreateSubgroup}>
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
        <TouchableOpacity style={styles.addMembersButton} onPress={onAddMembers}>
          <Ionicons name="person-add" size={20} color="#ffffff" />
          <Text style={styles.addMembersText}>Add or Invite Members</Text>
        </TouchableOpacity>
      )}

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
              {/* Message Button */}
              {onMessageMember && (
                <TouchableOpacity
                  style={styles.actionIcon}
                  onPress={() => onMessageMember(member)}
                >
                  <Ionicons name="chatbubble" size={18} color="#6366f1" />
                </TouchableOpacity>
              )}

              {/* Challenge Button */}
              <TouchableOpacity
                style={styles.actionIcon}
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
                      onPress={() => handleDemote(member)}
                    >
                      <Ionicons name="arrow-down" size={18} color="#f59e0b" />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.actionIcon}
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
          onPress={handleArchive}
        >
          <Ionicons name="archive" size={18} color="#ffffff" />
          <Text style={styles.dangerButtonText}>
            {group.isArchived ? 'Unarchive' : 'Archive'}
          </Text>
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
        <View style={[styles.container, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>Group Settings</Text>
            <TouchableOpacity style={[styles.closeButton, { backgroundColor: colors.background }]} onPress={onClose}>
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
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#0f172a',
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
    color: '#ffffff',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
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
    borderBottomColor: '#6366f1',
  },
  tabText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  activeTabText: {
    color: '#6366f1',
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
    backgroundColor: '#6366f1',
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
    color: '#9ca3af',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#334155',
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
    backgroundColor: '#1e293b',
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
    color: '#ffffff',
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: '#6366f1',
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
    backgroundColor: '#6366f1',
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
    color: '#ffffff',
    marginBottom: 12,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
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
    color: '#ffffff',
  },
  youBadge: {
    fontSize: 12,
    color: '#9ca3af',
  },
  roleBadge: {
    flexDirection: 'row',
    marginTop: 2,
  },
  ownerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fbbf2420',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  ownerBadgeText: {
    fontSize: 11,
    color: '#fbbf24',
    fontWeight: '500',
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f120',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  adminBadgeText: {
    fontSize: 11,
    color: '#6366f1',
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
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Danger Tab
  noAccessContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noAccessText: {
    color: '#6b7280',
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
  dangerSection: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  deleteSection: {
    borderLeftColor: '#ef4444',
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
    color: '#f59e0b',
    marginBottom: 4,
  },
  deleteTitle: {
    color: '#ef4444',
  },
  dangerDescription: {
    fontSize: 13,
    color: '#9ca3af',
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
    backgroundColor: '#f59e0b',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
  },
  dangerButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});

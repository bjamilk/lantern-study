// ===========================================
// Lantern Study Mobile - Groups Screen
// With Subgroup Support & Breadcrumb Navigation
// ===========================================

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Image,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useGroupStore, type Group } from '../../stores/groupStore';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme';
import NewDirectMessageModal from '../../components/NewDirectMessageModal';

export default function GroupsScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [currentParentId, setCurrentParentId] = useState<string | null>(null); // null = top level
  
  // Create group modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [createAsSubgroup, setCreateAsSubgroup] = useState(false);
  
  // New DM modal state
  const [showDMModal, setShowDMModal] = useState(false);
  
  const { user } = useAuthStore();
  const { 
    groups, 
    isLoading, 
    fetchGroups, 
    createGroup,
    getSubgroups,
    getTopLevelGroups,
    getBreadcrumbs,
  } = useGroupStore();

  useEffect(() => {
    if (user?.id) {
      fetchGroups(user.id);
    }
  }, [user?.id, fetchGroups]);

  // Collect all unique contacts from groups
  const allContacts = useMemo(() => {
    const contactMap = new Map<string, { id: string; userId: string; name: string; email?: string; avatarUrl?: string }>();
    
    groups.forEach(group => {
      group.members?.forEach(member => {
        if (!contactMap.has(member.userId)) {
          contactMap.set(member.userId, {
            id: member.id,
            userId: member.userId,
            name: member.name,
            avatarUrl: member.avatarUrl,
          });
        }
      });
    });
    
    return Array.from(contactMap.values());
  }, [groups]);

  const handleStartDM = useCallback((userId: string, userName: string) => {
    navigation.navigate('Groups', {
      screen: 'DirectMessage',
      params: { recipientId: userId, recipientName: userName },
    });
  }, [navigation]);

  // Get current breadcrumbs for navigation
  const breadcrumbs = useMemo(() => {
    if (!currentParentId) return [];
    return getBreadcrumbs(currentParentId);
  }, [currentParentId, getBreadcrumbs]);

  // Get groups to display based on current level
  const displayGroups = useMemo(() => {
    let groupsToDisplay: Group[];
    
    if (currentParentId) {
      // Show subgroups of current parent
      groupsToDisplay = getSubgroups(currentParentId);
    } else {
      // Show top-level groups
      groupsToDisplay = getTopLevelGroups();
    }
    
    // Apply search filter
    if (!searchQuery) return groupsToDisplay;
    
    return groupsToDisplay.filter(group =>
      group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      group.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [currentParentId, searchQuery, getSubgroups, getTopLevelGroups]);

  // Check if a group has subgroups
  const getSubgroupCount = useCallback((groupId: string) => {
    return getSubgroups(groupId).length;
  }, [getSubgroups]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.id) {
      await fetchGroups(user.id);
    }
    setRefreshing(false);
  }, [user?.id, fetchGroups]);

  const handleGroupPress = useCallback((group: Group) => {
    // Navigate to group chat
    navigation.navigate('Groups', {
      screen: 'GroupChat',
      params: { groupId: group.id, groupName: group.name },
    });
  }, [navigation]);

  const handleSubgroupsPress = useCallback((group: Group) => {
    // Navigate into subgroups view
    setCurrentParentId(group.id);
    setSearchQuery('');
  }, []);

  const handleBreadcrumbPress = useCallback((groupId: string | null) => {
    setCurrentParentId(groupId);
    setSearchQuery('');
  }, []);

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }
    
    if (!user) {
      Alert.alert('Error', 'You must be logged in to create a group');
      return;
    }
    
    try {
      await createGroup(
        newGroupName.trim(),
        newGroupDescription.trim(),
        user.id,
        user.user_metadata?.full_name || 'User',
        createAsSubgroup ? currentParentId || undefined : undefined
      );
      setNewGroupName('');
      setNewGroupDescription('');
      setShowCreateModal(false);
      setCreateAsSubgroup(false);
      Alert.alert('Success', createAsSubgroup ? 'Subgroup created!' : 'Group created successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to create group');
    }
  }, [newGroupName, newGroupDescription, user, createGroup, createAsSubgroup, currentParentId]);

  const formatTime = (dateString?: string) => {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const renderGroupItem = useCallback(({ item }: { item: Group }) => {
    const subgroupCount = getSubgroupCount(item.id);
    const hasSubgroups = subgroupCount > 0;
    
    return (
      <View style={[styles.groupCard, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={styles.groupMain}
          onPress={() => handleGroupPress(item)}
          activeOpacity={0.7}
        >
          <Image
            source={{ 
              uri: item.avatarUrl || 
                `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=6366f1&color=fff`
            }}
            style={styles.groupAvatar}
          />
          
          <View style={styles.groupInfo}>
            <View style={styles.groupHeader}>
              <View style={styles.groupNameRow}>
                <Text style={[styles.groupName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                {item.parentId && (
                  <View style={[styles.subgroupBadge, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="git-branch-outline" size={10} color={colors.primary} />
                  </View>
                )}
              </View>
              <Text style={[styles.groupTime, { color: colors.textSecondary }]}>
                {formatTime(item.lastMessage?.createdAt || item.updatedAt)}
              </Text>
            </View>
            
            <Text style={[styles.lastMessage, { color: colors.textSecondary }]} numberOfLines={1}>
              {item.lastMessage 
                ? `${item.lastMessage.senderName}: ${item.lastMessage.text}`
                : item.description || 'No messages yet'
              }
            </Text>
            
            <View style={styles.groupMeta}>
              <View style={styles.metaItem}>
                <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
                <Text style={[styles.memberCount, { color: colors.textSecondary }]}>{item.memberCount} members</Text>
              </View>
              {hasSubgroups && (
                <View style={styles.metaItem}>
                  <Ionicons name="folder-outline" size={14} color={colors.primary} />
                  <Text style={[styles.subgroupCountText, { color: colors.primary }]}>{subgroupCount} subgroups</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
        
        {/* Subgroups button */}
        {hasSubgroups ? (
          <TouchableOpacity
            style={[styles.subgroupsButton, { backgroundColor: colors.primaryLight }]}
            onPress={() => handleSubgroupsPress(item)}
          >
            <Ionicons name="folder-open" size={20} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} style={styles.chevron} />
        )}
      </View>
    );
  }, [handleGroupPress, handleSubgroupsPress, getSubgroupCount, colors]);

  const ListHeaderComponent = useMemo(() => (
    <View style={styles.listHeader}>
      {/* Breadcrumb Navigation */}
      {currentParentId && (
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.breadcrumbContainer}
          contentContainerStyle={styles.breadcrumbContent}
        >
          <TouchableOpacity
            style={styles.breadcrumbItem}
            onPress={() => handleBreadcrumbPress(null)}
          >
            <Ionicons name="home" size={16} color={colors.primary} />
            <Text style={[styles.breadcrumbText, { color: colors.primary }]}>All Groups</Text>
          </TouchableOpacity>
          
          {breadcrumbs.map((crumb, index) => (
            <View key={crumb.id} style={styles.breadcrumbItem}>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
              <TouchableOpacity
                onPress={() => handleBreadcrumbPress(crumb.id)}
                disabled={index === breadcrumbs.length - 1}
              >
                <Text style={[
                  styles.breadcrumbText,
                  { color: colors.primary },
                  index === breadcrumbs.length - 1 && { color: colors.text }
                ]}>
                  {crumb.name}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={currentParentId ? "Search subgroups..." : "Search groups..."}
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Groups Count */}
      <Text style={[styles.groupsCount, { color: colors.textSecondary }]}>
        {displayGroups.length} {currentParentId ? 'subgroup' : 'group'}{displayGroups.length !== 1 ? 's' : ''}
      </Text>
    </View>
  ), [searchQuery, displayGroups.length, currentParentId, breadcrumbs, handleBreadcrumbPress, colors]);

  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyContainer}>
      <View style={[styles.iconContainer, { backgroundColor: colors.primaryLight }]}>
        <Ionicons 
          name={currentParentId ? "folder-open-outline" : "people-outline"} 
          size={64} 
          color={colors.primary} 
        />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {searchQuery 
          ? 'No groups found' 
          : currentParentId 
            ? 'No subgroups yet' 
            : 'No study groups yet'
        }
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {searchQuery
          ? 'Try adjusting your search'
          : currentParentId
            ? 'Create a subgroup to organize topics'
            : 'Create a study group to collaborate with friends'
        }
      </Text>
      {!searchQuery && (
        <TouchableOpacity 
          style={[styles.createButtonEmpty, { backgroundColor: colors.primary }]} 
          onPress={() => {
            setCreateAsSubgroup(!!currentParentId);
            setShowCreateModal(true);
          }}
        >
          <Ionicons name="add" size={20} color="#ffffff" />
          <Text style={styles.createButtonText}>
            {currentParentId ? 'Create Subgroup' : 'Create Group'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  ), [searchQuery, currentParentId, colors]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {currentParentId && (
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => {
                // Go back to parent or top level
                const parent = breadcrumbs.length > 1 
                  ? breadcrumbs[breadcrumbs.length - 2].id 
                  : null;
                setCurrentParentId(parent);
              }}
            >
              <Ionicons name="arrow-back" size={24} color={colors.primary} />
            </TouchableOpacity>
          )}
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {currentParentId 
              ? breadcrumbs[breadcrumbs.length - 1]?.name || 'Subgroups'
              : 'Study Groups'
            }
          </Text>
        </View>
        <TouchableOpacity 
          style={[styles.addButton, { backgroundColor: colors.primary }]} 
          onPress={() => {
            setCreateAsSubgroup(!!currentParentId);
            setShowCreateModal(true);
          }}
        >
          <Ionicons name="add" size={24} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      {/* Groups List */}
      <FlatList
        data={displayGroups}
        keyExtractor={(item) => item.id}
        renderItem={renderGroupItem}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      />

      {/* Create Group Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowCreateModal(false);
          setCreateAsSubgroup(false);
        }}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {createAsSubgroup ? 'Create Subgroup' : 'Create Study Group'}
            </Text>
            
            {/* Subgroup indicator */}
            {createAsSubgroup && breadcrumbs.length > 0 && (
              <View style={[styles.subgroupIndicator, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="git-branch-outline" size={16} color={colors.primary} />
                <Text style={[styles.subgroupIndicatorText, { color: colors.primary }]}>
                  Creating under: {breadcrumbs[breadcrumbs.length - 1].name}
                </Text>
              </View>
            )}
            
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              {createAsSubgroup ? 'Subgroup Name *' : 'Group Name *'}
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder={createAsSubgroup ? "e.g., Chapter 1 Study" : "Enter group name"}
              placeholderTextColor={colors.textSecondary}
              value={newGroupName}
              onChangeText={setNewGroupName}
              autoFocus
            />
            
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Description (optional)</Text>
            <TextInput
              style={[styles.modalInput, styles.textArea, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              placeholder="What's this group about?"
              placeholderTextColor={colors.textSecondary}
              value={newGroupDescription}
              onChangeText={setNewGroupDescription}
              multiline
              numberOfLines={3}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: colors.border }]}
                onPress={() => {
                  setShowCreateModal(false);
                  setCreateAsSubgroup(false);
                  setNewGroupName('');
                  setNewGroupDescription('');
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveButton, 
                  { backgroundColor: colors.primary },
                  !newGroupName.trim() && styles.saveButtonDisabled
                ]}
                onPress={handleCreateGroup}
                disabled={!newGroupName.trim()}
              >
                <Text style={styles.saveButtonText}>
                  {createAsSubgroup ? 'Create' : 'Create'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* New DM Modal */}
      <NewDirectMessageModal
        visible={showDMModal}
        onClose={() => setShowDMModal(false)}
        contacts={allContacts}
        currentUserId={user?.id || ''}
        onStartChat={handleStartDM}
      />

      {/* Floating Action Button for New Message */}
      <TouchableOpacity
        style={styles.fabButton}
        onPress={() => setShowDMModal(true)}
      >
        <Ionicons name="chatbubbles" size={24} color="#ffffff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    flex: 1,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  listHeader: {
    marginBottom: 16,
  },
  // Breadcrumb styles
  breadcrumbContainer: {
    marginBottom: 12,
  },
  breadcrumbContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breadcrumbText: {
    fontSize: 14,
    color: '#6366f1',
    marginRight: 8,
  },
  breadcrumbTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: 16,
    color: '#ffffff',
  },
  groupsCount: {
    fontSize: 14,
    color: '#9ca3af',
  },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  groupMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  groupAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 16,
  },
  groupInfo: {
    flex: 1,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  groupNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  groupName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    flexShrink: 1,
  },
  subgroupBadge: {
    marginLeft: 6,
    backgroundColor: '#6366f120',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  groupTime: {
    fontSize: 12,
    color: '#6b7280',
  },
  lastMessage: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 6,
  },
  groupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  memberCount: {
    fontSize: 12,
    color: '#6b7280',
  },
  subgroupCountText: {
    fontSize: 12,
    color: '#6366f1',
  },
  subgroupsButton: {
    padding: 8,
    backgroundColor: '#6366f120',
    borderRadius: 8,
    marginLeft: 8,
  },
  chevron: {
    marginLeft: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  createButtonEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 24,
    textAlign: 'center',
  },
  subgroupIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#6366f115',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#6366f130',
  },
  subgroupIndicatorText: {
    fontSize: 14,
    color: '#6366f1',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  saveButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#4b5563',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  fabButton: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#8b5cf6',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
});

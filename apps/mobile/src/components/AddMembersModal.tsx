// ===========================================
// Lantern Study Mobile - Add Members Modal
// ===========================================
// Allows adding members by username search or share invite link

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Share,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { ThemeScope, useTheme } from '../theme';
import * as api from '../services/api';
import { ResolvedAvatar } from './ResolvedAvatar';

interface SearchResult {
  id: string;
  name: string;
  username?: string;
  displayUsername?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

interface AddMembersModalProps {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  inviteLink: string;
  groupMemberIds: string[];
  currentUserId: string;
  onAddMembers: (userIds: string[]) => void;
}

export default function AddMembersModal({
  visible,
  onClose,
  groupId,
  groupName,
  inviteLink,
  groupMemberIds,
  currentUserId,
  onAddMembers,
}: AddMembersModalProps) {
  const [view, setView] = useState<'initial' | 'search' | 'invite'>('initial');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const { colors } = useTheme();
  const searchRequestRef = useRef(0);
  const memberIdSet = useMemo(() => new Set(groupMemberIds), [groupMemberIds]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setView('initial');
      setSearchTerm('');
      setSearchResults([]);
      setSelectedUserIds([]);
      setCopied(false);
    }
  }, [visible]);

  // Debounced search for users
  useEffect(() => {
    if (view !== 'search' || !searchTerm.trim() || searchTerm.trim().length < 2) {
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
          .filter(u => u.id !== currentUserId && !memberIdSet.has(u.id))
          .map(
            (u): SearchResult => ({
              id: u.id,
              name: u.name,
              username: u.username,
              displayUsername: u.username ? `@${u.username}` : undefined,
              avatarUrl: u.avatar_url,
            })
          );
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
  }, [searchTerm, view, memberIdSet, currentUserId]);

  const handleCopyLink = async () => {
    await Clipboard.setStringAsync(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareLink = async () => {
    try {
      await Share.share({
        message: `Join my study group "${groupName}" on Lantern Study!\n\n${inviteLink}`,
        title: `Join ${groupName}`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const handleUserToggle = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleAddSelected = () => {
    if (selectedUserIds.length > 0) {
      onAddMembers(selectedUserIds);
    }
    onClose();
  };

  const getAvatarUrl = (user: SearchResult) => {
    if (user.avatarUrl) return user.avatarUrl;
    return null;
  };

  const renderInitialView = () => (
    <View style={styles.initialView}>
      <TouchableOpacity
        style={[styles.optionCard, { backgroundColor: colors.background, borderColor: colors.border }]}
        onPress={() => setView('search')}
      >
        <View style={[styles.optionIconContainer, { backgroundColor: colors.primary + '20' }]}>
          <Ionicons name="at" size={28} color={colors.primary} />
        </View>
        <View style={styles.optionTextContainer}>
          <Text style={[styles.optionTitle, { color: colors.text }]}>Search by Username</Text>
          <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
            Find users by @username or name
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.optionCard, { backgroundColor: colors.background, borderColor: colors.border }]}
        onPress={() => setView('invite')}
      >
        <View style={[styles.optionIconContainer, { backgroundColor: '#10B98120' }]}>
          <Ionicons name="link" size={28} color="#10B981" />
        </View>
        <View style={styles.optionTextContainer}>
          <Text style={[styles.optionTitle, { color: colors.text }]}>Share Invite Link</Text>
          <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
            Send a link for others to join
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={[styles.footerActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.doneButton, { backgroundColor: colors.background, borderColor: colors.border }]}
          onPress={onClose}
        >
          <Text style={[styles.doneButtonText, { color: colors.text }]}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSearchView = () => (
    <View style={styles.searchView}>
      <View style={[styles.searchInputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Ionicons name="search" size={20} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search by @username or name..."
          placeholderTextColor={colors.textSecondary}
          value={searchTerm}
          onChangeText={setSearchTerm}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        {searchTerm.length > 0 && (
          <TouchableOpacity onPress={() => setSearchTerm('')}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {isSearching ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : searchTerm.length < 2 ? (
        <View style={styles.emptyStateContainer}>
          <Ionicons name="at" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyStateTitle, { color: colors.textSecondary }]}>
            Type at least 2 characters to search
          </Text>
          <Text style={[styles.emptyStateSubtitle, { color: colors.textSecondary }]}>
            Search by @username, first name, or last name
          </Text>
        </View>
      ) : searchResults.length === 0 ? (
        <View style={styles.emptyStateContainer}>
          <Ionicons name="people" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyStateTitle, { color: colors.textSecondary }]}>
            No users found
          </Text>
          <Text style={[styles.emptyStateSubtitle, { color: colors.textSecondary }]}>
            Try a different search term or share the invite link
          </Text>
        </View>
      ) : (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isSelected = selectedUserIds.includes(item.id);
            return (
              <TouchableOpacity
                style={[
                  styles.userItem,
                  {
                    backgroundColor: isSelected ? colors.primary + '20' : colors.background,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => handleUserToggle(item.id)}
              >
                <View style={styles.userAvatarContainer}>
                  <Image source={{ uri: getAvatarUrl(item) }} style={styles.userAvatar} />
                  {isSelected && (
                    <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                  )}
                </View>
                <View style={styles.userInfo}>
                  <Text style={[styles.userName, { color: colors.text }]}>{item.name}</Text>
                  {item.displayUsername && (
                    <Text style={[styles.userUsername, { color: colors.primary }]}>
                      {item.displayUsername}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.userList}
        />
      )}

      <View style={[styles.footerActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.doneButton, { backgroundColor: colors.background, borderColor: colors.border }]}
          onPress={onClose}
        >
          <Text style={[styles.doneButtonText, { color: colors.text }]}>
            {selectedUserIds.length > 0 ? 'Cancel' : 'Done'}
          </Text>
        </TouchableOpacity>
        {selectedUserIds.length > 0 && (
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.primary, flex: 1 }]}
            onPress={handleAddSelected}
          >
            <Text style={styles.addButtonText}>
              Add {selectedUserIds.length} Member{selectedUserIds.length > 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderInviteView = () => (
    <ScrollView style={styles.inviteView} showsVerticalScrollIndicator={false}>
      <View style={[styles.section, { backgroundColor: colors.background }]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="link" size={22} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Share Invite Link</Text>
        </View>
        <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
          Anyone with this link can join the group
        </Text>

        <View style={[styles.linkContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.linkText, { color: colors.primary }]} numberOfLines={1}>
            {inviteLink}
          </Text>
          <TouchableOpacity 
            style={[styles.copyButton, copied && styles.copiedButton]}
            onPress={handleCopyLink}
          >
            <Ionicons 
              name={copied ? 'checkmark' : 'copy'} 
              size={18} 
              color="#ffffff" 
            />
          </TouchableOpacity>
        </View>

        <View style={styles.shareButtons}>
          <TouchableOpacity style={styles.shareButton} onPress={handleShareLink}>
            <Ionicons name="share-social" size={20} color="#ffffff" />
            <Text style={styles.shareButtonText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareButton} onPress={handleCopyLink}>
            <Ionicons name="copy" size={20} color="#ffffff" />
            <Text style={styles.shareButtonText}>
              {copied ? 'Copied!' : 'Copy Link'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.infoBox, { backgroundColor: colors.primary + '15' }]}>
        <Ionicons name="at" size={20} color={colors.primary} />
        <Text style={[styles.infoText, { color: colors.text }]}>
          Ask your friends for their @username and search for them directly to add them to the group.
        </Text>
      </View>
    </ScrollView>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <ThemeScope style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            {view !== 'initial' && (
              <TouchableOpacity 
                style={[styles.backButton, { backgroundColor: colors.background }]} 
                onPress={() => setView('initial')}
              >
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </TouchableOpacity>
            )}
            <Text style={[styles.title, { color: colors.text }, view !== 'initial' && { marginLeft: 16 }]}>
              Add Members
            </Text>
            <TouchableOpacity style={[styles.closeButton, { backgroundColor: colors.background }]} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            {view === 'initial' && renderInitialView()}
            {view === 'search' && renderSearchView()}
            {view === 'invite' && renderInviteView()}
          </View>
        </View>
      </ThemeScope>
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    flex: 1,
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
  content: {
    flex: 1,
  },
  // Initial view
  initialView: {
    padding: 20,
    gap: 12,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  optionIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionTextContainer: {
    flex: 1,
    marginLeft: 16,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  optionDescription: {
    fontSize: 13,
  },
  // Search view
  searchView: {
    flex: 1,
    padding: 20,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 16,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  userList: {
    paddingBottom: 20,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  userAvatarContainer: {
    position: 'relative',
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  checkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  userInfo: {
    marginLeft: 12,
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: '500',
  },
  userUsername: {
    fontSize: 13,
    marginTop: 2,
  },
  addButtonContainer: {
    padding: 16,
    borderTopWidth: 1,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    marginTop: 'auto',
  },
  doneButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  addButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Invite view
  inviteView: {
    padding: 20,
  },
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  sectionDescription: {
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
  },
  linkText: {
    flex: 1,
    fontSize: 13,
  },
  copyButton: {
    backgroundColor: '#6366f1',
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  copiedButton: {
    backgroundColor: '#10b981',
  },
  shareButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  shareButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    marginBottom: 40,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});

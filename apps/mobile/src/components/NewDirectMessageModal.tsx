// ===========================================
// Lantern Study Mobile - New Direct Message Modal
// Start a chat with contacts/members
// ===========================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import * as api from '../services/api';

interface Contact {
  id: string;
  userId: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  status?: 'online' | 'offline' | 'away';
}

interface SearchResult {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string;
}

interface NewDirectMessageModalProps {
  visible: boolean;
  onClose: () => void;
  contacts: Contact[];
  currentUserId: string;
  onStartChat: (userId: string, userName: string) => void;
}

export default function NewDirectMessageModal({
  visible,
  onClose,
  contacts,
  currentUserId,
  onStartChat,
}: NewDirectMessageModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [apiResults, setApiResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const { colors } = useTheme();
  const searchRequestRef = useRef(0);

  useEffect(() => {
    if (visible) {
      setSearchTerm('');
      setApiResults([]);
      setSearchError('');
      setIsSearching(false);
    }
  }, [visible]);

  const trimmedSearch = searchTerm.trim();
  const useApiSearch = trimmedSearch.length >= 2;

  useEffect(() => {
    if (!useApiSearch) {
      setApiResults([]);
      setSearchError('');
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchError('');
    const requestId = ++searchRequestRef.current;

    const timeoutId = setTimeout(async () => {
      try {
        const data = await api.searchUsers(trimmedSearch, 20);
        if (requestId !== searchRequestRef.current) return;

        const filtered = (data || [])
          .filter(u => u.id !== currentUserId)
          .map((u): SearchResult => ({
            id: u.id,
            name: u.name,
            username: u.username,
            avatarUrl: u.avatarUrl,
          }));
        setApiResults(filtered);
      } catch (err) {
        if (requestId !== searchRequestRef.current) return;
        console.error('DM search failed:', err);
        setSearchError('Failed to search. Please try again.');
        setApiResults([]);
      } finally {
        if (requestId === searchRequestRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [trimmedSearch, useApiSearch, currentUserId]);

  const filteredContacts = useMemo(() => {
    const otherContacts = contacts.filter(c => c.userId !== currentUserId);

    if (!trimmedSearch) {
      return otherContacts;
    }

    if (useApiSearch) {
      return [];
    }

    return otherContacts.filter(contact =>
      contact.name.toLowerCase().includes(trimmedSearch.toLowerCase()) ||
      contact.email?.toLowerCase().includes(trimmedSearch.toLowerCase())
    );
  }, [trimmedSearch, contacts, currentUserId, useApiSearch]);

  const listData = useMemo(() => {
    if (useApiSearch) {
      return apiResults.map(r => ({
        id: r.id,
        userId: r.id,
        name: r.name,
        username: r.username,
        avatarUrl: r.avatarUrl,
      }));
    }
    return filteredContacts;
  }, [useApiSearch, apiResults, filteredContacts]);

  const handleSelectContact = (contact: { userId: string; name: string }) => {
    onStartChat(contact.userId, contact.name);
    setSearchTerm('');
    onClose();
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'online': return '#10b981';
      case 'away': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  const renderContact = ({ item }: { item: Contact & { username?: string } }) => (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => handleSelectContact(item)}
      activeOpacity={0.7}
    >
      <View style={styles.avatarContainer}>
        <Image
          source={{
            uri: item.avatarUrl ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=6366f1&color=fff`
          }}
          style={styles.avatar}
        />
        {!useApiSearch && (
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]} />
        )}
      </View>
      
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{item.name}</Text>
        {item.username ? (
          <Text style={styles.contactEmail}>@{item.username}</Text>
        ) : item.email ? (
          <Text style={styles.contactEmail}>{item.email}</Text>
        ) : null}
      </View>
      
      <Ionicons name="chatbubble-outline" size={20} color="#6366f1" />
    </TouchableOpacity>
  );

  const emptyMessage = () => {
    if (isSearching) return null;
    if (searchError) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{searchError}</Text>
        </View>
      );
    }
    if (useApiSearch && listData.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={48} color="#4b5563" />
          <Text style={styles.emptyText}>No users found</Text>
          <Text style={styles.emptySubtext}>Try a different name or @username</Text>
        </View>
      );
    }
    if (!trimmedSearch && listData.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={48} color="#4b5563" />
          <Text style={styles.emptyText}>No contacts available</Text>
          <Text style={styles.emptySubtext}>Join groups to connect with others</Text>
        </View>
      );
    }
    if (trimmedSearch && !useApiSearch && listData.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No contacts found</Text>
          <Text style={styles.emptySubtext}>Type 2+ characters to search all users</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.card }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>New Message</Text>
            <TouchableOpacity onPress={onClose} style={[styles.closeButton, { backgroundColor: colors.background }]}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.searchContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Ionicons name="search" size={20} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search by name or @username"
              placeholderTextColor={colors.textSecondary}
              value={searchTerm}
              onChangeText={setSearchTerm}
              autoFocus
            />
            {searchTerm.length > 0 && (
              <TouchableOpacity onPress={() => setSearchTerm('')}>
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {isSearching && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#6366f1" />
            </View>
          )}

          <FlatList
            data={listData}
            keyExtractor={(item) => item.id}
            renderItem={renderContact}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={emptyMessage}
          />

          {!trimmedSearch && !useApiSearch && listData.length > 0 && (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>All Contacts</Text>
              <Text style={styles.sectionCount}>{listData.length}</Text>
            </View>
          )}
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
    maxHeight: '85%',
    minHeight: '60%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: '#ffffff',
  },
  loadingContainer: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#0f172a',
    position: 'absolute',
    top: 140,
    left: 0,
    right: 0,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCount: {
    fontSize: 14,
    color: '#6b7280',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
    flexGrow: 1,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    gap: 14,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  statusDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#1e293b',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  contactEmail: {
    fontSize: 13,
    color: '#9ca3af',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
});

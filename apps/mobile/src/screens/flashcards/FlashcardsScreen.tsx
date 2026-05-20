// ===========================================
// Lantern Study Mobile - Flashcards List Screen
// ===========================================

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Dimensions,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { useFlashcardStore, type Deck } from '../../stores/flashcardStore';
import { useTheme } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function FlashcardsScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'recent' | 'progress'>('recent');
  
  // Create deck modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckDescription, setNewDeckDescription] = useState('');
  
  // Get user and decks from stores
  const { user } = useAuthStore();
  const { decks, isLoading, error, fetchDecks, createDeck,
          offlineDeckIds, isDeckOffline, markDeckOffline, unmarkDeckOffline } = useFlashcardStore();

  // Fetch decks on mount
  useEffect(() => {
    if (user?.id) {
      fetchDecks(user.id);
    }
  }, [user?.id, fetchDecks]);

  const filteredDecks = useMemo(() => {
    let filtered = decks.filter(deck =>
      deck.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      deck.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    switch (sortBy) {
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'progress':
        filtered.sort((a, b) => {
          const progressA = a.card_count ? ((a as any).mastered_count || 0) / a.card_count : 0;
          const progressB = b.card_count ? ((b as any).mastered_count || 0) / b.card_count : 0;
          return progressB - progressA;
        });
        break;
      case 'recent':
      default:
        filtered.sort((a, b) => 
          new Date(b.updated_at || b.created_at).getTime() - 
          new Date(a.updated_at || a.created_at).getTime()
        );
    }

    return filtered;
  }, [decks, searchQuery, sortBy]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.id) {
      await fetchDecks(user.id);
    }
    setRefreshing(false);
  }, [user?.id, fetchDecks]);

  const handleDeckPress = useCallback((deck: Deck) => {
    navigation.navigate('Flashcards', {
      screen: 'DeckDetail',
      params: { deckId: deck.id, deckName: deck.name },
    });
  }, [navigation]);

  const handleCreateDeck = useCallback(() => {
    setShowCreateModal(true);
  }, []);

  const handleSaveDeck = useCallback(async () => {
    if (!newDeckName.trim()) {
      Alert.alert('Error', 'Please enter a deck name');
      return;
    }
    
    if (!user?.id) {
      Alert.alert('Error', 'You must be logged in to create a deck');
      return;
    }
    
    try {
      await createDeck(newDeckName.trim(), newDeckDescription.trim(), user.id);
      setNewDeckName('');
      setNewDeckDescription('');
      setShowCreateModal(false);
      Alert.alert('Success', 'Deck created successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to create deck');
    }
  }, [newDeckName, newDeckDescription, user?.id, createDeck]);

  const getProgressColor = (progress: number) => {
    if (progress >= 0.8) return '#10b981';
    if (progress >= 0.5) return '#f97316';
    return '#6366f1';
  };

  const renderDeckItem = useCallback(({ item }: { item: Deck }) => {
    const cardCount = (item as any).card_count || 0;
    const masteredCount = (item as any).mastered_count || 0;
    const progress = cardCount ? masteredCount / cardCount : 0;
    const progressColor = getProgressColor(progress);
    const downloaded = isDeckOffline(item.id);

    return (
      <TouchableOpacity
        style={[styles.deckCard, { backgroundColor: colors.card }]}
        onPress={() => handleDeckPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.deckHeader}>
          <View style={styles.deckTitleRow}>
            <Text style={[styles.deckName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
            {/* offline toggle icon */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                if (downloaded) {
                  unmarkDeckOffline(item.id);
                  Alert.alert('Offline mode', 'Deck removed from offline storage');
                } else if (user?.id) {
                  markDeckOffline(item.id, user.id);
                  Alert.alert('Offline mode', 'Deck downloaded for offline use');
                }
              }}
              style={styles.offlineIconWrapper}
            >
              <Ionicons
                name={downloaded ? 'cloud-checkmark' : 'cloud-download-outline'}
                size={20}
                color={downloaded ? colors.primary : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
          <Text style={[styles.deckDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.description || 'No description'}
          </Text>
        </View>

        <View style={styles.deckStats}>
          <View style={styles.cardCount}>
            <Ionicons name="layers-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.cardCountText, { color: colors.textSecondary }]}>{cardCount} cards</Text>
          </View>
          
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}> 
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${progress * 100}%`, backgroundColor: progressColor }
                ]} 
              />
            </View>
            <Text style={[styles.progressText, { color: progressColor }]}> 
              {Math.round(progress * 100)}%
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [handleDeckPress, colors, isDeckOffline, markDeckOffline, unmarkDeckOffline, user?.id]);

  const ListHeaderComponent = useMemo(() => (
    <>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search decks..."
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

      {/* Sort Options */}
      <View style={styles.sortContainer}>
        <Text style={[styles.sortLabel, { color: colors.textSecondary }]}>Sort by:</Text>
        <View style={styles.sortButtons}>
          {(['recent', 'name', 'progress'] as const).map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.sortButton, { backgroundColor: colors.card }, sortBy === option && { backgroundColor: colors.primary }]}
              onPress={() => setSortBy(option)}
            >
              <Text style={[styles.sortButtonText, { color: colors.textSecondary }, sortBy === option && { color: '#ffffff' }]}>
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Decks Count */}
      <Text style={[styles.decksCount, { color: colors.textSecondary }]}>
        {filteredDecks.length} {filteredDecks.length === 1 ? 'deck' : 'decks'}
      </Text>
    </>
  ), [searchQuery, sortBy, filteredDecks.length, colors]);

  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyContainer}>
      <Ionicons name="albums-outline" size={64} color={colors.textSecondary} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {searchQuery ? 'No decks found' : 'No decks yet'}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {searchQuery
          ? 'Try adjusting your search'
          : 'Create your first deck to start studying'}
      </Text>
      {!searchQuery && (
        <TouchableOpacity style={[styles.createButton, { backgroundColor: colors.primary }]} onPress={handleCreateDeck}>
          <Ionicons name="add" size={20} color="#ffffff" />
          <Text style={styles.createButtonText}>Create Deck</Text>
        </TouchableOpacity>
      )}
    </View>
  ), [searchQuery, handleCreateDeck, colors]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Flashcards</Text>
        <TouchableOpacity style={[styles.addButton, { backgroundColor: colors.primary }]} onPress={handleCreateDeck}>
          <Ionicons name="add" size={24} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      {/* Decks List */}
      <FlatList
        data={filteredDecks}
        keyExtractor={(item) => item.id}
        renderItem={renderDeckItem}
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

      {/* Create Deck Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Create New Deck</Text>
            
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Deck Name *</Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.inputText }]}
              placeholder="Enter deck name"
              placeholderTextColor={colors.inputPlaceholder}
              value={newDeckName}
              onChangeText={setNewDeckName}
              autoFocus
            />
            
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Description (optional)</Text>
            <TextInput
              style={[styles.modalInput, styles.textArea, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.inputText }]}
              placeholder="Enter description"
              placeholderTextColor={colors.inputPlaceholder}
              value={newDeckDescription}
              onChangeText={setNewDeckDescription}
              multiline
              numberOfLines={3}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: colors.border }]}
                onPress={() => {
                  setShowCreateModal(false);
                  setNewDeckName('');
                  setNewDeckDescription('');
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveButton, 
                  { backgroundColor: colors.primary },
                  !newDeckName.trim() && styles.saveButtonDisabled
                ]}
                onPress={handleSaveDeck}
                disabled={!newDeckName.trim()}
              >
                <Text style={[styles.saveButtonText, { color: colors.textInverse }]}>Create Deck</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
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
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sortLabel: {
    fontSize: 14,
    color: '#9ca3af',
    marginRight: 12,
  },
  sortButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  sortButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1e293b',
  },
  sortButtonActive: {
    backgroundColor: '#6366f1',
  },
  sortButtonText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  sortButtonTextActive: {
    color: '#ffffff',
    fontWeight: '500',
  },
  decksCount: {
    fontSize: 14,
    color: '#64748b',
  },
  deckCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  deckHeader: {
    marginBottom: 12,
  },
  deckTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  offlineIconWrapper: {
    marginLeft: 4,
  },
  deckName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
  },
  publicBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deckDescription: {
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
  },
  deckStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardCountText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBar: {
    width: 80,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#334155',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    width: 36,
    textAlign: 'right',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#334155',
  },
  tagText: {
    fontSize: 12,
    color: '#e2e8f0',
  },
  moreTagsText: {
    fontSize: 12,
    color: '#6366f1',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  createButton: {
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
});

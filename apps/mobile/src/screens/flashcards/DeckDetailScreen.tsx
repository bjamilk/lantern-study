// ===========================================
// Lantern Study Mobile - Deck Detail Screen
// ===========================================

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Dimensions,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useFlashcardStore, type Flashcard } from '../../stores/flashcardStore';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme';
import AIGenerateFlashcardsModal from '../../components/AIGenerateFlashcardsModal';
import AIUsageBadge from '../../components/AIUsageBadge';
import type { AIGeneratedFlashcard } from '../../services/ai';
import { MarkdownRenderer } from '@lantern/shared';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type DeckDetailRouteParams = {
  DeckDetail: {
    deckId: string;
    deckName: string;
  };
};

export default function DeckDetailScreen() {
  const route = useRoute<RouteProp<DeckDetailRouteParams, 'DeckDetail'>>();
  const navigation = useNavigation<any>();
  const { deckId, deckName } = route.params;

  // Stores
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const { flashcards: allFlashcards, fetchFlashcards, createFlashcard, isLoading,
          offlineDeckIds, isDeckOffline, markDeckOffline, unmarkDeckOffline } = useFlashcardStore();
  
  const flashcards = allFlashcards[deckId] || [];
  
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'due' | 'mastered'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [cardType, setCardType] = useState<'BASIC' | 'CLOZE'>('BASIC');
  const [newCardFront, setNewCardFront] = useState('');
  const [newCardBack, setNewCardBack] = useState('');
  const [clozeText, setClozeText] = useState('');
  const [showAIGenerateModal, setShowAIGenerateModal] = useState(false);

  // Fetch flashcards on mount
  useEffect(() => {
    fetchFlashcards(deckId);
  }, [deckId, fetchFlashcards]);

  const stats = useMemo(() => {
    const total = flashcards.length;
    const due = flashcards.filter(card => {
      const nextReview = card.srs_data?.next_review;
      return nextReview ? new Date(nextReview) <= new Date() : true;
    }).length;
    const mastered = flashcards.filter(card => 
      (card.srs_data?.repetitions || 0) >= 5
    ).length;
    return { total, due, mastered };
  }, [flashcards]);

  const filteredCards = useMemo(() => {
    switch (filter) {
      case 'due':
        return flashcards.filter(card => {
          const nextReview = card.srs_data?.next_review;
          return nextReview ? new Date(nextReview) <= new Date() : true;
        });
      case 'mastered':
        return flashcards.filter(card => 
          (card.srs_data?.repetitions || 0) >= 5
        );
      default:
        return flashcards;
    }
  }, [flashcards, filter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchFlashcards(deckId);
    setRefreshing(false);
  }, [deckId, fetchFlashcards]);

  const handleStartReview = useCallback(() => {
    const dueCards = flashcards.filter(card => {
      const nextReview = card.srs_data?.next_review;
      return !nextReview || new Date(nextReview) <= new Date();
    });
    if (dueCards.length === 0) {
      Alert.alert('No Cards Due', 'Great job! You have no cards due for review.');
      return;
    }
    navigation.navigate('FlashcardReview', { 
      deckId, 
      deckName,
      mode: 'review' 
    });
  }, [flashcards, navigation, deckId, deckName]);

  const handleCramSession = useCallback(() => {
    if (flashcards.length === 0) {
      Alert.alert('No Cards', 'Add some flashcards to start a cram session.');
      return;
    }
    navigation.navigate('FlashcardReview', { 
      deckId, 
      deckName,
      mode: 'cram' 
    });
  }, [flashcards, navigation, deckId, deckName]);

  const handleAddCard = useCallback(() => {
    setShowCreateModal(true);
  }, []);

  const handleCreateCard = useCallback(async () => {
    if (cardType === 'BASIC') {
      if (!newCardFront.trim() || !newCardBack.trim()) {
        Alert.alert('Error', 'Please fill in both front and back of the card');
        return;
      }
    } else {
      if (!clozeText.trim() || !clozeText.includes('{{c1::')) {
        Alert.alert('Error', 'Cloze text must contain a cloze deletion, e.g., {{c1::answer}}');
        return;
      }
    }
    
    try {
      await createFlashcard({
        deckId,
        type: cardType,
        front: cardType === 'BASIC' ? newCardFront.trim() : '',
        back: cardType === 'BASIC' ? newCardBack.trim() : undefined,
        clozeText: cardType === 'CLOZE' ? clozeText.trim() : undefined,
        userId: user?.id || 'demo-user',
      });
      setNewCardFront('');
      setNewCardBack('');
      setClozeText('');
      setCardType('BASIC');
      setShowCreateModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create flashcard');
    }
  }, [newCardFront, newCardBack, clozeText, cardType, deckId, createFlashcard, user?.id]);

  const handleCardPress = useCallback((card: Flashcard) => {
    const frontText = card.front || card.cloze_text || '';
    Alert.alert(
      'Card Options',
      `"${frontText.substring(0, 50)}${frontText.length > 50 ? '...' : ''}"`,
      [
        { text: 'Edit', onPress: () => {} },
        { text: 'Delete', style: 'destructive', onPress: () => {} },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, []);

  const handleAIFlashcardsGenerated = useCallback(async (cards: AIGeneratedFlashcard[]) => {
    let created = 0;
    for (const card of cards) {
      try {
        await createFlashcard({
          deckId,
          type: 'BASIC',
          front: card.front,
          back: card.back,
          userId: user?.id || 'demo-user',
        });
        created++;
      } catch {
        // continue with next card
      }
    }
    if (created > 0) {
      Alert.alert('Success', `${created} flashcards added to your deck!`);
      fetchFlashcards(deckId);
    }
  }, [deckId, createFlashcard, user?.id, fetchFlashcards]);

  const getCardStatus = (card: Flashcard) => {
    const nextReview = card.srs_data?.next_review;
    const isDue = nextReview ? new Date(nextReview) <= new Date() : true;
    const isMastered = (card.srs_data?.repetitions || 0) >= 5;
    
    if (isMastered) return { label: 'Mastered', color: '#10b981' };
    if (isDue) return { label: 'Due', color: '#f97316' };
    return { label: 'Learning', color: '#6366f1' };
  };

  const renderCard = useCallback(({ item }: { item: Flashcard }) => {
    const status = getCardStatus(item);
    const front = item.front || item.cloze_text || '';
    const back = item.back || '';

    return (
      <TouchableOpacity
        style={styles.cardItem}
        onPress={() => handleCardPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardContent}>
          <MarkdownRenderer content={front} />
          {back ? <MarkdownRenderer content={back} /> : null}
        </View>
      </TouchableOpacity>
    );
  }, [handleCardPress]);

  const ListHeaderComponent = useMemo(() => (
    <View style={styles.listHeader}>
      {/* Stats Cards */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={[styles.statCard, { borderColor: '#f97316' }]}>
          <Text style={[styles.statValue, { color: '#f97316' }]}>{stats.due}</Text>
          <Text style={styles.statLabel}>Due</Text>
        </View>
        <View style={[styles.statCard, { borderColor: '#10b981' }]}>
          <Text style={[styles.statValue, { color: '#10b981' }]}>{stats.mastered}</Text>
          <Text style={styles.statLabel}>Mastered</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.actionButton, styles.primaryButton]}
          onPress={handleStartReview}
        >
          <Ionicons name="play" size={20} color="#ffffff" />
          <Text style={styles.primaryButtonText}>
            Review ({stats.due})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.secondaryButton]}
          onPress={handleCramSession}
        >
          <Ionicons name="flash" size={20} color="#6366f1" />
          <Text style={styles.secondaryButtonText}>Cram</Text>
        </TouchableOpacity>
      </View>

      {/* AI Generate Button */}
      <TouchableOpacity
        style={styles.aiGenerateButton}
        onPress={() => setShowAIGenerateModal(true)}
      >
        <Ionicons name="sparkles" size={18} color="#6366f1" />
        <Text style={styles.aiGenerateButtonText}>AI Generate Flashcards</Text>
        <AIUsageBadge variant="badge" />
      </TouchableOpacity>

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        {(['all', 'due', 'mastered'] as const).map((filterOption) => (
          <TouchableOpacity
            key={filterOption}
            style={[
              styles.filterTab,
              filter === filterOption && styles.filterTabActive,
            ]}
            onPress={() => setFilter(filterOption)}
          >
            <Text
              style={[
                styles.filterTabText,
                filter === filterOption && styles.filterTabTextActive,
              ]}
            >
              {filterOption.charAt(0).toUpperCase() + filterOption.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.cardsCount}>
        {filteredCards.length} {filteredCards.length === 1 ? 'card' : 'cards'}
      </Text>
    </View>
  ), [stats, filter, filteredCards.length, handleStartReview, handleCramSession]);

  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyContainer}>
      <Ionicons name="document-text-outline" size={64} color="#4b5563" />
      <Text style={styles.emptyTitle}>No flashcards</Text>
      <Text style={styles.emptySubtitle}>
        {filter === 'all'
          ? 'Add your first flashcard to this deck'
          : `No ${filter} cards at the moment`}
      </Text>
    </View>
  ), [filter]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text style={[styles.deckTitle, { color: colors.text }]} numberOfLines={1}>{deckName}</Text>
        </View>
        {/* offline toggle */}
        <TouchableOpacity
          style={styles.offlineButton}
          onPress={() => {
            if (isDeckOffline(deckId)) {
              unmarkDeckOffline(deckId);
              Alert.alert('Offline mode', 'Deck removed from offline storage');
            } else if (user?.id) {
              markDeckOffline(deckId, user.id);
              Alert.alert('Offline mode', 'Deck downloaded for offline use');
            }
          }}
        >
          <Ionicons
            name={isDeckOffline(deckId) ? 'cloud-checkmark' : 'cloud-download-outline'}
            size={24}
            color={colors.text}
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.addButton} onPress={handleAddCard}>
          <Ionicons name="add" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Cards List */}
      <FlatList
        data={filteredCards}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
            colors={['#6366f1']}
          />
        }
      />

      {/* Create Card Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Flashcard</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              {/* Card Type Selector */}
              <Text style={styles.inputLabel}>Card Type</Text>
              <View style={styles.cardTypeSelector}>
                <TouchableOpacity
                  style={[
                    styles.cardTypeButton,
                    cardType === 'BASIC' && styles.cardTypeButtonActive,
                  ]}
                  onPress={() => setCardType('BASIC')}
                >
                  <Ionicons 
                    name="document-text" 
                    size={18} 
                    color={cardType === 'BASIC' ? '#ffffff' : '#9ca3af'} 
                  />
                  <Text style={[
                    styles.cardTypeText,
                    cardType === 'BASIC' && styles.cardTypeTextActive,
                  ]}>
                    Basic
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.cardTypeButton,
                    cardType === 'CLOZE' && styles.cardTypeButtonActive,
                  ]}
                  onPress={() => setCardType('CLOZE')}
                >
                  <Ionicons 
                    name="code-slash" 
                    size={18} 
                    color={cardType === 'CLOZE' ? '#ffffff' : '#9ca3af'} 
                  />
                  <Text style={[
                    styles.cardTypeText,
                    cardType === 'CLOZE' && styles.cardTypeTextActive,
                  ]}>
                    Cloze
                  </Text>
                </TouchableOpacity>
              </View>

              {cardType === 'BASIC' ? (
                <>
                  <Text style={styles.inputLabel}>Front (Question)</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Enter the question..."
                    placeholderTextColor="#64748b"
                    value={newCardFront}
                    onChangeText={setNewCardFront}
                    multiline
                    numberOfLines={3}
                  />
                  
                  <Text style={styles.inputLabel}>Back (Answer)</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Enter the answer..."
                    placeholderTextColor="#64748b"
                    value={newCardBack}
                    onChangeText={setNewCardBack}
                    multiline
                    numberOfLines={3}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.inputLabel}>Cloze Text</Text>
                  <TextInput
                    style={[styles.textInput, { minHeight: 100 }]}
                    placeholder="The capital of France is {{c1::Paris}}."
                    placeholderTextColor="#64748b"
                    value={clozeText}
                    onChangeText={setClozeText}
                    multiline
                    numberOfLines={4}
                  />
                  <View style={styles.clozeHint}>
                    <Ionicons name="information-circle" size={16} color="#6366f1" />
                    <Text style={styles.clozeHintText}>
                      Wrap text to hide with {'{{c1::your answer}}'}
                    </Text>
                  </View>
                </>
              )}
            </View>
            
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createButton, isLoading && styles.buttonDisabled]}
                onPress={handleCreateCard}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.createButtonText}>Add Card</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* AI Generate Flashcards Modal */}
      <AIGenerateFlashcardsModal
        visible={showAIGenerateModal}
        onClose={() => setShowAIGenerateModal(false)}
        onFlashcardsGenerated={handleAIFlashcardsGenerated}
      />
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
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
  },
  deckTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  offlineButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  listHeader: {
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  primaryButton: {
    backgroundColor: '#6366f1',
  },
  secondaryButton: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6366f1',
  },
  aiGenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#6366f120',
    borderWidth: 1,
    borderColor: '#6366f140',
    marginBottom: 20,
  },
  aiGenerateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    flex: 1,
  },
  filterContainer: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  filterTabActive: {
    backgroundColor: '#6366f1',
  },
  filterTabText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  filterTabTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  cardsCount: {
    fontSize: 14,
    color: '#64748b',
  },
  cardItem: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    alignItems: 'center',
  },
  cardContent: {
    flex: 1,
    marginRight: 12,
  },
  cardQuestion: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
    marginBottom: 4,
  },
  cardAnswer: {
    fontSize: 14,
    color: '#9ca3af',
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
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
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  modalBody: {
    padding: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
  },
  createButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    alignItems: 'center',
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  // Card type selector styles
  cardTypeSelector: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    gap: 4,
  },
  cardTypeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  cardTypeButtonActive: {
    backgroundColor: '#6366f1',
  },
  cardTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  cardTypeTextActive: {
    color: '#ffffff',
  },
  // Cloze hint styles
  clozeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1b4b',
    borderRadius: 8,
    padding: 12,
    gap: 8,
    marginTop: -8,
  },
  clozeHintText: {
    flex: 1,
    fontSize: 13,
    color: '#a5b4fc',
  },
});

// ===========================================
// Lantern Study Mobile - Challenge Modal
// Configure and start a 1v1 quiz battle
// ===========================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useGameStore, GameUser, GameConfig } from '../stores';
import { useAuthStore } from '../stores/authStore';

interface ChallengeModalProps {
  visible: boolean;
  onClose: () => void;
  opponent: GameUser;
  onGameStart: (session: any) => void;
  groupId?: string;
}

const QUESTION_COUNT_OPTIONS = [5, 10, 15, 20];
const DIFFICULTY_OPTIONS: { value: GameConfig['difficulty']; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'mixed', label: 'Mixed' },
];

export default function ChallengeModal({
  visible,
  onClose,
  opponent,
  onGameStart,
  groupId,
}: ChallengeModalProps) {
  const { colors } = useTheme();
  const { user } = useAuthStore();
  const { startGame, isLoading, error } = useGameStore();
  
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState<GameConfig['difficulty']>('mixed');

  const handleStartGame = async () => {
    if (!user) return;

    const currentUser: GameUser = {
      id: user.id,
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'You',
      avatarUrl: user.user_metadata?.avatar_url,
    };

    const config: GameConfig = {
      questionCount,
      difficulty,
      groupId,
    };

    try {
      const session = await startGame(config, currentUser, opponent);
      onGameStart(session);
      onClose();
    } catch (err) {
      console.error('Failed to start game:', err);
    }
  };

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    container: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '80%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
    },
    closeButton: {
      padding: 8,
    },
    content: {
      padding: 20,
    },
    opponentCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
    },
    opponentAvatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    opponentAvatarText: {
      fontSize: 20,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    opponentInfo: {
      flex: 1,
    },
    opponentLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 2,
    },
    opponentName: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    vsIcon: {
      backgroundColor: colors.error + '20',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    vsText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.error,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 12,
    },
    optionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 24,
    },
    optionButton: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 2,
      minWidth: 60,
      alignItems: 'center',
    },
    optionButtonSelected: {
      backgroundColor: colors.primary + '20',
      borderColor: colors.primary,
    },
    optionButtonUnselected: {
      backgroundColor: colors.card,
      borderColor: colors.border,
    },
    optionText: {
      fontSize: 14,
      fontWeight: '600',
    },
    optionTextSelected: {
      color: colors.primary,
    },
    optionTextUnselected: {
      color: colors.textSecondary,
    },
    startButton: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    startButtonDisabled: {
      opacity: 0.6,
    },
    startButtonText: {
      fontSize: 18,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    errorText: {
      color: colors.error,
      fontSize: 14,
      textAlign: 'center',
      marginBottom: 16,
    },
    infoCard: {
      backgroundColor: colors.primary + '10',
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
    },
    infoText: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    infoBold: {
      fontWeight: '600',
      color: colors.text,
    },
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <SafeAreaView edges={['bottom']} style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Challenge</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content}>
            {/* Opponent Card */}
            <View style={styles.opponentCard}>
              <View style={styles.opponentAvatar}>
                <Text style={styles.opponentAvatarText}>
                  {opponent.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.opponentInfo}>
                <Text style={styles.opponentLabel}>Challenging</Text>
                <Text style={styles.opponentName}>{opponent.name}</Text>
              </View>
              <View style={styles.vsIcon}>
                <Text style={styles.vsText}>1v1</Text>
              </View>
            </View>

            {/* Info Card */}
            <View style={styles.infoCard}>
              <Text style={styles.infoText}>
                <Text style={styles.infoBold}>Quiz Battle Mode:</Text> Answer questions faster 
                and more accurately than your opponent to win! Score is based on 
                correct answers and speed.
              </Text>
            </View>

            {/* Question Count */}
            <Text style={styles.sectionTitle}>Number of Questions</Text>
            <View style={styles.optionRow}>
              {QUESTION_COUNT_OPTIONS.map((count) => (
                <TouchableOpacity
                  key={count}
                  style={[
                    styles.optionButton,
                    questionCount === count
                      ? styles.optionButtonSelected
                      : styles.optionButtonUnselected,
                  ]}
                  onPress={() => setQuestionCount(count)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      questionCount === count
                        ? styles.optionTextSelected
                        : styles.optionTextUnselected,
                    ]}
                  >
                    {count}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Difficulty */}
            <Text style={styles.sectionTitle}>Difficulty</Text>
            <View style={styles.optionRow}>
              {DIFFICULTY_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionButton,
                    difficulty === option.value
                      ? styles.optionButtonSelected
                      : styles.optionButtonUnselected,
                  ]}
                  onPress={() => setDifficulty(option.value)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      difficulty === option.value
                        ? styles.optionTextSelected
                        : styles.optionTextUnselected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Error */}
            {error && <Text style={styles.errorText}>{error}</Text>}

            {/* Start Button */}
            <TouchableOpacity
              style={[styles.startButton, isLoading && styles.startButtonDisabled]}
              onPress={handleStartGame}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="flash" size={20} color="#FFFFFF" />
                  <Text style={styles.startButtonText}>Start Battle!</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

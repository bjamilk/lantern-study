// ===========================================
// Lantern Study Mobile - Challenge Modal
// Send a real duel challenge to a group member
// ===========================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { appAlert } from './ui/appDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useGameStore, GameUser, GameConfig } from '../stores';
import { useAuthStore } from '../stores/authStore';
import type { QuestionType } from '../stores/testStore';
import { buildCurrentGameUser } from '../utils/currentGameUser';
import { mobileQuestionTypesToWeb } from '../utils/questionHelpers';
import type { TestConfigAvailableFilter } from './TestConfigModal';
import { AppIcon, type AppIconName } from './ui/AppIcon';

interface ChallengeModalProps {
  visible: boolean;
  onClose: () => void;
  opponent: GameUser;
  onChallengeSent?: () => void;
  onSoloStart?: () => void;
  groupId?: string;
  availableTags?: string[];
  maxQuestions?: number;
  getAvailableCount?: (filter: TestConfigAvailableFilter) => number;
}

const QUESTION_COUNT_OPTIONS = [5, 10, 15, 20];

const QUESTION_TYPE_OPTIONS: { type: QuestionType; label: string; icon: AppIconName }[] = [
  { type: 'multiple_choice_single', label: 'Multiple Choice', icon: 'radio-button-on' },
  { type: 'multiple_choice_multiple', label: 'Multi-Select', icon: 'checkbox' },
  { type: 'true_false', label: 'True/False', icon: 'swap-horizontal' },
  { type: 'fill_in_blank', label: 'Fill in Blank', icon: 'text' },
  { type: 'matching', label: 'Matching', icon: 'git-compare' },
  { type: 'diagram_labeling', label: 'Diagram Label', icon: 'image' },
];

export default function ChallengeModal({
  visible,
  onClose,
  opponent,
  onChallengeSent,
  onSoloStart,
  groupId,
  availableTags = [],
  maxQuestions = 20,
  getAvailableCount,
}: ChallengeModalProps) {
  const { colors } = useTheme();
  const { user, profileName } = useAuthStore();
  const { sendChallenge, startSoloPractice, isLoading, error } = useGameStore();

  const [questionCount, setQuestionCount] = useState(10);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<QuestionType[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const currentUser: GameUser | null = user ? buildCurrentGameUser(user, profileName) : null;

  const filterState: TestConfigAvailableFilter = useMemo(
    () => ({
      selectedQuestionTypes,
      selectedTags,
      useSpacedRepetition: false,
      focusOnNew: false,
      subgroupIds: [],
    }),
    [selectedQuestionTypes, selectedTags]
  );

  const availableCount = useMemo(() => {
    if (getAvailableCount) return getAvailableCount(filterState);
    return maxQuestions;
  }, [getAvailableCount, filterState, maxQuestions]);

  const effectiveMax = Math.max(1, Math.min(maxQuestions, availableCount));
  const canSend = availableCount >= questionCount && questionCount > 0;

  const buildConfig = (): GameConfig => ({
    questionCount,
    groupId,
    allowedQuestionTypes:
      selectedQuestionTypes.length > 0
        ? mobileQuestionTypesToWeb(selectedQuestionTypes)
        : undefined,
    selectedTags: selectedTags.length > 0 ? selectedTags : undefined,
  });

  const toggleQuestionType = (type: QuestionType) => {
    setSelectedQuestionTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleSendChallenge = async () => {
    if (!currentUser) return;
    if (!canSend) {
      appAlert(
        'Not enough questions',
        `Only ${availableCount} question${availableCount === 1 ? '' : 's'} match your filters. Lower the count or adjust filters.`
      );
      return;
    }
    try {
      await sendChallenge(buildConfig(), currentUser, opponent);
      appAlert(
        'Challenge Sent',
        `${opponent.name} will be notified and can accept or decline your duel.`
      );
      onChallengeSent?.();
      onClose();
    } catch (err) {
      console.error('Failed to send challenge:', err);
    }
  };

  const handleSoloPractice = async () => {
    if (!currentUser) return;
    if (availableCount < 1) {
      appAlert('No questions', 'No testable questions match your filters.');
      return;
    }
    try {
      await startSoloPractice(buildConfig(), currentUser);
      onSoloStart?.();
      onClose();
    } catch (err) {
      console.error('Failed to start solo practice:', err);
    }
  };

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    container: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '90%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    content: {
      padding: 16,
    },
    vsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 12,
      gap: 12,
    },
    playerName: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    vsText: {
      fontSize: 14,
      fontWeight: '800',
      color: '#ef4444',
    },
    availableText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 8,
      marginTop: 12,
    },
    optionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    optionChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    optionChipSelected: {
      backgroundColor: colors.primaryFill,
      borderColor: colors.primary,
    },
    optionChipDisabled: {
      opacity: 0.4,
    },
    optionText: {
      fontSize: 13,
      color: colors.text,
    },
    optionTextSelected: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
    typeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    typeChipSelected: {
      backgroundColor: colors.primaryFill,
      borderColor: colors.primary,
    },
    tagChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tagChipSelected: {
      backgroundColor: '#ec4899',
      borderColor: '#ec4899',
    },
    tagText: {
      fontSize: 12,
      color: colors.text,
    },
    tagTextSelected: {
      color: '#fff',
      fontWeight: '600',
    },
    primaryButton: {
      backgroundColor: '#ef4444',
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 20,
    },
    primaryButtonDisabled: {
      opacity: 0.5,
    },
    secondaryButton: {
      backgroundColor: colors.background,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    buttonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    errorText: {
      color: '#ef4444',
      fontSize: 13,
      marginTop: 8,
      textAlign: 'center',
    },
    hint: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 12,
      lineHeight: 18,
    },
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['bottom']}>
          <View style={styles.header}>
            <Text style={styles.title}>Challenge to a Duel</Text>
            <TouchableOpacity onPress={onClose}>
              <AppIcon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.vsRow}>
              <Text style={styles.playerName}>{currentUser?.name || 'You'}</Text>
              <Text style={styles.vsText}>VS</Text>
              <Text style={styles.playerName}>{opponent.name}</Text>
            </View>

            <Text style={styles.availableText}>
              {availableCount} question{availableCount === 1 ? '' : 's'} available
              {!canSend ? ' — reduce count or adjust filters' : ''}
            </Text>

            <Text style={styles.sectionTitle}>Number of Questions</Text>
            <View style={styles.optionRow}>
              {QUESTION_COUNT_OPTIONS.map(count => {
                const disabled = count > effectiveMax;
                return (
                  <TouchableOpacity
                    key={count}
                    style={[
                      styles.optionChip,
                      questionCount === count && styles.optionChipSelected,
                      disabled && styles.optionChipDisabled,
                    ]}
                    onPress={() => !disabled && setQuestionCount(count)}
                    disabled={disabled}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        questionCount === count && styles.optionTextSelected,
                      ]}
                    >
                      {count}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>Filter by Question Type</Text>
            <Text style={[styles.hint, { marginTop: 0, marginBottom: 8, textAlign: 'left' }]}>
              Leave all unselected to include every type.
            </Text>
            <View style={styles.optionRow}>
              {QUESTION_TYPE_OPTIONS.map(option => {
                const selected = selectedQuestionTypes.includes(option.type);
                return (
                  <TouchableOpacity
                    key={option.type}
                    style={[styles.typeChip, selected && styles.typeChipSelected]}
                    onPress={() => toggleQuestionType(option.type)}
                  >
                    <AppIcon
                      name={option.icon}
                      size={14}
                      color={selected ? '#fff' : colors.textSecondary}
                    />
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {availableTags.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Filter by Tags</Text>
                <View style={styles.optionRow}>
                  {availableTags.map(tag => {
                    const selected = selectedTags.includes(tag);
                    return (
                      <TouchableOpacity
                        key={tag}
                        style={[styles.tagChip, selected && styles.tagChipSelected]}
                        onPress={() => toggleTag(tag)}
                      >
                        <Text style={[styles.tagText, selected && styles.tagTextSelected]}>
                          {tag}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}

            <Text style={styles.hint}>
              Your opponent will receive a notification and must accept before either of you can play the same question set.
            </Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryButton, !canSend && styles.primaryButtonDisabled]}
              onPress={handleSendChallenge}
              disabled={isLoading || !canSend}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>Send Challenge</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleSoloPractice}
              disabled={isLoading || availableCount < 1}
            >
              <Text style={styles.secondaryButtonText}>Solo Practice Instead</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

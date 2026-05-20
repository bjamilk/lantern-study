// ===========================================
// Lantern Study Mobile - Test Configuration Modal
// ===========================================

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Switch,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuestionType, TestMode } from '../stores/testStore';
import { useTheme } from '../theme';

// Timer presets in seconds
const TIMER_PRESETS = [
  { label: 'None', value: 0 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
  { label: '15 min', value: 900 },
  { label: '20 min', value: 1200 },
  { label: '30 min', value: 1800 },
  { label: '1 hour', value: 3600 },
];

const QUESTION_TYPE_OPTIONS: { type: QuestionType; label: string; icon: string }[] = [
  { type: 'multiple_choice_single', label: 'Multiple Choice', icon: 'radio-button-on' },
  { type: 'multiple_choice_multiple', label: 'Multi-Select', icon: 'checkbox' },
  { type: 'true_false', label: 'True/False', icon: 'swap-horizontal' },
  { type: 'fill_in_blank', label: 'Fill in Blank', icon: 'text' },
  { type: 'matching', label: 'Matching', icon: 'git-compare' },
  { type: 'diagram_labeling', label: 'Diagram Label', icon: 'image' },
  { type: 'open_ended', label: 'Open Ended', icon: 'document-text' },
];

export interface TestConfigOptions {
  numberOfQuestions: number;
  timerDuration: number; // in seconds, 0 = no timer
  selectedQuestionTypes: QuestionType[];
  selectedTags: string[];
  useSpacedRepetition: boolean;
  focusOnNew: boolean;
}

interface TestConfigModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (config: TestConfigOptions, mode: TestMode) => void;
  mode: TestMode;
  maxQuestions: number;
  availableTags: string[];
  testName: string;
}

export default function TestConfigModal({
  visible,
  onClose,
  onSubmit,
  mode,
  maxQuestions,
  availableTags,
  testName,
}: TestConfigModalProps) {
  const [numberOfQuestions, setNumberOfQuestions] = useState(Math.min(10, maxQuestions));
  const [timerDuration, setTimerDuration] = useState(0);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<QuestionType[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [useSpacedRepetition, setUseSpacedRepetition] = useState(false);
  const [focusOnNew, setFocusOnNew] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { colors } = useTheme();

  const isStudyMode = mode === 'study';

  // Reset when modal opens
  useEffect(() => {
    if (visible) {
      setNumberOfQuestions(Math.min(10, maxQuestions));
      setTimerDuration(isStudyMode ? 0 : 600); // 10 min default for test mode
      setSelectedQuestionTypes([]);
      setSelectedTags([]);
      setUseSpacedRepetition(false);
      setFocusOnNew(false);
      setShowAdvanced(false);
    }
  }, [visible, maxQuestions, isStudyMode]);

  // Mutual exclusion for SR and Focus on New
  useEffect(() => {
    if (focusOnNew) setUseSpacedRepetition(false);
  }, [focusOnNew]);

  useEffect(() => {
    if (useSpacedRepetition) setFocusOnNew(false);
  }, [useSpacedRepetition]);

  const toggleQuestionType = useCallback((type: QuestionType) => {
    setSelectedQuestionTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  const isValid = useMemo(() => {
    if (maxQuestions === 0) return false;
    if (numberOfQuestions <= 0) return false;
    if (numberOfQuestions > maxQuestions) return false;
    // Study mode doesn't require question types
    if (!isStudyMode && !useSpacedRepetition && !focusOnNew && selectedQuestionTypes.length === 0) {
      return false;
    }
    return true;
  }, [maxQuestions, numberOfQuestions, isStudyMode, useSpacedRepetition, focusOnNew, selectedQuestionTypes]);

  const handleSubmit = useCallback(() => {
    if (!isValid) return;
    
    onSubmit({
      numberOfQuestions,
      timerDuration: isStudyMode ? 0 : timerDuration,
      selectedQuestionTypes: useSpacedRepetition || focusOnNew ? [] : selectedQuestionTypes,
      selectedTags: useSpacedRepetition || focusOnNew ? [] : selectedTags,
      useSpacedRepetition,
      focusOnNew,
    }, mode);
  }, [isValid, numberOfQuestions, timerDuration, selectedQuestionTypes, selectedTags, useSpacedRepetition, focusOnNew, mode, isStudyMode, onSubmit]);

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return 'No limit';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours} hour`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} style={[styles.closeButton, { backgroundColor: colors.background }]}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <View style={[styles.headerIcon, isStudyMode && styles.headerIconStudy]}>
                <Ionicons 
                  name={isStudyMode ? 'book' : 'document-text'} 
                  size={24} 
                  color={isStudyMode ? '#10b981' : colors.primary} 
                />
              </View>
              <Text style={[styles.headerTitle, { color: colors.text }]}>
                {isStudyMode ? 'Study Session' : 'Test Configuration'}
              </Text>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>{testName}</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView 
            style={styles.content} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.contentContainer}
          >
            {/* Mode Description */}
            <View style={[styles.infoBox, isStudyMode && styles.infoBoxStudy]}>
              <Ionicons 
                name={isStudyMode ? 'bulb' : 'timer'} 
                size={20} 
                color={isStudyMode ? '#10b981' : '#6366f1'} 
              />
              <Text style={styles.infoText}>
                {isStudyMode 
                  ? 'Study at your own pace with immediate feedback and explanations.'
                  : 'Timed assessment with scoring. Submit when ready or when time runs out.'
                }
              </Text>
            </View>

            {/* Number of Questions */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="list" size={20} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Number of Questions</Text>
                <Text style={[styles.questionCount, { color: colors.primary }]}>{numberOfQuestions} / {maxQuestions}</Text>
              </View>
              
              <View style={styles.sliderContainer}>
                <View style={styles.numberInputRow}>
                  <TouchableOpacity
                    style={[styles.numberButton, { backgroundColor: colors.primary }]}
                    onPress={() => setNumberOfQuestions(Math.max(1, numberOfQuestions - 1))}
                    disabled={numberOfQuestions <= 1}
                  >
                    <Ionicons name="remove" size={20} color={numberOfQuestions <= 1 ? colors.textSecondary : '#ffffff'} />
                  </TouchableOpacity>
                  
                  <TextInput
                    style={[styles.numberInput, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }]}
                    value={String(numberOfQuestions)}
                    onChangeText={(text) => {
                      const val = parseInt(text) || 1;
                      setNumberOfQuestions(Math.min(Math.max(1, val), maxQuestions));
                    }}
                    keyboardType="number-pad"
                    selectTextOnFocus
                  />
                  
                  <TouchableOpacity
                    style={[styles.numberButton, { backgroundColor: colors.primary }]}
                    onPress={() => setNumberOfQuestions(Math.min(maxQuestions, numberOfQuestions + 1))}
                    disabled={numberOfQuestions >= maxQuestions}
                  >
                    <Ionicons name="add" size={20} color={numberOfQuestions >= maxQuestions ? colors.textSecondary : '#ffffff'} />
                  </TouchableOpacity>
                </View>
                
                {/* Quick select buttons */}
                <View style={styles.quickSelectRow}>
                  {[5, 10, 15, 20].filter(n => n <= maxQuestions).map((num) => (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.quickSelectButton,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        numberOfQuestions === num && { backgroundColor: colors.primary, borderColor: colors.primary },
                      ]}
                      onPress={() => setNumberOfQuestions(num)}
                    >
                      <Text style={[
                        styles.quickSelectText,
                        { color: colors.textSecondary },
                        numberOfQuestions === num && { color: '#fff' },
                      ]}>{num}</Text>
                    </TouchableOpacity>
                  ))}
                  {maxQuestions > 20 && (
                    <TouchableOpacity
                      style={[
                        styles.quickSelectButton,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        numberOfQuestions === maxQuestions && { backgroundColor: colors.primary, borderColor: colors.primary },
                      ]}
                      onPress={() => setNumberOfQuestions(maxQuestions)}
                    >
                      <Text style={[
                        styles.quickSelectText,
                        { color: colors.textSecondary },
                        numberOfQuestions === maxQuestions && { color: '#fff' },
                      ]}>All</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            {/* Timer - Only for Test Mode */}
            {!isStudyMode && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="time" size={20} color="#f97316" />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Timer</Text>
                  <Text style={[styles.timerValue, { color: '#f97316' }]}>{formatTime(timerDuration)}</Text>
                </View>
                
                <View style={styles.timerPresets}>
                  {TIMER_PRESETS.map((preset) => (
                    <TouchableOpacity
                      key={preset.value}
                      style={[
                        styles.timerPresetButton,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        timerDuration === preset.value && { backgroundColor: '#f97316', borderColor: '#f97316' },
                      ]}
                      onPress={() => setTimerDuration(preset.value)}
                    >
                      <Text style={[
                        styles.timerPresetText,
                        { color: colors.textSecondary },
                        timerDuration === preset.value && { color: '#fff' },
                      ]}>
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Question Types */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="apps" size={20} color="#8b5cf6" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Question Types</Text>
                {selectedQuestionTypes.length > 0 && (
                  <Text style={[styles.selectedCount, { color: '#8b5cf6' }]}>
                    {selectedQuestionTypes.length} selected
                  </Text>
                )}
              </View>
              
              {(useSpacedRepetition || focusOnNew) ? (
                <View style={styles.disabledMessage}>
                  <Ionicons name="information-circle" size={16} color={colors.textSecondary} />
                  <Text style={[styles.disabledMessageText, { color: colors.textSecondary }]}>
                    All types included with {useSpacedRepetition ? 'Spaced Repetition' : 'Focus on New'}
                  </Text>
                </View>
              ) : (
                <View style={styles.questionTypes}>
                  {QUESTION_TYPE_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.type}
                      style={[
                        styles.questionTypeButton,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        selectedQuestionTypes.includes(option.type) && { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
                      ]}
                      onPress={() => toggleQuestionType(option.type)}
                    >
                      <Ionicons 
                        name={option.icon as any} 
                        size={18} 
                        color={selectedQuestionTypes.includes(option.type) ? '#ffffff' : colors.textSecondary} 
                      />
                      <Text style={[
                        styles.questionTypeText,
                        { color: colors.textSecondary },
                        selectedQuestionTypes.includes(option.type) && { color: '#fff' },
                      ]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Advanced Options */}
            <TouchableOpacity 
              style={[styles.advancedToggle, { borderTopColor: colors.border }]}
              onPress={() => setShowAdvanced(!showAdvanced)}
            >
              <Text style={[styles.advancedToggleText, { color: colors.primary }]}>Advanced Options</Text>
              <Ionicons 
                name={showAdvanced ? 'chevron-up' : 'chevron-down'} 
                size={20} 
                color={colors.primary} 
              />
            </TouchableOpacity>

            {showAdvanced && (
              <>
                {/* Spaced Repetition */}
                <View style={[styles.toggleSection, { backgroundColor: colors.inputBackground }]}>
                  <View style={styles.toggleInfo}>
                    <View style={styles.toggleIcon}>
                      <Ionicons name="sync" size={20} color="#f59e0b" />
                    </View>
                    <View style={styles.toggleContent}>
                      <Text style={[styles.toggleTitle, { color: colors.text }]}>Spaced Repetition</Text>
                      <Text style={[styles.toggleDescription, { color: colors.textSecondary }]}>
                        Focus on questions you've gotten wrong more than right
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={useSpacedRepetition}
                    onValueChange={setUseSpacedRepetition}
                    trackColor={{ false: colors.border, true: '#f59e0b40' }}
                    thumbColor={useSpacedRepetition ? '#f59e0b' : colors.textSecondary}
                  />
                </View>

                {/* Focus on New */}
                <View style={[styles.toggleSection, { backgroundColor: colors.inputBackground }]}>
                  <View style={styles.toggleInfo}>
                    <View style={styles.toggleIcon}>
                      <Ionicons name="sparkles" size={20} color="#10b981" />
                    </View>
                    <View style={styles.toggleContent}>
                      <Text style={[styles.toggleTitle, { color: colors.text }]}>Focus on New</Text>
                      <Text style={[styles.toggleDescription, { color: colors.textSecondary }]}>
                        Prioritize questions added in the last 7 days or never attempted
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={focusOnNew}
                    onValueChange={setFocusOnNew}
                    trackColor={{ false: colors.border, true: '#10b98140' }}
                    thumbColor={focusOnNew ? '#10b981' : colors.textSecondary}
                  />
                </View>

                {/* Tags */}
                {availableTags.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <Ionicons name="pricetags" size={20} color="#ec4899" />
                      <Text style={[styles.sectionTitle, { color: colors.text }]}>Filter by Tags</Text>
                    </View>
                    
                    <View style={styles.tags}>
                      {availableTags.map((tag) => (
                        <TouchableOpacity
                          key={tag}
                          style={[
                            styles.tagButton,
                            { backgroundColor: colors.inputBackground, borderColor: colors.border },
                            selectedTags.includes(tag) && { backgroundColor: '#ec4899', borderColor: '#ec4899' },
                          ]}
                          onPress={() => toggleTag(tag)}
                        >
                          <Text style={[
                            styles.tagText,
                            selectedTags.includes(tag) && styles.tagTextActive,
                          ]}>
                            {tag}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
            <TouchableOpacity style={[styles.cancelButton, { backgroundColor: colors.inputBackground }]} onPress={onClose}>
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[
                styles.submitButton,
                isStudyMode && styles.submitButtonStudy,
                !isValid && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!isValid}
            >
              <Ionicons 
                name={isStudyMode ? 'book' : 'play'} 
                size={20} 
                color="#ffffff" 
              />
              <Text style={styles.submitButtonText}>
                {isStudyMode ? 'Start Studying' : 'Start Test'}
              </Text>
            </TouchableOpacity>
          </View>
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
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  closeButton: {
    padding: 4,
    width: 40,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerIconStudy: {
    backgroundColor: '#10b98120',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 24,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    backgroundColor: '#6366f115',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#6366f130',
    marginBottom: 24,
  },
  infoBoxStudy: {
    backgroundColor: '#10b98115',
    borderColor: '#10b98130',
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#d1d5db',
    lineHeight: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  questionCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6366f1',
  },
  sliderContainer: {
    paddingHorizontal: 4,
  },
  numberInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  numberButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberInput: {
    width: 80,
    height: 48,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#334155',
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  quickSelectRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  quickSelectButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  quickSelectButtonActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  quickSelectText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  quickSelectTextActive: {
    color: '#ffffff',
  },
  timerValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f97316',
  },
  timerPresets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timerPresetButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  timerPresetButtonActive: {
    backgroundColor: '#f9731620',
    borderColor: '#f97316',
  },
  timerPresetText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
  },
  timerPresetTextActive: {
    color: '#f97316',
  },
  selectedCount: {
    fontSize: 13,
    color: '#8b5cf6',
  },
  questionTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  questionTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  questionTypeButtonActive: {
    backgroundColor: '#8b5cf6',
    borderColor: '#8b5cf6',
  },
  questionTypeText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
  },
  questionTypeTextActive: {
    color: '#ffffff',
  },
  disabledMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: '#0f172a',
    borderRadius: 10,
  },
  disabledMessageText: {
    fontSize: 13,
    color: '#64748b',
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 16,
  },
  advancedToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
  },
  toggleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    marginBottom: 12,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
    marginRight: 12,
  },
  toggleIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleContent: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  tagButtonActive: {
    backgroundColor: '#ec489920',
    borderColor: '#ec4899',
  },
  tagText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  tagTextActive: {
    color: '#ec4899',
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    backgroundColor: '#1e293b',
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
  submitButton: {
    flex: 1.5,
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonStudy: {
    backgroundColor: '#10b981',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});

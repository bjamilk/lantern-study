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
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuestionType, TestMode, type TestPreset, type TestPresetConfig } from '../stores/testStore';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mobileQuestionTypesToWeb, webQuestionTypesToMobile } from '../utils/questionHelpers';
import {
  QUESTION_VISIBILITY_MODE_OPTIONS,
  type QuestionVisibilityMode,
} from '@lantern/shared/utils';
import { useQuestionVisibilityMode } from '../hooks/useQuestionVisibilityMode';

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
  selectedSubgroupIds: string[];
  visibilityMode?: QuestionVisibilityMode;
}

export interface TestConfigAvailableFilter {
  selectedQuestionTypes: QuestionType[];
  selectedTags: string[];
  useSpacedRepetition: boolean;
  focusOnNew: boolean;
  subgroupIds: string[];
  visibilityMode?: QuestionVisibilityMode;
  sessionMode?: 'test' | 'study';
}

interface TestConfigModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (config: TestConfigOptions, mode: TestMode) => void;
  mode: TestMode;
  maxQuestions: number;
  availableTags: string[];
  testName: string;
  getAvailableCount?: (filter: TestConfigAvailableFilter) => number;
  presets?: TestPreset[];
  onSavePreset?: (name: string, config: TestPresetConfig) => void;
  onDeletePreset?: (presetId: string) => void;
  subgroups?: { id: string; name: string; level: number }[];
}

export default function TestConfigModal({
  visible,
  onClose,
  onSubmit,
  mode,
  maxQuestions,
  availableTags,
  testName,
  getAvailableCount,
  presets = [],
  onSavePreset,
  onDeletePreset,
  subgroups = [],
}: TestConfigModalProps) {
  const [numberOfQuestions, setNumberOfQuestions] = useState(Math.min(10, maxQuestions));
  const [timerDuration, setTimerDuration] = useState(0);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<QuestionType[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [useSpacedRepetition, setUseSpacedRepetition] = useState(false);
  const [focusOnNew, setFocusOnNew] = useState(false);
  const [selectedSubgroupIds, setSelectedSubgroupIds] = useState<string[]>([]);
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [questionVisibilityMode, setQuestionVisibilityMode] = useQuestionVisibilityMode();

  const forcesStudyFromVisibility = mode === 'test' && questionVisibilityMode === 'unverified';
  const isStudyMode = mode === 'study' || forcesStudyFromVisibility;
  const effectiveSessionMode: 'test' | 'study' = isStudyMode ? 'study' : 'test';

  const liveAvailableCount = useMemo(() => {
    if (!getAvailableCount) return maxQuestions;
    return getAvailableCount({
      selectedQuestionTypes,
      selectedTags,
      useSpacedRepetition,
      focusOnNew,
      subgroupIds: useSpacedRepetition || focusOnNew ? [] : selectedSubgroupIds,
      visibilityMode: questionVisibilityMode,
      sessionMode: effectiveSessionMode,
    });
  }, [
    getAvailableCount,
    maxQuestions,
    selectedQuestionTypes,
    selectedTags,
    useSpacedRepetition,
    focusOnNew,
    selectedSubgroupIds,
    questionVisibilityMode,
    effectiveSessionMode,
  ]);

  const effectiveMaxQuestions = getAvailableCount ? liveAvailableCount : maxQuestions;

  // Reset when modal opens
  useEffect(() => {
    if (visible) {
      setNumberOfQuestions(Math.min(10, Math.max(1, maxQuestions)));
      setTimerDuration(isStudyMode ? 0 : Math.min(600, Math.max(60, Math.min(10, maxQuestions) * 60)));
      setSelectedQuestionTypes([]);
      setSelectedTags([]);
      setUseSpacedRepetition(false);
      setFocusOnNew(false);
      setSelectedSubgroupIds([]);
      setPresetName('');
      setSelectedPresetId('');
      setShowAdvanced(false);
    }
  }, [visible, maxQuestions, isStudyMode]);

  // Clamp question count when available pool changes
  useEffect(() => {
    if (!visible) return;
    if (effectiveMaxQuestions === 0) {
      setNumberOfQuestions(0);
      return;
    }
    setNumberOfQuestions(prev => {
      if (prev <= 0) return Math.min(10, effectiveMaxQuestions);
      if (prev > effectiveMaxQuestions) return effectiveMaxQuestions;
      if (prev < 1) return 1;
      return prev;
    });
  }, [effectiveMaxQuestions, visible]);

  // Auto-set timer to 1 min per question in test mode
  useEffect(() => {
    if (!visible || isStudyMode) return;
    if (numberOfQuestions > 0) {
      setTimerDuration(numberOfQuestions * 60);
    }
  }, [numberOfQuestions, visible, isStudyMode]);

  // Mutual exclusion for SR and Focus on New
  useEffect(() => {
    if (focusOnNew) setUseSpacedRepetition(false);
  }, [focusOnNew]);

  useEffect(() => {
    if (useSpacedRepetition) setFocusOnNew(false);
  }, [useSpacedRepetition]);

  useEffect(() => {
    if (focusOnNew || useSpacedRepetition) {
      setSelectedSubgroupIds([]);
    }
  }, [focusOnNew, useSpacedRepetition]);

  const toggleSubgroup = useCallback((subgroupId: string) => {
    setSelectedSubgroupIds(prev =>
      prev.includes(subgroupId) ? prev.filter(id => id !== subgroupId) : [...prev, subgroupId]
    );
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    setNumberOfQuestions(preset.config.numberOfQuestions);
    setTimerDuration(preset.config.timerDuration || 0);
    setSelectedQuestionTypes(webQuestionTypesToMobile(preset.config.allowedQuestionTypes || []));
    setSelectedTags(preset.config.selectedTags || []);
    setFocusOnNew(preset.config.focusOnNew || false);
    setUseSpacedRepetition(false);
    setSelectedPresetId(presetId);
  }, [presets]);

  const handleSavePreset = useCallback(() => {
    if (!onSavePreset || !presetName.trim()) {
      Alert.alert('Preset name required', 'Please enter a name for the preset.');
      return;
    }
    if (presets.length >= 5) {
      Alert.alert('Limit reached', 'You can save up to 5 presets. Delete one to add another.');
      return;
    }
    const config: TestPresetConfig = {
      numberOfQuestions,
      allowedQuestionTypes:
        useSpacedRepetition || focusOnNew ? [] : mobileQuestionTypesToWeb(selectedQuestionTypes),
      selectedTags: useSpacedRepetition || focusOnNew ? [] : selectedTags,
      timerDuration: !isStudyMode && timerDuration > 0 ? timerDuration : undefined,
      focusOnNew,
    };
    onSavePreset(presetName.trim(), config);
    setPresetName('');
  }, [
    onSavePreset,
    presetName,
    presets.length,
    numberOfQuestions,
    useSpacedRepetition,
    focusOnNew,
    selectedQuestionTypes,
    selectedTags,
    timerDuration,
    isStudyMode,
  ]);

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
    if (effectiveMaxQuestions === 0) return false;
    if (numberOfQuestions <= 0) return false;
    if (numberOfQuestions > effectiveMaxQuestions) return false;
    if (!isStudyMode && timerDuration <= 0) return false;
    if (!isStudyMode && !useSpacedRepetition && !focusOnNew && selectedQuestionTypes.length === 0) {
      return false;
    }
    return true;
  }, [
    effectiveMaxQuestions,
    numberOfQuestions,
    isStudyMode,
    timerDuration,
    useSpacedRepetition,
    focusOnNew,
    selectedQuestionTypes,
  ]);

  const validationHint = useMemo(() => {
    if (effectiveMaxQuestions === 0) return 'No testable questions match your filters.';
    if (!isStudyMode && !useSpacedRepetition && !focusOnNew && selectedQuestionTypes.length === 0) {
      return 'Select at least one question type.';
    }
    if (!isStudyMode && timerDuration <= 0) return 'Set a timer for the test.';
    return null;
  }, [
    effectiveMaxQuestions,
    isStudyMode,
    useSpacedRepetition,
    focusOnNew,
    selectedQuestionTypes,
    timerDuration,
  ]);

  const handleSubmit = useCallback(() => {
    if (!isValid) return;
    if (questionVisibilityMode === 'none') {
      Alert.alert('No questions', 'Question visibility is set to hide all. Change the filter to start.');
      return;
    }
    if (forcesStudyFromVisibility) {
      Alert.alert(
        'Study session',
        'Unverified questions are study-only. Starting a study session instead.'
      );
    }

    onSubmit(
      {
        numberOfQuestions,
        timerDuration: isStudyMode ? 0 : timerDuration,
        selectedQuestionTypes: useSpacedRepetition || focusOnNew ? [] : selectedQuestionTypes,
        selectedTags: useSpacedRepetition || focusOnNew ? [] : selectedTags,
        useSpacedRepetition,
        focusOnNew,
        selectedSubgroupIds: useSpacedRepetition || focusOnNew ? [] : selectedSubgroupIds,
        visibilityMode: questionVisibilityMode,
      },
      effectiveSessionMode
    );
  }, [
    isValid,
    numberOfQuestions,
    timerDuration,
    selectedQuestionTypes,
    selectedTags,
    useSpacedRepetition,
    focusOnNew,
    selectedSubgroupIds,
    mode,
    questionVisibilityMode,
    forcesStudyFromVisibility,
    isStudyMode,
    effectiveSessionMode,
    isStudyMode,
    onSubmit,
  ]);

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
            <View
              style={[
                styles.infoBox,
                {
                  backgroundColor: isStudyMode ? colors.successBackground : colors.primaryBackground,
                  borderColor: isStudyMode ? `${colors.success}55` : `${colors.primary}55`,
                },
              ]}
            >
              <Ionicons 
                name={isStudyMode ? 'bulb' : 'timer'} 
                size={20} 
                color={isStudyMode ? colors.success : colors.primary} 
              />
              <Text style={[styles.infoText, { color: colors.text }]}>
                {isStudyMode 
                  ? 'Study at your own pace with immediate feedback and explanations.'
                  : 'Timed assessment with scoring. Submit when ready or when time runs out.'
                }
              </Text>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="filter" size={20} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Question visibility</Text>
              </View>
              <View style={{ gap: 8, marginTop: 8 }}>
                {QUESTION_VISIBILITY_MODE_OPTIONS.map((opt) => {
                  const selected = questionVisibilityMode === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => setQuestionVisibilityMode(opt.value)}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? `${colors.primary}14` : colors.background,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: selected ? '700' : '500' }}>
                        {opt.label}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                        {opt.helper}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {forcesStudyFromVisibility ? (
                <Text style={[styles.availableHint, { color: colors.warning || '#b45309', marginTop: 8 }]}>
                  Unverified pool is practice-only — Start opens Study mode.
                </Text>
              ) : null}
              {mode === 'test' && questionVisibilityMode === 'all' ? (
                <Text style={[styles.availableHint, { color: colors.textSecondary, marginTop: 8 }]}>
                  Graded tests still use the verified subset only.
                </Text>
              ) : null}
            </View>

            {/* Number of Questions */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="list" size={20} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Number of Questions</Text>
                <Text style={[styles.questionCount, { color: colors.primary }]}>
                  {numberOfQuestions} / {effectiveMaxQuestions}
                </Text>
              </View>
              {getAvailableCount ? (
                <Text style={[styles.availableHint, { color: colors.textSecondary }]}>
                  {effectiveMaxQuestions} question{effectiveMaxQuestions === 1 ? '' : 's'} available with current filters
                </Text>
              ) : null}
              
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
                      const clamped = Math.min(Math.max(1, val), Math.max(1, effectiveMaxQuestions));
                      setNumberOfQuestions(clamped);
                    }}
                    keyboardType="number-pad"
                    selectTextOnFocus
                  />
                  
                  <TouchableOpacity
                    style={[styles.numberButton, { backgroundColor: colors.primary }]}
                    onPress={() => setNumberOfQuestions(Math.min(effectiveMaxQuestions, numberOfQuestions + 1))}
                    disabled={numberOfQuestions >= effectiveMaxQuestions}
                  >
                    <Ionicons name="add" size={20} color={numberOfQuestions >= effectiveMaxQuestions ? colors.textSecondary : '#ffffff'} />
                  </TouchableOpacity>
                </View>
                
                {/* Quick select buttons */}
                <View style={styles.quickSelectRow}>
                  {[5, 10, 15, 20].filter(n => n <= effectiveMaxQuestions).map((num) => (
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
                  {effectiveMaxQuestions > 20 && (
                    <TouchableOpacity
                      style={[
                        styles.quickSelectButton,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        numberOfQuestions === effectiveMaxQuestions && { backgroundColor: colors.primary, borderColor: colors.primary },
                      ]}
                      onPress={() => setNumberOfQuestions(effectiveMaxQuestions)}
                    >
                      <Text style={[
                        styles.quickSelectText,
                        { color: colors.textSecondary },
                        numberOfQuestions === effectiveMaxQuestions && { color: '#fff' },
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

            {/* Presets */}
            {onSavePreset ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="bookmark" size={20} color="#10b981" />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Presets</Text>
                </View>
                {presets.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
                    {presets.map(preset => (
                      <TouchableOpacity
                        key={preset.id}
                        style={[
                          styles.presetChip,
                          { borderColor: colors.border, backgroundColor: colors.inputBackground },
                          selectedPresetId === preset.id && { borderColor: colors.primary, backgroundColor: `${colors.primary}20` },
                        ]}
                        onPress={() => applyPreset(preset.id)}
                      >
                        <Text style={[styles.presetChipText, { color: colors.text }]}>{preset.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : null}
                <View style={styles.presetSaveRow}>
                  <TextInput
                    style={[styles.presetInput, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }]}
                    value={presetName}
                    onChangeText={setPresetName}
                    placeholder="Preset name"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <TouchableOpacity style={[styles.presetSaveButton, { backgroundColor: colors.primary }]} onPress={handleSavePreset}>
                    <Text style={styles.presetSaveText}>Save</Text>
                  </TouchableOpacity>
                  {onDeletePreset && selectedPresetId ? (
                    <TouchableOpacity
                      style={styles.presetDeleteButton}
                      onPress={() => {
                        Alert.alert('Delete preset', 'Remove this preset?', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => {
                              onDeletePreset(selectedPresetId);
                              setSelectedPresetId('');
                            },
                          },
                        ]);
                      }}
                    >
                      <Ionicons name="trash-outline" size={18} color="#ef4444" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Sub-groups */}
            {subgroups.length > 0 && !useSpacedRepetition && !focusOnNew ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="git-network" size={20} color="#0ea5e9" />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Include Sub-groups</Text>
                </View>
                <TouchableOpacity
                  style={styles.selectAllRow}
                  onPress={() => {
                    if (selectedSubgroupIds.length === subgroups.length) {
                      setSelectedSubgroupIds([]);
                    } else {
                      setSelectedSubgroupIds(subgroups.map(s => s.id));
                    }
                  }}
                >
                  <Ionicons
                    name={selectedSubgroupIds.length === subgroups.length ? 'checkbox' : 'square-outline'}
                    size={18}
                    color="#0ea5e9"
                  />
                  <Text style={[styles.selectAllText, { color: colors.text }]}>Select all sub-groups</Text>
                </TouchableOpacity>
                {subgroups.map(sub => (
                  <TouchableOpacity
                    key={sub.id}
                    style={[styles.subgroupRow, { paddingLeft: 12 + sub.level * 16 }]}
                    onPress={() => toggleSubgroup(sub.id)}
                  >
                    <Ionicons
                      name={selectedSubgroupIds.includes(sub.id) ? 'checkbox' : 'square-outline'}
                      size={18}
                      color="#0ea5e9"
                    />
                    <Text style={[styles.subgroupText, { color: colors.text }]}>{sub.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

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
          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.card, paddingBottom: Math.max(32, insets.bottom + 16) }]}>
            {!isValid && validationHint ? (
              <Text style={[styles.validationHint, { color: colors.textSecondary }]}>
                {validationHint}
              </Text>
            ) : null}
            <View style={styles.footerButtons}>
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
    height: '92%',
    maxHeight: '92%',
    overflow: 'hidden',
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
    backgroundColor: '#10b98120',
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
    flexGrow: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
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
    color: '#10b981',
  },
  availableHint: {
    fontSize: 12,
    marginBottom: 10,
    marginTop: -6,
  },
  presetRow: {
    marginBottom: 10,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  presetSaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  presetInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  presetSaveButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  presetSaveText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  presetDeleteButton: {
    padding: 8,
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: '500',
  },
  subgroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  subgroupText: {
    fontSize: 14,
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
    backgroundColor: '#10b981',
    borderColor: '#10b981',
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
    color: '#10b981',
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
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    backgroundColor: '#1e293b',
    flexShrink: 0,
  },
  validationHint: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 12,
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
    backgroundColor: '#10b981',
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

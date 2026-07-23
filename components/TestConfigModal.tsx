import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import { useToastStore } from '../stores/toastStore';
import { Group, Message, MessageType, QuestionType, TestConfig, UserQuestionStats, TestPreset, User, QuestionStatus } from '../types';
import { QuestionMarkCircleIcon, AcademicCapIcon, XMarkIcon, ClockIcon, ListBulletIcon, TagIcon, CloudArrowDownIcon, ArrowPathIcon, UsersIcon, BookmarkIcon, TrashIcon } from '@heroicons/react/24/outline';
import { isQuestionTestable } from '../utils/helpers';
import { featureAccents } from '@lantern/shared/design';
import {
  QUESTION_VISIBILITY_MODE_OPTIONS,
  messagePassesStudyQuestionPool,
  type QuestionVisibilityMode,
} from '@lantern/shared/utils';
import { useQuestionVisibilityMode } from '../hooks/useQuestionVisibilityMode';
import Modal from './ui/Modal';

interface TestConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: Group;
  allGroups: Group[];
  mode: 'test' | 'study' | 'game';
  allMessages: Record<string, Message[]>;
  userQuestionStats: UserQuestionStats;
  testPresets: TestPreset[];
  challengeOpponent?: User | null;
  onSavePreset: (name: string, config: Omit<TestConfig, 'questionIds' | 'groupId'>) => void;
  onDeletePreset: (presetId: string) => void;
  onSubmit: (config: Omit<TestConfig, 'questionIds' | 'groupId'>, mode: 'test' | 'study' | 'game', useSpacedRepetition: boolean, selectedSubgroupIDs: string[]) => void;
  onSoloPractice?: (config: Omit<TestConfig, 'questionIds' | 'groupId'>) => void;
  onDownloadForOffline: (config: Omit<TestConfig, 'questionIds' | 'groupId'>, useSpacedRepetition: boolean, selectedSubgroupIDs: string[]) => void;
  isDownloading?: boolean;
}

const TESTABLE_QUESTION_TYPES: QuestionType[] = [
  QuestionType.MULTIPLE_CHOICE_SINGLE,
  QuestionType.MULTIPLE_CHOICE_MULTIPLE,
  QuestionType.TRUE_FALSE,
  QuestionType.FILL_IN_THE_BLANK,
  QuestionType.MATCHING,
  QuestionType.DIAGRAM_LABELING,
];

export const TestConfigModal: React.FC<TestConfigModalProps> = ({ 
    isOpen, 
    onClose, 
    group,
    allGroups,
    mode, 
    allMessages, 
    userQuestionStats,
    testPresets,
    challengeOpponent,
    onSavePreset,
    onDeletePreset,
    onSubmit,
    onSoloPractice,
    onDownloadForOffline,
    isDownloading 
}) => {
  const [numberOfQuestions, setNumberOfQuestions] = useState(0);
  const [selectedTimerSeconds, setSelectedTimerSeconds] = useState<number>(0);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<QuestionType[]>([]);
  const [selectedTagsInModal, setSelectedTagsInModal] = useState<string[]>([]);
  const [useSpacedRepetition, setUseSpacedRepetition] = useState(false);
  const [focusOnNew, setFocusOnNew] = useState(false);
  const [selectedSubgroupIDs, setSelectedSubgroupIDs] = useState<string[]>([]);
  const [presetName, setPresetName] = useState('');
  const [questionVisibilityMode, setQuestionVisibilityMode] = useQuestionVisibilityMode();

  /** Unverified pool is study-only; starting Test with that filter becomes Study. */
  const forcesStudyFromVisibility =
    mode === 'test' && questionVisibilityMode === 'unverified';
  const effectiveMode: 'test' | 'study' | 'game' = forcesStudyFromVisibility ? 'study' : mode;
  
  const getSubgroupsWithLevel = useCallback((parentId: string, allGroups: Group[], level = 0): { group: Group; level: number }[] => {
    const subgroups: { group: Group; level: number }[] = [];
    const directSubgroups = allGroups.filter(g => g.parentId === parentId && !g.isArchived);
    for (const subgroup of directSubgroups) {
        subgroups.push({ group: subgroup, level });
        subgroups.push(...getSubgroupsWithLevel(subgroup.id, allGroups, level + 1));
    }
    return subgroups;
  }, []);

  useEffect(() => {
    if (focusOnNew) setUseSpacedRepetition(false);
  }, [focusOnNew]);

  useEffect(() => {
    if (useSpacedRepetition) setFocusOnNew(false);
  }, [useSpacedRepetition]);

  const availableSubgroups = useMemo(() => {
    return getSubgroupsWithLevel(group.id, allGroups);
  }, [group.id, allGroups, getSubgroupsWithLevel]);

  const scopedGroupMessages = useMemo(() => {
    const groupIdsForFilter = [group.id, ...selectedSubgroupIDs];
    return [...new Set(groupIdsForFilter)].flatMap(id => allMessages[id] || []);
  }, [allMessages, group.id, selectedSubgroupIDs]);

  const questionStatusBreakdown = useMemo(() => {
    let verified = 0;
    let pending = 0;
    let rejected = 0;
    for (const msg of scopedGroupMessages) {
      if (msg.type !== MessageType.QUESTION || msg.isArchived) continue;
      if (isQuestionTestable(msg)) {
        verified += 1;
      } else if (msg.questionStatus === QuestionStatus.REJECTED) {
        rejected += 1;
      } else {
        pending += 1;
      }
    }
    return { verified, pending, rejected };
  }, [scopedGroupMessages]);

  const uniqueTagsFromGroup = useMemo(() => {
    const tagsSet = new Set<string>();
    scopedGroupMessages.forEach((msg: Message) => {
      const inPool =
        effectiveMode === 'study'
          ? messagePassesStudyQuestionPool(msg, questionVisibilityMode)
          : isQuestionTestable(msg);
      if (inPool && msg.tags?.length) {
        msg.tags.forEach(tag => tagsSet.add(tag));
      }
    });
    return Array.from(tagsSet).sort();
  }, [scopedGroupMessages, effectiveMode, questionVisibilityMode]);
  
  const { normalModeQuestions, spacedRepetitionQuestions, focusOnNewQuestions } = useMemo(() => {
    const validQuestionsForFilter =
      questionVisibilityMode === 'none'
        ? []
        : effectiveMode === 'study'
          ? scopedGroupMessages.filter((msg) =>
              messagePassesStudyQuestionPool(msg, questionVisibilityMode)
            )
          : // Graded test / game: verified bank only (All still uses verified subset)
            scopedGroupMessages.filter(isQuestionTestable);
    
    const applyBaseFilters = (questions: Message[]) => {
      return questions.filter(msg => {
        const isAllowedType = selectedQuestionTypes.length === 0 || selectedQuestionTypes.includes(msg.questionType!);
        let matchesTags = true;
        if (selectedTagsInModal.length > 0) {
          matchesTags = msg.tags ? selectedTagsInModal.some(tag => msg.tags!.includes(tag)) : false;
        }
        return isAllowedType && matchesTags;
      });
    }

    const normal = applyBaseFilters(validQuestionsForFilter);

    // Spaced Repetition: questions user got wrong more than right, OR questions never attempted
    const spaced = validQuestionsForFilter.filter((q: Message) => {
        const stats = userQuestionStats[q.id];
        if (!stats) return true; // Never attempted = needs study
        return stats.incorrectAttempts > 0 && stats.incorrectAttempts >= stats.correctAttempts;
    });
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentQuestions = new Set(applyBaseFilters(validQuestionsForFilter).filter(q => new Date(q.timestamp) >= sevenDaysAgo && !userQuestionStats[q.id]));
    const unattemptedQuestions = new Set(applyBaseFilters(validQuestionsForFilter).filter(q => !userQuestionStats[q.id]));
    const focusSet = new Set([...recentQuestions, ...unattemptedQuestions]);

    return { normalModeQuestions: normal, spacedRepetitionQuestions: spaced, focusOnNewQuestions: Array.from(focusSet) };
  }, [
    scopedGroupMessages,
    selectedQuestionTypes,
    selectedTagsInModal,
    userQuestionStats,
    effectiveMode,
    questionVisibilityMode,
  ]);

  const availableQuestions = useSpacedRepetition ? spacedRepetitionQuestions : (focusOnNew ? focusOnNewQuestions : normalModeQuestions);
  const maxQuestions = availableQuestions.length;

  useEffect(() => {
    if (isOpen) {
      setSelectedQuestionTypes([]);
      setSelectedTagsInModal([]);
      setSelectedTimerSeconds(0);
      setUseSpacedRepetition(false);
      setFocusOnNew(false);
      setSelectedSubgroupIDs([]);
      setPresetName('');
    }
  }, [isOpen]);
  
  useEffect(() => {
    setNumberOfQuestions(prevNumOfQs => {
      if (maxQuestions === 0) return 0;
      const defaultNum = Math.min(10, maxQuestions);
      if (prevNumOfQs === 0 && maxQuestions > 0) return defaultNum;
      if (prevNumOfQs > maxQuestions) return maxQuestions;
      if (prevNumOfQs < 1 && maxQuestions > 0) return 1;
      return prevNumOfQs;
    });
  }, [maxQuestions]);

  useEffect(() => {
    if (focusOnNew || mode === 'game') {
        setSelectedSubgroupIDs([]);
    }
  }, [focusOnNew, mode]);

  const testConfigPanelClass =
    '!p-4 sm:!p-6 rounded-t-2xl sm:rounded-lantern-xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col min-h-0 overflow-hidden border-t-4 bg-lantern-surface';
  const testConfigPanelStyle = { borderTopColor: featureAccents.groups };

  if (!isOpen) return null;

  const handleApplyPreset = (presetId: string) => {
    const preset = testPresets.find(p => p.id === presetId);
    if (preset) {
        setNumberOfQuestions(preset.config.numberOfQuestions);
        setSelectedTimerSeconds(preset.config.timerDuration || 0);
        setSelectedQuestionTypes(preset.config.allowedQuestionTypes);
        setSelectedTagsInModal(preset.config.selectedTags || []);
        setFocusOnNew(preset.config.focusOnNew || false);
        setUseSpacedRepetition(false);
    }
  };

  const handleSaveCurrentAsPreset = () => {
      if (!presetName.trim()) {
          useToastStore.getState().showToast("Please enter a name for the preset.", 'error');
          return;
      }
      const currentConfig: Omit<TestConfig, 'questionIds' | 'groupId'> = {
          numberOfQuestions,
          allowedQuestionTypes: useSpacedRepetition || focusOnNew ? [] : selectedQuestionTypes,
          selectedTags: useSpacedRepetition || focusOnNew ? [] : selectedTagsInModal,
          timerDuration: mode === 'test' && selectedTimerSeconds > 0 ? selectedTimerSeconds : undefined,
          focusOnNew: focusOnNew,
      };
      onSavePreset(presetName, currentConfig);
      setPresetName('');
  };

  const handleQuestionTypeChange = (type: QuestionType, checked: boolean) => {
    setSelectedQuestionTypes(prevTypes =>
      checked ? [...prevTypes, type] : prevTypes.filter(t => t !== type)
    );
  };

  const handleTagChange = (tag: string, checked: boolean) => {
    setSelectedTagsInModal(prevTags =>
      checked ? [...prevTags, tag] : prevTags.filter(t => t !== tag)
    );
  };

  const handleSubgroupToggle = (subgroupId: string) => {
    setSelectedSubgroupIDs(prev => 
        prev.includes(subgroupId)
            ? prev.filter(id => id !== subgroupId)
            : [...prev, subgroupId]
    );
  };

  const handleSelectAllSubgroups = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
        setSelectedSubgroupIDs(availableSubgroups.map(({ group }) => group.id));
    } else {
        setSelectedSubgroupIDs([]);
    }
  };

  const isSubmitDisabled = () => {
    if (isDownloading) return true;
    if (maxQuestions === 0) return true;
    if (numberOfQuestions <= 0) return true;
    if (effectiveMode === 'test' && selectedTimerSeconds <= 0) return true;
    // Study mode doesn't require question type selection - it shows all questions
    if (
      effectiveMode !== 'study' &&
      !useSpacedRepetition &&
      !focusOnNew &&
      selectedQuestionTypes.length === 0
    ) {
      return true;
    }
    if (numberOfQuestions > maxQuestions) return true;
    return false;
  };

  const getCurrentConfig = (): Omit<TestConfig, 'questionIds' | 'groupId'> => ({
    numberOfQuestions,
    allowedQuestionTypes: useSpacedRepetition || focusOnNew ? [] : selectedQuestionTypes,
    selectedTags: useSpacedRepetition || focusOnNew ? [] : selectedTagsInModal,
    focusOnNew: focusOnNew,
    timerDuration: mode === 'test' ? selectedTimerSeconds : undefined,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitDisabled()) {
        useToastStore.getState().showToast(`Please ensure you have selected question types, set a timer (for tests), there are available questions for the selected criteria, and the number of questions is valid (1-${maxQuestions}).`, 'error');
        return;
    }
    if (forcesStudyFromVisibility) {
      useToastStore.getState().showToast(
        'Unverified questions are study-only. Starting a study session instead.',
        'info'
      );
    }
    if (questionVisibilityMode === 'none') {
      useToastStore.getState().showToast('Question visibility is set to hide all. Change the filter to start.', 'error');
      return;
    }
    onSubmit(getCurrentConfig(), effectiveMode, useSpacedRepetition, selectedSubgroupIDs);
  };

  const visibilityControl = (
    <div className="p-3 rounded-md border border-lantern-border bg-lantern-background-secondary/60">
      <label htmlFor="question-visibility-mode" className="block text-sm font-medium text-lantern-text mb-1">
        Question visibility
      </label>
      <select
        id="question-visibility-mode"
        value={questionVisibilityMode}
        onChange={(e) => setQuestionVisibilityMode(e.target.value as QuestionVisibilityMode)}
        className="w-full p-2 border border-lantern-border rounded-md bg-lantern-surface text-lantern-text text-sm"
      >
        {QUESTION_VISIBILITY_MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-lantern-text-secondary">
        {QUESTION_VISIBILITY_MODE_OPTIONS.find((o) => o.value === questionVisibilityMode)?.helper}
      </p>
      {forcesStudyFromVisibility && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          Unverified pool is practice-only — Start will open Study mode.
        </p>
      )}
      {mode === 'test' && questionVisibilityMode === 'all' && (
        <p className="mt-1 text-xs text-lantern-text-tertiary">
          Graded tests still use the verified subset only.
        </p>
      )}
    </div>
  );

  const handleDownload = () => {
    if (isSubmitDisabled()) {
        useToastStore.getState().showToast(`Cannot download. Please ensure you have selected question types, there are available questions for the selected criteria, and the number of questions is valid (1-${maxQuestions}).`, 'error');
        return;
    }
     const config: Omit<TestConfig, 'questionIds' | 'groupId'> = {
      numberOfQuestions,
      allowedQuestionTypes: useSpacedRepetition || focusOnNew ? [] : selectedQuestionTypes,
      selectedTags: useSpacedRepetition || focusOnNew ? [] : selectedTagsInModal,
      timerDuration: mode === 'test' && selectedTimerSeconds > 0 ? selectedTimerSeconds : undefined,
      focusOnNew: focusOnNew,
    };
    onDownloadForOffline(config, useSpacedRepetition, selectedSubgroupIDs);
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) val = maxQuestions > 0 ? 1 : 0;
    if (maxQuestions === 0) val = 0;
    else {
      if (val < 1) val = 1;
      if (val > maxQuestions) val = maxQuestions;
    }
    setNumberOfQuestions(val);
    if (mode === 'test') setSelectedTimerSeconds(val * 60);
  };
  
  const getModalTitle = () => {
    if(mode === 'game' && challengeOpponent) return `Challenge ${challengeOpponent.name} to a ${numberOfQuestions}-question duel in "${group.name}"`;
    if(mode === 'study') return `Study Session for "${group.name}"`;
    return `Configure Test for "${group.name}"`;
  };
  
  const Icon = mode === 'test' ? QuestionMarkCircleIcon : AcademicCapIcon;

  const questionAvailabilityHint = (
    <>
      <p className="mt-1 text-xs text-lantern-text-secondary">
        {effectiveMode === 'study'
          ? 'Pool follows your question visibility filter. Unverified items hide automatically once verified.'
          : 'Graded tests use group-verified questions only. Pending and rejected stay out of scored tests.'}
      </p>
      {(questionStatusBreakdown.verified + questionStatusBreakdown.pending + questionStatusBreakdown.rejected) > 0 && (
        <p className="mt-0.5 text-xs text-lantern-text-tertiary">
          {questionStatusBreakdown.verified} verified · {questionStatusBreakdown.pending} pending · {questionStatusBreakdown.rejected} rejected
        </p>
      )}
    </>
  );

  // For study mode, show a completely distinct blue-themed interface
  if (mode === 'study') {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        ariaLabelledBy="test-config-study-title"
        maxWidthClass="max-w-2xl"
        loading={isDownloading}
        closeOnBackdrop={!isDownloading}
        alignClass="items-end sm:items-center justify-center"
        paddingClass="p-0 sm:p-4"
        backdropClassName="overscroll-contain"
        panelClassName={testConfigPanelClass}
        panelStyle={testConfigPanelStyle}
      >
          <div className="flex justify-between items-center mb-4 flex-shrink-0 gap-3">
            <h2 id="test-config-study-title" className="text-lg sm:text-xl font-semibold text-lantern-text flex items-center min-w-0">
              <span className="text-2xl mr-2 shrink-0">📚</span>
              <AcademicCapIcon className="w-6 h-6 mr-2 shrink-0" style={{ color: featureAccents.groups }} />
              <span className="truncate">Configure Study for "{group.name}"</span>
            </h2>
            <button onClick={onClose} className="text-lantern-text-secondary hover:text-lantern-text dark:text-lantern-text-tertiary dark:hover:text-lantern-text shrink-0">
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 -mr-1 space-y-4">
          {/* Study Mode Features - Blue Theme */}
          <div className="p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
            <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-3 text-sm">Study Mode Features</h3>
            <div className="space-y-2">
              <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                <span className="text-green-500 mr-2">✓</span>
                <span className="font-medium">No Timer</span>
                <span className="ml-2 text-lantern-primary text-xs">— Take as long as you need</span>
              </div>
              <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                <span className="text-green-500 mr-2">✓</span>
                <span className="font-medium">Instant Feedback</span>
                <span className="ml-2 text-lantern-primary text-xs">— See answer after each question</span>
              </div>
              <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                <span className="text-green-500 mr-2">✓</span>
                <span className="font-medium">Not Recorded</span>
                <span className="ml-2 text-lantern-primary text-xs">— Practice without pressure</span>
              </div>
              <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                <span className="text-green-500 mr-2">✓</span>
                <span className="font-medium">Pause Anytime</span>
                <span className="ml-2 text-lantern-primary text-xs">— Take breaks when needed</span>
              </div>
              <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                <span className="text-green-500 mr-2">✓</span>
                <span className="font-medium">Review Explanations</span>
                <span className="ml-2 text-lantern-primary text-xs">— Learn from each answer</span>
              </div>
              <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                <span className="text-green-500 mr-2">✓</span>
                <span className="font-medium">Mark for Review</span>
                <span className="ml-2 text-lantern-primary text-xs">— Flag difficult questions</span>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {visibilityControl}
            {/* Load Preset */}
            {testPresets.length > 0 && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-700">
                <label htmlFor="study-preset-select" className="text-sm font-medium text-blue-700 dark:text-blue-300 flex items-center mb-2"><BookmarkIcon className="w-5 h-5 mr-1.5"/>Load a Preset</label>
                <div className="flex gap-2">
                  <select id="study-preset-select" onChange={e => handleApplyPreset(e.target.value)} defaultValue="" className="flex-grow p-2 border border-lantern-primary/30 rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary">
                    <option value="" disabled>Select a preset...</option>
                    {testPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" onClick={() => { void confirmDialog({ title: 'Delete preset?', message: 'Are you sure you want to delete this preset?', danger: true, confirmLabel: 'Delete' }).then((ok) => { if (ok) onDeletePreset((document.getElementById('study-preset-select') as HTMLSelectElement)?.value); }); }} className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-md"><TrashIcon className="w-5 h-5"/></button>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="numberOfQuestions" className="block text-sm font-medium text-lantern-text flex items-center">
                <ListBulletIcon className="w-5 h-5 mr-1.5 text-lantern-primary"/>
                Number of Questions 
                <span className="ml-1 text-xs text-lantern-text-secondary">{`(${maxQuestions} available)`}</span>
              </label>
              {questionAvailabilityHint}
              <div className="flex items-center gap-4 mt-2">
                <input
                  type="range"
                  id="numberOfQuestions"
                  min={maxQuestions > 0 ? 1 : 0}
                  max={maxQuestions}
                  value={numberOfQuestions}
                  onChange={handleNumberChange}
                  className="flex-1 h-2 bg-blue-200 dark:bg-blue-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  disabled={maxQuestions === 0}
                />
                <input
                  type="number"
                  value={numberOfQuestions}
                  onChange={handleNumberChange}
                  className="w-20 p-1 text-center border border-lantern-primary/30 rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary"
                  disabled={maxQuestions === 0}
                />
              </div>
            </div>

            {/* Special Learning Modes */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-700">
              <h3 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2 flex items-center">
                <AcademicCapIcon className="w-5 h-5 mr-1.5"/>Special Learning Modes
              </h3>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input type="checkbox" checked={useSpacedRepetition} onChange={e => setUseSpacedRepetition(e.target.checked)} className="h-4 w-4 rounded text-lantern-primary border-lantern-primary/30 focus:ring-lantern-primary" />
                  <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">
                    <span className="font-medium text-blue-700 dark:text-blue-300">Spaced Repetition</span>
                    <span className="text-xs text-lantern-text-secondary ml-1">(prioritize weak & unattempted questions)</span>
                  </span>
                </label>
                <label className="flex items-center">
                  <input type="checkbox" checked={focusOnNew} onChange={e => setFocusOnNew(e.target.checked)} className="h-4 w-4 rounded text-lantern-primary border-lantern-primary/30 focus:ring-lantern-primary" />
                  <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">
                    <span className="font-medium text-blue-700 dark:text-blue-300">Focus on New Questions</span>
                    <span className="text-xs text-lantern-text-secondary ml-1">(prioritizes recent & unattempted)</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Include Sub-groups */}
            {availableSubgroups.length > 0 && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-700">
                <h3 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2 flex items-center">
                  <UsersIcon className="w-5 h-5 mr-1.5"/>Include Sub-groups
                </h3>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  <label className="flex items-center p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-800/50">
                    <input type="checkbox" onChange={handleSelectAllSubgroups} checked={selectedSubgroupIDs.length === availableSubgroups.length && availableSubgroups.length > 0} className="h-4 w-4 rounded text-lantern-primary border-lantern-border focus:ring-lantern-primary"/>
                    <span className="ml-2 text-sm font-semibold text-lantern-text dark:text-lantern-text">Select All</span>
                  </label>
                  {availableSubgroups.map(({ group: sub, level }) => (
                    <label key={sub.id} className="flex items-center p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-800/50" style={{ marginLeft: `${level * 1}rem` }}>
                      <input type="checkbox" checked={selectedSubgroupIDs.includes(sub.id)} onChange={() => handleSubgroupToggle(sub.id)} className="h-4 w-4 rounded text-lantern-primary border-lantern-border focus:ring-lantern-primary"/>
                      <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary flex items-center">
                        {level > 0 && <span className="text-lantern-text-tertiary mr-1">└</span>}
                        {sub.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Filter by Question Type */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-700">
              <h3 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2 flex items-center">
                <ListBulletIcon className="w-5 h-5 mr-1.5"/>Filter by Question Type <span className="text-xs text-lantern-text-secondary ml-1">(leave empty for all types)</span>
              </h3>
                <div className="grid grid-cols-2 gap-2">
                {TESTABLE_QUESTION_TYPES.map(type => (
                  <label key={type} className="flex items-center p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-800/50">
                    <input type="checkbox" checked={selectedQuestionTypes.includes(type)} onChange={e => handleQuestionTypeChange(type, e.target.checked)} className="h-4 w-4 rounded text-lantern-primary border-lantern-border focus:ring-lantern-primary" />
                    <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">{type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Filter by Tags */}
            {uniqueTagsFromGroup.length > 0 && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-700">
                <h3 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2 flex items-center">
                  <TagIcon className="w-5 h-5 mr-1.5"/>Filter by Tags <span className="text-xs text-lantern-text-secondary ml-1">(leave empty for all tags)</span>
                </h3>
                <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                  {uniqueTagsFromGroup.map(tag => (
                    <label key={tag} className="flex items-center p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-800/50">
                      <input type="checkbox" checked={selectedTagsInModal.includes(tag)} onChange={e => handleTagChange(tag, e.target.checked)} className="h-4 w-4 rounded text-lantern-primary border-lantern-border focus:ring-lantern-primary" />
                      <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">{tag}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-md text-center">
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">{availableQuestions.length} questions available based on your filters</p>
            </div>

            {/* Save Preset */}
            {testPresets.length < 5 && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-700">
                <h3 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2 flex items-center">
                  <BookmarkIcon className="w-5 h-5 mr-1.5"/>Save Current Configuration as Preset
                </h3>
                <div className="flex gap-2">
                  <input type="text" value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Preset name..." className="flex-grow p-2 border border-lantern-primary/30 rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary"/>
                  <button type="button" onClick={handleSaveCurrentAsPreset} disabled={!presetName.trim()} className="px-4 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-md disabled:opacity-50">Save</button>
                </div>
              </div>
            )}
          </form>
          </div>

          <div className="flex-shrink-0 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mt-4 pt-4 border-t border-blue-200 dark:border-blue-700 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={handleDownload}
              disabled={maxQuestions === 0 || numberOfQuestions < 1}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-900/70 border border-lantern-primary/30 dark:border-blue-700 rounded-md flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading && <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin"/>}
              <CloudArrowDownIcon className="w-5 h-5 mr-2" />
              Download for Offline
            </button>
            <div className="flex gap-3 w-full sm:w-auto">
              <button type="button" onClick={onClose} className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary hover:bg-lantern-background-secondary border border-lantern-border rounded-md dark:bg-lantern-surface-secondary dark:text-lantern-text-tertiary dark:border-lantern-border dark:hover:bg-lantern-border">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={maxQuestions === 0 || numberOfQuestions < 1}
                className="flex-1 sm:flex-none px-6 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-lg"
              >
                <span className="text-lg mr-2">📚</span>
                Start Studying
              </button>
            </div>
          </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="test-config-modal-title"
      maxWidthClass="max-w-2xl"
      loading={isDownloading}
      closeOnBackdrop={!isDownloading}
      alignClass="items-end sm:items-center justify-center"
      paddingClass="p-0 sm:p-4"
      backdropClassName="overscroll-contain"
      panelClassName={testConfigPanelClass}
      panelStyle={testConfigPanelStyle}
    >
        <div className="flex justify-between items-center mb-4 flex-shrink-0 gap-3">
          <h2 id="test-config-modal-title" className="text-lg sm:text-xl font-semibold text-lantern-text flex items-center min-w-0">
            {mode === 'test' && <span className="text-2xl mr-2 shrink-0">📝</span>}
            <Icon className="w-6 h-6 mr-2 shrink-0" style={{ color: featureAccents.groups }} />
            <span className="truncate">{mode === 'test' ? `Configure Test for "${group.name}"` : getModalTitle()}</span>
          </h2>
          <button onClick={onClose} className="text-lantern-text-secondary hover:text-lantern-text dark:text-lantern-text-tertiary dark:hover:text-lantern-text shrink-0">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 -mr-1 space-y-4">
        {/* Test Mode Features - Purple Theme */}
        {mode === 'test' && (
          <div className="p-4 bg-purple-50 dark:bg-purple-900/30 rounded-lg border border-lantern-primary/30">
            <h3 className="font-semibold text-purple-800 dark:text-purple-200 mb-3 text-sm">Test Mode Features</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center text-sm text-purple-700 dark:text-purple-300">
                <span className="mr-2">⏱️</span>
                <span className="font-medium">Timed Test</span>
              </div>
              <div className="flex items-center text-sm text-purple-700 dark:text-purple-300">
                <span className="mr-2">📊</span>
                <span className="font-medium">Results Recorded</span>
              </div>
              <div className="flex items-center text-sm text-purple-700 dark:text-purple-300">
                <span className="mr-2">🏆</span>
                <span className="font-medium">Score & Stats</span>
              </div>
              <div className="flex items-center text-sm text-purple-700 dark:text-purple-300">
                <span className="mr-2">📈</span>
                <span className="font-medium">Dashboard Updates</span>
              </div>
              <div className="flex items-center text-sm text-purple-700 dark:text-purple-300">
                <span className="mr-2">❓</span>
                <span className="font-medium">Answers at End</span>
              </div>
              <div className="flex items-center text-sm text-purple-700 dark:text-purple-300">
                <span className="mr-2">🎓</span>
                <span className="font-medium">Exam Simulation</span>
              </div>
            </div>
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {visibilityControl}
          {mode !== 'game' && testPresets.length > 0 && (
            <div className="p-3 bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-md border dark:border-lantern-border">
              <label htmlFor="preset-select" className="text-sm font-medium text-lantern-text flex items-center mb-2"><BookmarkIcon className="w-5 h-5 mr-1.5"/>Load a Preset</label>
              <div className="flex gap-2">
                <select id="preset-select" onChange={e => handleApplyPreset(e.target.value)} defaultValue="" className="flex-grow p-2 border border-lantern-border dark:border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text">
                  <option value="" disabled>Select a preset...</option>
                  {testPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" onClick={() => { void confirmDialog({ title: 'Delete preset?', message: 'Are you sure you want to delete this preset?', danger: true, confirmLabel: 'Delete' }).then((ok) => { if (ok) onDeletePreset((document.getElementById('preset-select') as HTMLSelectElement)?.value); }); }} className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-md"><TrashIcon className="w-5 h-5"/></button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="numberOfQuestions" className="block text-sm font-medium text-lantern-text flex items-center">
                <ListBulletIcon className="w-5 h-5 mr-1.5 text-lantern-text-secondary"/>
                Number of Questions 
                <span className="ml-1 text-xs text-lantern-text-secondary">{`(${maxQuestions} available)`}</span>
              </label>
              {questionAvailabilityHint}
              <input
                type="range"
                id="numberOfQuestions"
                min={maxQuestions > 0 ? 1 : 0}
                max={maxQuestions}
                value={numberOfQuestions}
                onChange={handleNumberChange}
                className="w-full mt-1 h-2 bg-lantern-background-secondary dark:bg-lantern-border rounded-lg appearance-none cursor-pointer"
                disabled={maxQuestions === 0}
              />
              <input
                type="number"
                value={numberOfQuestions}
                onChange={handleNumberChange}
                className="w-20 mt-2 p-1 text-center border border-lantern-border dark:border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text"
                disabled={maxQuestions === 0}
              />
            </div>
            {mode === 'test' && (
              <div>
                <label htmlFor="timerDuration" className="block text-sm font-medium text-lantern-text flex items-center">
                    <ClockIcon className="w-5 h-5 mr-1.5 text-lantern-text-secondary"/>
                    Timer (minutes)
                </label>
                <input
                  type="number"
                  id="timerDuration"
                  value={Math.floor((selectedTimerSeconds || 0) / 60) || ''}
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    setSelectedTimerSeconds(isNaN(val) ? 0 : val * 60);
                  }}
                  min="1"
                  className="w-full mt-1 p-2 border border-lantern-border dark:border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text"
                  required
                />
              </div>
            )}
          </div>
          
          {mode !== 'game' && (
            <div className="p-3 bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-md border dark:border-lantern-border">
                <h3 className="text-sm font-medium text-lantern-text mb-2">Special Learning Modes</h3>
                <div className="space-y-2">
                    <label className="flex items-center">
                        <input type="checkbox" checked={useSpacedRepetition} onChange={e => setUseSpacedRepetition(e.target.checked)} className="h-4 w-4 rounded text-lantern-primary border-lantern-border focus:ring-lantern-primary" />
                        <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">Spaced Repetition <span className="text-xs text-lantern-text-secondary">(prioritize weak & unattempted questions)</span></span>
                    </label>
                    <label className="flex items-center">
                        <input type="checkbox" checked={focusOnNew} onChange={e => setFocusOnNew(e.target.checked)} className="h-4 w-4 rounded text-lantern-primary border-lantern-border focus:ring-lantern-primary" />
                        <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">Focus on New Questions <span className="text-xs text-lantern-text-secondary">(prioritizes recent & unattempted)</span></span>
                    </label>
                </div>
            </div>
          )}

          {!useSpacedRepetition && !focusOnNew && mode !== 'game' && availableSubgroups.length > 0 && (
            <div className="p-3 bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-md border dark:border-lantern-border">
                <h3 className="text-sm font-medium text-lantern-text mb-2 flex items-center"><UsersIcon className="w-5 h-5 mr-1.5"/>Include Sub-groups</h3>
                <div className="max-h-40 overflow-y-auto space-y-1">
                    <label className="flex items-center p-1 rounded hover:bg-lantern-background-secondary dark:hover:bg-lantern-border/50">
                        <input type="checkbox" onChange={handleSelectAllSubgroups} checked={selectedSubgroupIDs.length === availableSubgroups.length && availableSubgroups.length > 0} className="h-4 w-4 rounded text-lantern-primary border-lantern-border"/>
                        <span className="ml-2 text-sm font-semibold text-lantern-text dark:text-lantern-text">Select All Sub-groups</span>
                    </label>
                    {availableSubgroups.map(({ group: sub, level }) => (
                         <label key={sub.id} className="flex items-center p-1 rounded hover:bg-lantern-background-secondary dark:hover:bg-lantern-border/50" style={{ marginLeft: `${level * 1}rem` }}>
                            <input type="checkbox" checked={selectedSubgroupIDs.includes(sub.id)} onChange={() => handleSubgroupToggle(sub.id)} className="h-4 w-4 rounded text-lantern-primary border-lantern-border"/>
                            <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary flex items-center">
                              {level > 0 && <span className="text-lantern-text-tertiary mr-1">└</span>}
                              {sub.name}
                            </span>
                        </label>
                    ))}
                </div>
            </div>
          )}

          {!useSpacedRepetition && !focusOnNew && (
            <>
              <div className="p-3 bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-md border dark:border-lantern-border">
                <h3 className="text-sm font-medium text-lantern-text mb-2 flex items-center"><ListBulletIcon className="w-5 h-5 mr-1.5"/>Filter by Question Type</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {TESTABLE_QUESTION_TYPES.map(type => (
                    <label key={type} className="flex items-center p-1 rounded hover:bg-lantern-background-secondary dark:hover:bg-lantern-border/50">
                      <input type="checkbox" checked={selectedQuestionTypes.includes(type)} onChange={e => handleQuestionTypeChange(type, e.target.checked)} className="h-4 w-4 rounded text-lantern-primary border-lantern-border" />
                      <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">{type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}</span>
                    </label>
                  ))}
                </div>
              </div>
              
              {uniqueTagsFromGroup.length > 0 && (
                <div className="p-3 bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-md border dark:border-lantern-border">
                  <h3 className="text-sm font-medium text-lantern-text mb-2 flex items-center"><TagIcon className="w-5 h-5 mr-1.5"/>Filter by Tags</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-32 overflow-y-auto">
                    {uniqueTagsFromGroup.map(tag => (
                      <label key={tag} className="flex items-center p-1 rounded hover:bg-lantern-background-secondary dark:hover:bg-lantern-border/50">
                        <input type="checkbox" checked={selectedTagsInModal.includes(tag)} onChange={e => handleTagChange(tag, e.target.checked)} className="h-4 w-4 rounded text-lantern-primary border-lantern-border" />
                        <span className="ml-2 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">{tag}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

           <div className={`p-2 rounded-md text-center ${mode === 'test' ? 'bg-purple-50 dark:bg-purple-900/40' : 'bg-blue-50 dark:bg-blue-900/40'}`}>
                <p className={`text-sm font-medium ${mode === 'test' ? 'text-purple-700 dark:text-purple-300' : 'text-blue-700 dark:text-blue-300'}`}>{availableQuestions.length} questions available based on your filters.</p>
           </div>

          {mode !== 'game' && testPresets.length < 5 && (
            <div className="p-3 bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-md border dark:border-lantern-border">
                <h3 className="text-sm font-medium text-lantern-text mb-2 flex items-center"><BookmarkIcon className="w-5 h-5 mr-1.5"/>Save Current Configuration as Preset</h3>
                <div className="flex gap-2">
                  <input type="text" value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Preset name..." className="flex-grow p-2 border border-lantern-border dark:border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text"/>
                  <button type="button" onClick={handleSaveCurrentAsPreset} disabled={!presetName.trim()} className="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 bg-lantern-primary hover:bg-lantern-primary-dark">Save</button>
                </div>
            </div>
          )}
        </form>
        </div>

        <div className={`flex-shrink-0 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mt-4 pt-4 border-t pb-[max(1rem,env(safe-area-inset-bottom))] ${mode === 'test' ? 'border-lantern-primary/30' : 'border-lantern-border'}`}>
          {mode !== 'game' && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={isSubmitDisabled()}
                className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/50 hover:bg-purple-200 dark:hover:bg-purple-900/70 border border-lantern-primary/40 rounded-md flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDownloading && <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin"/>}
                <CloudArrowDownIcon className="w-5 h-5 mr-2" />
                Download for Offline
              </button>
          )}
          <div className="flex flex-wrap justify-end gap-2 w-full sm:w-auto sm:flex-grow">
            {mode === 'game' && onSoloPractice && (
              <button
                type="button"
                onClick={() => onSoloPractice(getCurrentConfig())}
                className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-md disabled:opacity-50"
                disabled={isSubmitDisabled()}
              >
                Solo Practice
              </button>
            )}
            <button
                type="submit"
                className={`flex-1 sm:flex-none px-6 py-2 text-sm font-semibold text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-lg ${mode === 'test' ? 'bg-lantern-primary hover:bg-lantern-primary-dark' : mode === 'game' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                disabled={isSubmitDisabled()}
            >
                {mode === 'test' && <span className="text-lg mr-2">📝</span>}
                {mode === 'test' ? 'Start Test' : (mode === 'study' ? 'Start Study Session' : (challengeOpponent ? 'Send Challenge' : 'Send Challenge'))}
            </button>
          </div>
        </div>
    </Modal>
  );
};

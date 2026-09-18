


import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppIcon } from './ui/AppIcon';
import { TestSessionData, StudySessionData, TestQuestion, QuestionType, UserAnswerRecord, MatchingItem, DiagramLabel, type AnswerConfidence, type TestSessionKind } from '../types';
import VoiceInputButton from './VoiceInputButton';
import TestUtilityToolbar, { ToolType } from './TestUtilityToolbar';
import { ResolvedStorageImg } from './ui/ResolvedStorageImg';
import { nearestPreviousUnlockedIndex } from '../utils/helpers';
import { setStudyIntent } from '../services/presenceHeartbeat';
import {
  CONFIDENCE_CHOICES,
  canRevealAnswer,
  confidenceGate,
  confidenceOutcomeLabel,
  readConfidence,
} from '../utils/testConfidence';

interface TestTakingScreenProps {
  mode: 'test' | 'study';
  session: TestSessionData | StudySessionData;
  showExplanationsImmediately?: boolean;
  onUpdateAnswer: (questionId: string, answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>) => void; 
  onChangeQuestion: (newIndex: number) => void;
  onToggleBookmark: (questionId: string) => void;
  onSubmitTest?: () => void;
  onSubmitOfflineTest?: () => void;
  isSubmittingTest?: boolean;
  onEndSession?: () => void;
  onPauseSession: () => void;
  onCancelSession: () => void;
}

const formatTime = (totalSeconds: number): string => {
  if (totalSeconds < 0) totalSeconds = 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

/** Resolve countdown deadline — recovers when draft sync wiped endTime. */
function resolveSessionEndTime(
  session: TestSessionData | StudySessionData,
): Date | null {
  if (session.endTime) return new Date(session.endTime);
  // Prefer wall-clock recovery from start + duration so question changes / autosave
  // cannot re-anchor on a stale remainingTime snapshot.
  const duration = session.config?.timerDuration;
  if (duration && duration > 0 && session.startTime) {
    return new Date(new Date(session.startTime).getTime() + duration * 1000);
  }
  if (typeof session.remainingTime === 'number' && Number.isFinite(session.remainingTime)) {
    return new Date(Date.now() + Math.max(0, session.remainingTime) * 1000);
  }
  return null;
}

// FIX: Added a trailing comma to the generic type parameter to avoid being parsed as a JSX tag.
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

export const TestTakingScreen: React.FC<TestTakingScreenProps> = ({ 
  mode,
  session,
  showExplanationsImmediately = true,
  onUpdateAnswer,
  onChangeQuestion,
  onToggleBookmark,
  onSubmitTest,
  onSubmitOfflineTest,
  isSubmittingTest = false,
  onEndSession,
  onPauseSession,
  onCancelSession,
}) => {
  const [isReviewMode, setIsReviewMode] = useState(false);
  const currentQuestion = session.questions[session.currentQuestionIndex];
  // Exam lock: once answered + advanced, a question can't be returned to.
  const lockMode = mode === 'test' && session.config.lockAnsweredQuestions === true;
  const lockedIdSet = React.useMemo(
    () => new Set(session.lockedQuestionIds ?? []),
    [session.lockedQuestionIds]
  );
  const isLockedIndex = (index: number): boolean =>
    lockMode && lockedIdSet.has(session.questions[index]?.id);
  // In lock mode, "Previous" skips locked questions to reach the nearest earlier
  // OPEN (skipped/unanswered) one, so skipped questions stay reachable.
  const previousTargetIndex = lockMode
    ? nearestPreviousUnlockedIndex(session.questions.map((q) => q.id), lockedIdSet, session.currentQuestionIndex)
    : session.currentQuestionIndex - 1;

  useEffect(() => {
    setStudyIntent({
      context: 'testing',
      courseId: session.config.courseId || undefined,
      topic: session.title || session.config.groupName || undefined,
    });
    return () => setStudyIntent(null);
  }, [session.config.courseId, session.title, session.config.groupName]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (isReviewMode) return;

      if (event.key === 'ArrowLeft' && previousTargetIndex >= 0) {
        event.preventDefault();
        onChangeQuestion(previousTargetIndex);
        return;
      }
      if (event.key === 'ArrowRight' && session.currentQuestionIndex < session.questions.length - 1) {
        event.preventDefault();
        onChangeQuestion(session.currentQuestionIndex + 1);
        return;
      }
      // Number keys 1-9 jump to question palette (1-based)
      if (/^[1-9]$/.test(event.key)) {
        const idx = parseInt(event.key, 10) - 1;
        if (idx < session.questions.length) {
          event.preventDefault();
          onChangeQuestion(idx);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isReviewMode, session.currentQuestionIndex, session.questions.length, previousTargetIndex, onChangeQuestion]);
  const userAnswer = session.userAnswers[currentQuestion.id];
  const totalQuestions = session.questions.length;
  
  const [currentSelections, setCurrentSelections] = useState<string[]>([]);
  const [fillText, setFillText] = useState('');
  const [timeLeftDisplay, setTimeLeftDisplay] = useState<string | null>(null);
  const [isTimeLow, setIsTimeLow] = useState(false);
  const [matchSelections, setMatchSelections] = useState<Record<string, string>>({});
  const [shuffledAnswers, setShuffledAnswers] = useState<MatchingItem[] | DiagramLabel[]>([]);
  const [diagramSelections, setDiagramSelections] = useState<Record<string, string>>({});

  // ── Utility toolbar state ──────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<ToolType>(null);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showNote, setShowNote] = useState(false);
  // Per-question tool data (keyed by questionId)
  const [highlights, setHighlights] = useState<Record<string, Array<{ start: number; end: number }>>>({});
  const [struckOutOptions, setStruckOutOptions] = useState<Record<string, string[]>>({});
  const [questionNotes, setQuestionNotes] = useState<Record<string, string>>({});

  // ── Answer streak (study mode) ─────────────────────────────────────────────
  const [answerStreak, setAnswerStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [showStreakBadge, setShowStreakBadge] = useState(false);

  /**
   * Confidence before the reveal — practice attempts only (spec §9 #5).
   *
   * The gate has to live HERE rather than in the grading handler because that
   * handler reveals on the same call that records the answer (and, with "show
   * explanations immediately" on, does it the instant an option is tapped). So
   * a committed answer is HELD locally until the student says how sure they
   * were, and only then handed over — which is what makes this confidence
   * *before* the reveal rather than a survey after it.
   *
   * A timed exam attempt never reaches any of this: `commitAnswer` passes
   * straight through for `mode === 'test'`.
   */
  const [confidenceByQuestion, setConfidenceByQuestion] = useState<Record<string, AnswerConfidence>>({});
  const [heldAnswers, setHeldAnswers] = useState<
    Record<string, Partial<Omit<UserAnswerRecord, 'questionId'>>>
  >({});

  const sessionKind: TestSessionKind = mode === 'study' ? 'study' : 'test';

  const commitAnswer = (
    questionId: string,
    data: Partial<Omit<UserAnswerRecord, 'questionId'>> & { revealAnswer?: boolean }
  ) => {
    if (mode !== 'study') {
      onUpdateAnswer(questionId, data);
      return;
    }
    const already =
      confidenceByQuestion[questionId] ?? readConfidence(session.userAnswers[questionId]);
    const carriesAnswer = Boolean(
      data.selectedOptionIds || data.fillText || data.matchingAnswers || data.diagramAnswers
    );
    if (!already && carriesAnswer) {
      setHeldAnswers((prev) => ({ ...prev, [questionId]: { ...(prev[questionId] ?? {}), ...data } }));
      return;
    }
    onUpdateAnswer(questionId, already ? { ...data, confidence: already } : data);
  };

  const answerWithConfidence = (level: AnswerConfidence) => {
    const questionId = currentQuestion.id;
    const held = heldAnswers[questionId];
    setConfidenceByQuestion((prev) => ({ ...prev, [questionId]: level }));
    setHeldAnswers((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    onUpdateAnswer(questionId, {
      ...(held ?? {}),
      confidence: level,
      revealAnswer: true,
    } as Partial<Omit<UserAnswerRecord, 'questionId'>> & { revealAnswer?: boolean });
  };
  const prevIsCorrectRef = useRef<boolean | null | undefined>(undefined);

  const questionViewStartTimeRef = useRef<number | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const questionStemRef = useRef<HTMLParagraphElement>(null);
  /** Suppress mark click-to-remove when a drag-select just applied a highlight. */
  const highlightAppliedRef = useRef(false);

  // ── Track answer streak in study mode ─────────────────────────────────────
  useEffect(() => {
    if (mode !== 'study') return;
    const currentIsCorrect = userAnswer?.isCorrect;
    const prev = prevIsCorrectRef.current;
    // Only react when isCorrect transitions from undefined → true/false (i.e., answer graded)
    if (prev === undefined && currentIsCorrect !== undefined) {
      if (currentIsCorrect) {
        setAnswerStreak(s => {
          const next = s + 1;
          setBestStreak(b => Math.max(b, next));
          if (next >= 3) setShowStreakBadge(true);
          return next;
        });
      } else {
        setAnswerStreak(0);
      }
    }
    prevIsCorrectRef.current = currentIsCorrect;
  }, [mode, userAnswer?.isCorrect]);

  // Reset prevIsCorrect tracking when navigating to a new question
  useEffect(() => {
    prevIsCorrectRef.current = userAnswer?.isCorrect;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.currentQuestionIndex]);

  // Auto-hide streak badge after 2.5 s
  useEffect(() => {
    if (!showStreakBadge) return;
    const t = setTimeout(() => setShowStreakBadge(false), 2500);
    return () => clearTimeout(t);
  }, [showStreakBadge, answerStreak]);

  useEffect(() => {
    questionViewStartTimeRef.current = Date.now();
    setCurrentSelections(userAnswer?.selectedOptionIds || []);
    setFillText(userAnswer?.fillText || '');
    
    setMatchSelections(Object.fromEntries((userAnswer?.matchingAnswers || []).map(m => [m.promptItemId, m.answerItemId])));
    setDiagramSelections(Object.fromEntries((userAnswer?.diagramAnswers || []).map(d => [d.labelId, d.selectedLabelId])));
    
    if (currentQuestion.questionType === QuestionType.MATCHING && currentQuestion.matchingAnswerItems) {
        setShuffledAnswers(shuffleArray(currentQuestion.matchingAnswerItems));
    }
    if (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING && currentQuestion.diagramLabels) {
        setShuffledAnswers(shuffleArray(currentQuestion.diagramLabels));
    }

  }, [session.currentQuestionIndex, currentQuestion.id, userAnswer]);


  useEffect(() => {
    const endAt = resolveSessionEndTime(session);
    const isTimedSession = Boolean(endAt);
    // Auto-submit only applies to test mode (study is feedback-oriented / untimed by design).
    const canAutoSubmit =
      mode === 'test' && Boolean(onSubmitTest || onSubmitOfflineTest);

    if (!isTimedSession) {
      setTimeLeftDisplay(null);
      setIsTimeLow(false);
      return;
    }

    const totalDuration = session.config.timerDuration;
    const calculateTimeLeft = () => {
      const endTimeMs = endAt!.getTime();
      const diff = Math.round((endTimeMs - Date.now()) / 1000);

      if (totalDuration && diff > 0 && diff <= totalDuration * 0.1) {
        setIsTimeLow(true);
      } else {
        setIsTimeLow(false);
      }

      if (diff <= 0) {
        setTimeLeftDisplay(formatTime(0));
        if (canAutoSubmit) {
          if (session.isOffline && onSubmitOfflineTest) onSubmitOfflineTest();
          else if (!session.isOffline && onSubmitTest) onSubmitTest();
        }
        return 0;
      }
      setTimeLeftDisplay(formatTime(diff));
      return diff;
    };

    if (calculateTimeLeft() <= 0) return;

    const timerId = setInterval(() => {
      if (calculateTimeLeft() <= 0) {
        clearInterval(timerId);
      }
    }, 1000);

    return () => clearInterval(timerId);
  }, [
    mode,
    session.endTime,
    session.remainingTime,
    session.startTime,
    session.config.timerDuration,
    onSubmitTest,
    onSubmitOfflineTest,
    session.isOffline,
    session.currentQuestionIndex,
  ]);
  
  useEffect(() => {
    const container = paletteRef.current;
    if (!container) return;
    const currentButton = container.querySelector(`[data-qindex="${session.currentQuestionIndex}"]`) as HTMLElement | null;
    if (!currentButton) return;
    // Horizontal-only scroll — avoid scrollIntoView, which can scroll overflow-hidden
    // AppShell ancestors and clip the timer / pause / cancel header out of view.
    const targetLeft =
      currentButton.offsetLeft - container.clientWidth / 2 + currentButton.offsetWidth / 2;
    container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }, [session.currentQuestionIndex]);

  const handleInitiateSubmit = () => {
    if (mode === 'test') {
      setIsReviewMode(true);
    }
  };

  const handleOptionSelect = (optionId: string) => {
    if (mode === 'study' && userAnswer?.isCorrect !== undefined) {
      return;
    }

    const newSelections = [optionId];
    setCurrentSelections(newSelections);

    const timeSpentSeconds = questionViewStartTimeRef.current 
      ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
      : undefined;
    commitAnswer(currentQuestion.id, { selectedOptionIds: newSelections, timeSpentSeconds });
  };
  
  const handleMultiOptionSelect = (optionId: string) => {
    if (mode === 'study' && userAnswer?.isCorrect !== undefined) {
        return;
    }
    const newSelections = currentSelections.includes(optionId)
        ? currentSelections.filter(id => id !== optionId)
        : [...currentSelections, optionId];
    
    setCurrentSelections(newSelections);

    if(mode === 'test') {
        const timeSpentSeconds = questionViewStartTimeRef.current 
            ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
            : undefined;
        commitAnswer(currentQuestion.id, { selectedOptionIds: newSelections, timeSpentSeconds });
    }
  };

  const handleFillTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (mode === 'study' && userAnswer?.isCorrect !== undefined) {
        return;
    }
    const newText = e.target.value;
    setFillText(newText);

    if (mode === 'test') {
        const timeSpentSeconds = questionViewStartTimeRef.current 
            ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
            : undefined;
        commitAnswer(currentQuestion.id, { fillText: newText, timeSpentSeconds });
    }
  };

  const submitFillTextAnswer = () => {
    if (mode !== 'study' || userAnswer?.isCorrect !== undefined) return;
    
    const timeSpentSeconds = questionViewStartTimeRef.current 
        ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
        : undefined;
    commitAnswer(currentQuestion.id, { fillText, timeSpentSeconds });
  };

  const submitMultiSelectAnswer = () => {
    if (mode === 'study' && userAnswer?.isCorrect === undefined) {
        const timeSpentSeconds = questionViewStartTimeRef.current 
            ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
            : undefined;
        commitAnswer(currentQuestion.id, { selectedOptionIds: currentSelections, timeSpentSeconds });
    }
  };

  const handleMatchSelect = (promptItemId: string, answerItemId: string) => {
      if (mode === 'study' && userAnswer?.isCorrect !== undefined) return;

      const newMatchSelections = {
          ...matchSelections,
          [promptItemId]: answerItemId,
      };
      setMatchSelections(newMatchSelections);

      if (mode === 'test') {
          const matchingAnswers = Object.entries(newMatchSelections)
            .filter(([, answerId]) => answerId) // only include answered ones
            .map(([promptId, answerId]) => ({ promptItemId: promptId, answerItemId: answerId }));
          
          const timeSpentSeconds = questionViewStartTimeRef.current 
              ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
              : undefined;
          
          commitAnswer(currentQuestion.id, { matchingAnswers, timeSpentSeconds });
      }
  };
  
  const submitMatchingAnswer = () => {
      if (mode !== 'study' || userAnswer?.isCorrect !== undefined) return;
      
      const matchingAnswers = Object.entries(matchSelections)
          .map(([promptItemId, answerItemId]) => ({ promptItemId, answerItemId }));
          
      const timeSpentSeconds = questionViewStartTimeRef.current 
          ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
          : undefined;
          
      commitAnswer(currentQuestion.id, { matchingAnswers, timeSpentSeconds });
  };

  const handleDiagramLabelSelect = (labelId: string, selectedLabelId: string) => {
    if (mode === 'study' && userAnswer?.isCorrect !== undefined) return;
    
    const newDiagramSelections = {...diagramSelections, [labelId]: selectedLabelId};
    setDiagramSelections(newDiagramSelections);

    if(mode === 'test') {
        const diagramAnswers = Object.entries(newDiagramSelections)
            .filter(([,selId]) => selId)
            .map(([lblId, selId]) => ({labelId: lblId, selectedLabelId: selId}));
        
        const timeSpentSeconds = questionViewStartTimeRef.current 
              ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
              : undefined;
        commitAnswer(currentQuestion.id, { diagramAnswers, timeSpentSeconds });
    }
  };

  const submitDiagramAnswer = () => {
    if (mode !== 'study' || userAnswer?.isCorrect !== undefined) return;
    const diagramAnswers = Object.entries(diagramSelections)
            .map(([labelId, selectedLabelId]) => ({labelId, selectedLabelId}));

    const timeSpentSeconds = questionViewStartTimeRef.current 
            ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
            : undefined;
            
    commitAnswer(currentQuestion.id, { diagramAnswers, timeSpentSeconds });
  };

  // ── Highlight helpers ──────────────────────────────────────────────────────

  const applyHighlightFromSelection = useCallback(() => {
    if (activeTool !== 'highlight') return;
    const stem = questionStemRef.current;
    const selection = window.getSelection();
    if (!stem || !selection || selection.isCollapsed || selection.rangeCount === 0) return;

    let range: Range;
    try {
      range = selection.getRangeAt(0);
    } catch {
      return;
    }

    // Selection must intersect the question stem (mouseup may land outside the <p>).
    const startInStem = stem.contains(range.startContainer) || stem === range.startContainer;
    const endInStem = stem.contains(range.endContainer) || stem === range.endContainer;
    if (!startInStem && !endInStem) return;

    try {
      const clipped = range.cloneRange();
      if (!startInStem) clipped.setStart(stem, 0);
      if (!endInStem) clipped.setEnd(stem, stem.childNodes.length);

      const preRange = document.createRange();
      preRange.selectNodeContents(stem);
      preRange.setEnd(clipped.startContainer, clipped.startOffset);
      const start = preRange.toString().length;
      const end = start + clipped.toString().length;
      if (start >= end) return;

      highlightAppliedRef.current = true;
      setHighlights(prev => {
        const existing = prev[currentQuestion.id] || [];
        // Ignore exact duplicate ranges
        if (existing.some(r => r.start === start && r.end === end)) return prev;
        return {
          ...prev,
          [currentQuestion.id]: [...existing, { start, end }],
        };
      });
      selection.removeAllRanges();
      window.setTimeout(() => {
        highlightAppliedRef.current = false;
      }, 0);
    } catch {
      // Range APIs can throw if the DOM shifted mid-selection; ignore quietly.
    }
  }, [activeTool, currentQuestion.id]);

  // Listen on document so releasing the pointer slightly outside the stem still applies.
  useEffect(() => {
    if (activeTool !== 'highlight') return;
    const onPointerUp = () => {
      requestAnimationFrame(() => applyHighlightFromSelection());
    };
    document.addEventListener('pointerup', onPointerUp);
    return () => document.removeEventListener('pointerup', onPointerUp);
  }, [activeTool, applyHighlightFromSelection]);

  const removeHighlightRange = useCallback(
    (target: { start: number; end: number }) => {
      if (highlightAppliedRef.current) return;
      setHighlights(prev => ({
        ...prev,
        [currentQuestion.id]: (prev[currentQuestion.id] || []).filter(
          // Drop any stored slice that overlaps the clicked (merged) mark
          r => r.end <= target.start || r.start >= target.end
        ),
      }));
    },
    [currentQuestion.id]
  );

  const renderHighlightedText = (text: string, ranges: Array<{ start: number; end: number }>) => {
    if (!ranges.length) return text;

    // Sort and merge overlapping ranges
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const h of sorted) {
      if (merged.length && h.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, h.end);
      } else {
        merged.push({ ...h });
      }
    }

    const segments: React.ReactNode[] = [];
    let lastIndex = 0;
    merged.forEach((h, i) => {
      const s = Math.max(0, Math.min(h.start, text.length));
      const e = Math.max(0, Math.min(h.end, text.length));
      if (s > lastIndex) segments.push(<span key={`t-${i}`}>{text.slice(lastIndex, s)}</span>);
      if (s < e) {
        segments.push(
          <mark
            key={`h-${i}`}
            className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded-sm cursor-pointer"
            title="Click to remove highlight"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              removeHighlightRange(h);
            }}
          >
            {text.slice(s, e)}
          </mark>
        );
      }
      lastIndex = Math.max(lastIndex, e);
    });
    if (lastIndex < text.length) segments.push(<span key="t-end">{text.slice(lastIndex)}</span>);
    return <>{segments}</>;
  };

  // ── Strikeout helper ───────────────────────────────────────────────────────

  const handleStrikeoutOption = (optionId: string) => {
    setStruckOutOptions(prev => {
      const current = prev[currentQuestion.id] || [];
      return {
        ...prev,
        [currentQuestion.id]: current.includes(optionId)
          ? current.filter(id => id !== optionId)
          : [...current, optionId],
      };
    });
  };


  const renderOptions = (question: TestQuestion, currentAnswerRecord?: UserAnswerRecord) => {
    if (!question.options) return null;

    const isMultiChoice = question.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE;
    const isStudyModeAnswered = mode === 'study' && currentAnswerRecord?.isCorrect !== undefined;
    const struckForQuestion = struckOutOptions[question.id] || [];
    
    // Strip any baked-in letter prefix (e.g. "A. ", "B) ", "(C) ") so shuffled
    // options always show a fresh label that matches their current render position.
    const stripPrefix = (text: string) =>
      text.replace(/^\s*[\(\[]?[A-Za-z][\)\]\.]\s*/, '');

    return question.options.map((opt, optIdx) => {
      const displayLetter = String.fromCharCode(65 + optIdx); // A, B, C …
      const displayText = stripPrefix(opt.text);
      let optionClasses = "p-2 sm:p-3 border rounded-lg hover:bg-lantern-background-secondary dark:border-lantern-border dark:hover:bg-lantern-surface-secondary/70 transition-colors text-lantern-text";
      let icon = null;
      const isSelected = currentSelections.includes(opt.id);
      const isCorrectOption = question.correctAnswerIds?.includes(opt.id);
      const isStruckOut = !isStudyModeAnswered && struckForQuestion.includes(opt.id);

      if (!isStudyModeAnswered) {
          optionClasses += activeTool === 'strikeout' ? " cursor-pointer" : " cursor-pointer";
          if (isSelected && !isStruckOut) {
            optionClasses = `${optionClasses} bg-lantern-primary-background dark:bg-lantern-primary-dark/60 border-lantern-primary dark:border-lantern-primary ring-2 ring-lantern-primary dark:ring-lantern-primary`; 
          }
          if (isStruckOut) {
            optionClasses = `${optionClasses} opacity-40 dark:opacity-30 border-red-300 dark:border-red-700`;
          }
      } else { 
          optionClasses += " cursor-default";
          if (isCorrectOption) {
              optionClasses = `${optionClasses} bg-green-100 dark:bg-green-900/40 border-green-500 dark:border-green-600 text-green-700 dark:text-green-300`;
              icon = <AppIcon name="checkmark-circle" size={16} className="ml-auto text-green-600 dark:text-green-400" />;
          } else if (isSelected && !isCorrectOption) {
              optionClasses = `${optionClasses} bg-red-100 dark:bg-red-900/40 border-red-500 dark:border-red-600 text-red-700 dark:text-red-300`;
              icon = <AppIcon name="close-circle" size={16} className="ml-auto text-red-600 dark:text-red-400" />;
          } else {
              optionClasses = `${optionClasses} opacity-70 dark:opacity-60`;
          }
      }

      const handleClick = () => {
        if (isStudyModeAnswered) return;
        if (activeTool === 'strikeout') {
          handleStrikeoutOption(opt.id);
        } else {
          isMultiChoice ? handleMultiOptionSelect(opt.id) : handleOptionSelect(opt.id);
        }
      };

      return (
        <li
          key={opt.id}
          onClick={handleClick}
          className={`flex items-center ${optionClasses}`}
          aria-checked={isSelected}
          role={isMultiChoice ? "checkbox" : "radio"} 
          tabIndex={isStudyModeAnswered ? -1 : 0} 
          onKeyDown={isStudyModeAnswered ? undefined : (e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
        >
          {isMultiChoice && <input type="checkbox" checked={isSelected} readOnly className="h-3.5 w-3.5 sm:h-4 sm:w-4 rounded text-lantern-primary border-lantern-border focus:ring-lantern-primary mr-2 sm:mr-3" />}
          <span className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-full border border-current flex items-center justify-center text-label tracking-normal sm:text-caption font-bold mr-2 sm:mr-3 select-none">
            {displayLetter}
          </span>
          <span className={`text-xs sm:text-sm font-medium flex-grow ${isStruckOut ? 'line-through' : ''}`}>{displayText}</span>
          {isStruckOut && !isStudyModeAnswered && (
            <span className="ml-auto text-xs text-red-400 dark:text-red-500 font-medium select-none">✕</span>
          )}
          {icon}
        </li>
      );
    });
  };
  
  // Mode-specific theming
  const genericHeaderText = mode === 'test'
    ? (session.isOffline ? 'Offline Test' : 'Test in Progress')
    : (session.isOffline ? 'Offline Study' : 'Study Session');
  /**
   * The BREADCRUMB-TITLE the StudyFetch reference puts here (2026-09-17
   * measurement, §Pre-assessment): the name of the thing being taken, not the
   * name of the activity. "Pre-assessment · Cell biology" tells a student which
   * of their three open checks this is; "Test in Progress" told them only that
   * they were, in fact, taking a test.
   *
   * The session's own title wins when it has one, and the generic string stays
   * as the fallback — a session built on the fly (a group test, a quick study
   * run) genuinely has no better name, and "Untitled" would be worse than
   * saying what kind of screen this is. The mode/offline distinction is not
   * lost: it moves to the subtitle line below, which already carries the rules.
   */
  const sessionTitle = (session.title || '').trim();
  const headerText = sessionTitle || genericHeaderText;

  /**
   * How far through, as the reference's percentage.
   *
   * ANSWERED, not "questions I have scrolled past": `Q 3/10` already says where
   * the cursor is, and repeating that as a percentage would be the same fact
   * twice. What a student cannot see from the counter is how much of the paper
   * is actually done, which is the number that tells them whether they can
   * submit. Same predicate as the review screen's `answeredCount`, so the bar
   * and the review cannot disagree about what counts as answered.
   */
  const answeredSoFar = Object.values(session.userAnswers).filter((ans: UserAnswerRecord) => (
    (ans.selectedOptionIds && ans.selectedOptionIds.length > 0) ||
    (ans.fillText && ans.fillText.trim() !== '') ||
    (ans.matchingAnswers && ans.matchingAnswers.length > 0) ||
    (ans.diagramAnswers && ans.diagramAnswers.length > 0)
  )).length;
  const answeredPercent = totalQuestions === 0
    ? 0
    : Math.round((answeredSoFar / totalQuestions) * 100);

  const isCurrentBookmarked = userAnswer?.isBookmarked || false;

  if (isReviewMode && mode === 'test') {
    const answeredCount = Object.values(session.userAnswers).filter((ans: UserAnswerRecord) => {
        return (ans.selectedOptionIds && ans.selectedOptionIds.length > 0) ||
               (ans.fillText && ans.fillText.trim() !== "") ||
               (ans.matchingAnswers && ans.matchingAnswers.length > 0) ||
               (ans.diagramAnswers && ans.diagramAnswers.length > 0);
    }).length;

    const skippedCount = totalQuestions - answeredCount;
    const bookmarkedCount = Object.values(session.userAnswers).filter((ans: UserAnswerRecord) => ans.isBookmarked).length;

    const handleQuestionSelect = (index: number) => {
        if (isLockedIndex(index)) return; // locked questions can't be reopened from the review list
        onChangeQuestion(index);
        setIsReviewMode(false);
    };
    
    const finalSubmitAction = session.isOffline ? onSubmitOfflineTest : onSubmitTest;

    return (
        <div className="flex-1 flex flex-col bg-lantern-background text-lantern-text p-4 md:p-6">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl md:text-3xl font-semibold text-lantern-text">Review Your Answers</h1>
                {timeLeftDisplay && (
                    <div className={`flex items-center text-sm font-medium px-3 py-1 rounded-full transition-colors ${isTimeLow ? 'text-white bg-red-600 animate-pulse' : 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50'}`}>
                        <AppIcon name="time" size={20} className="mr-1.5" />
                        Time Remaining: {timeLeftDisplay}
                    </div>
                )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 text-center">
                <div className="bg-lantern-surface p-4 rounded-lg shadow">
                    <p className="text-sm text-lantern-text-secondary">Answered</p>
                    <p className="text-2xl font-bold text-green-500">{answeredCount}</p>
                </div>
                <div className="bg-lantern-surface p-4 rounded-lg shadow">
                    <p className="text-sm text-lantern-text-secondary">Skipped</p>
                    <p className="text-2xl font-bold text-yellow-500">{skippedCount}</p>
                </div>
                <div className="bg-lantern-surface p-4 rounded-lg shadow">
                    <p className="text-sm text-lantern-text-secondary">Bookmarked</p>
                    <p className="text-2xl font-bold text-lantern-primary">{bookmarkedCount}</p>
                </div>
            </div>

            <div className="bg-lantern-surface p-4 rounded-lg shadow mb-6 flex-grow overflow-y-auto">
                <h2 className="text-lg font-semibold mb-3">Questions</h2>
                <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2">
                    {session.questions.map((q, index) => {
                        const answerRecord = session.userAnswers[q.id];
                        const isAnswered = answerRecord && ((answerRecord.selectedOptionIds && answerRecord.selectedOptionIds.length > 0) || (answerRecord.fillText && answerRecord.fillText.trim() !== "") || (answerRecord.matchingAnswers && answerRecord.matchingAnswers.length > 0) || (answerRecord.diagramAnswers && answerRecord.diagramAnswers.length > 0));
                        const isBookmarked = !!answerRecord?.isBookmarked;
                        const isLocked = lockMode && lockedIdSet.has(q.id);

                        let buttonClasses = "h-10 w-10 text-sm font-medium rounded-md flex items-center justify-center relative transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-lantern-surface";
                        if (isLocked) {
                            buttonClasses += " bg-lantern-border/60 text-lantern-text-tertiary cursor-not-allowed opacity-70";
                        } else if (isAnswered) {
                            buttonClasses += " bg-green-500 text-white hover:bg-green-600";
                        } else {
                            buttonClasses += " bg-lantern-border dark:bg-lantern-surface-secondary text-lantern-text hover:bg-lantern-border dark:hover:bg-lantern-border";
                        }
                        if (isBookmarked && !isLocked) {
                            buttonClasses += " ring-2 ring-lantern-primary dark:ring-lantern-primary";
                        }

                        return (
                            <button key={q.id} onClick={() => handleQuestionSelect(index)} disabled={isLocked} aria-disabled={isLocked} className={buttonClasses} aria-label={isLocked ? `Question ${q.questionNumber} (locked)` : `Go to question ${q.questionNumber}`}>
                                {isLocked ? (
                                    <AppIcon name="lock-closed" size={16} aria-hidden="true" />
                                ) : (
                                  <>
                                    {isBookmarked && <AppIcon name="bookmark" size={12} filled className="absolute top-1 right-1 text-lantern-primary" />}
                                    {q.questionNumber}
                                  </>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
            
            <div className="bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-r-lg mb-6 flex items-start" role="alert">
                <AppIcon name="warning" size={24} className="mr-3 flex-shrink-0" />
                <div>
                  <p className="font-bold">Final Submission Warning</p>
                  <p className="text-sm">Once you submit, you will not be able to change your answers. Please review your questions carefully.</p>
                </div>
            </div>

            <div className="flex-shrink-0 flex justify-between items-center">
                <button onClick={() => setIsReviewMode(false)} className="px-6 py-3 bg-lantern-border hover:bg-lantern-border text-white rounded-md flex items-center">
                    <AppIcon name="arrow-back" size={20} className="mr-2" />
                    Return to Test
                </button>
                <button
                    onClick={finalSubmitAction}
                    disabled={isSubmittingTest}
                    className={`px-6 py-3 text-white rounded-md flex items-center font-semibold ${isSubmittingTest ? 'bg-red-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
                >
                    {isSubmittingTest ? 'Submitting...' : 'Confirm & Submit Test'} <AppIcon name="checkmark-circle" size={20} className="ml-2" />
                </button>
            </div>
        </div>
    );
  }


  if (!currentQuestion) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-lantern-background text-lantern-text">
        <p>Error: Question not found. This should not happen.</p>
        {onEndSession && <button onClick={onEndSession} className="mt-4 px-4 py-2 bg-lantern-border hover:bg-lantern-border dark:bg-lantern-surface-secondary dark:hover:bg-lantern-border text-white rounded-md">End Session</button>}
      </div>
    );
  }

  const finalSubmitAction = session.isOffline ? onSubmitOfflineTest : onSubmitTest;
  const isStudyModeAnswered = mode === 'study' && userAnswer?.isCorrect !== undefined;
  const heldAnswer = heldAnswers[currentQuestion.id];
  // A draft can be held locally (waiting on the confidence gate) as well as
  // recorded on the session, and both count as "they have committed".
  const hasStudyAnswerDraft = mode === 'study' && !isStudyModeAnswered && (
    Boolean(heldAnswer) || !!(
      userAnswer?.selectedOptionIds?.length ||
      userAnswer?.fillText ||
      userAnswer?.matchingAnswers?.length ||
      userAnswer?.diagramAnswers?.length
    )
  );
  const recordedConfidence =
    confidenceByQuestion[currentQuestion.id] ?? readConfidence(userAnswer);
  const gate = confidenceGate({
    sessionKind,
    hasDraftAnswer: hasStudyAnswerDraft,
    isRevealed: isStudyModeAnswered,
    recorded: recordedConfidence,
  });
  const confidenceLine = confidenceOutcomeLabel(recordedConfidence, userAnswer?.isCorrect);

  const handleCheckStudyAnswer = () => {
    onUpdateAnswer(currentQuestion.id, { revealAnswer: true } as Partial<Omit<UserAnswerRecord, 'questionId'>> & { revealAnswer?: boolean });
  };

  // Mode-specific theme colors
  const modeTheme = mode === 'study'
    ? {
        bgGradient: 'bg-gradient-to-b from-lantern-primary-background to-lantern-background dark:from-lantern-primary-background dark:to-lantern-background',
        headerBorder: 'border-blue-200 dark:border-blue-800',
        infoBannerSubtext: 'text-lantern-primary',
      }
    : {
        bgGradient: 'bg-gradient-to-b from-lantern-primary-background to-lantern-background dark:from-lantern-primary-background dark:to-lantern-background',
        headerBorder: 'border-purple-200 dark:border-purple-800',
        infoBannerSubtext: 'text-lantern-primary',
      };

  return (
    <div className={`flex-1 min-h-0 flex flex-col ${modeTheme.bgGradient} text-lantern-text relative`}>

      {/* ── Answer Streak Badge (study mode) ── */}
      {mode === 'study' && showStreakBadge && answerStreak >= 3 && (
        <div
          key={answerStreak}
          className="absolute top-4 right-4 z-50 pointer-events-none"
          style={{ animation: 'streakPop 0.4s ease-out' }}
        >
          <style>{`
            @keyframes streakPop {
              0% { transform: scale(0.5) translateY(-10px); opacity: 0; }
              60% { transform: scale(1.15) translateY(0); opacity: 1; }
              100% { transform: scale(1) translateY(0); opacity: 1; }
            }
          `}</style>
          <div className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full px-4 py-2 shadow-lg">
            <span className="text-xl">🔥</span>
            <div className="leading-tight">
              <p className="text-sm font-bold">{answerStreak} in a row!</p>
              {answerStreak >= 10 && <p className="text-xs text-orange-100">Legendary!</p>}
              {answerStreak >= 5 && answerStreak < 10 && <p className="text-xs text-orange-100">On fire!</p>}
              {answerStreak < 5 && <p className="text-xs text-orange-100">Keep it up!</p>}
            </div>
          </div>
        </div>
      )}

      {/* Slim sticky session chrome — maximize Q&A viewport below */}
      <div className={`shrink-0 z-20 px-2 py-1.5 sm:px-4 sm:py-2 border-b ${modeTheme.headerBorder} bg-inherit`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="text-base sm:text-lg shrink-0" aria-hidden="true">
              {mode === 'study' ? '📚' : '📝'}
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 min-w-0">
                <h1
                  className={`text-sm sm:text-base font-semibold truncate ${
                    mode === 'study'
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-purple-700 dark:text-purple-300'
                  }`}
                >
                  {headerText}
                </h1>
                <span className="text-[11px] sm:text-xs text-lantern-text-secondary whitespace-nowrap tabular-nums">
                  Q {session.currentQuestionIndex + 1}/{totalQuestions}
                </span>
                <span
                  className="text-[11px] sm:text-xs text-lantern-text-secondary whitespace-nowrap tabular-nums"
                  aria-label={`${answeredPercent} percent answered`}
                >
                  {answeredPercent}% done
                </span>
                {lockMode && (
                  <span
                    className="inline-flex items-center gap-1 text-label tracking-normal sm:text-caption font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                    title="Locked mode: once you answer a question and move on, you can't return to it."
                  >
                    <AppIcon name="lock-closed" size={12} aria-hidden="true" />
                    Locked
                  </span>
                )}
              </div>
              <p className={`hidden sm:block text-[11px] leading-tight truncate ${modeTheme.infoBannerSubtext}`}>
                {/* When the title took the heading, the activity name moves
                    here so "which screen am I on" is still answered. */}
                {sessionTitle ? `${genericHeaderText} · ` : ''}
                {mode === 'study'
                  ? timeLeftDisplay
                    ? 'Timed · Instant feedback · Not recorded'
                    : 'No timer · Instant feedback · Not recorded'
                  : 'Timed · Results recorded · Answers at end'}
              </p>
            </div>
          </div>
          <div className="flex items-center shrink-0 gap-1 sm:gap-1.5">
            {timeLeftDisplay && (
              <div
                className={`flex items-center tabular-nums text-xs sm:text-sm font-bold px-2 py-1 sm:px-2.5 sm:py-1 rounded-md border ${
                  isTimeLow
                    ? 'text-white bg-red-600 border-red-700 animate-pulse'
                    : 'text-lantern-text bg-lantern-surface border-lantern-primary dark:bg-lantern-surface-secondary dark:text-lantern-text dark:border-lantern-primary'
                }`}
                aria-live="polite"
                aria-label={`Time remaining ${timeLeftDisplay}`}
                title="Time remaining"
              >
                <AppIcon name="time" size={14} className={`mr-1 shrink-0 ${
 isTimeLow ? 'text-white' : 'text-lantern-primary'
 }`} />
                <span>{timeLeftDisplay}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onPauseSession}
              className="p-1 sm:p-1.5 rounded-full hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary text-lantern-text-secondary"
              aria-label="Pause Session"
              title="Pause & Exit Session"
            >
              <AppIcon name="pause" size={16} />
            </button>
            <button
              type="button"
              onClick={onCancelSession}
              className="p-1 sm:p-1.5 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400"
              aria-label="Cancel Session"
              title="Cancel & Exit Session"
            >
              <AppIcon name="close" size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Pinned exam tools — stay visible while question content scrolls */}
      <div className="shrink-0 z-10 px-2 sm:px-4 md:px-6 pt-1.5 sm:pt-2 bg-inherit">
        <TestUtilityToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          showCalculator={showCalculator}
          onToggleCalculator={() => setShowCalculator(v => !v)}
          showNote={showNote}
          onToggleNote={() => setShowNote(v => !v)}
          note={questionNotes[currentQuestion.id] || ''}
          onNoteChange={text =>
            setQuestionNotes(prev => ({ ...prev, [currentQuestion.id]: text }))
          }
          isBookmarked={isCurrentBookmarked}
          onToggleBookmark={() => onToggleBookmark(currentQuestion.id)}
          highlightCount={(highlights[currentQuestion.id] || []).length}
          onClearHighlights={() =>
            setHighlights(prev => ({ ...prev, [currentQuestion.id]: [] }))
          }
        />
      </div>

      {/* Scrollable question + answers — primary content owner */}
      <div className="flex-1 min-h-0 px-2 sm:px-4 md:px-6 pt-1.5 sm:pt-2 pb-2 overflow-y-auto overscroll-y-contain">
        <div className="bg-lantern-surface p-3 sm:p-4 md:p-5 rounded-lg shadow-md mb-2 sm:mb-3">
            <div className="flex justify-between items-start mb-1 gap-2">
                <h2 id={`question-stem-${currentQuestion.id}`} className="text-base sm:text-lg md:text-xl font-semibold text-lantern-text">
                    Question {currentQuestion.questionNumber}:
                </h2>
            </div>
            <p
              ref={questionStemRef}
              className={`text-body md:text-heading mb-3 sm:mb-4 whitespace-pre-wrap text-lantern-text ${
                activeTool === 'highlight'
                  ? 'cursor-text select-text'
                  : 'select-none'
              }`}
              style={activeTool === 'highlight' ? { userSelect: 'text', WebkitUserSelect: 'text' } : undefined}
            >
              {renderHighlightedText(
                currentQuestion.questionStem,
                highlights[currentQuestion.id] || []
              )}
            </p>
             {currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE && <p className="text-xs text-lantern-text-secondary mb-4">(Select all that apply)</p>}
             {currentQuestion.questionType === QuestionType.MATCHING && <p className="text-xs text-lantern-text-secondary mb-4">(Match each prompt to the correct answer)</p>}
             {currentQuestion.questionType === QuestionType.DIAGRAM_LABELING && <p className="text-xs text-lantern-text-secondary mb-4">(Select the correct label for each pin from the dropdown menu)</p>}

            {currentQuestion.imageUrl && currentQuestion.questionType !== QuestionType.DIAGRAM_LABELING && (
                <div className="my-3 w-full max-w-xl mx-auto">
                    <ResolvedStorageImg
                        src={currentQuestion.imageUrl}
                        alt="Question visual"
                        className="w-full h-auto max-h-[50vh] sm:max-h-[60vh] object-contain rounded-md border border-lantern-border shadow"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                </div>
            )}

            {currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK && (
              <div className="mt-4 relative">
                <input
                  type="text"
                  value={fillText}
                  onChange={handleFillTextChange}
                  onBlur={handleFillTextChange} // Ensures answer is saved in test mode if user clicks away
                  placeholder="Type your answer here..."
                  className="w-full p-3 pr-12 border border-lantern-border rounded-lg shadow-sm focus:ring-2 focus:ring-lantern-primary dark:focus:ring-lantern-primary focus:border-transparent transition bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text disabled:bg-lantern-background-secondary dark:disabled:bg-lantern-surface-secondary/50"
                  disabled={isStudyModeAnswered}
                  aria-label="Answer input for fill-in-the-blank question"
                />
                <VoiceInputButton
                    className="absolute top-1/2 right-2 -translate-y-1/2"
                    onTranscriptUpdate={(text) => setFillText(prev => prev + text)}
                    disabled={isStudyModeAnswered}
                />
                {mode === 'study' && !isStudyModeAnswered && (
                  <div className="mt-4 text-right">
                    <button 
                        onClick={submitFillTextAnswer}
                        className="px-3 py-1.5 sm:px-4 sm:py-2 bg-green-500 hover:bg-green-600 text-white rounded-md text-xs sm:text-sm font-semibold disabled:opacity-50"
                        disabled={!fillText.trim()}
                    >
                        Submit Answer
                    </button>
                  </div>
                )}
              </div>
            )}

            {[QuestionType.MULTIPLE_CHOICE_SINGLE, QuestionType.TRUE_FALSE, QuestionType.MULTIPLE_CHOICE_MULTIPLE].includes(currentQuestion.questionType!) && (
              <ul className="space-y-2 sm:space-y-3" role={currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE ? "group" : "radiogroup"} aria-labelledby={`question-stem-${currentQuestion.id}`}>
                  {renderOptions(currentQuestion, userAnswer)}
              </ul>
            )}
            
            {currentQuestion.questionType === QuestionType.MATCHING && (
                <div className="mt-4 space-y-3">
                    {currentQuestion.matchingPromptItems?.map(prompt => {
                        const correctMatch = isStudyModeAnswered ? currentQuestion.correctMatches?.find(m => m.promptItemId === prompt.id) : undefined;
                        const userSelectionId = matchSelections[prompt.id];
                        const isMatchCorrect = correctMatch?.answerItemId === userSelectionId;

                        let promptFeedbackClass = '';
                        if (isStudyModeAnswered) {
                            promptFeedbackClass = isMatchCorrect ? 'border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-900/30' : 'border-red-400 dark:border-red-500 bg-red-50 dark:bg-red-900/30';
                        }

                        return (
                            <div key={prompt.id} className={`p-3 border rounded-lg ${promptFeedbackClass}`}>
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                    <p className="flex-1 font-medium text-lantern-text">{prompt.text}</p>
                                    <div className="flex-shrink-0 w-full sm:w-1/2 md:w-5/12">
                                        <select
                                            value={matchSelections[prompt.id] || ""}
                                            onChange={e => handleMatchSelect(prompt.id, e.target.value)}
                                            disabled={isStudyModeAnswered}
                                            className="w-full p-2 border border-lantern-border rounded-md shadow-sm bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary disabled:opacity-70 disabled:cursor-not-allowed"
                                        >
                                            <option value="" disabled>Select a match...</option>
                                            {(shuffledAnswers as MatchingItem[]).map(ans => (
                                                <option key={ans.id} value={ans.id}>{ans.text}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                {isStudyModeAnswered && !isMatchCorrect && (
                                    <div className="mt-2 text-xs flex items-center text-green-700 dark:text-green-300">
                                        <AppIcon name="checkmark-circle" size={16} className="mr-1" />
                                        Correct answer: <span className="font-semibold ml-1">{(shuffledAnswers as MatchingItem[]).find(a => a.id === correctMatch?.answerItemId)?.text || 'N/A'}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {currentQuestion.questionType === QuestionType.DIAGRAM_LABELING && (
              <div className="mt-4">
                  <div className="relative w-full max-w-xl mx-auto border-2 border-lantern-border rounded-lg overflow-hidden">
                      <ResolvedStorageImg src={currentQuestion.imageUrl} alt="Diagram to label" className="w-full h-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      {currentQuestion.diagramLabels?.map((label, index) => (
                          <div 
                              key={label.id} 
                              className="absolute -translate-x-1/2 -translate-y-1/2" 
                              style={{ left: `${label.x}%`, top: `${label.y}%` }}
                          >
                              <div className="relative flex items-center justify-center w-7 h-7 bg-red-600 text-white font-bold text-sm rounded-full shadow-lg ring-2 ring-white">
                                  {index + 1}
                              </div>
                          </div>
                      ))}
                  </div>
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {currentQuestion.diagramLabels?.map((label, index) => {
                          const userSelectionId = diagramSelections[label.id];
                          const isCorrect = userSelectionId === label.id;
                          let dropdownFeedbackClass = 'border-lantern-border';
                          if (isStudyModeAnswered) {
                            dropdownFeedbackClass = isCorrect ? 'border-green-500 bg-green-50 dark:bg-green-900/30' : 'border-red-500 bg-red-50 dark:bg-red-900/30';
                          }
                          return (
                            <div key={label.id} className="flex items-center space-x-3">
                                <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-red-600 text-white font-bold text-xs rounded-full">{index + 1}</div>
                                <select 
                                    value={userSelectionId || ''}
                                    onChange={(e) => handleDiagramLabelSelect(label.id, e.target.value)}
                                    disabled={isStudyModeAnswered}
                                    className={`w-full p-2 border rounded-md shadow-sm bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary disabled:opacity-70 ${dropdownFeedbackClass}`}
                                >
                                    <option value="" disabled>Select a label...</option>
                                    {(shuffledAnswers as DiagramLabel[]).map(opt => (
                                        <option key={opt.id} value={opt.id}>{opt.text}</option>
                                    ))}
                                </select>
                                {isStudyModeAnswered && (isCorrect ? <AppIcon name="checkmark-circle" size={20} className="text-green-500" /> : <AppIcon name="close-circle" size={20} className="text-red-500" />)}
                            </div>
                          );
                      })}
                  </div>
              </div>
            )}
            
            {mode === 'study' && (currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE || currentQuestion.questionType === QuestionType.MATCHING || currentQuestion.questionType === QuestionType.DIAGRAM_LABELING) && !isStudyModeAnswered && gate.state !== 'ask' && (
                <div className="mt-4 text-right">
                    <button 
                        onClick={currentQuestion.questionType === QuestionType.MATCHING ? submitMatchingAnswer : (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING ? submitDiagramAnswer : submitMultiSelectAnswer)}
                        className="px-3 py-1.5 sm:px-4 sm:py-2 bg-green-500 hover:bg-green-600 text-white rounded-md text-xs sm:text-sm font-semibold disabled:opacity-50"
                        disabled={
                          (currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE && currentSelections.length === 0) ||
                          (currentQuestion.questionType === QuestionType.MATCHING && !currentQuestion.matchingPromptItems?.every(p => matchSelections[p.id])) ||
                          (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING && !currentQuestion.diagramLabels?.every(l => diagramSelections[l.id]))
                        }
                    >
                        Submit Answer
                    </button>
                </div>
            )}

            {/* Confidence, asked BEFORE the reveal and only on practice. The
                two chips replace "Check Answer" while the gate is open: the
                answer is already committed, so this is the button that reveals
                it, and the student cannot see the outcome before choosing. */}
            {gate.state === 'ask' && (
                <div className="mt-4 p-3 rounded-lg border border-lantern-border bg-lantern-surface">
                    <p className="text-body font-semibold text-lantern-text">Before you see the answer — how sure are you?</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {CONFIDENCE_CHOICES.map((choice) => (
                            <button
                                key={choice.id}
                                type="button"
                                onClick={() => answerWithConfidence(choice.id)}
                                className="min-h-[44px] px-4 rounded-lantern border border-lantern-border bg-lantern-background text-body font-semibold text-lantern-text hover:border-lantern-feature-tests-ink hover:bg-lantern-feature-tests-tint"
                            >
                                {choice.label}
                                <span className="ml-2 text-caption font-normal text-lantern-text-secondary">{choice.hint}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {mode === 'study' && !showExplanationsImmediately && hasStudyAnswerDraft && canRevealAnswer(gate) && (
                <div className="mt-4 text-right">
                    <button
                        onClick={handleCheckStudyAnswer}
                        className="px-3 py-1.5 sm:px-4 sm:py-2 bg-green-500 hover:bg-green-600 text-white rounded-md text-xs sm:text-sm font-semibold"
                    >
                        Check Answer
                    </button>
                </div>
            )}

            {isStudyModeAnswered && (
              <div className={`mt-4 p-3 rounded-md ${userAnswer.isCorrect ? 'bg-green-50 dark:bg-green-900/40 border-green-400 dark:border-green-600' : 'bg-red-50 dark:bg-red-900/40 border-red-400 dark:border-red-600'} border`}>
                  <h3 className={`text-sm font-semibold ${userAnswer.isCorrect ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                    {userAnswer.isCorrect ? 'Correct!' : 'Incorrect.'}
                  </h3>
                  {currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK && !userAnswer.isCorrect && (
                    <p className="text-sm text-lantern-text mt-1">
                      Correct answer(s): <span className="font-semibold">{currentQuestion.acceptableAnswers?.join(', ')}</span>
                    </p>
                  )}
                  <p className="text-sm text-lantern-text mt-1 whitespace-pre-wrap">{currentQuestion.explanation}</p>
                  {confidenceLine && (
                    <p className="text-caption text-lantern-text-secondary mt-1">{confidenceLine}</p>
                  )}
              </div>
            )}
        </div>

        <div className="mt-auto pt-2 sm:pt-4 flex justify-between items-center gap-2 flex-shrink-0">
            <button
            onClick={() => onChangeQuestion(previousTargetIndex)}
            disabled={previousTargetIndex < 0}
            title={lockMode && previousTargetIndex < session.currentQuestionIndex - 1 && previousTargetIndex >= 0 ? 'Back to your last open question' : undefined}
            className="px-2.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm bg-lantern-background-secondary text-lantern-text rounded-md hover:bg-lantern-border dark:hover:bg-lantern-border disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
            <AppIcon name="chevron-back" size={16} className="sm:mr-1" />
            <span className="hidden sm:inline">Previous</span>
            </button>

            {mode === 'test' && session.currentQuestionIndex === totalQuestions - 1 && (
            <button
                onClick={handleInitiateSubmit}
                disabled={isSubmittingTest}
                className={`px-3 py-1.5 sm:px-6 sm:py-2 text-xs sm:text-sm text-white rounded-md focus:ring-2 focus:ring-lantern-primary dark:focus:ring-lantern-primary focus:ring-offset-2 ${isSubmittingTest ? 'bg-lantern-primary-light cursor-not-allowed' : 'bg-lantern-primary hover:bg-lantern-primary-dark dark:bg-lantern-primary dark:hover:bg-lantern-primary'}`}
            >
                <span className="hidden sm:inline">Review & Submit Test</span>
                <span className="sm:hidden">Submit</span>
            </button>
            )}
            
            {mode === 'study' && onEndSession && (
                session.currentQuestionIndex === totalQuestions - 1 ? (
                    <button
                        onClick={onEndSession}
                        className="px-3 py-1.5 sm:px-6 sm:py-2 text-xs sm:text-sm bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-700 text-white rounded-md focus:ring-2 focus:ring-green-400 dark:focus:ring-green-500 focus:ring-offset-2"
                    >
                        <span className="hidden sm:inline">End Study Session</span>
                        <span className="sm:hidden">End</span>
                    </button>
                ) : (
                    <button
                        onClick={() => onChangeQuestion(session.currentQuestionIndex + 1)}
                        disabled={!isStudyModeAnswered}
                        className="px-2.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm bg-green-500 hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    >
                        <span className="hidden sm:inline">Next Question</span>
                        <span className="sm:hidden">Next</span>
                        <AppIcon name="chevron-forward" size={16} className="sm:ml-1" />
                    </button>
                )
            )}
            
            {mode === 'test' && session.currentQuestionIndex < totalQuestions - 1 && (
                <button
                    onClick={() => onChangeQuestion(session.currentQuestionIndex + 1)}
                    disabled={session.currentQuestionIndex === totalQuestions - 1}
                    className="px-2.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm bg-lantern-primary hover:bg-lantern-primary dark:bg-lantern-primary dark:hover:bg-lantern-primary-dark text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                    <span className="hidden sm:inline">Next Question</span>
                    <span className="sm:hidden">Next</span>
                    <AppIcon name="chevron-forward" size={16} className="sm:ml-1" />
                </button>
            )}
        </div>
      </div>

      <div 
        ref={paletteRef}
        className="flex-shrink-0 bg-lantern-background-secondary dark:bg-lantern-surface p-1.5 sm:p-2 md:p-3 border-t border-lantern-border dark:border-lantern-border shadow-md overflow-x-auto"
        role="toolbar" 
        aria-label="Question navigation"
      >
        <div className="flex space-x-1 sm:space-x-2">
          {session.questions.map((q, index) => {
            const answerRecord = session.userAnswers[q.id];
            const isCurrent = session.currentQuestionIndex === index;
            const isAnswered = answerRecord && (
                (answerRecord.selectedOptionIds && answerRecord.selectedOptionIds.length > 0) ||
                (answerRecord.fillText && answerRecord.fillText.trim() !== "") ||
                (answerRecord.matchingAnswers && answerRecord.matchingAnswers.length > 0) ||
                (answerRecord.diagramAnswers && answerRecord.diagramAnswers.length > 0)
            );
            const isBookmarked = !!answerRecord?.isBookmarked;
            const isLocked = lockMode && !isCurrent && lockedIdSet.has(q.id);

            let buttonClasses = "min-w-[44px] sm:min-w-[36px] md:min-w-[40px] min-h-[44px] h-11 sm:h-9 md:h-10 px-1.5 sm:px-2.5 py-0.5 sm:py-1 text-xs sm:text-xs font-medium rounded-md flex items-center justify-center relative transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-lantern-surface touch-manipulation";
            let title = `Go to Question ${q.questionNumber}`;
            if (isBookmarked) title += " (Bookmarked for review)";
            if (isLocked) title = `Question ${q.questionNumber} (Locked — answered)`;
            else if (isAnswered) title += " (Answered)";
            else title += " (Unanswered)";


            if (isCurrent) {
              buttonClasses += " bg-lantern-primary dark:bg-lantern-primary-light text-white ring-2 ring-lantern-primary dark:ring-lantern-primary-light shadow-lg sm:scale-105";
            } else if (isLocked) {
              buttonClasses += " bg-lantern-border/60 text-lantern-text-tertiary cursor-not-allowed opacity-70";
            } else if (isAnswered) {
              buttonClasses += " bg-green-200 dark:bg-green-700/80 text-green-800 dark:text-green-100 hover:bg-green-300 dark:hover:bg-green-600";
            } else {
              buttonClasses += " bg-lantern-border text-lantern-text hover:bg-lantern-border dark:hover:bg-lantern-border";
            }
            if (isBookmarked && !isCurrent) {
                 buttonClasses += " border-2 border-yellow-500 dark:border-yellow-400";
            }


            return (
              <button
                key={q.id}
                data-qindex={index}
                onClick={() => { if (!isLocked) onChangeQuestion(index); }}
                disabled={isLocked}
                aria-disabled={isLocked}
                className={buttonClasses}
                aria-label={title}
                title={title}
              >
                {isLocked ? (
                    <AppIcon name="lock-closed" size={14} aria-hidden="true" />
                ) : (
                  <>
                    {isBookmarked && (
                        <AppIcon name="bookmark" size={12} filled className={`absolute top-0.5 right-0.5 ${isCurrent ? 'text-yellow-300' : 'text-yellow-600 dark:text-yellow-400'}`} />
                    )}
                    {q.questionNumber}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

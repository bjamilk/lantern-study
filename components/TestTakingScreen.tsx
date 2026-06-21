


import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TestSessionData, StudySessionData, TestQuestion, QuestionType, UserAnswerRecord, MatchingItem, DiagramLabel } from '../types';
import { ChevronLeftIcon, ChevronRightIcon, CheckCircleIcon as CheckCircleSolid, XCircleIcon as XCircleSolid, AcademicCapIcon, QuestionMarkCircleIcon, ClockIcon, BookmarkIcon as BookmarkOutlineIcon, ArrowsRightLeftIcon, ArrowLeftIcon, ExclamationTriangleIcon, XMarkIcon, PauseIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import VoiceInputButton from './VoiceInputButton';
import TestUtilityToolbar, { ToolType } from './TestUtilityToolbar';

interface TestTakingScreenProps {
  mode: 'test' | 'study';
  session: TestSessionData | StudySessionData;
  showExplanationsImmediately?: boolean;
  onUpdateAnswer: (questionId: string, answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>) => void; 
  onChangeQuestion: (newIndex: number) => void;
  onToggleBookmark: (questionId: string) => void;
  onSubmitTest?: () => void;
  onSubmitOfflineTest?: () => void;
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
  onEndSession,
  onPauseSession,
  onCancelSession,
}) => {
  const [isReviewMode, setIsReviewMode] = useState(false);
  useEffect(() => {
    console.log('[TestTakingScreen] mounted/updated', { mode, session });
  }, [mode, session]);
  const currentQuestion = session.questions[session.currentQuestionIndex];
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
  const [markedQuestions, setMarkedQuestions] = useState<string[]>([]);

  // ── Answer streak (study mode) ─────────────────────────────────────────────
  const [answerStreak, setAnswerStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [showStreakBadge, setShowStreakBadge] = useState(false);
  const prevIsCorrectRef = useRef<boolean | null | undefined>(undefined);

  const questionViewStartTimeRef = useRef<number | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const questionStemRef = useRef<HTMLParagraphElement>(null);

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
    if (mode === 'test' && session.endTime && (onSubmitTest || onSubmitOfflineTest)) {
      const totalDuration = session.config.timerDuration;
      const calculateTimeLeft = () => {
        const now = new Date().getTime();
        const endTimeMs = new Date(session.endTime!).getTime(); 
        const diff = Math.round((endTimeMs - now) / 1000);
        
        if (totalDuration && diff > 0 && diff <= totalDuration * 0.1) {
          setIsTimeLow(true);
        } else {
          setIsTimeLow(false);
        }

        if (diff <= 0) {
          setTimeLeftDisplay(formatTime(0));
          if (session.isOffline && onSubmitOfflineTest) onSubmitOfflineTest();
          else if (!session.isOffline && onSubmitTest) onSubmitTest();
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
    } else {
      setTimeLeftDisplay(null);
      setIsTimeLow(false);
    }
  }, [mode, session.endTime, session.config.timerDuration, onSubmitTest, onSubmitOfflineTest, session.isOffline, session.currentQuestionIndex]);
  
  useEffect(() => {
    if (paletteRef.current) {
      const currentButton = paletteRef.current.querySelector(`[data-qindex="${session.currentQuestionIndex}"]`) as HTMLElement;
      if (currentButton) {
        currentButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
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
    onUpdateAnswer(currentQuestion.id, { selectedOptionIds: newSelections, timeSpentSeconds });
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
        onUpdateAnswer(currentQuestion.id, { selectedOptionIds: newSelections, timeSpentSeconds });
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
        onUpdateAnswer(currentQuestion.id, { fillText: newText, timeSpentSeconds });
    }
  };

  const submitFillTextAnswer = () => {
    if (mode !== 'study' || userAnswer?.isCorrect !== undefined) return;
    
    const timeSpentSeconds = questionViewStartTimeRef.current 
        ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
        : undefined;
    onUpdateAnswer(currentQuestion.id, { fillText, timeSpentSeconds });
  };

  const submitMultiSelectAnswer = () => {
    if (mode === 'study' && userAnswer?.isCorrect === undefined) {
        const timeSpentSeconds = questionViewStartTimeRef.current 
            ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
            : undefined;
        onUpdateAnswer(currentQuestion.id, { selectedOptionIds: currentSelections, timeSpentSeconds });
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
          
          onUpdateAnswer(currentQuestion.id, { matchingAnswers, timeSpentSeconds });
      }
  };
  
  const submitMatchingAnswer = () => {
      if (mode !== 'study' || userAnswer?.isCorrect !== undefined) return;
      
      const matchingAnswers = Object.entries(matchSelections)
          .map(([promptItemId, answerItemId]) => ({ promptItemId, answerItemId }));
          
      const timeSpentSeconds = questionViewStartTimeRef.current 
          ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
          : undefined;
          
      onUpdateAnswer(currentQuestion.id, { matchingAnswers, timeSpentSeconds });
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
        onUpdateAnswer(currentQuestion.id, { diagramAnswers, timeSpentSeconds });
    }
  };

  const submitDiagramAnswer = () => {
    if (mode !== 'study' || userAnswer?.isCorrect !== undefined) return;
    const diagramAnswers = Object.entries(diagramSelections)
            .map(([labelId, selectedLabelId]) => ({labelId, selectedLabelId}));

    const timeSpentSeconds = questionViewStartTimeRef.current 
            ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
            : undefined;
            
    onUpdateAnswer(currentQuestion.id, { diagramAnswers, timeSpentSeconds });
  };

  // ── Highlight helpers ──────────────────────────────────────────────────────

  const handleHighlightSelection = useCallback(() => {
    if (activeTool !== 'highlight') return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !questionStemRef.current) return;

    const range = selection.getRangeAt(0);
    if (!questionStemRef.current.contains(range.commonAncestorContainer)) return;

    // Calculate char offsets relative to the stem element
    const preRange = document.createRange();
    preRange.selectNodeContents(questionStemRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + range.toString().length;
    if (start >= end) return;

    setHighlights(prev => ({
      ...prev,
      [currentQuestion.id]: [...(prev[currentQuestion.id] || []), { start, end }],
    }));
    selection.removeAllRanges();
  }, [activeTool, currentQuestion.id]);

  const renderHighlightedText = (text: string, ranges: Array<{ start: number; end: number }>) => {
    if (!ranges.length) return <>{text}</>;

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
            onClick={() => {
              setHighlights(prev => ({
                ...prev,
                [currentQuestion.id]: (prev[currentQuestion.id] || []).filter(
                  r => !(r.start === h.start && r.end === h.end)
                ),
              }));
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
      let optionClasses = "p-2 sm:p-3 border rounded-lg hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700/70 transition-colors text-slate-800 dark:text-slate-200";
      let icon = null;
      const isSelected = currentSelections.includes(opt.id);
      const isCorrectOption = question.correctAnswerIds?.includes(opt.id);
      const isStruckOut = !isStudyModeAnswered && struckForQuestion.includes(opt.id);

      if (!isStudyModeAnswered) {
          optionClasses += activeTool === 'strikeout' ? " cursor-pointer" : " cursor-pointer";
          if (isSelected && !isStruckOut) {
            optionClasses = `${optionClasses} bg-indigo-100 dark:bg-indigo-900/60 border-indigo-500 dark:border-indigo-600 ring-2 ring-indigo-400 dark:ring-indigo-500`; 
          }
          if (isStruckOut) {
            optionClasses = `${optionClasses} opacity-40 dark:opacity-30 border-red-300 dark:border-red-700`;
          }
      } else { 
          optionClasses += " cursor-default";
          if (isCorrectOption) {
              optionClasses = `${optionClasses} bg-green-100 dark:bg-green-900/40 border-green-500 dark:border-green-600 text-green-700 dark:text-green-300`;
              icon = <CheckCircleSolid className="w-4 h-4 sm:w-5 sm:h-5 ml-auto text-green-600 dark:text-green-400" />;
          } else if (isSelected && !isCorrectOption) {
              optionClasses = `${optionClasses} bg-red-100 dark:bg-red-900/40 border-red-500 dark:border-red-600 text-red-700 dark:text-red-300`;
              icon = <XCircleSolid className="w-4 h-4 sm:w-5 sm:h-5 ml-auto text-red-600 dark:text-red-400" />;
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
          {isMultiChoice && <input type="checkbox" checked={isSelected} readOnly className="h-3.5 w-3.5 sm:h-4 sm:w-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 mr-2 sm:mr-3" />}
          <span className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-full border border-current flex items-center justify-center text-[10px] sm:text-xs font-bold mr-2 sm:mr-3 select-none">
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
  const headerText = mode === 'test' 
    ? (session.isOffline ? '📝 Offline Test' : '📝 Test in Progress') 
    : (session.isOffline ? '📚 Offline Study' : '📚 Study Session');
  const headerIcon = mode === 'test' ? 
    <QuestionMarkCircleIcon className="w-6 h-6 sm:w-8 sm:h-8 mr-2 sm:mr-3 text-purple-600 dark:text-purple-400" /> : 
    <AcademicCapIcon className="w-6 h-6 sm:w-8 sm:h-8 mr-2 sm:mr-3 text-blue-600 dark:text-blue-400" />;

  const isCurrentBookmarked = userAnswer?.isBookmarked || false;
  const BookmarkToggleIcon = isCurrentBookmarked ? BookmarkSolidIcon : BookmarkOutlineIcon;

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
        onChangeQuestion(index);
        setIsReviewMode(false);
    };
    
    const finalSubmitAction = session.isOffline ? onSubmitOfflineTest : onSubmitTest;

    return (
        <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 p-4 md:p-6">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl md:text-3xl font-semibold text-slate-800 dark:text-slate-100">Review Your Answers</h1>
                {timeLeftDisplay && (
                    <div className={`flex items-center text-sm font-medium px-3 py-1 rounded-full transition-colors ${isTimeLow ? 'text-white bg-red-600 animate-pulse' : 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50'}`}>
                        <ClockIcon className="w-5 h-5 mr-1.5" />
                        Time Remaining: {timeLeftDisplay}
                    </div>
                )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 text-center">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Answered</p>
                    <p className="text-2xl font-bold text-green-500">{answeredCount}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Skipped</p>
                    <p className="text-2xl font-bold text-yellow-500">{skippedCount}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Bookmarked</p>
                    <p className="text-2xl font-bold text-indigo-500">{bookmarkedCount}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow mb-6 flex-grow overflow-y-auto">
                <h2 className="text-lg font-semibold mb-3">Questions</h2>
                <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2">
                    {session.questions.map((q, index) => {
                        const answerRecord = session.userAnswers[q.id];
                        const isAnswered = answerRecord && ((answerRecord.selectedOptionIds && answerRecord.selectedOptionIds.length > 0) || (answerRecord.fillText && answerRecord.fillText.trim() !== "") || (answerRecord.matchingAnswers && answerRecord.matchingAnswers.length > 0) || (answerRecord.diagramAnswers && answerRecord.diagramAnswers.length > 0));
                        const isBookmarked = !!answerRecord?.isBookmarked;

                        let buttonClasses = "h-10 w-10 text-sm font-medium rounded-md flex items-center justify-center relative transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-800";
                        if (isAnswered) {
                            buttonClasses += " bg-green-500 text-white hover:bg-green-600";
                        } else {
                            buttonClasses += " bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-400 dark:hover:bg-slate-600";
                        }
                        if (isBookmarked) {
                            buttonClasses += " ring-2 ring-indigo-500 dark:ring-indigo-400";
                        }

                        return (
                            <button key={q.id} onClick={() => handleQuestionSelect(index)} className={buttonClasses} aria-label={`Go to question ${q.questionNumber}`}>
                                {isBookmarked && <BookmarkSolidIcon className="w-3 h-3 absolute top-1 right-1 text-indigo-500 dark:text-indigo-400"/>}
                                {q.questionNumber}
                            </button>
                        );
                    })}
                </div>
            </div>
            
            <div className="bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-r-lg mb-6 flex items-start" role="alert">
                <ExclamationTriangleIcon className="w-6 h-6 mr-3 flex-shrink-0" />
                <div>
                  <p className="font-bold">Final Submission Warning</p>
                  <p className="text-sm">Once you submit, you will not be able to change your answers. Please review your questions carefully.</p>
                </div>
            </div>

            <div className="flex-shrink-0 flex justify-between items-center">
                <button onClick={() => setIsReviewMode(false)} className="px-6 py-3 bg-slate-500 hover:bg-slate-600 text-white rounded-md flex items-center">
                    <ArrowLeftIcon className="w-5 h-5 mr-2" />
                    Return to Test
                </button>
                <button onClick={finalSubmitAction} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-md flex items-center font-semibold">
                    Confirm & Submit Test <CheckCircleSolid className="w-5 h-5 ml-2" />
                </button>
            </div>
        </div>
    );
  }


  if (!currentQuestion) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300">
        <p>Error: Question not found. This should not happen.</p>
        {onEndSession && <button onClick={onEndSession} className="mt-4 px-4 py-2 bg-slate-500 hover:bg-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-md">End Session</button>}
      </div>
    );
  }

  const finalSubmitAction = session.isOffline ? onSubmitOfflineTest : onSubmitTest;
  const isStudyModeAnswered = mode === 'study' && userAnswer?.isCorrect !== undefined;
  const hasStudyAnswerDraft = mode === 'study' && !isStudyModeAnswered && !!(
    userAnswer?.selectedOptionIds?.length ||
    userAnswer?.fillText ||
    userAnswer?.matchingAnswers?.length ||
    userAnswer?.diagramAnswers?.length
  );

  const handleCheckStudyAnswer = () => {
    onUpdateAnswer(currentQuestion.id, { revealAnswer: true } as Partial<Omit<UserAnswerRecord, 'questionId'>> & { revealAnswer?: boolean });
  };

  // Mode-specific theme colors
  const modeTheme = mode === 'study' 
    ? { 
        bgGradient: 'bg-gradient-to-b from-blue-50 to-slate-100 dark:from-blue-950/30 dark:to-slate-900',
        headerBorder: 'border-blue-200 dark:border-blue-800',
        infoBanner: 'bg-blue-100 dark:bg-blue-900/40 border-blue-200 dark:border-blue-700',
        infoBannerText: 'text-blue-800 dark:text-blue-200',
        infoBannerSubtext: 'text-blue-600 dark:text-blue-400',
        navPalette: 'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
      }
    : { 
        bgGradient: 'bg-gradient-to-b from-purple-50 to-slate-100 dark:from-purple-950/30 dark:to-slate-900',
        headerBorder: 'border-purple-200 dark:border-purple-800',
        infoBanner: 'bg-purple-100 dark:bg-purple-900/40 border-purple-200 dark:border-purple-700',
        infoBannerText: 'text-purple-800 dark:text-purple-200',
        infoBannerSubtext: 'text-purple-600 dark:text-purple-400',
        navPalette: 'bg-purple-100 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800'
      };

  return (
    <div className={`flex-1 flex flex-col ${modeTheme.bgGradient} text-slate-800 dark:text-slate-200 relative`}>

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

      <div className="flex-1 p-2 sm:p-4 md:p-6 overflow-y-auto">
        {/* Mode Info Banner */}
        <div className={`mb-2 sm:mb-4 p-2 sm:p-3 rounded-lg border flex items-center ${modeTheme.infoBanner}`}>
          <span className="text-lg sm:text-2xl mr-2 sm:mr-3">{mode === 'study' ? '📚' : '📝'}</span>
          <div className="flex-1 min-w-0">
            <span className={`font-semibold text-sm sm:text-base ${modeTheme.infoBannerText}`}>
              {mode === 'study' ? 'Study Mode' : 'Test Mode'}
            </span>
            <span className={`hidden sm:inline text-sm ml-2 ${modeTheme.infoBannerSubtext}`}>
              {mode === 'study' 
                ? '• No timer • Instant feedback • Not recorded' 
                : '• Timed • Results recorded • Answers at end'}
            </span>
            <p className={`sm:hidden text-[10px] mt-0.5 ${modeTheme.infoBannerSubtext}`}>
              {mode === 'study' ? 'No timer · Instant feedback' : 'Timed · Results recorded'}
            </p>
          </div>
          {mode === 'test' && timeLeftDisplay && (
            <div className={`flex items-center text-sm font-medium px-3 py-1 rounded-full transition-colors ${isTimeLow ? 'text-white bg-red-600 animate-pulse' : 'text-purple-800 dark:text-purple-200 bg-purple-200 dark:bg-purple-800'}`}>
              <ClockIcon className="w-5 h-5 mr-1.5" />
              {timeLeftDisplay}
            </div>
          )}
        </div>

        <div className={`mb-3 sm:mb-6 pb-2 sm:pb-4 border-b ${modeTheme.headerBorder}`}>
          <div className="flex items-center justify-between gap-2">
              <div className={`flex items-center text-base sm:text-xl md:text-2xl font-semibold min-w-0 ${mode === 'study' ? 'text-blue-700 dark:text-blue-300' : 'text-purple-700 dark:text-purple-300'}`}> 
                  {headerIcon} <span className="truncate">{headerText}</span>
              </div>
              <div className="flex items-center shrink-0 gap-1 sm:gap-2">
                <button 
                    onClick={onPauseSession}
                    className="p-1.5 sm:p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                    aria-label="Pause Session"
                    title="Pause & Exit Session"
                >
                    <PauseIcon className="w-5 h-5 sm:w-6 sm:h-6"/>
                </button>
                <button 
                    onClick={onCancelSession}
                    className="p-1.5 sm:p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400"
                    aria-label="Cancel Session"
                    title="Cancel & Exit Session"
                >
                    <XMarkIcon className="w-5 h-5 sm:w-6 sm:h-6"/>
                </button>
              </div>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 pl-0 sm:pl-14">
            Question {session.currentQuestionIndex + 1} of {totalQuestions}
          </p>
        </div>

        {/* ── Utility Toolbar ── */}
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
          isMarked={markedQuestions.includes(currentQuestion.id)}
          onToggleMark={() =>
            setMarkedQuestions(prev =>
              prev.includes(currentQuestion.id)
                ? prev.filter(id => id !== currentQuestion.id)
                : [...prev, currentQuestion.id]
            )
          }
          highlightCount={(highlights[currentQuestion.id] || []).length}
          onClearHighlights={() =>
            setHighlights(prev => ({ ...prev, [currentQuestion.id]: [] }))
          }
        />

        <div className="bg-white dark:bg-slate-800 p-3 sm:p-4 md:p-6 rounded-lg shadow-md mb-3 sm:mb-6">
            <div className="flex justify-between items-start mb-1 gap-2">
                <h2 id={`question-stem-${currentQuestion.id}`} className="text-base sm:text-lg md:text-xl font-semibold text-slate-900 dark:text-slate-100">
                    Question {currentQuestion.questionNumber}:
                </h2>
                <button
                    onClick={() => onToggleBookmark(currentQuestion.id)}
                    className={`p-1 sm:p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0 ${isCurrentBookmarked ? 'text-yellow-500 dark:text-yellow-400' : 'text-slate-500 dark:text-slate-400'}`}
                    aria-label={isCurrentBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                    title={isCurrentBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                >
                    <BookmarkToggleIcon className="w-5 h-5 md:w-6 md:h-6" />
                </button>
            </div>
            <p
              ref={questionStemRef}
              className={`text-sm sm:text-md md:text-lg mb-3 sm:mb-4 whitespace-pre-wrap text-slate-800 dark:text-slate-200 ${activeTool === 'highlight' ? 'cursor-text select-text' : ''}`}
              onMouseUp={activeTool === 'highlight' ? handleHighlightSelection : undefined}
            >
              {renderHighlightedText(
                currentQuestion.questionStem,
                highlights[currentQuestion.id] || []
              )}
            </p>
             {currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE && <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">(Select all that apply)</p>}
             {currentQuestion.questionType === QuestionType.MATCHING && <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">(Match each prompt to the correct answer)</p>}
             {currentQuestion.questionType === QuestionType.DIAGRAM_LABELING && <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">(Select the correct label for each pin from the dropdown menu)</p>}

            {currentQuestion.imageUrl && currentQuestion.questionType !== QuestionType.DIAGRAM_LABELING && (
                <div className="my-3 flex justify-center">
                    <img 
                        src={currentQuestion.imageUrl}
                        alt="Question visual" 
                        className="max-w-sm h-auto rounded-md border border-slate-300 dark:border-slate-600 shadow"
                        style={{ maxHeight: '250px' }}
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
                  className="w-full p-3 pr-12 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent transition bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:bg-slate-200 dark:disabled:bg-slate-700/50"
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
                                    <p className="flex-1 font-medium text-slate-800 dark:text-slate-200">{prompt.text}</p>
                                    <div className="flex-shrink-0 w-full sm:w-1/2 md:w-5/12">
                                        <select
                                            value={matchSelections[prompt.id] || ""}
                                            onChange={e => handleMatchSelect(prompt.id, e.target.value)}
                                            disabled={isStudyModeAnswered}
                                            className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-70 disabled:cursor-not-allowed"
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
                                        <CheckCircleSolid className="w-4 h-4 mr-1"/>
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
                  <div className="relative w-full max-w-xl mx-auto border-2 border-slate-300 dark:border-slate-600 rounded-lg overflow-hidden">
                      <img src={currentQuestion.imageUrl} alt="Diagram to label" className="w-full h-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
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
                          let dropdownFeedbackClass = 'border-slate-300 dark:border-slate-600';
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
                                    className={`w-full p-2 border rounded-md shadow-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-70 ${dropdownFeedbackClass}`}
                                >
                                    <option value="" disabled>Select a label...</option>
                                    {(shuffledAnswers as DiagramLabel[]).map(opt => (
                                        <option key={opt.id} value={opt.id}>{opt.text}</option>
                                    ))}
                                </select>
                                {isStudyModeAnswered && (isCorrect ? <CheckCircleSolid className="w-5 h-5 text-green-500"/> : <XCircleSolid className="w-5 h-5 text-red-500"/>)}
                            </div>
                          );
                      })}
                  </div>
              </div>
            )}
            
            {mode === 'study' && (currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE || currentQuestion.questionType === QuestionType.MATCHING || currentQuestion.questionType === QuestionType.DIAGRAM_LABELING) && !isStudyModeAnswered && (
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

            {mode === 'study' && !showExplanationsImmediately && hasStudyAnswerDraft && (
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
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">
                      Correct answer(s): <span className="font-semibold">{currentQuestion.acceptableAnswers?.join(', ')}</span>
                    </p>
                  )}
                  <p className="text-sm text-slate-700 dark:text-slate-300 mt-1 whitespace-pre-wrap">{currentQuestion.explanation}</p>
              </div>
            )}
        </div>

        <div className="mt-auto pt-2 sm:pt-4 flex justify-between items-center gap-2 flex-shrink-0">
            <button
            onClick={() => onChangeQuestion(session.currentQuestionIndex - 1)}
            disabled={session.currentQuestionIndex === 0}
            className="px-2.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
            <ChevronLeftIcon className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-1" />
            <span className="hidden sm:inline">Previous</span>
            </button>

            {mode === 'test' && session.currentQuestionIndex === totalQuestions - 1 && (
            <button
                onClick={handleInitiateSubmit}
                className="px-3 py-1.5 sm:px-6 sm:py-2 text-xs sm:text-sm bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white rounded-md focus:ring-2 focus:ring-indigo-400 dark:focus:ring-indigo-500 focus:ring-offset-2"
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
                        <ChevronRightIcon className="w-4 h-4 sm:w-5 sm:h-5 sm:ml-1" />
                    </button>
                )
            )}
            
            {mode === 'test' && session.currentQuestionIndex < totalQuestions - 1 && (
                <button
                    onClick={() => onChangeQuestion(session.currentQuestionIndex + 1)}
                    disabled={session.currentQuestionIndex === totalQuestions - 1}
                    className="px-2.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm bg-indigo-500 hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                    <span className="hidden sm:inline">Next Question</span>
                    <span className="sm:hidden">Next</span>
                    <ChevronRightIcon className="w-4 h-4 sm:w-5 sm:h-5 sm:ml-1" />
                </button>
            )}
        </div>
      </div>

      <div 
        ref={paletteRef}
        className="flex-shrink-0 bg-slate-200 dark:bg-slate-800 p-1.5 sm:p-2 md:p-3 border-t border-slate-300 dark:border-slate-700 shadow-md overflow-x-auto"
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
            const isMarkedQ = markedQuestions.includes(q.id);

            let buttonClasses = "min-w-[28px] sm:min-w-[36px] md:min-w-[40px] h-7 sm:h-9 md:h-10 px-1.5 sm:px-2.5 py-0.5 sm:py-1 text-[10px] sm:text-xs font-medium rounded-md flex items-center justify-center relative transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-slate-800";
            let title = `Go to Question ${q.questionNumber}`;
            if (isBookmarked) title += " (Bookmarked)";
            if (isMarkedQ) title += " (Flagged)";
            if (isAnswered) title += " (Answered)";
            else title += " (Unanswered)";


            if (isCurrent) {
              buttonClasses += " bg-indigo-500 dark:bg-indigo-400 text-white ring-2 ring-indigo-600 dark:ring-indigo-300 shadow-lg sm:scale-105";
            } else if (isAnswered) {
              buttonClasses += " bg-green-200 dark:bg-green-700/80 text-green-800 dark:text-green-100 hover:bg-green-300 dark:hover:bg-green-600";
            } else {
              buttonClasses += " bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-400 dark:hover:bg-slate-500";
            }
            if (isBookmarked && !isCurrent) { 
                 buttonClasses += " border-2 border-yellow-500 dark:border-yellow-400";
            }
            if (isMarkedQ && !isCurrent) {
                 buttonClasses += " border-2 border-orange-500 dark:border-orange-400";
            }


            return (
              <button
                key={q.id}
                data-qindex={index}
                onClick={() => onChangeQuestion(index)}
                className={buttonClasses}
                aria-label={title}
                title={title}
              >
                {isBookmarked && (
                    <BookmarkSolidIcon className={`w-3 h-3 absolute top-0.5 right-0.5 ${isCurrent ? 'text-yellow-300' : 'text-yellow-600 dark:text-yellow-400'}`} />
                )}
                {isMarkedQ && !isBookmarked && (
                    <svg
                      className={`w-3 h-3 absolute top-0.5 right-0.5 ${isCurrent ? 'text-orange-300' : 'text-orange-500 dark:text-orange-400'}`}
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                      <line x1="4" y1="22" x2="4" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                )}
                {q.questionNumber}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

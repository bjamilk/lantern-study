import React, { useState, useEffect, useRef } from 'react';
import { GameSession, TestQuestion, QuestionType, UserAnswerRecord, MatchingItem, DiagramLabel } from '../types';
import { ChevronRightIcon, UserIcon, SpeakerWaveIcon, SpeakerXMarkIcon, PauseIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import VoiceInputButton from './VoiceInputButton';
import { gameAudio } from '../utils/audio';

interface GameScreenProps {
  session: GameSession;
  onUpdateAnswer: (questionId: string, answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>, timeTaken: number) => void;
  onPauseSession: () => void;
  onRequestEndSession: () => void;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

export const GameScreen: React.FC<GameScreenProps> = ({ 
  session,
  onUpdateAnswer,
  onPauseSession,
  onRequestEndSession,
}) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const currentQuestion = session.questions[currentQuestionIndex];
  const totalQuestions = session.questions.length;
  
  const [currentSelections, setCurrentSelections] = useState<string[]>([]);
  const [fillText, setFillText] = useState('');
  const [matchSelections, setMatchSelections] = useState<Record<string, string>>({});
  const [shuffledAnswers, setShuffledAnswers] = useState<MatchingItem[] | DiagramLabel[]>([]);
  const [diagramSelections, setDiagramSelections] = useState<Record<string, string>>({});
  const [isAnswered, setIsAnswered] = useState(false);
  const [isMuted, setIsMuted] = useState(gameAudio.getMuted());

  const [timeLeft, setTimeLeft] = useState(20);
  const [isTimerActive, setIsTimerActive] = useState(true);

  const questionViewStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    questionViewStartTimeRef.current = Date.now();
    const existingAnswer = session.userAnswers[currentQuestion.id];
    setIsAnswered(!!existingAnswer);
    setCurrentSelections(existingAnswer?.selectedOptionIds || []);
    setFillText(existingAnswer?.fillText || '');
    setMatchSelections(Object.fromEntries((existingAnswer?.matchingAnswers || []).map(m => [m.promptItemId, m.answerItemId])));
    setDiagramSelections(Object.fromEntries((existingAnswer?.diagramAnswers || []).map(d => [d.labelId, d.selectedLabelId])));
    
    if (currentQuestion.questionType === QuestionType.MATCHING && currentQuestion.matchingAnswerItems) {
        setShuffledAnswers(shuffleArray(currentQuestion.matchingAnswerItems));
    }
    if (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING && currentQuestion.diagramLabels) {
        setShuffledAnswers(shuffleArray(currentQuestion.diagramLabels));
    }

    // Reset countdown timer
    setTimeLeft(20);
    setIsTimerActive(!existingAnswer);
  }, [currentQuestionIndex, currentQuestion.id, session.userAnswers]);

  // Audio countdown ticks
  useEffect(() => {
    if (!isTimerActive || isAnswered) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          // Auto-submit empty response on timeout
          if (!isAnswered) {
             gameAudio.playIncorrect();
             if (currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_SINGLE || currentQuestion.questionType === QuestionType.TRUE_FALSE) {
                submitAnswer({ selectedOptionIds: [] });
             } else if (currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK) {
                submitAnswer({ fillText: '' });
             } else if (currentQuestion.questionType === QuestionType.MATCHING) {
                submitAnswer({ matchingAnswers: [] });
             } else if (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING) {
                submitAnswer({ diagramAnswers: [] });
             }
          }
          return 0;
        }
        
        // Play tick sound for the final 10 seconds
        if (prev <= 10 && !isMuted) {
          gameAudio.playTick();
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isTimerActive, currentQuestionIndex, isAnswered, isMuted, currentQuestion.questionType]);

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    gameAudio.setMuted(nextMute);
  };

  const submitAnswer = (answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>) => {
      if (isAnswered) return;
      setIsTimerActive(false);
      const timeSpentSeconds = questionViewStartTimeRef.current 
        ? (Date.now() - questionViewStartTimeRef.current) / 1000
        : 0;
      onUpdateAnswer(currentQuestion.id, answerData, timeSpentSeconds);
      setIsAnswered(true);
  };

  const handleNextQuestion = () => {
      if (currentQuestionIndex < totalQuestions - 1) {
          setCurrentQuestionIndex(prev => prev + 1);
      }
  };

  const handleMultiOptionSelect = (optionId: string) => {
    if (isAnswered) return;
    setCurrentSelections(prev => prev.includes(optionId) ? prev.filter(id => id !== optionId) : [...prev, optionId]);
  };

  const handleFillTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isAnswered) return;
    setFillText(e.target.value);
  };
  
  const handleMatchSelect = (promptItemId: string, answerItemId: string) => {
      if (isAnswered) return;
      setMatchSelections(prev => ({ ...prev, [promptItemId]: answerItemId }));
  };

  const handleDiagramLabelSelect = (labelId: string, selectedLabelId: string) => {
    if (isAnswered) return;
    setDiagramSelections(prev => ({ ...prev, [labelId]: selectedLabelId }));
  };

  const renderOptions = (question: TestQuestion) => {
    if (!question.options) return null;
    const isMulti = question.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE;

    const cardStyles = [
      { bg: 'bg-red-600 border-red-700', hover: 'hover:bg-red-500', active: 'ring-red-400', shape: '▲', shapeColor: 'text-red-200' },
      { bg: 'bg-blue-600 border-blue-700', hover: 'hover:bg-blue-500', active: 'ring-blue-400', shape: '◆', shapeColor: 'text-blue-200' },
      { bg: 'bg-amber-500 border-amber-600', hover: 'hover:bg-amber-400', active: 'ring-amber-300', shape: '●', shapeColor: 'text-amber-100' },
      { bg: 'bg-emerald-600 border-emerald-700', hover: 'hover:bg-emerald-500', active: 'ring-emerald-400', shape: '■', shapeColor: 'text-emerald-200' }
    ];

    return question.options.map((opt, idx) => {
        const style = cardStyles[idx % cardStyles.length];
        const isSelected = currentSelections.includes(opt.id);
        const isCorrectOption = question.correctAnswerIds?.includes(opt.id);
        
        let cardClass = `relative flex items-center p-4 md:p-6 border-b-4 rounded-xl text-white font-semibold transition-all transform hover:-translate-y-0.5 duration-150 select-none shadow-md ${style.bg}`;
        let icon = null;

        if (isAnswered) {
          cardClass += ' cursor-default ';
          if (isCorrectOption) {
            cardClass += ' ring-4 ring-green-400 border-green-500 scale-[1.02] z-10 ';
            icon = <CheckCircleIcon className="w-6 h-6 ml-auto text-white" />;
          } else if (isSelected && !isCorrectOption) {
            cardClass += ' ring-4 ring-red-400 border-red-500 scale-[0.98] opacity-90 ';
            icon = <XCircleIcon className="w-6 h-6 ml-auto text-white" />;
          } else {
            cardClass += ' opacity-30 scale-95 ';
          }
        } else {
          cardClass += ` cursor-pointer ${style.hover} ${isSelected ? `ring-4 ${style.active} scale-[1.02]` : ''}`;
        }
        
        const handleClick = () => {
            if (isAnswered) return;
            if (isMulti) {
                handleMultiOptionSelect(opt.id);
            } else { // Single choice or T/F
                setCurrentSelections([opt.id]);
                
                const isCorrect = question.correctAnswerIds?.includes(opt.id);
                if (isCorrect) {
                  gameAudio.playCorrect();
                } else {
                  gameAudio.playIncorrect();
                }
                
                submitAnswer({ selectedOptionIds: [opt.id] });
            }
        };

        return (
            <li key={opt.id} onClick={handleClick} className={cardClass}>
                <div className="flex items-center space-x-3 w-full">
                    <span className={`text-2xl md:text-3xl font-extrabold ${style.shapeColor} mr-2`}>
                      {style.shape}
                    </span>
                    {isMulti && (
                      <input 
                        type="checkbox" 
                        checked={isSelected} 
                        readOnly 
                        className="h-5 w-5 rounded text-lantern-primary border-white/40 bg-lantern-surface/20 mr-2 focus:ring-offset-0 focus:ring-0" 
                      />
                    )}
                    <span className="text-md md:text-lg flex-grow text-left">{opt.text}</span>
                    {icon}
                </div>
            </li>
        );
    });
  };

  const userProgress = (Object.keys(session.userAnswers).length / totalQuestions) * 100;
  const opponentProgress = session.isSoloPractice
    ? 0
    : (Object.keys(session.opponentAnswers).length / totalQuestions) * 100;
  const showOpponent = !session.isSoloPractice;

  const canSubmit =
    !isAnswered && (
      (currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE && currentSelections.length > 0) ||
      (currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK && fillText.trim() !== '') ||
      (currentQuestion.questionType === QuestionType.MATCHING && currentQuestion.matchingPromptItems?.every(p => matchSelections[p.id])) ||
      (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING && currentQuestion.diagramLabels?.every(l => diagramSelections[l.id]))
    );

  const handleSubmitComplex = () => {
    let isCorrect = false;
    if (currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE) {
      const correctSet = new Set(currentQuestion.correctAnswerIds || []);
      const selectedSet = new Set(currentSelections);
      isCorrect = correctSet.size === selectedSet.size && [...correctSet].every(id => selectedSet.has(id));
      submitAnswer({ selectedOptionIds: currentSelections });
    }
    if (currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK) {
      isCorrect = currentQuestion.correctAnswerText?.toLowerCase().trim() === fillText.toLowerCase().trim();
      submitAnswer({ fillText });
    }
    if (currentQuestion.questionType === QuestionType.MATCHING) {
      isCorrect = currentQuestion.matchingPromptItems?.every(p => {
        const correctAns = currentQuestion.matchingAnswerItems?.find(a => a.promptItemId === p.id);
        return correctAns && matchSelections[p.id] === correctAns.id;
      }) || false;
      submitAnswer({ matchingAnswers: Object.entries(matchSelections).map(([promptItemId, answerItemId]) => ({ promptItemId, answerItemId })) });
    }
    if (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING) {
      isCorrect = currentQuestion.diagramLabels?.every(l => diagramSelections[l.id] === l.text) || false;
      submitAnswer({ diagramAnswers: Object.entries(diagramSelections).map(([labelId, selectedLabelId]) => ({ labelId, selectedLabelId })) });
    }

    if (isCorrect) {
      gameAudio.playCorrect();
    } else {
      gameAudio.playIncorrect();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-lantern-background text-lantern-text">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
        {/* Game HUD */}
        <div className="mb-6 pb-4 border-b border-lantern-border dark:border-lantern-border">
            <div className="flex justify-between items-center gap-2 text-xl md:text-2xl font-semibold text-lantern-text mb-4">
                <div className="flex items-center min-w-0">
                    {session.user.avatarUrl ? (
                        <img src={session.user.avatarUrl} alt={session.user.name} className="w-10 h-10 rounded-full border-2 border-blue-500" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                    ) : (
                        <div className="w-10 h-10 rounded-full border-2 border-blue-500 bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-lantern-primary dark:text-blue-300 font-bold text-lg">
                            {session.user.name?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                    )}
                    <div className="ml-3 flex flex-col items-start">
                      <span className="leading-tight">{session.user.name}</span>
                      {session.userStreak && session.userStreak > 0 ? (
                        <div className="flex items-center space-x-1 bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full text-[10px] font-bold animate-bounce mt-0.5 shadow-sm">
                          <span>🔥 {session.userStreak} Streak!</span>
                          {session.userStreak >= 3 && <span className="text-[8px] tracking-wider uppercase ml-1 animate-pulse font-extrabold text-red-500">Hot</span>}
                        </div>
                      ) : null}
                    </div>
                </div>
                
                {/* Audio + session controls */}
                <div className="flex items-center shrink-0 space-x-1 sm:space-x-2">
                  {showOpponent && <span className="text-red-500 text-sm md:text-base font-extrabold hidden sm:inline">VS</span>}
                  {!showOpponent && <span className="text-lantern-primary text-xs sm:text-sm font-semibold hidden sm:inline">Solo</span>}
                  <button
                    onClick={onPauseSession}
                    className="p-2 rounded-full hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface transition-colors"
                    title="Pause & exit"
                    aria-label="Pause game"
                  >
                    <PauseIcon className="w-5 h-5 sm:w-6 sm:h-6 text-lantern-text-secondary" />
                  </button>
                  <button
                    onClick={onRequestEndSession}
                    className="p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                    title="End game"
                    aria-label="End game"
                  >
                    <XMarkIcon className="w-5 h-5 sm:w-6 sm:h-6 text-red-600 dark:text-red-400" />
                  </button>
                  <button 
                    onClick={toggleMute}
                    className="p-2 rounded-full hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface transition-colors"
                    title={isMuted ? "Unmute Audio" : "Mute Audio"}
                    aria-label={isMuted ? "Unmute audio" : "Mute audio"}
                  >
                    {isMuted ? (
                      <SpeakerXMarkIcon className="w-5 h-5 sm:w-6 sm:h-6 text-lantern-text-secondary" />
                    ) : (
                      <SpeakerWaveIcon className="w-5 h-5 sm:w-6 sm:h-6 text-lantern-primary" />
                    )}
                  </button>
                </div>

                 {showOpponent && (
                 <div className="flex items-center min-w-0">
                    <div className="mr-3 flex flex-col items-end">
                      <span className="leading-tight">{session.opponent.name}</span>
                      {session.opponentStreak && session.opponentStreak > 0 ? (
                        <div className="flex items-center space-x-1 bg-lantern-background-secondary dark:bg-lantern-surface text-lantern-text-secondary px-2 py-0.5 rounded-full text-[10px] font-bold mt-0.5 shadow-sm">
                          <span>🔥 {session.opponentStreak} Streak</span>
                        </div>
                      ) : null}
                    </div>
                    {session.opponent.avatarUrl ? (
                        <img src={session.opponent.avatarUrl} alt={session.opponent.name} className="w-10 h-10 rounded-full border-2 border-lantern-border" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                    ) : (
                        <div className="w-10 h-10 rounded-full border-2 border-lantern-border bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex items-center justify-center text-lantern-text-secondary dark:text-lantern-text-tertiary font-bold text-lg">
                            {session.opponent.name?.charAt(0)?.toUpperCase() || 'O'}
                        </div>
                    )}
                </div>
                 )}
            </div>
            <div className="space-y-2">
                 <div>
                    <div className="flex justify-between text-xs mb-1 text-lantern-text-secondary">
                        <span className="font-semibold text-lantern-primary">Score: {session.userScore} pts <span className="text-lantern-text-tertiary">({session.userCorrectAnswers || 0} correct)</span></span>
                        <span>Time: {session.userTime.toFixed(1)}s</span>
                    </div>
                    <div className="w-full bg-lantern-background-secondary rounded-full h-4 overflow-hidden">
                        <div className="bg-blue-500 h-4 rounded-full transition-all duration-500" style={{ width: `${userProgress}%` }}></div>
                    </div>
                 </div>
                 {showOpponent && (
                 <div>
                     <div className="flex justify-between text-xs mb-1 text-lantern-text-secondary">
                        <span className="font-semibold text-lantern-text-secondary">Score: {session.opponentScore} pts <span className="text-lantern-text-tertiary">({session.opponentCorrectAnswers || 0} correct)</span></span>
                        <span>Time: {session.opponentTime.toFixed(1)}s</span>
                    </div>
                    <div className="w-full bg-lantern-background-secondary rounded-full h-4 overflow-hidden">
                        <div className="bg-lantern-border h-4 rounded-full transition-all duration-500" style={{ width: `${opponentProgress}%` }}></div>
                    </div>
                 </div>
                 )}
            </div>
             <p className="text-center text-sm text-lantern-text-secondary mt-4 font-medium">
                Question {currentQuestionIndex + 1} of {totalQuestions}
            </p>
        </div>

        {/* Question Area */}
        <div className="bg-lantern-surface p-4 md:p-6 rounded-2xl shadow-lg border border-lantern-border">
            {/* Timer countdown progress bar */}
            {!isAnswered && (
              <div className="mb-4">
                <div className="flex justify-between text-xs font-semibold mb-1 text-lantern-text-secondary">
                  <span>Countdown Timer</span>
                  <span className={timeLeft <= 5 ? 'text-red-500 animate-pulse font-bold' : ''}>{timeLeft}s left</span>
                </div>
                <div className="w-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary h-2.5 rounded-full overflow-hidden">
                  <div 
                      className={`h-full transition-all duration-1000 ${timeLeft > 10 ? 'bg-lantern-primary' : timeLeft > 5 ? 'bg-amber-500' : 'bg-red-500 animate-pulse'}`}
                      style={{ width: `${(timeLeft / 20) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}

            <h2 className="text-lg md:text-xl font-bold text-lantern-text">
                Question {currentQuestion.questionNumber}:
            </h2>
            <p className="text-md md:text-lg my-4 whitespace-pre-wrap text-lantern-text-secondary dark:text-lantern-text font-medium leading-relaxed">
              {currentQuestion.questionStem}
            </p>
            
            {/* Render options based on type */}
            {[QuestionType.MULTIPLE_CHOICE_SINGLE, QuestionType.TRUE_FALSE, QuestionType.MULTIPLE_CHOICE_MULTIPLE].includes(currentQuestion.questionType!) && (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {renderOptions(currentQuestion)}
              </ul>
            )}

            {currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK && (
              <div className="mt-4 relative">
                <input type="text" value={fillText} onChange={handleFillTextChange} placeholder="Type your answer here..." className="w-full p-4 pr-12 border border-lantern-border rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-lantern-primary dark:bg-lantern-surface-secondary" disabled={isAnswered} />
                <VoiceInputButton className="absolute top-1/2 right-2 -translate-y-1/2" onTranscriptUpdate={(text) => setFillText(prev => prev + text)} disabled={isAnswered}/>
              </div>
            )}
            
            {currentQuestion.questionType === QuestionType.MATCHING && (
                <div className="mt-4 space-y-3">
                    {currentQuestion.matchingPromptItems?.map(prompt => (
                        <div key={prompt.id} className="p-3 border border-lantern-border rounded-xl dark:bg-lantern-surface-secondary">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                <p className="flex-1 font-medium">{prompt.text}</p>
                                <div className="flex-shrink-0 w-full sm:w-1/2 md:w-5/12">
                                    <select value={matchSelections[prompt.id] || ""} onChange={e => handleMatchSelect(prompt.id, e.target.value)} disabled={isAnswered} className="w-full p-2.5 border border-lantern-border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-lantern-primary dark:bg-lantern-surface-secondary">
                                        <option value="" disabled>Select a match...</option>
                                        {(shuffledAnswers as MatchingItem[]).map(ans => (<option key={ans.id} value={ans.id}>{ans.text}</option>))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {currentQuestion.questionType === QuestionType.DIAGRAM_LABELING && currentQuestion.imageUrl && (
                <div className="mt-4">
                    <div className="relative w-full max-w-xl mx-auto border-2 border-lantern-border rounded-xl overflow-hidden shadow-md">
                      <img src={currentQuestion.imageUrl} alt="Diagram" className="w-full h-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      {currentQuestion.diagramLabels?.map((label, index) => (
                        <div key={label.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${label.x}%`, top: `${label.y}%` }}>
                          <div className="relative flex items-center justify-center w-7 h-7 bg-red-650 text-white font-extrabold text-sm rounded-full shadow-lg ring-2 ring-white">
                            {index + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {currentQuestion.diagramLabels?.map((label, index) => (
                            <div key={label.id} className="flex items-center space-x-3">
                                <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-red-600 text-white font-extrabold text-xs rounded-full shadow-sm">{index + 1}</div>
                                <select value={diagramSelections[label.id] || ''} onChange={(e) => handleDiagramLabelSelect(label.id, e.target.value)} disabled={isAnswered} className="w-full p-2 border border-lantern-border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-lantern-primary dark:bg-lantern-surface-secondary">
                                    <option value="" disabled>Select a label...</option>
                                    {(shuffledAnswers as DiagramLabel[]).map(opt => (<option key={opt.id} value={opt.id}>{opt.text}</option>))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            )}

        </div>
      </div>

      {/* Sticky action bar — keeps Submit/Next visible on mobile */}
      <div className="flex-shrink-0 border-t border-lantern-border dark:border-lantern-border bg-lantern-surface px-4 py-3 md:px-6 md:py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] safe-area-bottom">
        {canSubmit && (
          <button
            onClick={handleSubmitComplex}
            className="w-full sm:w-auto sm:ml-auto sm:flex px-6 py-3 bg-green-550 hover:bg-green-600 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all duration-150 flex items-center justify-center"
          >
            Submit Answer
          </button>
        )}

        {isAnswered && (
          currentQuestionIndex < totalQuestions - 1 ? (
            <button
              onClick={handleNextQuestion}
              className="w-full sm:w-auto sm:ml-auto sm:flex px-6 py-3 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-xl items-center justify-center font-bold shadow-md hover:shadow-lg transition-all duration-150"
            >
              Next Question <ChevronRightIcon className="w-5 h-5 ml-1" />
            </button>
          ) : (
            <p className="text-center text-sm text-lantern-text-secondary font-medium italic">
              {session.isSoloPractice
                ? 'Finishing session…'
                : session.challengeId
                  ? 'Submitting your answers…'
                  : 'All questions answered.'}
            </p>
          )
        )}

        {!canSubmit && !isAnswered && (
          <p className="text-center text-xs text-lantern-text-secondary">
            Select an answer to continue
          </p>
        )}
      </div>
    </div>
  );
};

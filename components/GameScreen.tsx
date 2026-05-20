

import React, { useState, useEffect, useRef } from 'react';
import { GameSession, TestQuestion, QuestionType, UserAnswerRecord, MatchingItem, DiagramLabel } from '../types';
import { ChevronRightIcon, UserIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import VoiceInputButton from './VoiceInputButton';

interface GameScreenProps {
  session: GameSession;
  onUpdateAnswer: (questionId: string, answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>, timeTaken: number) => void; 
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

export const GameScreen: React.FC<GameScreenProps> = ({ 
  session,
  onUpdateAnswer,
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

  }, [currentQuestionIndex, currentQuestion.id, session.userAnswers]);

  const submitAnswer = (answerData: Partial<Omit<UserAnswerRecord, 'questionId'>>) => {
      if(isAnswered) return;
      const timeSpentSeconds = questionViewStartTimeRef.current 
        ? Math.round((Date.now() - questionViewStartTimeRef.current) / 1000) 
        : 0;
      onUpdateAnswer(currentQuestion.id, answerData, timeSpentSeconds);
      setIsAnswered(true);
  }

  const handleNextQuestion = () => {
      if (currentQuestionIndex < totalQuestions - 1) {
          setCurrentQuestionIndex(prev => prev + 1);
      }
      // The game end logic is handled in App.tsx when the last answer is processed.
  }

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

    return question.options.map((opt) => {
        const isSelected = currentSelections.includes(opt.id);
        const isCorrectOption = question.correctAnswerIds?.includes(opt.id);
        let optionClasses = `p-3 border rounded-lg transition-colors text-gray-800 dark:text-slate-200 ${isAnswered ? 'cursor-default' : 'cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700'}`;
        let icon = null;

        if(isAnswered) {
             if (isCorrectOption) {
                optionClasses += " bg-green-100 dark:bg-green-900/40 border-green-500 dark:border-green-600 text-green-700 dark:text-green-300";
                icon = <CheckCircleIcon className="w-5 h-5 ml-auto text-green-600 dark:text-green-400" />;
            } else if (isSelected && !isCorrectOption) {
                optionClasses += " bg-red-100 dark:bg-red-900/40 border-red-500 dark:border-red-600 text-red-700 dark:text-red-300";
                icon = <XCircleIcon className="w-5 h-5 ml-auto text-red-600 dark:text-red-400" />;
            } else {
                 optionClasses += " border-gray-300 dark:border-slate-600 opacity-70";
            }
        } else {
            optionClasses += ` dark:border-slate-600 ${isSelected ? 'bg-blue-100 dark:bg-blue-900/60 border-blue-500 ring-2 ring-blue-400' : 'border-gray-300'}`;
        }
        
        const handleClick = () => {
            if (isAnswered) return;
            if (isMulti) {
                handleMultiOptionSelect(opt.id);
            } else { // Single choice or T/F
                setCurrentSelections([opt.id]);
                submitAnswer({ selectedOptionIds: [opt.id] });
            }
        };

        return (
            <li key={opt.id} onClick={handleClick} className={`flex items-center ${optionClasses}`}>
                {isMulti && <input type="checkbox" checked={isSelected} readOnly className="h-4 w-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500 mr-3" />}
                <span className="mr-2 text-sm font-medium flex-grow">{opt.text}</span> {icon}
            </li>
        );
    });
  };

  const userProgress = (Object.keys(session.userAnswers).length / totalQuestions) * 100;
  const opponentProgress = (Object.keys(session.opponentAnswers).length / totalQuestions) * 100;

  return (
    <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200">
      <div className="flex-1 p-4 md:p-6 overflow-y-auto">
        {/* Game HUD */}
        <div className="mb-6 pb-4 border-b border-slate-300 dark:border-slate-700">
            <div className="flex justify-between items-center text-xl md:text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-4">
                <div className="flex items-center">
                    {session.user.avatarUrl ? (
                        <img src={session.user.avatarUrl} alt={session.user.name} className="w-10 h-10 rounded-full border-2 border-blue-500" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                    ) : (
                        <div className="w-10 h-10 rounded-full border-2 border-blue-500 bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-lg">
                            {session.user.name?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                    )}
                    <span className="ml-3">{session.user.name}</span>
                </div>
                <span className="text-red-500">VS</span>
                 <div className="flex items-center">
                    <span className="mr-3">{session.opponent.name}</span>
                    {session.opponent.avatarUrl ? (
                        <img src={session.opponent.avatarUrl} alt={session.opponent.name} className="w-10 h-10 rounded-full border-2 border-gray-500" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                    ) : (
                        <div className="w-10 h-10 rounded-full border-2 border-gray-500 bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-bold text-lg">
                            {session.opponent.name?.charAt(0)?.toUpperCase() || 'O'}
                        </div>
                    )}
                </div>
            </div>
            <div className="space-y-2">
                 <div>
                    <div className="flex justify-between text-xs mb-1 text-slate-600 dark:text-slate-400">
                        <span>Score: {session.userScore}</span>
                        <span>Time: {session.userTime.toFixed(1)}s</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-4">
                        <div className="bg-blue-500 h-4 rounded-full transition-all duration-500" style={{ width: `${userProgress}%` }}></div>
                    </div>
                 </div>
                 <div>
                     <div className="flex justify-between text-xs mb-1 text-slate-600 dark:text-slate-400">
                        <span>Score: {session.opponentScore}</span>
                        <span>Time: {session.opponentTime.toFixed(1)}s</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-4">
                        <div className="bg-gray-500 h-4 rounded-full transition-all duration-500" style={{ width: `${opponentProgress}%` }}></div>
                    </div>
                 </div>
            </div>
             <p className="text-center text-sm text-slate-600 dark:text-slate-400 mt-4">
                Question {currentQuestionIndex + 1} of {totalQuestions}
            </p>
        </div>

        {/* Question Area */}
        <div className="bg-white dark:bg-slate-800 p-4 md:p-6 rounded-lg shadow-md mb-6">
            <h2 className="text-lg md:text-xl font-semibold text-slate-900 dark:text-slate-100">
                Question {currentQuestion.questionNumber}:
            </h2>
            <p className="text-md md:text-lg my-4 whitespace-pre-wrap text-slate-800 dark:text-slate-200">{currentQuestion.questionStem}</p>
            
            {/* Render options based on type */}
            {[QuestionType.MULTIPLE_CHOICE_SINGLE, QuestionType.TRUE_FALSE, QuestionType.MULTIPLE_CHOICE_MULTIPLE].includes(currentQuestion.questionType!) && (
              <ul className="space-y-3">
                  {renderOptions(currentQuestion)}
              </ul>
            )}

            {currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK && (
              <div className="mt-4 relative">
                <input type="text" value={fillText} onChange={handleFillTextChange} placeholder="Type your answer here..." className="w-full p-3 pr-12 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm" disabled={isAnswered} />
                <VoiceInputButton className="absolute top-1/2 right-2 -translate-y-1/2" onTranscriptUpdate={(text) => setFillText(prev => prev + text)} disabled={isAnswered}/>
              </div>
            )}
            
            {currentQuestion.questionType === QuestionType.MATCHING && (
                <div className="mt-4 space-y-3">
                    {currentQuestion.matchingPromptItems?.map(prompt => (
                        <div key={prompt.id} className="p-3 border dark:border-slate-600 rounded-lg">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                <p className="flex-1 font-medium">{prompt.text}</p>
                                <div className="flex-shrink-0 w-full sm:w-1/2 md:w-5/12">
                                    <select value={matchSelections[prompt.id] || ""} onChange={e => handleMatchSelect(prompt.id, e.target.value)} disabled={isAnswered} className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm">
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
                    <div className="relative w-full max-w-xl mx-auto border-2 rounded-lg overflow-hidden"><img src={currentQuestion.imageUrl} alt="Diagram" className="w-full h-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                        {currentQuestion.diagramLabels?.map((label, index) => (<div key={label.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${label.x}%`, top: `${label.y}%` }}><div className="relative flex items-center justify-center w-7 h-7 bg-red-600 text-white font-bold text-sm rounded-full shadow-lg ring-2 ring-white">{index + 1}</div></div>))}
                    </div>
                    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {currentQuestion.diagramLabels?.map((label, index) => (
                            <div key={label.id} className="flex items-center space-x-3">
                                <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-red-600 text-white font-bold text-xs rounded-full">{index + 1}</div>
                                <select value={diagramSelections[label.id] || ''} onChange={(e) => handleDiagramLabelSelect(label.id, e.target.value)} disabled={isAnswered} className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm">
                                    <option value="" disabled>Select a label...</option>
                                    {(shuffledAnswers as DiagramLabel[]).map(opt => (<option key={opt.id} value={opt.id}>{opt.text}</option>))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!isAnswered && (
                (currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE && currentSelections.length > 0) ||
                (currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK && fillText.trim() !== '') ||
                (currentQuestion.questionType === QuestionType.MATCHING && currentQuestion.matchingPromptItems?.every(p => matchSelections[p.id])) ||
                (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING && currentQuestion.diagramLabels?.every(l => diagramSelections[l.id]))
            ) && (
                <div className="mt-4 text-right">
                    <button onClick={() => {
                        if (currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE) submitAnswer({ selectedOptionIds: currentSelections });
                        if (currentQuestion.questionType === QuestionType.FILL_IN_THE_BLANK) submitAnswer({ fillText });
                        if (currentQuestion.questionType === QuestionType.MATCHING) submitAnswer({ matchingAnswers: Object.entries(matchSelections).map(([promptItemId, answerItemId]: [string, string]) => ({ promptItemId, answerItemId })) });
                        if (currentQuestion.questionType === QuestionType.DIAGRAM_LABELING) submitAnswer({ diagramAnswers: Object.entries(diagramSelections).map(([labelId, selectedLabelId]: [string, string]) => ({ labelId, selectedLabelId })) });
                    }}
                        className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md text-sm font-semibold"
                    >
                        Submit Answer
                    </button>
                </div>
            )}

            {isAnswered && (
                <div className="mt-4 text-right">
                    {currentQuestionIndex < totalQuestions - 1 ? (
                        <button 
                            onClick={handleNextQuestion}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center font-semibold"
                        >
                            Next Question <ChevronRightIcon className="w-5 h-5 ml-1" />
                        </button>
                    ) : (
                        <div className="text-right text-sm text-slate-500 dark:text-slate-400 italic">
                            Waiting for results...
                        </div>
                    )}
                </div>
            )}

        </div>
      </div>
    </div>
  );
};

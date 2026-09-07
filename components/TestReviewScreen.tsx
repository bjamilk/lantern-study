import React, { useMemo, useState } from 'react';
import { TestResult, QuestionType, UserAnswerRecord, Message, TestQuestion, TestConfig, TestSessionData, Group } from '../types';
import { CheckCircleIcon, XCircleIcon, InformationCircleIcon, ArrowLeftOnRectangleIcon, ChartBarIcon, ArrowPathIcon, AcademicCapIcon, TrophyIcon, CheckBadgeIcon, HandThumbUpIcon, FaceSmileIcon, ArrowTrendingUpIcon, PresentationChartLineIcon } from '@heroicons/react/24/solid';
import { SparklesIcon } from '@heroicons/react/24/outline';
import Confetti from './Confetti';
import TestAnalysisModal from './TestAnalysisModal';
import AIUsageInline from './AIUsageInline';
import { ResolvedStorageImg } from './ui/ResolvedStorageImg';

interface TestReviewScreenProps {
  results: TestResult; 
  allTestResults: TestResult[];
  groups: Group[];
  onExit: () => void;
  onNavigateToDashboard: () => void;
  onRetakeTest: (session: TestSessionData) => void;
  onPracticeFailedQuestions: (failedQuestions: TestQuestion[]) => void;
  onExplainAnswer?: (question: string, userAnswer: string, correctAnswer: string, options?: string[]) => Promise<string | null>;
}

const TestReviewScreen: React.FC<TestReviewScreenProps> = ({ results, allTestResults, groups, onExit, onNavigateToDashboard, onRetakeTest, onPracticeFailedQuestions, onExplainAnswer }) => {
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [aiExplanations, setAiExplanations] = useState<Record<number, string>>({});
  const [aiExplainLoading, setAiExplainLoading] = useState<Record<number, boolean>>({});
  const { session, score, totalQuestions, correctAnswersCount } = results;
  
  const scoreFeedback = useMemo(() => {
    if (score === 100) {
        return {
            message: "Perfect Score! Absolutely brilliant!",
            colorClass: "text-yellow-500 dark:text-yellow-400",
            icon: TrophyIcon,
            showConfetti: true,
            rank: 'S', rankColor: 'bg-gradient-to-br from-yellow-400 to-amber-500 text-white',
        };
    }
    if (score >= 90) {
        return {
            message: "Outstanding! Top of the class performance!",
            colorClass: "text-green-500 dark:text-green-400",
            icon: CheckBadgeIcon,
            showConfetti: true,
            rank: 'A', rankColor: 'bg-gradient-to-br from-green-400 to-emerald-600 text-white',
        };
    }
    if (score >= 80) {
        return {
            message: "Excellent work! You've mastered the material.",
            colorClass: "text-green-500 dark:text-green-400",
            icon: CheckBadgeIcon,
            showConfetti: false,
            rank: 'B', rankColor: 'bg-gradient-to-br from-blue-400 to-blue-600 text-white',
        };
    }
    if (score >= 60) {
        return {
            message: "Great job! Keep reviewing to solidify your knowledge.",
            colorClass: "text-lantern-primary-text",
            icon: HandThumbUpIcon,
            showConfetti: false,
            rank: 'C', rankColor: 'bg-gradient-to-br from-lantern-primary-light to-lantern-primary text-white',
        };
    }
    if (score >= 40) {
        return {
            message: "Good effort. Consistent practice will make a difference.",
            colorClass: "text-lantern-primary-text",
            icon: FaceSmileIcon,
            showConfetti: false,
            rank: 'D', rankColor: 'bg-gradient-to-br from-orange-400 to-orange-600 text-white',
        };
    }
    return {
        message: "Don't be discouraged. Use this as a guide for what to study next.",
        colorClass: "text-red-500 dark:text-red-400",
        icon: ArrowTrendingUpIcon,
        showConfetti: false,
        rank: 'F', rankColor: 'bg-gradient-to-br from-red-400 to-red-600 text-white',
    };
  }, [score]);

  const testNumberForGroup = useMemo(() => {
    const groupTests = allTestResults
        .filter(r => r.session.config.groupId === results.session.config.groupId)
        .sort((a, b) => new Date(a.session.startTime).getTime() - new Date(b.session.startTime).getTime());
    
    const currentTestIndex = groupTests.findIndex(r => r.session.startTime === results.session.startTime);
    return currentTestIndex !== -1 ? currentTestIndex + 1 : groupTests.length;
  }, [allTestResults, results]);

  const groupName = useMemo(() => {
    const group = groups.find(g => g.id === session.config.groupId);
    return group ? `${group.name} (Test #${testNumberForGroup})` : 'Unknown Group';
  }, [groups, session.config.groupId, testNumberForGroup]);


  const failedQuestions = session.questions.filter(q => !session.userAnswers[q.id]?.isCorrect);
  const Icon = scoreFeedback.icon;

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 bg-lantern-background text-lantern-text overflow-y-auto relative">
      {scoreFeedback.showConfetti && <Confetti />}
      <div className="mb-6 pb-4 border-b border-lantern-border dark:border-lantern-border">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
            <h1 className="text-title text-lantern-primary-text dark:text-lantern-primary-light mb-2 sm:mb-0">Test Review</h1>
            <div className="flex space-x-2">
                <button
                    onClick={onNavigateToDashboard}
                    className="px-3 py-2 bg-teal-500 hover:bg-teal-600 dark:bg-teal-600 dark:hover:bg-teal-700 text-white rounded-md focus:ring-2 focus:ring-teal-400 dark:focus:ring-teal-500 focus:ring-offset-2 flex items-center text-body"
                    aria-label="View Dashboard"
                >
                    <ChartBarIcon className="w-5 h-5 mr-1.5" /> Dashboard
                </button>
                <button
                    onClick={onExit}
                    className="px-3 py-2 bg-lantern-primary-fill hover:bg-lantern-primary-dark dark:bg-lantern-primary-fill dark:hover:bg-lantern-primary-fill text-white rounded-md focus:ring-2 focus:ring-lantern-primary dark:focus:ring-lantern-primary focus:ring-offset-2 flex items-center text-body"
                    aria-label="Return to Chat"
                >
                    <ArrowLeftOnRectangleIcon className="w-5 h-5 mr-1.5" /> Return to Chat
                </button>
            </div>
        </div>
        <div className="mt-4 p-4 bg-lantern-surface rounded-lg shadow-md">
            <div className="text-center mb-4 pb-4 border-b border-lantern-border">
                <Icon className={`w-16 h-16 mx-auto ${scoreFeedback.colorClass}`} />
                <p className={`text-title font-bold mt-2 ${scoreFeedback.colorClass}`}>{scoreFeedback.message}</p>
            </div>
            <div className="flex flex-col md:flex-row justify-around items-center space-y-3 md:space-y-0 md:space-x-4">
                {/* Rank Badge */}
                <div className="flex flex-col items-center gap-1">
                  <p className="text-body text-lantern-text-secondary">Rank</p>
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center text-title font-black shadow-lg ${scoreFeedback.rankColor}`}
                    style={{ animation: 'rankReveal 0.6s ease-out' }}>
                    <style>{`@keyframes rankReveal { 0%{transform:scale(0) rotate(-30deg);opacity:0} 70%{transform:scale(1.2) rotate(5deg);opacity:1} 100%{transform:scale(1) rotate(0)} }`}</style>
                    {scoreFeedback.rank}
                  </div>
                </div>
                <div className="text-center">
                    <p className="text-body text-lantern-text-secondary">Your Score</p>
                    <p className={`text-display tabular-nums ${scoreFeedback.colorClass}`}>{score.toFixed(1)}%</p>
                </div>
                <div className="text-center">
                    <p className="text-body text-lantern-text-secondary">Correct Answers</p>
                    <p className="text-title tabular-nums text-lantern-text">{correctAnswersCount} / {totalQuestions}</p>
                </div>
                <div className="text-center">
                    <p className="text-body text-lantern-text-secondary">Group</p>
                    <p className="text-heading font-medium text-lantern-text truncate max-w-[150px] md:max-w-xs" title={groupName}>
                        {groupName} 
                    </p>
                </div>
            </div>
        </div>
      </div>
      
      {/* Next Steps Section */}
      <div className="mb-6 p-4 bg-lantern-surface rounded-lg shadow-md">
        <h2 className="text-heading font-semibold mb-3 text-lantern-text">Next Steps</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => onRetakeTest(session)}
            className="flex-1 px-4 py-2 bg-lantern-primary-fill hover:bg-lantern-primary-dark dark:bg-lantern-primary-fill dark:hover:bg-lantern-primary-fill text-white rounded-md focus:ring-2 focus:ring-lantern-primary focus:ring-offset-2 flex items-center justify-center text-body font-medium"
            aria-label="Retake this test with similar settings"
          >
            <ArrowPathIcon className="w-5 h-5 mr-2" />
            Retake Test
          </button>
          <button
            onClick={() => onPracticeFailedQuestions(failedQuestions)}
            disabled={failedQuestions.length === 0}
            className="flex-1 px-4 py-2 bg-lantern-primary-fill hover:bg-lantern-primary-dark text-white rounded-md focus:ring-2 focus:ring-lantern-primary focus:ring-offset-2 flex items-center justify-center text-body font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={`Practice the ${failedQuestions.length} questions you failed`}
          >
            <AcademicCapIcon className="w-5 h-5 mr-2" />
            Practice Failed ({failedQuestions.length})
          </button>
           <button
            onClick={() => setIsAnalysisModalOpen(true)}
            className="flex-1 px-4 py-2 bg-teal-500 hover:bg-teal-600 dark:bg-teal-600 dark:hover:bg-teal-700 text-white rounded-md focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 flex items-center justify-center text-body font-medium"
            aria-label="View detailed analysis of this test"
          >
            <PresentationChartLineIcon className="w-5 h-5 mr-2" />
            Detailed Analysis
          </button>
        </div>
        {failedQuestions.length === 0 && (
            <p className="text-caption text-center mt-2 text-green-600 dark:text-green-400">Perfect score! No questions to practice.</p>
        )}
      </div>

      <div className="space-y-6">
        {session.questions.map((question, index) => {
          const userAnswerRecord = session.userAnswers[question.id];
          const isCorrect = userAnswerRecord?.isCorrect;
          
          const wasAnswered = userAnswerRecord && (
              (userAnswerRecord.selectedOptionIds && userAnswerRecord.selectedOptionIds.length > 0) || 
              (userAnswerRecord.fillText && userAnswerRecord.fillText.trim() !== '') ||
              (userAnswerRecord.matchingAnswers && userAnswerRecord.matchingAnswers.length > 0) ||
              (userAnswerRecord.diagramAnswers && userAnswerRecord.diagramAnswers.length > 0)
          );

          return (
            <div key={question.id} className="bg-lantern-surface p-4 rounded-lg shadow-md">
              <h2 className="text-heading mb-2 text-lantern-text"> 
                Question {index + 1}: {isCorrect ? 
                <CheckCircleIcon className="w-5 h-5 inline-block ml-2 text-green-500 dark:text-green-400" /> : 
                (wasAnswered ? <XCircleIcon className="w-5 h-5 inline-block ml-2 text-red-500 dark:text-red-400" /> : <InformationCircleIcon className="w-5 h-5 inline-block ml-2 text-yellow-500 dark:text-yellow-400" />)
                }
              </h2>
              <p className="text-lantern-text mb-3 whitespace-pre-wrap">{question.questionStem}</p>

              {question.imageUrl && question.questionType !== QuestionType.DIAGRAM_LABELING && (
                <div className="my-3 w-full max-w-xl mx-auto">
                    <ResolvedStorageImg
                        src={question.imageUrl}
                        alt="Question visual"
                        className="w-full h-auto max-h-[50vh] sm:max-h-[60vh] object-contain rounded-md border border-lantern-border shadow"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                </div>
              )}

              {question.questionType === QuestionType.FILL_IN_THE_BLANK && (
                <div className="space-y-2 mb-3">
                  <div className="p-2 border dark:border-lantern-border rounded-md text-body">
                    <span className="font-semibold text-lantern-text-secondary">Your Answer: </span>
                    <span className={`italic ${!userAnswerRecord?.fillText?.trim() ? 'text-lantern-text-secondary' : isCorrect ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                      {userAnswerRecord?.fillText?.trim() ? userAnswerRecord.fillText : 'Not Answered'}
                    </span>
                  </div>
                  {!isCorrect && (
                    <div className="p-2 border border-green-400 dark:border-green-600 rounded-md text-body bg-green-50 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                      <span className="font-semibold">Acceptable Answer(s): </span>
                      <span>{question.acceptableAnswers?.join(', ')}</span>
                    </div>
                  )}
                </div>
              )}

              {[QuestionType.MULTIPLE_CHOICE_SINGLE, QuestionType.TRUE_FALSE, QuestionType.MULTIPLE_CHOICE_MULTIPLE].includes(question.questionType!) && question.options && (
                <div className="space-y-2 mb-3">
                    {question.options.map(opt => {
                        const userSelectedIds = userAnswerRecord?.selectedOptionIds || [];
                        const correctOptionIds = question.correctAnswerIds || [];
                        const isUserSelected = userSelectedIds.includes(opt.id);
                        const isCorrectOption = correctOptionIds.includes(opt.id);
                        let classes = "p-2 border dark:border-lantern-border rounded-md text-body";
                        let annotation = null;
                        
                        if (isCorrectOption) {
                            classes += " bg-green-50 dark:bg-green-900/40 border-green-400 dark:border-green-600 text-green-700 dark:text-green-300 font-medium";
                            if (!isUserSelected) annotation = <span className="text-caption font-normal ml-2 text-green-700 dark:text-green-300">(Correct Answer - Missed)</span>;
                        }
                        if (isUserSelected) {
                            if (isCorrectOption) {
                                annotation = <span className="text-caption font-normal ml-2 text-green-700 dark:text-green-300">(Your Answer - Correct)</span>;
                            } else {
                                classes += " bg-red-50 dark:bg-red-900/40 border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 line-through";
                                annotation = <span className="text-caption font-normal ml-2 text-red-700 dark:text-red-300">(Your Answer - Incorrect)</span>;
                            }
                        } else if (!isCorrectOption) {
                            classes += " text-lantern-text-secondary";
                        }
                        
                        return (
                            <div key={opt.id} className={classes}>
                                {opt.text}
                                {annotation}
                            </div>
                        );
                    })}
                    {!wasAnswered && (
                        <p className="p-2 border dark:border-yellow-600 rounded-md text-body bg-yellow-50 dark:bg-yellow-900/40 border-yellow-400 text-yellow-700 dark:text-yellow-300">
                            Not Answered.
                        </p>
                    )}
                </div>
              )}
              
              {question.questionType === QuestionType.MATCHING && (
                <div className="space-y-2 mb-3">
                    {question.matchingPromptItems?.map(prompt => {
                        const correctAnswer = question.correctMatches?.find(m => m.promptItemId === prompt.id);
                        const userAnswer = userAnswerRecord?.matchingAnswers?.find(m => m.promptItemId === prompt.id);
                        const isMatchCorrect = correctAnswer?.answerItemId === userAnswer?.answerItemId;
                        const correctAnswerText = question.matchingAnswerItems?.find(a => a.id === correctAnswer?.answerItemId)?.text || 'N/A';
                        const userAnswerText = question.matchingAnswerItems?.find(a => a.id === userAnswer?.answerItemId)?.text;

                        return (
                            <div key={prompt.id} className="p-2 border dark:border-lantern-border rounded-md text-body">
                                <div className="flex flex-col items-start sm:flex-row sm:justify-between sm:items-center gap-1">
                                    <span className="font-medium text-lantern-text">{prompt.text}</span>
                                    {isMatchCorrect ? <CheckCircleIcon className="w-5 h-5 text-green-500 flex-shrink-0" /> : <XCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0" />}
                                </div>
                                <div className="pl-0 sm:pl-4 mt-1">
                                    <p>Your answer: <span className={`italic ${isMatchCorrect ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{userAnswerText || <span className="text-lantern-text-secondary">Not answered</span>}</span></p>
                                    {!isMatchCorrect && <p>Correct answer: <span className="italic text-green-700 dark:text-green-300">{correctAnswerText}</span></p>}
                                </div>
                            </div>
                        );
                    })}
                     {!wasAnswered && (
                        <p className="p-2 border dark:border-yellow-600 rounded-md text-body bg-yellow-50 dark:bg-yellow-900/40 border-yellow-400 text-yellow-700 dark:text-yellow-300">
                            Not Answered.
                        </p>
                    )}
                </div>
              )}

              {question.questionType === QuestionType.DIAGRAM_LABELING && (
                <div className="space-y-2 mb-3">
                   <div className="relative w-full max-w-md mx-auto border-2 border-lantern-border rounded-lg overflow-hidden">
                      <ResolvedStorageImg src={question.imageUrl} alt="Diagram" className="w-full h-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      {question.diagramLabels?.map((label, index) => (
                          <div 
                              key={label.id} 
                              className="absolute -translate-x-1/2 -translate-y-1/2" 
                              style={{ left: `${label.x}%`, top: `${label.y}%` }}
                          >
                              <div className="relative flex items-center justify-center w-6 h-6 bg-red-600 text-white font-bold text-caption rounded-full shadow-lg ring-2 ring-white">
                                  {index + 1}
                              </div>
                          </div>
                      ))}
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                    {question.diagramLabels?.map((label, index) => {
                       const userAnswer = userAnswerRecord?.diagramAnswers?.find(a => a.labelId === label.id);
                       const selectedLabelText = question.diagramLabels?.find(l => l.id === userAnswer?.selectedLabelId)?.text;
                       const isLabelCorrect = label.id === userAnswer?.selectedLabelId;

                       return (
                         <div key={label.id} className="text-body p-2 border-l-4 dark:bg-lantern-surface-secondary/50 rounded" style={{borderColor: isLabelCorrect ? '#22c55e' : '#ef4444'}}>
                            <p className="font-semibold text-lantern-text">
                              <span className="inline-flex items-center justify-center w-5 h-5 mr-2 bg-red-600 text-white font-bold text-caption rounded-full">{index+1}</span>
                              {label.text}
                            </p>
                            <p className="pl-7">
                                Your answer: 
                                <span className={`italic ml-1 ${isLabelCorrect ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                                    {selectedLabelText || <span className="text-lantern-text-secondary">Not Answered</span>}
                                </span>
                            </p>
                         </div>
                       )
                    })}
                  </div>
                </div>
              )}
              
              <div className="mt-3 pt-3 border-t border-lantern-border">
                <h4 className="text-body font-semibold text-lantern-text-secondary flex items-center">
                    <InformationCircleIcon className="w-5 h-5 mr-1 text-lantern-primary-text" /> Explanation:
                </h4>
                <p className="text-body text-lantern-text-secondary mt-1 whitespace-pre-wrap">{question.explanation}</p>
              </div>

              {/* AI Explain button */}
              {onExplainAnswer && (
                <div className="mt-2">
                  {aiExplanations[index] ? (
                    <div className="p-3 bg-purple-50 dark:bg-purple-900/30 border border-lantern-primary/30 rounded-md">
                      <h4 className="text-body font-semibold text-purple-700 dark:text-purple-300 flex items-center mb-1">
                        <SparklesIcon className="w-4 h-4 mr-1" /> AI Explanation:
                      </h4>
                      <p className="text-body text-lantern-text whitespace-pre-wrap">{aiExplanations[index]}</p>
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <button
                        onClick={async () => {
                          setAiExplainLoading(prev => ({ ...prev, [index]: true }));
                          const userAns = userAnswerRecord?.selectedOptionIds?.map(
                            id => question.options?.find(o => o.id === id)?.text
                          ).filter(Boolean).join(', ')
                            || userAnswerRecord?.fillText
                            || userAnswerRecord?.shortAnswerText
                            || 'Not answered';
                          const correctAns = question.correctAnswerIds?.map(
                            id => question.options?.find(o => o.id === id)?.text
                          ).filter(Boolean).join(', ')
                            || question.acceptableAnswers?.join(', ')
                            || 'N/A';
                          const optTexts = question.options?.map(o => o.text);
                          const explanation = await onExplainAnswer(question.questionStem || question.text || '', userAns, correctAns, optTexts);
                          if (explanation) {
                            setAiExplanations(prev => ({ ...prev, [index]: explanation }));
                          }
                          setAiExplainLoading(prev => ({ ...prev, [index]: false }));
                        }}
                        disabled={aiExplainLoading[index]}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium text-lantern-primary-text bg-lantern-primary-background hover:bg-lantern-primary-background border border-lantern-primary/30 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <SparklesIcon className="w-4 h-4" />
                        {aiExplainLoading[index] ? 'Explaining...' : 'Explain with AI'}
                      </button>
                      <AIUsageInline className="ml-2" />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
       <div className="mt-8 text-center">
         <button
            onClick={onExit}
            className="px-6 py-3 bg-lantern-primary-fill hover:bg-lantern-primary-dark dark:bg-lantern-primary-fill dark:hover:bg-lantern-primary-fill text-white rounded-md focus:ring-2 focus:ring-lantern-primary dark:focus:ring-lantern-primary focus:ring-offset-2 flex items-center text-body mx-auto"
            >
             <ArrowLeftOnRectangleIcon className="w-5 h-5 mr-2" /> Return to Chat
            </button>
      </div>

      <TestAnalysisModal 
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        results={results}
      />
    </div>
  );
};

export default TestReviewScreen;
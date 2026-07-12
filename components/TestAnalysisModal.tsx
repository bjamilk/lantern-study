



import React, { useEffect, useRef } from 'react';
import { TestResult } from '../types';
import { ChartPieIcon, ClockIcon, TagIcon, SparklesIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';
import { Chart, registerables } from 'chart.js';
import type { Chart as ChartType } from 'chart.js';
import { computeWeakTopicsFromTestResult } from '../utils/buildFlashcardSource';
import { isUserAnswerAttempted, resolveQuestionResultStatus, QUESTION_RESULT_CHART_COLORS } from '@lantern/shared/utils';

Chart.register(...registerables);

interface TestAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: TestResult;
  onGenerateWeakTopicFlashcards?: (results: TestResult, weakTopics: string[]) => void | Promise<void>;
  isGeneratingFlashcards?: boolean;
}

const TestAnalysisModal: React.FC<TestAnalysisModalProps> = ({
  isOpen,
  onClose,
  results,
  onGenerateWeakTopicFlashcards,
  isGeneratingFlashcards = false,
}) => {
    const pieChartRef = useRef<HTMLCanvasElement>(null);
    const timePerQuestionChartRef = useRef<HTMLCanvasElement>(null);
    const timePerTagChartRef = useRef<HTMLCanvasElement>(null);

    const chartInstances = useRef<{ pie?: ChartType, timePerQ?: ChartType, timePerTag?: ChartType }>({});

    useEffect(() => {
        if (!isOpen) return;

        const { session, totalQuestions, correctAnswersCount } = results;

        // Data for Pie Chart
        const unattemptedCount = session.questions.filter(q => {
            return !isUserAnswerAttempted(session.userAnswers[q.id]);
        }).length;
        const incorrectCount = totalQuestions - correctAnswersCount - unattemptedCount;

        // Data for Time per Question Chart
        const timePerQuestionData = session.questions.map(q => ({
            status: resolveQuestionResultStatus(q, session.userAnswers[q.id]),
            label: `Q${q.questionNumber}`,
            time: session.userAnswers[q.id]?.timeSpentSeconds ?? 0,
            stem: q.questionStem || q.text || '',
        })).sort((a,b) => parseInt(a.label.substring(1)) - parseInt(b.label.substring(1)));

        // Data for Time per Tag Chart
        const tagTimeMap = new Map<string, { totalTime: number, count: number }>();
        session.questions.forEach(q => {
            const time = session.userAnswers[q.id]?.timeSpentSeconds;
            if (q.tags && typeof time === 'number') {
                q.tags.forEach(tag => {
                    const current = tagTimeMap.get(tag) || { totalTime: 0, count: 0 };
                    current.totalTime += time;
                    current.count++;
                    tagTimeMap.set(tag, current);
                });
            }
        });
        const timePerTagData = Array.from(tagTimeMap.entries()).map(([tag, { totalTime, count }]) => ({
            label: tag,
            avgTime: count > 0 ? totalTime / count : 0,
        }));
        
        let localPieChart: ChartType | undefined;
        let localTimePerQChart: ChartType | undefined;
        let localTimePerTagChart: ChartType | undefined;

        // Destroy existing charts before creating new ones
        Object.values(chartInstances.current).forEach((chart: ChartType | undefined) => chart?.destroy());
        chartInstances.current = {};

        {

            // Create Pie Chart
            if (pieChartRef.current) {
                const pieCtx = pieChartRef.current.getContext('2d');
                if (pieCtx) {
                    localPieChart = new Chart(pieCtx, {
                        type: 'pie',
                        data: {
                            labels: ['Correct', 'Incorrect', 'Unattempted'],
                            datasets: [{
                                data: [correctAnswersCount, incorrectCount, unattemptedCount],
                                backgroundColor: ['#22c55e', '#ef4444', '#f59e0b'],
                                hoverOffset: 4,
                            }]
                        },
                        options: { responsive: true, plugins: { legend: { position: 'top' } } }
                    });
                    chartInstances.current.pie = localPieChart;
                }
            }

            // Create Time per Question Chart
            if (timePerQuestionChartRef.current) {
                const timePerQCtx = timePerQuestionChartRef.current.getContext('2d');
                if (timePerQCtx) {
                    localTimePerQChart = new Chart(timePerQCtx, {
                        type: 'bar',
                        data: {
                            labels: timePerQuestionData.map(d => d.label),
                            datasets: [{
                                label: 'Time Spent (s)',
                                data: timePerQuestionData.map(d => d.time),
                                backgroundColor: timePerQuestionData.map(d =>
                                    QUESTION_RESULT_CHART_COLORS[d.status].bg
                                ),
                                borderColor: timePerQuestionData.map(d =>
                                    QUESTION_RESULT_CHART_COLORS[d.status].border
                                ),
                                borderWidth: 1,
                            }]
                        },
                        options: {
                            responsive: true,
                            datasets: { bar: { minBarLength: 6 } },
                            scales: { y: { beginAtZero: true, title: { display: true, text: 'Seconds' } } },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: {
                                        title: (items) => {
                                            const idx = items[0]?.dataIndex ?? -1;
                                            const d = timePerQuestionData[idx];
                                            const statusLabel = d
                                                ? d.status.charAt(0).toUpperCase() + d.status.slice(1)
                                                : '';
                                            return d ? `${d.label}  •  ${d.time}s  •  ${statusLabel}` : '';
                                        },
                                        label: (item) => {
                                            const d = timePerQuestionData[item.dataIndex];
                                            if (!d?.stem) return '';
                                            // Wrap long text across multiple tooltip lines (~60 chars each)
                                            const words = d.stem.split(' ');
                                            const lines: string[] = [];
                                            let line = '';
                                            for (const word of words) {
                                                if ((line + ' ' + word).trim().length > 60) {
                                                    if (line) lines.push(line);
                                                    line = word;
                                                } else {
                                                    line = line ? line + ' ' + word : word;
                                                }
                                            }
                                            if (line) lines.push(line);
                                            return lines;
                                        },
                                    },
                                    displayColors: false,
                                    bodyFont: { size: 12 },
                                    titleFont: { size: 13, weight: 'bold' },
                                    padding: 10,
                                    maxWidth: 280,
                                },
                            }
                        }
                    });
                    chartInstances.current.timePerQ = localTimePerQChart;
                }
            }

            // Create Time per Tag Chart
            if (timePerTagChartRef.current && timePerTagData.length > 0) {
                const timePerTagCtx = timePerTagChartRef.current.getContext('2d');
                if (timePerTagCtx) {
                    localTimePerTagChart = new Chart(timePerTagCtx, {
                        type: 'bar',
                        data: {
                            labels: timePerTagData.map(d => d.label),
                            datasets: [{
                                label: 'Avg. Time Spent (s)',
                                data: timePerTagData.map(d => d.avgTime),
                                backgroundColor: 'rgba(168, 85, 247, 0.7)',
                            }]
                        },
                        options: {
                            responsive: true,
                            scales: { y: { beginAtZero: true, title: { display: true, text: 'Seconds' } } },
                            plugins: { legend: { display: false } }
                        }
                    });
                    chartInstances.current.timePerTag = localTimePerTagChart;
                }
            }
        }

        // Cleanup function
        return () => {
            if (localPieChart) localPieChart.destroy();
            if (localTimePerQChart) localTimePerQChart.destroy();
            if (localTimePerTagChart) localTimePerTagChart.destroy();
            Object.values(chartInstances.current).forEach((chart: ChartType | undefined) => chart?.destroy());
            chartInstances.current = {};
        };

    }, [isOpen, results]);

    if (!isOpen) return null;
    
    // Check if there are any tags to determine if the third chart should be shown
    const hasTags = results.session.questions.some(q => q.tags && q.tags.length > 0);

    const weakTopics = computeWeakTopicsFromTestResult(results);

    const handleGenerateFlashcards = () => {
        if (!onGenerateWeakTopicFlashcards || isGeneratingFlashcards) return;
        void onGenerateWeakTopicFlashcards(results, weakTopics);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            ariaLabelledBy="analysis-modal-title"
            maxWidthClass="max-w-4xl"
            loading={isGeneratingFlashcards}
            closeOnBackdrop={!isGeneratingFlashcards}
            panelClassName="!p-0 h-[90vh] flex flex-col overflow-hidden"
        >
            <div className="flex justify-between items-center px-6 py-4 border-b border-lantern-border flex-shrink-0">
                <h2 id="analysis-modal-title" className="text-xl font-semibold text-lantern-text">Detailed Test Analysis</h2>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleGenerateFlashcards}
                        disabled={!onGenerateWeakTopicFlashcards || isGeneratingFlashcards}
                        className="flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 text-sm font-medium bg-lantern-primary hover:bg-lantern-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg shadow-sm transition-colors"
                        title={weakTopics.length ? `Generate flashcards for: ${weakTopics.join(', ')}` : 'Generate flashcards from questions you missed'}
                    >
                        {isGeneratingFlashcards ? (
                            <ArrowPathIcon className="w-4 h-4 animate-spin" aria-hidden />
                        ) : (
                            <SparklesIcon className="w-4 h-4" aria-hidden />
                        )}
                        {isGeneratingFlashcards
                            ? 'Generating...'
                            : weakTopics.length
                                ? 'Generate Flashcards for Weak Topics'
                                : 'Generate Flashcards'}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
                        aria-label="Close analysis dialog"
                    >
                        <XMarkIcon className="w-6 h-6" aria-hidden />
                    </button>
                </div>
            </div>
            <div className="flex-grow overflow-y-auto px-6 py-4 space-y-8 bg-lantern-surface">
                    {/* Pie Chart */}
                    <section>
                        <h3 className="text-lg font-semibold text-lantern-text mb-2 flex items-center">
                            <ChartPieIcon className="w-5 h-5 mr-2 text-lantern-success" aria-hidden />
                            Question Performance
                        </h3>
                        <div className="relative h-64 md:h-80 mx-auto max-w-sm">
                            <canvas ref={pieChartRef}></canvas>
                        </div>
                    </section>
                    {/* Time per Question */}
                    <section>
                        <h3 className="text-lg font-semibold text-lantern-text mb-2 flex items-center">
                            <ClockIcon className="w-5 h-5 mr-2 text-lantern-primary" aria-hidden />
                            Time Spent per Question
                        </h3>
                        <div className="mb-3 flex flex-wrap gap-3 text-xs text-lantern-text-secondary">
                            <div className="inline-flex items-center gap-1.5">
                                <span className="inline-block w-3 h-3 rounded-sm bg-green-500"></span>
                                Correct
                            </div>
                            <div className="inline-flex items-center gap-1.5">
                                <span className="inline-block w-3 h-3 rounded-sm bg-red-500"></span>
                                Incorrect
                            </div>
                            <div className="inline-flex items-center gap-1.5">
                                <span className="inline-block w-3 h-3 rounded-sm bg-amber-500"></span>
                                Unattempted
                            </div>
                        </div>
                        <div className="relative h-72">
                            <canvas ref={timePerQuestionChartRef}></canvas>
                        </div>
                    </section>
                    {/* Time per Tag */}
                    {hasTags && (
                        <section>
                             <h3 className="text-lg font-semibold text-lantern-text mb-2 flex items-center">
                                <TagIcon className="w-5 h-5 mr-2 text-lantern-accent" aria-hidden />
                                Average Time per Tag
                            </h3>
                            <div className="relative h-72">
                                <canvas ref={timePerTagChartRef}></canvas>
                            </div>
                        </section>
                    )}
                </div>
        </Modal>
    );
};

export default TestAnalysisModal;
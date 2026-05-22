



import React, { useEffect, useRef } from 'react';
import { TestResult } from '../types';
import { XCircleIcon, ChartPieIcon, ClockIcon, TagIcon } from '@heroicons/react/24/outline';
import type { Chart as ChartType } from 'chart.js';

interface TestAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: TestResult;
}

const TestAnalysisModal: React.FC<TestAnalysisModalProps> = ({ isOpen, onClose, results }) => {
    const pieChartRef = useRef<HTMLCanvasElement>(null);
    const timePerQuestionChartRef = useRef<HTMLCanvasElement>(null);
    const timePerTagChartRef = useRef<HTMLCanvasElement>(null);

    const chartInstances = useRef<{ pie?: ChartType, timePerQ?: ChartType, timePerTag?: ChartType }>({});

    useEffect(() => {
        if (!isOpen) return;

        const { session, totalQuestions, correctAnswersCount } = results;

        // Data for Pie Chart
        const unattemptedCount = session.questions.filter(q => {
            const answer = session.userAnswers[q.id];
            if (!answer) return true;
            return !(
                (answer.selectedOptionIds && answer.selectedOptionIds.length > 0) ||
                (answer.fillText && answer.fillText.trim() !== '') ||
                (answer.matchingAnswers && answer.matchingAnswers.length > 0) ||
                (answer.diagramAnswers && answer.diagramAnswers.length > 0)
            );
        }).length;
        const incorrectCount = totalQuestions - correctAnswersCount - unattemptedCount;

        // Data for Time per Question Chart
        const timePerQuestionData = session.questions.map(q => ({
            label: `Q${q.questionNumber}`,
            time: session.userAnswers[q.id]?.timeSpentSeconds ?? 0,
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
        
        let active = true;
        let localPieChart: ChartType | undefined;
        let localTimePerQChart: ChartType | undefined;
        let localTimePerTagChart: ChartType | undefined;

        // Destroy existing charts before creating new ones
        Object.values(chartInstances.current).forEach((chart: ChartType | undefined) => chart?.destroy());
        chartInstances.current = {};

        import('chart.js').then(({ Chart, registerables }) => {
            if (!active) return;
            Chart.register(...registerables);

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
                                backgroundColor: 'rgba(59, 130, 246, 0.7)',
                            }]
                        },
                        options: {
                            responsive: true,
                            scales: { y: { beginAtZero: true, title: { display: true, text: 'Seconds' } } },
                            plugins: { legend: { display: false } }
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
        }).catch(err => {
            console.error('Failed to load chart.js dynamically:', err);
        });

        // Cleanup function
        return () => {
            active = false;
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

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-labelledby="analysis-modal-title">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-4xl transform h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                    <h2 id="analysis-modal-title" className="text-xl font-semibold text-gray-800 dark:text-gray-100">Detailed Test Analysis</h2>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Close modal">
                        <XCircleIcon className="w-6 h-6" />
                    </button>
                </div>
                <div className="flex-grow overflow-y-auto pr-2 -mr-4 space-y-8">
                    {/* Pie Chart */}
                    <section>
                        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center">
                            <ChartPieIcon className="w-5 h-5 mr-2 text-green-500"/>
                            Question Performance
                        </h3>
                        <div className="relative h-64 md:h-80 mx-auto max-w-sm">
                            <canvas ref={pieChartRef}></canvas>
                        </div>
                    </section>
                    {/* Time per Question */}
                    <section>
                        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center">
                            <ClockIcon className="w-5 h-5 mr-2 text-blue-500"/>
                            Time Spent per Question
                        </h3>
                        <div className="relative h-72">
                            <canvas ref={timePerQuestionChartRef}></canvas>
                        </div>
                    </section>
                    {/* Time per Tag */}
                    {hasTags && (
                        <section>
                             <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center">
                                <TagIcon className="w-5 h-5 mr-2 text-purple-500"/>
                                Average Time per Tag
                            </h3>
                            <div className="relative h-72">
                                <canvas ref={timePerTagChartRef}></canvas>
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TestAnalysisModal;
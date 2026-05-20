import React, { useState } from 'react';
import { SparklesIcon, XCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import AIUsageInline from './AIUsageInline';

interface AIGenerateQuestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    notes: string,
    options: { count: number; difficulty: string; questionTypes: string[]; subject: string }
  ) => void;
  isGenerating: boolean;
}

const QUESTION_TYPES = [
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'fill_in_blank', label: 'Fill in the Blank' },
];

const AIGenerateQuestionsModal: React.FC<AIGenerateQuestionsModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isGenerating,
}) => {
  const [notes, setNotes] = useState('');
  const [count, setCount] = useState<number | ''>(5);
  const [difficulty, setDifficulty] = useState('mixed');
  const [subject, setSubject] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['multiple_choice', 'true_false']);

  if (!isOpen) return null;

  const toggleType = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim() || count === '' || Number(count) <= 0 || Number(count) > 20) {
      alert('Please provide notes and a number of questions between 1 and 20.');
      return;
    }
    if (selectedTypes.length === 0) {
      alert('Please select at least one question type.');
      return;
    }
    onSubmit(notes, {
      count: Number(count),
      difficulty,
      questionTypes: selectedTypes,
      subject: subject.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-generate-questions-title"
    >
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl transform max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2
            id="ai-generate-questions-title"
            className="text-xl font-semibold text-gray-800 dark:text-gray-100 flex items-center"
          >
            <SparklesIcon className="w-6 h-6 mr-2 text-indigo-500" />
            Generate Questions with AI
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Paste your notes below, and AI will generate practice questions that get posted to the group chat.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Notes textarea */}
          <div>
            <label htmlFor="ai-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Your Notes
            </label>
            <textarea
              id="ai-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={8}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Paste lecture notes, chapter text, or any study material..."
              required
            />
          </div>

          {/* Subject + Count row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ai-subject" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Subject (optional)
              </label>
              <input
                id="ai-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md"
                placeholder="e.g. Biology, History"
              />
            </div>
            <div>
              <label htmlFor="ai-count" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Number of Questions
              </label>
              <input
                id="ai-count"
                type="number"
                value={count}
                onChange={(e) => setCount(e.target.value === '' ? '' : parseInt(e.target.value))}
                min="1"
                max="20"
                required
                className="w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md"
              />
            </div>
          </div>

          {/* Difficulty selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Difficulty</label>
            <div className="flex gap-2">
              {['easy', 'medium', 'hard', 'mixed'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDifficulty(d)}
                  className={`px-3 py-1.5 text-sm rounded-md border capitalize ${
                    difficulty === d
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Question type toggles */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Question Types
            </label>
            <div className="flex flex-wrap gap-2">
              {QUESTION_TYPES.map((qt) => (
                <button
                  key={qt.value}
                  type="button"
                  onClick={() => toggleType(qt.value)}
                  className={`px-3 py-1.5 text-sm rounded-md border ${
                    selectedTypes.includes(qt.value)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600'
                  }`}
                >
                  {qt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <AIUsageInline />
            <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-600 dark:text-gray-200 border border-gray-300 dark:border-gray-500 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm flex items-center justify-center disabled:opacity-50"
            >
              {isGenerating && <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />}
              {isGenerating ? 'Generating...' : 'Generate Questions'}
            </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AIGenerateQuestionsModal;

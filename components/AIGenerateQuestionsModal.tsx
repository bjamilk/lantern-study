import React, { useState } from 'react';
import { useToastStore } from '../stores/toastStore';
import { SparklesIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import AIUsageInline from './AIUsageInline';
import { AIDisclaimer } from './AIDisclaimer';
import Modal from './ui/Modal';

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

  const toggleType = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim() || count === '' || Number(count) <= 0 || Number(count) > 20) {
      useToastStore.getState().showToast('Please provide notes and a number of questions between 1 and 20.', 'error');
      return;
    }
    if (selectedTypes.length === 0) {
      useToastStore.getState().showToast('Please select at least one question type.', 'error');
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="ai-generate-questions-title"
      maxWidthClass="max-w-2xl"
      loading={isGenerating}
      closeOnBackdrop={!isGenerating}
      panelClassName="max-h-[90vh] overflow-y-auto"
    >
      <div className="flex justify-between items-center mb-4">
        <h2
          id="ai-generate-questions-title"
          className="text-xl font-semibold text-lantern-text flex items-center"
        >
          <SparklesIcon className="w-6 h-6 mr-2 text-lantern-primary" aria-hidden />
          Generate Questions with AI
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={isGenerating}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:opacity-50"
          aria-label="Close generate questions dialog"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>
      <p className="text-sm text-lantern-text-secondary mb-2">
        Paste your notes below, and AI will generate practice questions that get posted to the group chat.
      </p>
      <AIDisclaimer className="mb-4" />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="ai-notes" className="block text-sm font-medium text-lantern-text mb-1">
            Your Notes
          </label>
          <textarea
            id="ai-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={8}
            className="w-full p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            placeholder="Paste lecture notes, chapter text, or any study material..."
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="ai-subject" className="block text-sm font-medium text-lantern-text mb-1">
              Subject (optional)
            </label>
            <input
              id="ai-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full min-h-[44px] p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
              placeholder="e.g. Biology, History"
            />
          </div>
          <div>
            <label htmlFor="ai-count" className="block text-sm font-medium text-lantern-text mb-1">
              Number of Questions
            </label>
            <input
              id="ai-count"
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              min="1"
              max="20"
              required
              className="w-full min-h-[44px] p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <p className="block text-sm font-medium text-lantern-text mb-1">Difficulty</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Question difficulty">
            {['easy', 'medium', 'hard', 'mixed'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d)}
                aria-pressed={difficulty === d}
                className={`min-h-[44px] px-3 py-1.5 text-sm rounded-lg border capitalize ${
                  difficulty === d
                    ? 'bg-lantern-primary text-white border-lantern-primary'
                    : 'bg-lantern-surface text-lantern-text border-lantern-border hover:bg-lantern-background-secondary'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="block text-sm font-medium text-lantern-text mb-1">Question Types</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Question types">
            {QUESTION_TYPES.map((qt) => (
              <button
                key={qt.value}
                type="button"
                onClick={() => toggleType(qt.value)}
                aria-pressed={selectedTypes.includes(qt.value)}
                className={`min-h-[44px] px-3 py-1.5 text-sm rounded-lg border ${
                  selectedTypes.includes(qt.value)
                    ? 'bg-lantern-primary text-white border-lantern-primary'
                    : 'bg-lantern-surface text-lantern-text border-lantern-border hover:bg-lantern-background-secondary'
                }`}
              >
                {qt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 flex-wrap gap-3">
          <AIUsageInline />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="min-h-[44px] px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary border border-lantern-border rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-lg shadow-sm flex items-center justify-center disabled:opacity-50"
            >
              {isGenerating && <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" aria-hidden />}
              {isGenerating ? 'Generating...' : 'Generate Questions'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default AIGenerateQuestionsModal;

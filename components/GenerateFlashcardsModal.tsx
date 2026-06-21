import React, { useState } from 'react';
import { SparklesIcon, XCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface GenerateFlashcardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (notes: string, count: number) => void;
  isGenerating: boolean;
}

const GenerateFlashcardsModal: React.FC<GenerateFlashcardsModalProps> = ({ isOpen, onClose, onSubmit, isGenerating }) => {
  const [notes, setNotes] = useState('');
  const [count, setCount] = useState<number | ''>(10);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim() || count === '' || Number(count) < 10 || Number(count) > 20) {
      alert("Please provide notes and specify a number of cards between 10 and 20.");
      return;
    }
    onSubmit(notes, Number(count));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-labelledby="generate-cards-modal-title">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl transform">
        <div className="flex justify-between items-center mb-4">
          <h2 id="generate-cards-modal-title" className="text-xl font-semibold text-gray-800 dark:text-gray-100 flex items-center">
            <SparklesIcon className="w-6 h-6 mr-2 text-indigo-500" />
            Generate Flashcards with AI
          </h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Paste your notes below, and our AI will automatically create flashcards for the key concepts.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Your Notes</label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={10}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Paste your lecture notes, a chapter summary, or any text here..."
              required
            />
          </div>
          <div>
            <label htmlFor="cardCount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Number of Cards to Generate</label>
            <input
              type="number"
              id="cardCount"
              value={count}
              onChange={(e) => setCount(e.target.value === '' ? '' : parseInt(e.target.value))}
              min="10"
              max="20"
              required
              className="w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md"
            />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} disabled={isGenerating} className="px-4 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-600 dark:text-gray-200 border border-gray-300 dark:border-gray-500 rounded-md">Cancel</button>
            <button type="submit" disabled={isGenerating} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm flex items-center justify-center disabled:opacity-50">
              {isGenerating && <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />}
              {isGenerating ? 'Generating...' : 'Generate Cards'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GenerateFlashcardsModal;
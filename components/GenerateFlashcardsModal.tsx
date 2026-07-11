import React, { useState } from 'react';
import { useToastStore } from '../stores/toastStore';
import { SparklesIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface GenerateFlashcardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (notes: string, count: number) => void;
  isGenerating: boolean;
}

const GenerateFlashcardsModal: React.FC<GenerateFlashcardsModalProps> = ({ isOpen, onClose, onSubmit, isGenerating }) => {
  const [notes, setNotes] = useState('');
  const [count, setCount] = useState<number | ''>(10);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim() || count === '' || Number(count) < 10 || Number(count) > 20) {
      useToastStore.getState().showToast('Please provide notes and specify a number of cards between 10 and 20.', 'error');
      return;
    }
    onSubmit(notes, Number(count));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="generate-cards-modal-title"
      maxWidthClass="max-w-2xl"
      loading={isGenerating}
      closeOnBackdrop={!isGenerating}
    >
      <div className="flex justify-between items-center mb-4">
        <h2 id="generate-cards-modal-title" className="text-xl font-semibold text-lantern-text flex items-center">
          <SparklesIcon className="w-6 h-6 mr-2 text-lantern-primary" aria-hidden />
          Generate Flashcards with AI
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={isGenerating}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:opacity-50"
          aria-label="Close generate flashcards dialog"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>
      <p className="text-sm text-lantern-text-secondary mb-4">
        Paste your notes below, and our AI will automatically create flashcards for the key concepts.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-lantern-text mb-1">Your Notes</label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={10}
            className="w-full p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            placeholder="Paste your lecture notes, a chapter summary, or any text here..."
            required
          />
        </div>
        <div>
          <label htmlFor="cardCount" className="block text-sm font-medium text-lantern-text mb-1">Number of Cards to Generate</label>
          <input
            type="number"
            id="cardCount"
            value={count}
            onChange={(e) => setCount(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            min="10"
            max="20"
            required
            className="w-full min-h-[44px] p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
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
            {isGenerating ? 'Generating...' : 'Generate Cards'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default GenerateFlashcardsModal;

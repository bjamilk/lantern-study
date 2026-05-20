import React, { useState, useEffect } from 'react';
import { XCircleIcon, RectangleStackIcon } from '@heroicons/react/24/outline';
import { Deck } from '../types';

interface CreateDeckModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { id?: string; name: string; description?: string; isShared?: boolean }) => void;
  editingDeck?: Deck | null;
}

const CreateDeckModal: React.FC<CreateDeckModalProps> = ({ isOpen, onClose, onSubmit, editingDeck }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isShared, setIsShared] = useState(false);
  const isEditing = !!editingDeck;

  useEffect(() => {
    if (isOpen) {
      if (isEditing && editingDeck) {
        setName(editingDeck.name);
        setDescription(editingDeck.description || '');
        setIsShared(!!editingDeck.isShared);
      } else {
        setName('');
        setDescription('');
        setIsShared(false);
      }
    }
  }, [isOpen, editingDeck, isEditing]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Deck name cannot be empty.');
      return;
    }
    onSubmit({
      id: isEditing ? editingDeck.id : undefined,
      name: name.trim(),
      description: description.trim() || undefined,
      isShared,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-labelledby="create-deck-modal-title">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md transform">
        <div className="flex justify-between items-center mb-4">
          <h2 id="create-deck-modal-title" className="text-xl font-semibold text-gray-800 dark:text-gray-100 flex items-center">
            <RectangleStackIcon className="w-6 h-6 mr-2 text-blue-500" />
            {isEditing ? 'Edit Deck' : 'Create New Deck'}
          </h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="deckName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deck Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              id="deckName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
              placeholder="e.g., Biology Chapter 5"
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Pro Tip: The "Minimum Information Principle" is key. Regardless of the format, keep your cards as simple as possible. A card should ideally test one single "atom" of information to avoid mental fatigue.
            </p>
          </div>
          <div>
            <label htmlFor="deckDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description (Optional)</label>
            <textarea
              id="deckDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
              placeholder="A brief description of this deck's content"
            />
          </div>
          <div className="flex items-center space-x-2">
            <input
              id="deckShared"
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="deckShared" className="text-sm font-medium text-gray-700 dark:text-gray-300">Share this deck so others can view and use it</label>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm dark:bg-blue-500 dark:hover:bg-blue-600">{isEditing ? 'Save Changes' : 'Create Deck'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateDeckModal;
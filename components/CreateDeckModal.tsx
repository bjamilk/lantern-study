import React, { useState, useEffect } from 'react';
import { useToastStore } from '../stores/toastStore';
import { RectangleStackIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Course, Deck } from '../types';
import Modal from './ui/Modal';
import { CoursePicker } from './academic/CoursePicker';

interface CreateDeckModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { id?: string; name: string; description?: string; isShared?: boolean; courseId?: string | null }) => void;
  editingDeck?: Deck | null;
}

const CreateDeckModal: React.FC<CreateDeckModalProps> = ({ isOpen, onClose, onSubmit, editingDeck }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [course, setCourse] = useState<Course | string | null>(null);
  const isEditing = !!editingDeck;

  useEffect(() => {
    if (isOpen) {
      if (isEditing && editingDeck) {
        setName(editingDeck.name);
        setDescription(editingDeck.description || '');
        setIsShared(!!editingDeck.isShared);
        setCourse(editingDeck.courseId || null);
      } else {
        setName('');
        setDescription('');
        setIsShared(false);
        setCourse(null);
      }
    }
  }, [isOpen, editingDeck, isEditing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      useToastStore.getState().showToast('Deck name cannot be empty.', 'info');
      return;
    }
    const courseId = typeof course === 'string' ? course : course?.id ?? null;
    onSubmit({
      id: isEditing ? editingDeck.id : undefined,
      name: name.trim(),
      description: description.trim() || undefined,
      isShared,
      courseId,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="create-deck-modal-title" maxWidthClass="max-w-md">
      <div className="flex justify-between items-center mb-4">
        <h2 id="create-deck-modal-title" className="text-xl font-semibold text-lantern-text flex items-center">
          <RectangleStackIcon className="w-6 h-6 mr-2 text-lantern-primary" aria-hidden />
          {isEditing ? 'Edit Deck' : 'Create New Deck'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          aria-label="Close deck dialog"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="deckName" className="block text-sm font-medium text-lantern-text mb-1">
            Deck Name <span className="text-lantern-error">*</span>
          </label>
          <input
            type="text"
            id="deckName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full min-h-[44px] p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text placeholder:text-lantern-text-tertiary focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            placeholder="e.g., Biology Chapter 5"
          />
          <p className="mt-2 text-xs text-lantern-text-muted">
            Pro Tip: Keep cards simple — each card should test one idea to avoid mental fatigue.
          </p>
        </div>
        <div>
          <label htmlFor="deckDescription" className="block text-sm font-medium text-lantern-text mb-1">Description (Optional)</label>
          <textarea
            id="deckDescription"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text placeholder:text-lantern-text-tertiary focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            placeholder="A brief description of this deck's content"
          />
        </div>
        <CoursePicker
          id="deckCourse"
          label={<>Course <span className="text-lantern-text-tertiary font-normal">(optional)</span></>}
          value={course}
          onChange={(next) => setCourse(next)}
          placeholder="File this deck under a course"
        />
        <div className="flex items-center gap-2 min-h-[44px]">
          <input
            id="deckShared"
            type="checkbox"
            checked={isShared}
            onChange={(e) => setIsShared(e.target.checked)}
            className="h-4 w-4 rounded border-lantern-border text-lantern-primary focus:ring-lantern-primary"
          />
          <label htmlFor="deckShared" className="text-sm font-medium text-lantern-text">
            Share this deck so others can view and use it
          </label>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary border border-lantern-border rounded-lg hover:opacity-90"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-lg shadow-sm"
          >
            {isEditing ? 'Save Changes' : 'Create Deck'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateDeckModal;

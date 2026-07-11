import React from 'react';
import { Message } from '../types';
import { CheckBadgeIcon, XMarkIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface DuplicateQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  duplicateInfo: {
    newQuestionData: Omit<Message, 'id' | 'timestamp' | 'sender' | 'upvotes' | 'downvotes'>;
    existingQuestion: Message;
  };
  onUpvoteAndClose: (existingQuestionId: string) => void;
}

const DuplicateQuestionModal: React.FC<DuplicateQuestionModalProps> = ({
  isOpen,
  onClose,
  duplicateInfo,
  onUpvoteAndClose,
}) => {
  const { newQuestionData, existingQuestion } = duplicateInfo;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="duplicate-question-modal-title"
      maxWidthClass="max-w-2xl"
      panelClassName="max-h-[90vh] overflow-y-auto"
    >
      <div className="flex justify-between items-center mb-4">
        <h2 id="duplicate-question-modal-title" className="text-xl font-semibold text-lantern-text flex items-center">
          <CheckBadgeIcon className="w-6 h-6 mr-2 text-lantern-accent" aria-hidden />
          Duplicate Question Found
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          aria-label="Close duplicate question dialog"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>

      <p className="text-sm text-lantern-text-secondary mb-4">
        It looks like a question with the exact same wording already exists in this group. To keep the question bank clean, we can&apos;t add this as a new question.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-b border-lantern-border py-4">
        <div className="p-3 bg-lantern-background-secondary rounded-md">
          <h3 className="font-semibold text-lantern-text">Your Submission</h3>
          <p className="text-sm text-lantern-text-secondary mt-2 whitespace-pre-wrap">{newQuestionData.questionStem}</p>
        </div>
        <div className="p-3 bg-lantern-primary-background rounded-md border border-lantern-primary/30">
          <h3 className="font-semibold text-lantern-primary">Existing Question</h3>
          <p className="text-sm text-lantern-text-secondary mt-2 whitespace-pre-wrap">{existingQuestion.questionStem}</p>
          <p className="text-xs text-lantern-text-muted mt-2">by {existingQuestion.sender.name}</p>
        </div>
      </div>

      <p className="text-sm text-lantern-text-secondary mt-4">
        Instead of creating a new one, how about upvoting the existing question? We&apos;ll even give you{' '}
        <span className="font-bold text-lantern-accent">+5 points</span> for helping out!
      </p>

      <div className="flex justify-end gap-3 mt-6 flex-wrap">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary border border-lantern-border rounded-lg hover:opacity-90"
        >
          Got It
        </button>
        <button
          type="button"
          onClick={() => onUpvoteAndClose(existingQuestion.id)}
          className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-lantern-success hover:opacity-90 border border-transparent rounded-lg shadow-sm"
        >
          Upvote Existing &amp; Get +5 Points
        </button>
      </div>
    </Modal>
  );
};

export default DuplicateQuestionModal;

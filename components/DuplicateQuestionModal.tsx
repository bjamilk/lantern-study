import React from 'react';
import { Message } from '../types';
import { XCircleIcon, CheckBadgeIcon } from '@heroicons/react/24/outline';

interface DuplicateQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  duplicateInfo: { 
    newQuestionData: Omit<Message, 'id' | 'timestamp' | 'sender' | 'upvotes' | 'downvotes'>, 
    existingQuestion: Message 
  };
  onUpvoteAndClose: (existingQuestionId: string) => void;
}

const DuplicateQuestionModal: React.FC<DuplicateQuestionModalProps> = ({ 
  isOpen, 
  onClose, 
  duplicateInfo, 
  onUpvoteAndClose 
}) => {
  if (!isOpen) return null;

  const { newQuestionData, existingQuestion } = duplicateInfo;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-labelledby="duplicate-question-modal-title">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl transform max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 id="duplicate-question-modal-title" className="text-xl font-semibold text-gray-800 dark:text-gray-100 flex items-center">
            <CheckBadgeIcon className="w-6 h-6 mr-2 text-yellow-500" />
            Duplicate Question Found
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" aria-label="Close modal">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          It looks like a question with the exact same wording already exists in this group. To keep the question bank clean, we can't add this as a new question.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-b border-gray-200 dark:border-gray-700 py-4">
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200">Your Submission</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-wrap">{newQuestionData.questionStem}</p>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-md border border-blue-200 dark:border-blue-700">
            <h3 className="font-semibold text-blue-700 dark:text-blue-300">Existing Question</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-wrap">{existingQuestion.questionStem}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">by {existingQuestion.sender.name}</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-300 mt-4">
          Instead of creating a new one, how about upvoting the existing question? We'll even give you <span className="font-bold text-yellow-600 dark:text-yellow-400">+5 points</span> for helping out!
        </p>

        <div className="flex justify-end space-x-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-md"
          >
            Got It
          </button>
          <button
            type="button"
            onClick={() => onUpvoteAndClose(existingQuestion.id)}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 border border-transparent rounded-md shadow-sm"
          >
            Upvote Existing & Get +5 Points ✨
          </button>
        </div>
      </div>
    </div>
  );
};

export default DuplicateQuestionModal;


import React, { useState, useEffect } from 'react';
import { XCircleIcon } from '@heroicons/react/24/outline';
import { Group } from '../types'; // Import Group type
import Modal from './ui/Modal';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, description: string, memberEmails: string, parentId?: string) => void;
  parentId?: string; // For creating sub-groups
  allGroups?: Group[]; // To get parent group name for title
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ 
  isOpen, 
  onClose, 
  onSubmit, 
  parentId, 
  allGroups 
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberEmails, setMemberEmails] = useState('');
  const [modalTitle, setModalTitle] = useState('Create New Study Group');
  const [parentPath, setParentPath] = useState<string[]>([]);

  // Build the parent path for display
  const buildParentPath = (groupId: string, groups: Group[]): string[] => {
    const path: string[] = [];
    let currentId: string | undefined = groupId;
    while (currentId) {
      const group = groups.find(g => g.id === currentId);
      if (group) {
        path.unshift(group.name);
        currentId = group.parentId;
      } else {
        break;
      }
    }
    return path;
  };

  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setMemberEmails('');
      if (parentId && allGroups) {
        const path = buildParentPath(parentId, allGroups);
        setParentPath(path);
        const parentGroup = allGroups.find(g => g.id === parentId);
        setModalTitle(parentGroup ? `Create Sub-group in "${parentGroup.name}"` : 'Create New Sub-group');
      } else {
        setModalTitle('Create New Study Group');
        setParentPath([]);
      }
    }
  }, [isOpen, parentId, allGroups]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), description.trim(), memberEmails.trim(), parentId);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="create-group-modal-title" maxWidthClass="max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 id="create-group-modal-title" className="text-xl font-semibold text-lantern-text dark:text-lantern-text">{modalTitle}</h2>
          <button onClick={onClose} className="text-lantern-text-secondary hover:text-lantern-text dark:text-lantern-text-tertiary dark:hover:text-lantern-text" aria-label="Close modal">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        {parentPath.length > 0 && (
          <div className="mb-4 p-2 bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-md">
            <p className="text-xs text-lantern-text-secondary mb-1">Parent hierarchy:</p>
            <p className="text-sm text-lantern-text">
              {parentPath.map((name, index) => (
                <span key={index}>
                  {index > 0 && <span className="mx-1 text-lantern-text-tertiary">→</span>}
                  <span className={index === parentPath.length - 1 ? 'font-semibold' : ''}>{name}</span>
                </span>
              ))}
            </p>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="groupName" className="block text-sm font-medium text-lantern-text mb-1">
              {parentId ? 'Sub-group Name' : 'Group Name'} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="groupName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border border-lantern-border rounded-md focus:ring-lantern-primary focus:border-lantern-primary shadow-sm bg-lantern-surface dark:bg-lantern-surface-secondary dark:border-lantern-border text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary"
              placeholder={parentId ? "e.g., Chapter 1 Discussions" : "e.g., Organic Chemistry Finals Prep"}
              required
            />
          </div>
          <div className="mb-4">
            <label htmlFor="groupDescription" className="block text-sm font-medium text-lantern-text mb-1">
              Description (Optional)
            </label>
            <textarea
              id="groupDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full p-2 border border-lantern-border rounded-md focus:ring-lantern-primary focus:border-lantern-primary shadow-sm bg-lantern-surface dark:bg-lantern-surface-secondary dark:border-lantern-border text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary"
              placeholder="A brief description of the group's purpose"
            />
          </div>
          <div className="mb-6">
            <label htmlFor="memberEmails" className="block text-sm font-medium text-lantern-text mb-1">
              Invite Members by Email (Optional)
            </label>
            <input
              type="text"
              id="memberEmails"
              value={memberEmails}
              onChange={(e) => setMemberEmails(e.target.value)}
              className="w-full p-2 border border-lantern-border rounded-md focus:ring-lantern-primary focus:border-lantern-primary shadow-sm bg-lantern-surface dark:bg-lantern-surface-secondary dark:border-lantern-border text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary"
              placeholder="email1@example.com, email2@example.com"
            />
            <p className="text-xs text-lantern-text-secondary mt-1">Comma-separated email addresses. Invited members can access this {parentId ? 'sub-group' : 'group'}.</p>
          </div>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary hover:bg-lantern-background-secondary border border-lantern-border rounded-md dark:bg-lantern-surface-secondary dark:text-lantern-text-tertiary dark:border-lantern-border dark:hover:bg-lantern-border focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lantern-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark border border-transparent rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lantern-primary disabled:opacity-50"
              disabled={!name.trim()}
            >
              {parentId ? 'Create Sub-group' : 'Create Group'}
            </button>
          </div>
        </form>
    </Modal>
  );
};

export default CreateGroupModal;
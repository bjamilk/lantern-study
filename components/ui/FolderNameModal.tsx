import React, { useEffect, useState } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import Modal from './Modal';

export interface FolderParentOption {
  id: string;
  name: string;
  color?: string;
}

interface FolderNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** `parentId` is only passed when `parentOptions` were offered (create mode). */
  onSubmit: (name: string, parentId?: string | null) => void;
  title?: string;
  placeholder?: string;
  /** When set, the modal edits an existing folder name. */
  initialName?: string;
  submitLabel?: string;
  /**
   * Offer "Put inside…" — top-level folders the new folder can be nested under
   * (one level, Phase 1 · B). Omit to hide the control (e.g. rename).
   */
  parentOptions?: FolderParentOption[];
  /** Pre-selected parent (e.g. the folder currently open). */
  initialParentId?: string | null;
}

export const FolderNameModal: React.FC<FolderNameModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title = 'New folder',
  placeholder = 'Folder name',
  initialName = '',
  submitLabel,
  parentOptions,
  initialParentId = null,
}) => {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setParentId(initialParentId || '');
    }
  }, [isOpen, initialName, initialParentId]);

  const offersParent = Array.isArray(parentOptions) && parentOptions.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (offersParent) onSubmit(trimmed, parentId || null);
    else onSubmit(trimmed);
    onClose();
  };

  const actionLabel = submitLabel || (initialName ? 'Save' : 'Create');

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="folder-name-title" maxWidthClass="max-w-sm">
      <h2 id="folder-name-title" className="text-lg font-bold text-lantern-text mb-4">{title}</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          maxLength={80}
          aria-label={placeholder}
        />
        {offersParent ? (
          <div>
            <label htmlFor="folder-parent" className="block text-sm font-medium text-lantern-text mb-1">
              Put inside
            </label>
            <select
              id="folder-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary px-3 py-2 text-sm text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
            >
              <option value="">Top level (no parent)</option>
              {parentOptions!.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-lantern-text-secondary">Folders nest one level deep.</p>
          </div>
        ) : null}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose} className="min-h-[44px]">Cancel</Button>
          <Button type="submit" disabled={!name.trim()} className="min-h-[44px]">{actionLabel}</Button>
        </div>
      </form>
    </Modal>
  );
};

export default FolderNameModal;

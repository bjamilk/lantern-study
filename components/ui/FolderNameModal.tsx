import React, { useEffect, useState } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import Modal from './Modal';

interface FolderNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  title?: string;
  placeholder?: string;
}

export const FolderNameModal: React.FC<FolderNameModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title = 'New folder',
  placeholder = 'Folder name',
}) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (isOpen) setName('');
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

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
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose} className="min-h-[44px]">Cancel</Button>
          <Button type="submit" disabled={!name.trim()} className="min-h-[44px]">Create</Button>
        </div>
      </form>
    </Modal>
  );
};

export default FolderNameModal;

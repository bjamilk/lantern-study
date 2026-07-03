import React, { useEffect, useState } from 'react';
import { Button } from './Button';
import { Input } from './Input';

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

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="folder-name-title">
      <div className="w-full max-w-sm rounded-2xl bg-lantern-surface border border-lantern-border shadow-xl p-6">
        <h2 id="folder-name-title" className="text-lg font-bold text-lantern-text mb-4">{title}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            maxLength={80}
          />
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name.trim()}>Create</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FolderNameModal;

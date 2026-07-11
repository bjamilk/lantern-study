import React, { useEffect, useState } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import { useToastStore } from '../stores/toastStore';
import { XCircleIcon, UserIcon, TrashIcon } from '@heroicons/react/24/outline';
import { User } from '../types';
import { searchUsers } from '../services/supabase';
import * as notesApi from '../services/notes';
import Modal from './ui/Modal';

interface NoteCollaborator {
  noteId: string;
  userId: string;
  role: string;
  addedAt: string;
  user?: { id: string; name?: string; avatarUrl?: string };
}

interface NoteCollaboratorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  noteId: string;
  currentUserId?: string;
}

const NoteCollaboratorsModal: React.FC<NoteCollaboratorsModalProps> = ({
  isOpen,
  onClose,
  noteId,
  currentUserId,
}) => {
  const [collaborators, setCollaborators] = useState<NoteCollaborator[]>([]);
  const [inviteValue, setInviteValue] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [userSuggestions, setUserSuggestions] = useState<User[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);

  const loadCollaborators = async () => {
    if (!noteId) return;
    setIsLoading(true);
    try {
      const data = await notesApi.fetchNoteCollaborators(noteId);
      setCollaborators(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load note collaborators', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadCollaborators();
      setInviteValue('');
      setSelectedUserId('');
      setUserQuery('');
      setUserSuggestions([]);
    }
  }, [isOpen, noteId]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (!userQuery.trim()) {
        setUserSuggestions([]);
        return;
      }
      if (userQuery.trim().length < 2) {
        setUserSuggestions([]);
        return;
      }
      setIsSearchingUsers(true);
      searchUsers(userQuery.trim(), 10)
        .then((users) => setUserSuggestions(users.map((u) => ({
          id: u.id,
          name: u.name || '',
          username: u.username || undefined,
          avatarUrl: u.avatarUrl,
        }))))
        .catch(() => setUserSuggestions([]))
        .finally(() => setIsSearchingUsers(false));
    }, 250);
    return () => clearTimeout(handler);
  }, [userQuery]);

  const handleAdd = async () => {
    const target = (selectedUserId || inviteValue).trim();
    if (!target) return;
    setIsSaving(true);
    try {
      await notesApi.addNoteCollaborator(noteId, target, 'editor');
      await loadCollaborators();
      setInviteValue('');
      setSelectedUserId('');
      setUserQuery('');
      setUserSuggestions([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add collaborator.';
      useToastStore.getState().showToast(message, 'info');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!(await confirmDialog({ title: 'Please confirm', message: "Remove this collaborator?", danger: true }))) return;
    try {
      await notesApi.removeNoteCollaborator(noteId, userId);
      setCollaborators(prev => prev.filter(c => c.userId !== userId));
    } catch (err) {
      console.error('Failed to remove collaborator', err);
      useToastStore.getState().showToast('Failed to remove collaborator.', 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="note-collaborators-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 overflow-hidden"
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-lantern-border">
          <h2 id="note-collaborators-title" className="text-lg font-semibold text-lantern-text flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-lantern-primary" aria-hidden />
            Note Collaborators
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Close note collaborators dialog"
          >
            <XCircleIcon className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-lantern-text-secondary mb-4">
            Invite someone by searching their name, or enter their @username or email.
          </p>

          <div className="relative mb-4">
            <input
              value={userQuery || inviteValue}
              onChange={(e) => {
                const value = e.target.value;
                setUserQuery(value);
                setInviteValue(value);
                setSelectedUserId('');
              }}
              placeholder="Search name, @username, or email"
              aria-label="Search users to invite"
              className="w-full min-h-[44px] p-2 border rounded-lg bg-lantern-surface border-lantern-border text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            />
            {isSearchingUsers && (
              <div className="absolute right-2 top-2 text-xs text-lantern-text-muted">Searching…</div>
            )}
            {userSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-lantern-surface border border-lantern-border rounded-lg shadow-lg z-50">
                {userSuggestions.map(user => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedUserId(user.id);
                      setInviteValue(user.id);
                      setUserQuery(user.name ? `${user.name}${user.email ? ` (${user.email})` : ''}` : user.email || user.id);
                      setUserSuggestions([]);
                    }}
                    className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-lantern-background-secondary"
                  >
                    <div className="text-sm font-medium text-lantern-text">
                      {user.name || user.email || user.id}
                    </div>
                    <div className="text-xs text-lantern-text-muted">
                      {user.username ? `@${user.username}` : user.email || user.id}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end mb-4">
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={!(selectedUserId || inviteValue).trim() || isSaving}
              className="min-h-[44px] px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
            >
              {isSaving ? 'Adding…' : 'Add Collaborator'}
            </button>
          </div>

          <div className="space-y-3 max-h-60 overflow-y-auto">
            {isLoading ? (
              <div className="text-sm text-lantern-text-muted">Loading collaborators…</div>
            ) : collaborators.length === 0 ? (
              <div className="text-sm text-lantern-text-muted">No collaborators yet.</div>
            ) : (
              collaborators.map(collab => (
                <div key={collab.userId} className="flex items-center justify-between p-3 bg-lantern-background-secondary rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-lantern-text">
                      {collab.user?.name || collab.userId}
                    </div>
                    <div className="text-xs text-lantern-text-muted">{collab.role}</div>
                  </div>
                  {collab.userId !== currentUserId && (
                    <button
                      type="button"
                      onClick={() => void handleRemove(collab.userId)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-error hover:opacity-80 rounded-lg"
                      title="Remove collaborator"
                      aria-label="Remove collaborator"
                    >
                      <TrashIcon className="w-5 h-5" aria-hidden />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
    </Modal>
  );
};

export default NoteCollaboratorsModal;

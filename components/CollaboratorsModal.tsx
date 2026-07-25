import React, { useEffect, useMemo, useState } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import { useToastStore } from '../stores/toastStore';
import { XCircleIcon, PlusIcon, UserIcon, TrashIcon } from '@heroicons/react/24/outline';
import { DeckCollaborator, User } from '../types';
import { addDeckCollaborator, fetchDeckCollaborators, searchUsers, removeDeckCollaborator } from '../services/supabase';

interface CollaboratorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  deckId: string;
  currentUserId?: string;
}

import Modal from './ui/Modal';

const CollaboratorsModal: React.FC<CollaboratorsModalProps> = ({ isOpen, onClose, deckId, currentUserId }) => {
  const [collaborators, setCollaborators] = useState<DeckCollaborator[]>([]);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<'viewer' | 'editor' | 'owner'>('editor');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [userQuery, setUserQuery] = useState('');
  const [userSuggestions, setUserSuggestions] = useState<User[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);

  const loadCollaborators = async () => {
    if (!deckId) return;
    setIsLoading(true);
    try {
      const data = await fetchDeckCollaborators(deckId);
      setCollaborators(data);
    } catch (err) {
      console.error('Failed to load collaborators', err);
    } finally {
      setIsLoading(false);
    }
  };

  const searchUsersForCollaborator = async (query: string) => {
    if (query.trim().replace(/^@+/, '').length < 2) {
      setUserSuggestions([]);
      return;
    }
    setIsSearchingUsers(true);
    try {
      const users = await searchUsers(query.trim(), 10);
      setUserSuggestions(users.map((u: { id: string; name?: string; username?: string | null }) => ({
        id: u.id,
        name: u.name || '',
        username: u.username || undefined,
        email: '',
        password: '',
        phoneNumber: '',
        avatarUrl: '',
        points: 0,
        badges: [],
        stats: {} as User['stats'],
      })));
    } catch (err) {
      console.error('Failed to search users', err);
      setUserSuggestions([]);
    } finally {
      setIsSearchingUsers(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCollaborators();
    }
  }, [isOpen, deckId]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (userQuery.trim()) {
        searchUsersForCollaborator(userQuery.trim());
      } else {
        setUserSuggestions([]);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [userQuery]);

  const handleAdd = async () => {
    const targetId = newUserId.trim();
    if (!targetId) return;
    setIsSaving(true);
    try {
      const added = await addDeckCollaborator(deckId, targetId, newRole);
      setCollaborators(prev => [...prev, added]);
      setNewUserId('');
      setUserQuery('');
      setUserSuggestions([]);
      setNewRole('editor');
    } catch (err) {
      console.error('Failed to add collaborator', err);
      useToastStore.getState().showToast('Failed to add collaborator. Make sure the user ID is correct.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!(await confirmDialog({ title: 'Please confirm', message: "Remove this collaborator?", danger: true }))) return;
    try {
      await removeDeckCollaborator(deckId, userId);
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
      ariaLabelledBy="deck-collaborators-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 overflow-hidden"
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-lantern-border">
          <h2 id="deck-collaborators-title" className="text-lg font-semibold text-lantern-text flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-lantern-primary" aria-hidden />
            Deck Collaborators
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Close deck collaborators dialog"
          >
            <XCircleIcon className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-lantern-text-secondary mb-4">
            Invite people to collaborate on this deck by adding their user ID. They will be able to edit and contribute cards depending on the role.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="relative col-span-2">
              <input
                value={userQuery}
                onChange={(e) => {
                  setUserQuery(e.target.value);
                  setNewUserId(e.target.value);
                }}
                placeholder="Search by username (min 2 chars)"
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
                        setNewUserId(user.id);
                        setUserQuery(user.username ? `@${user.username}` : (user.name || user.id));
                        setUserSuggestions([]);
                      }}
                      className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-lantern-background-secondary"
                    >
                      <div className="text-sm font-medium text-lantern-text">{user.name || user.username || user.id}</div>
                      <div className="text-xs text-lantern-text-muted">{user.username ? `@${user.username}` : user.id}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as 'viewer' | 'editor' | 'owner')}
              aria-label="Collaborator role"
              className="min-h-[44px] p-2 border rounded-lg bg-lantern-surface border-lantern-border text-lantern-text focus:ring-2 focus:ring-lantern-primary"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
          </div>

          <div className="flex justify-end mb-4">
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={!newUserId.trim() || isSaving}
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
                    <div className="text-sm font-semibold text-lantern-text">{collab.profile?.name || collab.userId}</div>
                    <div className="text-xs text-lantern-text-muted">{collab.role}</div>
                    <div className="text-xs text-lantern-text-muted">Added {new Date(collab.addedAt).toLocaleString()}</div>
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

export default CollaboratorsModal;

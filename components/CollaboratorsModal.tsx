import React, { useEffect, useMemo, useState } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import { useToastStore } from '../stores/toastStore';
import { XCircleIcon, PlusIcon, UserIcon, TrashIcon } from '@heroicons/react/24/outline';
import { DeckCollaborator, User } from '../types';
import { addDeckCollaborator, fetchDeckCollaborators, fetchUsers, removeDeckCollaborator } from '../services/supabase';

interface CollaboratorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  deckId: string;
  currentUserId?: string;
}

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

  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setUserSuggestions([]);
      return;
    }
    setIsSearchingUsers(true);
    try {
      const users = await fetchUsers(query, { limit: 10 });
      setUserSuggestions(users);
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
        searchUsers(userQuery.trim());
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
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-indigo-600" />
            Deck Collaborators
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
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
                placeholder="Search users by name/email"
                className="w-full p-2 border rounded-md bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100"
              />
              {isSearchingUsers && (
                <div className="absolute right-2 top-2 text-xs text-slate-500">Searching…</div>
              )}
              {userSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg z-50">
                  {userSuggestions.map(user => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => {
                        setNewUserId(user.id);
                        setUserQuery(`${user.name || ''} (${user.email || ''})`);
                        setUserSuggestions([]);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{user.name || user.email || user.id}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{user.email || user.id}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as any)}
              className="p-2 border rounded-md bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
          </div>

          <div className="flex justify-end mb-4">
            <button
              onClick={handleAdd}
              disabled={!newUserId.trim() || isSaving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-md text-sm font-semibold"
            >
              {isSaving ? 'Adding…' : 'Add Collaborator'}
            </button>
          </div>

          <div className="space-y-3 max-h-60 overflow-y-auto">
            {isLoading ? (
              <div className="text-sm text-slate-500">Loading collaborators…</div>
            ) : collaborators.length === 0 ? (
              <div className="text-sm text-slate-500">No collaborators yet.</div>
            ) : (
              collaborators.map(collab => (
                <div key={collab.userId} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{collab.profile?.name || collab.userId}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{collab.role}</div>
                    <div className="text-xs text-slate-400">Added {new Date(collab.addedAt).toLocaleString()}</div>
                  </div>
                  {collab.userId !== currentUserId && (
                    <button
                      onClick={() => handleRemove(collab.userId)}
                      className="p-2 text-red-600 hover:text-red-800 rounded-md"
                      title="Remove collaborator"
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollaboratorsModal;

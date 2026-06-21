import React, { useEffect, useState } from 'react';
import { XCircleIcon, UserIcon, TrashIcon } from '@heroicons/react/24/outline';
import { User } from '../types';
import { fetchUsers } from '../services/supabase';
import * as notesApi from '../services/notes';

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
      setIsSearchingUsers(true);
      fetchUsers(userQuery.trim(), { limit: 10 })
        .then(setUserSuggestions)
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
      alert(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!window.confirm('Remove this collaborator?')) return;
    try {
      await notesApi.removeNoteCollaborator(noteId, userId);
      setCollaborators(prev => prev.filter(c => c.userId !== userId));
    } catch (err) {
      console.error('Failed to remove collaborator', err);
      alert('Failed to remove collaborator.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-indigo-600" />
            Note Collaborators
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
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
                      setSelectedUserId(user.id);
                      setInviteValue(user.id);
                      setUserQuery(user.name ? `${user.name}${user.email ? ` (${user.email})` : ''}` : user.email || user.id);
                      setUserSuggestions([]);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {user.name || user.email || user.id}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
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
              onClick={handleAdd}
              disabled={!(selectedUserId || inviteValue).trim() || isSaving}
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
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {collab.user?.name || collab.userId}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{collab.role}</div>
                  </div>
                  {collab.userId !== currentUserId && (
                    <button
                      type="button"
                      onClick={() => void handleRemove(collab.userId)}
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

export default NoteCollaboratorsModal;

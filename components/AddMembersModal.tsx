import React, { useState, useEffect, useRef } from 'react';
import { Group } from '../types';
import { XMarkIcon, UserPlusIcon, MagnifyingGlassIcon, CheckIcon, UsersIcon, AtSymbolIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { searchUsers } from '../services/supabase';
import GroupInviteLinkPanel from './GroupInviteLinkPanel';
import { buildGroupInviteLink } from '../utils/groupInvite';
import Modal from './ui/Modal';

interface SearchResult {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string;
  avatar_url: string | null;
}

interface AddMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (userIds: string[]) => Promise<void> | void;
  group: Group;
  currentUser: { id: string };
}

const AddMembersModal: React.FC<AddMembersModalProps> = ({ isOpen, onClose, onSubmit, group, currentUser }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setSearchResults([]);
      setSelectedUserIds([]);
      setSearchError('');
      setSuccessMessage('');
      // Auto-focus the search input after a short delay for animation
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Debounced search for users by username or name using Supabase RPC
  useEffect(() => {
    if (!searchTerm.trim() || searchTerm.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setSearchError('');

    const timeoutId = setTimeout(async () => {
      try {
        const data = await searchUsers(searchTerm.trim(), 20);
        const groupMemberIds = new Set(group.members?.map(m => m.id) || []);
        const filtered = (data || []).filter((user: SearchResult) => 
          !groupMemberIds.has(user.id)
        );
        setSearchResults(filtered);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchError(err instanceof Error ? err.message : 'Failed to search. Please try again.');
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, group.members, currentUser.id]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (selectedUserIds.length > 0 && !isSubmitting) {
      const count = selectedUserIds.length;
      setIsSubmitting(true);
      try {
        await onSubmit(selectedUserIds);
        setSelectedUserIds([]);
        setSearchTerm('');
        setSearchResults([]);
        setSuccessMessage(`${count} member${count !== 1 ? 's' : ''} added successfully!`);
        setTimeout(() => {
          setSuccessMessage('');
          onClose();
        }, 1800);
      } catch (error) {
        console.error('Failed to add members:', error);
        setSearchError('Failed to add members. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleUserToggle = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const inviteLink = group.inviteId ? buildGroupInviteLink(group.inviteId) : '';

  const getAvatarUrl = (user: SearchResult) => {
    if (user.avatar_url) return user.avatar_url;
    const name = user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=40`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="add-members-modal-title"
      maxWidthClass="max-w-lg"
      loading={isSubmitting}
      closeOnBackdrop={!isSubmitting}
      panelClassName="!p-0 h-[80vh] max-h-[40rem] flex flex-col overflow-hidden"
    >
        <div className="flex justify-between items-center px-6 py-4 border-b border-lantern-border flex-shrink-0">
          <h2 id="add-members-modal-title" className="text-xl font-semibold text-lantern-text flex items-center min-w-0">
            <UserPlusIcon className="w-6 h-6 mr-2 text-lantern-primary shrink-0" aria-hidden />
            <span className="truncate">Add Members to &quot;{group.name}&quot;</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Close add members dialog"
          >
            <XMarkIcon className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col flex-1 min-h-0 bg-lantern-surface">
        {successMessage && (
          <div className="mb-3 p-3 bg-lantern-success/10 border border-lantern-success/30 rounded-lg flex items-center text-lantern-success">
            <CheckCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" aria-hidden />
            <span className="text-sm font-medium">{successMessage}</span>
          </div>
        )}

        {/* Search input — always visible at top */}
        <div className="relative mb-3 flex-shrink-0">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-lantern-text-tertiary" />
          </div>
          <input
            ref={searchInputRef}
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 p-2.5 border border-lantern-border dark:bg-lantern-surface-secondary dark:text-lantern-text rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary"
            placeholder="Search by name or @username"
          />
        </div>

        {/* Search results area — scrollable middle */}
        <div className="flex-1 overflow-y-auto border dark:border-lantern-border rounded-lg min-h-0">
          {isSearching && (
            <div className="p-8 flex justify-center">
              <svg className="animate-spin h-6 w-6 text-lantern-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          )}

          {searchError && (
            <div className="p-4 text-center text-sm text-red-500">{searchError}</div>
          )}

          {!isSearching && !searchError && searchTerm.length < 2 && (
            <div className="p-8 text-center">
              <AtSymbolIcon className="w-12 h-12 mx-auto text-lantern-text-tertiary dark:text-lantern-text-secondary mb-3" />
              <p className="text-sm text-lantern-text-secondary">
                Type at least 2 characters to search for users
              </p>
              <p className="text-xs text-lantern-text-tertiary mt-1">
                Search by name or @username
              </p>
            </div>
          )}

          {!isSearching && !searchError && searchTerm.length >= 2 && searchResults.length === 0 && (
            <div className="p-8 text-center">
              <UsersIcon className="w-12 h-12 mx-auto text-lantern-text-tertiary dark:text-lantern-text-secondary mb-3" />
              <p className="text-sm text-lantern-text-secondary">
                No users found matching "{searchTerm}"
              </p>
              <p className="text-xs text-lantern-text-tertiary mt-2 max-w-xs mx-auto">
                They may need to set a username in Settings, or their profile may be private.
                Try the invite link below instead.
              </p>
            </div>
          )}

          {!isSearching && searchResults.length > 0 && (
            <ul className="divide-y divide-lantern-border">
              {searchResults.map(user => {
                const isSelected = selectedUserIds.includes(user.id);
                return (
                  <li key={user.id} className={isSelected ? 'bg-blue-50 dark:bg-blue-900/50' : ''}>
                    <button
                      type="button"
                      onClick={() => handleUserToggle(user.id)}
                      className={`w-full p-3 flex items-center text-left transition-colors ${isSelected ? '' : 'hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary/50'}`}
                    >
                      <div className="relative">
                        <img src={getAvatarUrl(user)} alt={user.name} className="w-10 h-10 rounded-full mr-3" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }} />
                        {isSelected && (
                          <div className="absolute bottom-0 right-2 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center border-2 border-white dark:border-lantern-border">
                            <CheckIcon className="w-3 h-3 text-white"/>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-lantern-text truncate">{user.name}</p>
                        {user.username && (
                          <p className="text-sm text-lantern-primary dark:text-blue-400">@{user.username}</p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Invite link section — always visible at bottom */}
        {inviteLink && (
          <div className="mt-3 pt-3 border-t border-lantern-border flex-shrink-0">
            <div className="flex items-center text-xs text-lantern-text-secondary mb-2">
              <div className="flex-1 border-t border-lantern-border"></div>
              <span className="px-3 uppercase tracking-wider font-medium">or share invite link</span>
              <div className="flex-1 border-t border-lantern-border"></div>
            </div>
            <GroupInviteLinkPanel inviteLink={inviteLink} groupName={group.name} compact />
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end space-x-3 pt-4 mt-3 border-t border-lantern-border flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary dark:bg-lantern-surface-secondary hover:bg-lantern-background-secondary dark:hover:bg-lantern-border border border-lantern-border rounded-lg"
          >
            {selectedUserIds.length > 0 ? 'Cancel' : 'Done'}
          </button>
          {selectedUserIds.length > 0 && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`px-4 py-2 text-sm font-medium text-white border border-transparent rounded-lg shadow-sm ${isSubmitting ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {isSubmitting ? 'Adding...' : `Add ${selectedUserIds.length} Member${selectedUserIds.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
        </div>
    </Modal>
  );
};

export default AddMembersModal;
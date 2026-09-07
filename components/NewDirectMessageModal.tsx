import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import { normalizeUserSearchQuery } from '@lantern/shared';
import { searchUsers } from '../services/supabase';
import Modal from './ui/Modal';
import { AppIcon } from './ui/AppIcon';

interface SearchResult {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string;
  avatar_url: string | null;
}

interface NewDirectMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onStartDm: (userId: string) => void;
}

const getAvatarUrl = (user: SearchResult) => {
  if (user.avatar_url) return user.avatar_url;
  const name = user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User';
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=100`;
};

const NewDirectMessageModal: React.FC<NewDirectMessageModalProps> = ({ isOpen, onClose, currentUser, onStartDm }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSearchResults([]);
      setSearchError('');
      setIsSearching(false);
      searchRequestIdRef.current += 1;
    }
  }, [isOpen]);

  useEffect(() => {
    if (normalizeUserSearchQuery(searchTerm).length < 2) {
      setSearchResults([]);
      setSearchError('');
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchError('');
    const requestId = ++searchRequestIdRef.current;

    const timeoutId = setTimeout(async () => {
      try {
        const data = await searchUsers(searchTerm.trim(), 20);
        if (requestId !== searchRequestIdRef.current) return;
        const filtered = (data || []).filter((user: SearchResult) => user.id !== currentUser.id);
        setSearchResults(filtered);
      } catch (err) {
        if (requestId !== searchRequestIdRef.current) return;
        console.error('Search failed:', err);
        setSearchError(err instanceof Error ? err.message : 'Failed to search. Please try again.');
        setSearchResults([]);
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, currentUser.id]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="new-dm-modal-title" maxWidthClass="max-w-md" panelClassName="flex h-[70vh] max-h-[35rem] flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 id="new-dm-modal-title" className="text-xl font-semibold text-lantern-text dark:text-lantern-text">New Message</h2>
          <button onClick={onClose} className="text-lantern-text-secondary hover:text-lantern-text dark:text-lantern-text-tertiary dark:hover:text-lantern-text">
            <AppIcon name="close-circle" size={24} />
          </button>
        </div>
        
        <div className="relative mb-3 flex-shrink-0">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <AppIcon name="search" size={20} className="text-lantern-text-tertiary" />
          </div>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 p-2 border border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text focus:ring-lantern-primary focus:border-lantern-primary"
            placeholder="Search by name or @username…"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto border-t border-lantern-border -mx-6 px-6 pt-3">
          {isSearching && (
            <div className="p-8 flex justify-center">
              <svg className="animate-spin h-6 w-6 text-lantern-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          )}

          {searchError && (
            <p className="p-4 text-center text-sm text-red-500">{searchError}</p>
          )}

          {!isSearching && !searchError && searchTerm.trim().length < 2 && (
            <p className="p-4 text-center text-sm text-lantern-text-secondary">
              Type at least 2 characters to search by name or @username.
            </p>
          )}

           <ul className="divide-y divide-lantern-border">
            {!isSearching && searchResults.map(user => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => onStartDm(user.id)}
                    className="w-full p-3 flex items-center text-left hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary/50 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
                  >
                  <img src={getAvatarUrl(user)} alt="" className="w-10 h-10 rounded-full mr-3" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }} />
                  <div>
                    <p className="font-medium text-lantern-text">{user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim()}</p>
                    {user.username && (
                      <p className="text-sm text-lantern-primary">@{user.username}</p>
                    )}
                  </div>
                  </button>
                </li>
              )
            )}
             {!isSearching && !searchError && searchTerm.trim().length >= 2 && searchResults.length === 0 && (
                <p className="p-4 text-center text-sm text-lantern-text-secondary">No users found.</p>
             )}
          </ul>
        </div>
    </Modal>
  );
};

export default NewDirectMessageModal;

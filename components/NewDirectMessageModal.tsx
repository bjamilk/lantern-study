import React, { useState, useMemo } from 'react';
import { User } from '../types';
import { XCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface NewDirectMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  allUsers: User[];
  onStartDm: (userId: string) => void;
}

const NewDirectMessageModal: React.FC<NewDirectMessageModalProps> = ({ isOpen, onClose, currentUser, allUsers, onStartDm }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredUsers = useMemo(() => {
    if (!searchTerm.trim()) {
      return []; // Don't show anyone until user starts typing
    }
    return allUsers.filter(user =>
      user.id !== currentUser.id &&
      (user.name.toLowerCase().includes(searchTerm.trim().toLowerCase()) ||
       user.email?.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    );
  }, [searchTerm, allUsers, currentUser]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="new-dm-modal-title" maxWidthClass="max-w-md" panelClassName="flex h-[70vh] max-h-[35rem] flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 id="new-dm-modal-title" className="text-xl font-semibold text-gray-800 dark:text-gray-100">New Message</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="relative mb-3 flex-shrink-0">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          </div>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Search for a user..."
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto border-t border-gray-200 dark:border-gray-700 -mx-6 px-6 pt-3">
           <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredUsers.map(user => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => onStartDm(user.id)}
                    className="w-full p-3 flex items-center text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
                  >
                  <img src={user.avatarUrl} alt="" className="w-10 h-10 rounded-full mr-3" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }} />
                  <div>
                    <p className="font-medium text-gray-800 dark:text-gray-200">{user.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
                  </div>
                  </button>
                </li>
              )
            )}
             {searchTerm && filteredUsers.length === 0 && (
                <p className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">No users found.</p>
             )}
             {!searchTerm && (
                <p className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">Start typing to find someone to message.</p>
             )}
          </ul>
        </div>
    </Modal>
  );
};

export default NewDirectMessageModal;

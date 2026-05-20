import React, { useState, useEffect } from 'react';
import { XMarkIcon, CheckCircleIcon, ExclamationCircleIcon, UserIcon } from '@heroicons/react/24/outline';
import { supabase } from '../services/supabase';
import type { User } from '../types';

interface UsernameRequiredModalProps {
  isOpen: boolean;
  currentUser: User;
  onClose: () => void;
  onSuccess: (username: string, firstName: string, lastName: string) => void;
}

const UsernameRequiredModal: React.FC<UsernameRequiredModalProps> = ({
  isOpen,
  currentUser,
  onClose,
  onSuccess,
}) => {
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Username validation regex: lowercase alphanumeric + underscore, 3-20 chars
  const usernameRegex = /^[a-z0-9_]{3,20}$/;

  // Initialize name fields from current user's name
  useEffect(() => {
    const currentName = currentUser?.name || '';
    if (currentName) {
      const parts = currentName.trim().split(' ');
      if (parts.length >= 2) {
        setFirstName(parts[0]);
        setLastName(parts.slice(1).join(' '));
      } else if (parts.length === 1) {
        setFirstName(parts[0]);
      }
    }
  }, [currentUser]);

  // Debounced username availability check using Supabase RPC
  useEffect(() => {
    if (!username) return;
    
    const normalizedUsername = username.toLowerCase().trim();
    
    // Validate format first
    if (!usernameRegex.test(normalizedUsername)) {
      setUsernameError('3-20 characters: letters, numbers, underscore only');
      setUsernameAvailable(null);
      return;
    }
    
    setUsernameError('');
    setCheckingUsername(true);
    
    const timeoutId = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('is_username_available', {
          check_username: normalizedUsername,
        });

        if (error) {
          console.error('Username check error:', error);
          setCheckingUsername(false);
          return;
        }

        setUsernameAvailable(data === true);
        if (data === false) {
          setUsernameError('Username is already taken');
        }
      } catch (err) {
        console.error('Username check failed:', err);
      } finally {
        setCheckingUsername(false);
      }
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('Please enter a username.');
      return;
    }

    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your first and last name.');
      return;
    }

    const normalizedUsername = username.toLowerCase().trim();
    if (!usernameRegex.test(normalizedUsername)) {
      setError('Username must be 3-20 characters, using only lowercase letters, numbers, and underscores.');
      return;
    }

    if (usernameAvailable === false) {
      setError('This username is already taken. Please choose another.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Update username and profile info directly via Supabase
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          username: normalizedUsername,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          name: `${firstName.trim()} ${lastName.trim()}`,
        })
        .eq('id', currentUser.id);

      if (updateError) {
        if (updateError.code === '23505') {
          // Unique constraint violation
          setError('This username is already taken. Please choose another.');
        } else {
          setError(updateError.message || 'Failed to save username. Please try again.');
        }
        return;
      }

      onSuccess(normalizedUsername, firstName.trim(), lastName.trim());
    } catch (err) {
      console.error('Failed to save username:', err);
      setError('Failed to save username. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-50 dark:bg-slate-700 px-6 py-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Complete Your Profile
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Choose a unique username to help others find and invite you to study groups.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* First & Last Name */}
          <div className="flex space-x-4">
            <div className="w-1/2">
              <label htmlFor="modalFirstName" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                First Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <UserIcon className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="modalFirstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="First"
                />
              </div>
            </div>
            <div className="w-1/2">
              <label htmlFor="modalLastName" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Last Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <UserIcon className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="modalLastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Last"
                />
              </div>
            </div>
          </div>

          {/* Username */}
          <div>
            <label htmlFor="modalUsername" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-slate-400 font-medium">@</span>
              </div>
              <input
                id="modalUsername"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                className={`w-full pl-8 pr-10 py-2.5 border rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 ${
                  usernameError ? 'border-red-500 focus:ring-red-500' : 
                  usernameAvailable === true ? 'border-green-500 focus:ring-green-500' : 
                  'border-slate-300 dark:border-slate-600 focus:ring-indigo-500'
                }`}
                placeholder="your_username"
                maxLength={20}
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                {checkingUsername && (
                  <svg className="animate-spin h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {!checkingUsername && usernameAvailable === true && (
                  <CheckCircleIcon className="h-5 w-5 text-green-500" />
                )}
                {!checkingUsername && usernameError && (
                  <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
                )}
              </div>
            </div>
            {usernameError && (
              <p className="mt-1 text-xs text-red-500">{usernameError}</p>
            )}
            {!usernameError && username && usernameAvailable === true && (
              <p className="mt-1 text-xs text-green-500">@{username} is available!</p>
            )}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              3-20 characters: lowercase letters, numbers, and underscores only
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 p-3 rounded-lg">
              <ExclamationCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !username || !firstName || !lastName || usernameAvailable === false || checkingUsername}
            className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-800 focus:ring-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              'Save & Continue'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default UsernameRequiredModal;

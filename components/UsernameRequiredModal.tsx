import React, { useState, useEffect } from 'react';
import { XMarkIcon, CheckCircleIcon, ExclamationCircleIcon, UserIcon } from '@heroicons/react/24/outline';
import { checkUsernameAvailability, updateUsername } from '../services/supabase';
import type { User } from '../types';
import Modal from './ui/Modal';

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

  const usernameRegex = /^[a-z0-9_]{3,20}$/;

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

  useEffect(() => {
    if (!username) return;

    const normalizedUsername = username.toLowerCase().trim();

    if (!usernameRegex.test(normalizedUsername)) {
      setUsernameError('3-20 characters: letters, numbers, underscore only');
      setUsernameAvailable(null);
      return;
    }

    setUsernameError('');
    setCheckingUsername(true);
    let cancelled = false;

    const timeoutId = setTimeout(async () => {
      try {
        const available = await Promise.race([
          checkUsernameAvailability(normalizedUsername),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Username availability check timed out')), 8000)
          ),
        ]);
        if (cancelled) return;
        setUsernameAvailable(available);
        if (!available) {
          setUsernameError('Username is already taken');
        }
      } catch (err) {
        console.error('Username check failed:', err);
        // Don't hard-block Save if the availability probe fails; server still validates.
        if (!cancelled) setUsernameAvailable(null);
      } finally {
        if (!cancelled) setCheckingUsername(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
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
      await updateUsername(currentUser.id, normalizedUsername, firstName.trim(), lastName.trim());
      onSuccess(normalizedUsername, firstName.trim(), lastName.trim());
    } catch (err: unknown) {
      console.error('Failed to save username:', err);
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already taken') || message.includes('23505')) {
        setError('This username is already taken. Please choose another.');
      } else {
        setError(message || 'Failed to save username. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="username-required-title"
      maxWidthClass="max-w-md"
      loading={isSubmitting}
      closeOnBackdrop={!isSubmitting}
      panelClassName="!p-0 overflow-hidden"
    >
      <div className="bg-lantern-primary-background px-6 py-4 border-b border-lantern-border">
        <h2 id="username-required-title" className="text-xl font-bold text-lantern-text">
          Complete Your Profile
        </h2>
        <p className="text-sm text-lantern-text-secondary mt-1">
          Choose a unique username to help others find and invite you to study groups.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5 bg-lantern-surface">
        <div className="flex gap-2 sm:gap-4 min-w-0">
          <div className="w-1/2 min-w-0">
            <label htmlFor="modalFirstName" className="block text-sm font-medium text-lantern-text mb-1">
              First Name
            </label>
            <div className="relative min-w-0">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <UserIcon className="h-5 w-5 text-lantern-text-muted" aria-hidden />
              </div>
              <input
                id="modalFirstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                title={firstName}
                className="w-full min-w-0 min-h-[44px] pl-10 pr-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-sm"
                placeholder="First"
              />
            </div>
          </div>
          <div className="w-1/2 min-w-0">
            <label htmlFor="modalLastName" className="block text-sm font-medium text-lantern-text mb-1">
              Last Name
            </label>
            <div className="relative min-w-0">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <UserIcon className="h-5 w-5 text-lantern-text-muted" aria-hidden />
              </div>
              <input
                id="modalLastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                title={lastName}
                className="w-full min-w-0 min-h-[44px] pl-10 pr-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-sm"
                placeholder="Last"
              />
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="modalUsername" className="block text-sm font-medium text-lantern-text mb-1">
            Username
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-lantern-text-muted font-medium">@</span>
            </div>
            <input
              id="modalUsername"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              className={`w-full min-h-[44px] pl-8 pr-10 py-2.5 border rounded-lg bg-lantern-surface text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 ${
                usernameError ? 'border-lantern-error focus:ring-lantern-error' :
                usernameAvailable === true ? 'border-lantern-success focus:ring-lantern-success' :
                'border-lantern-border focus:ring-lantern-primary'
              }`}
              placeholder="your_username"
              maxLength={20}
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              {checkingUsername && (
                <svg className="animate-spin h-5 w-5 text-lantern-text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {!checkingUsername && usernameAvailable === true && (
                <CheckCircleIcon className="h-5 w-5 text-lantern-success" aria-hidden />
              )}
              {!checkingUsername && usernameError && (
                <ExclamationCircleIcon className="h-5 w-5 text-lantern-error" aria-hidden />
              )}
            </div>
          </div>
          {usernameError && <p className="mt-1 text-xs text-lantern-error">{usernameError}</p>}
          {!usernameError && username && usernameAvailable === true && (
            <p className="mt-1 text-xs text-lantern-success">@{username} is available!</p>
          )}
          <p className="mt-1 text-xs text-lantern-text-muted">
            3-20 characters: lowercase letters, numbers, and underscores only
          </p>
        </div>

        {error && (
          <div className="flex items-center text-sm text-lantern-error bg-lantern-error/10 p-3 rounded-lg">
            <ExclamationCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" aria-hidden />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !username.trim() || !firstName.trim() || !lastName.trim() || usernameAvailable === false}
          className="w-full min-h-[44px] flex justify-center py-3 px-4 text-sm font-semibold rounded-lg text-white bg-lantern-primary hover:bg-lantern-primary-dark focus:outline-none focus:ring-2 focus:ring-lantern-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            'Save & Continue'
          )}
        </button>
      </form>
    </Modal>
  );
};

export default UsernameRequiredModal;

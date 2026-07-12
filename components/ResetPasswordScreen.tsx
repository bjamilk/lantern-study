import React, { useState } from 'react';
import { LockClosedIcon, EyeIcon, EyeSlashIcon, ExclamationCircleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { updateAuthPassword } from '../services/supabase';
import { LanternIcon } from './ui/LanternIcon';

interface ResetPasswordScreenProps {
  onComplete: () => void;
}

const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({ onComplete }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await updateAuthPassword(password);
      setSuccess(true);
      window.history.replaceState({}, '', '/');
      setTimeout(() => onComplete(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-lantern-background transition-colors duration-300">
      <div className="w-full max-w-md m-4 bg-lantern-surface/50 dark:border dark:border-lantern-border rounded-3xl shadow-2xl p-8 sm:p-12">
        <div className="text-center mb-8">
          <LanternIcon size={48} className="mx-auto" />
          <h2 className="mt-4 text-3xl font-bold text-lantern-text">Set new password</h2>
          <p className="mt-2 text-sm text-lantern-text-secondary">
            Choose a strong password for your account.
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="newPassword" className="sr-only">New password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <LockClosedIcon className="h-5 w-5 text-lantern-text-tertiary" />
              </div>
              <input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                placeholder="New password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-lantern-text-tertiary hover:text-lantern-text-secondary focus:outline-none"
              >
                {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirmNewPassword" className="sr-only">Confirm new password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <LockClosedIcon className="h-5 w-5 text-lantern-text-tertiary" />
              </div>
              <input
                id="confirmNewPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                placeholder="Confirm new password"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 p-3 rounded-lg">
              <ExclamationCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center text-sm text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 p-3 rounded-lg">
              <CheckCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" />
              Password updated! Redirecting…
            </div>
          )}

          <button
            type="submit"
            disabled={loading || success}
            className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-lg text-white bg-lantern-primary hover:bg-lantern-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-lantern-surface focus:ring-lantern-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPasswordScreen;

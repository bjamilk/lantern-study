import React, { useEffect, useState } from 'react';
import {
  ACCOUNT_DATA_LOSS_ITEMS,
  ACCOUNT_DELETE_CONFIRM_TEXT,
  ACCOUNT_DELETION_GRACE_DAYS,
  ACCOUNT_EXPORT_COPY,
  isSignedExportV2,
} from '@lantern/shared';
import { Button, Input } from './ui';
import { Card } from './ui/Card';
import { ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/24/outline';

export type AccountDeletionChoice = 'pause' | 'immediate';

export interface AccountDeletionModalProps {
  open: boolean;
  onClose: () => void;
  onExport: () => void | Promise<void>;
  onPauseAccount: () => Promise<void>;
  onDeleteImmediate: (password: string) => Promise<void>;
  exporting?: boolean;
  loading?: boolean;
}

type Step = 'warn' | 'choose' | 'confirm';

export const AccountDeletionModal: React.FC<AccountDeletionModalProps> = ({
  open,
  onClose,
  onExport,
  onPauseAccount,
  onDeleteImmediate,
  exporting = false,
  loading = false,
}) => {
  const [step, setStep] = useState<Step>('warn');
  const [choice, setChoice] = useState<AccountDeletionChoice>('pause');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('warn');
      setChoice('pause');
      setConfirmText('');
      setPassword('');
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const canConfirmImmediate =
    choice === 'immediate' &&
    confirmText === ACCOUNT_DELETE_CONFIRM_TEXT &&
    password.length >= 8;

  const handleFinalConfirm = async () => {
    setError(null);
    try {
      if (choice === 'pause') {
        await onPauseAccount();
      } else {
        await onDeleteImmediate(password);
      }
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-deletion-title"
    >
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
            <div>
              <h2 id="account-deletion-title" className="text-lg font-semibold text-lantern-text">
                {step === 'warn' && 'Before you go'}
                {step === 'choose' && 'How should we handle your account?'}
                {step === 'confirm' && (choice === 'pause' ? 'Pause your account' : 'Delete permanently')}
              </h2>
              {step === 'warn' && (
                <p className="text-sm text-lantern-text-secondary mt-1">
                  Deleting your account removes data from Lantern Study. This cannot be undone after the grace period ends.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-lantern-text-secondary hover:text-lantern-text"
            aria-label="Close"
          >
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>

        {step === 'warn' && (
          <>
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-100">
              <p className="font-medium mb-2">Export a backup first (recommended)</p>
              <p className="text-amber-800 dark:text-amber-200/90">{ACCOUNT_EXPORT_COPY.summary}</p>
              <p className="text-xs mt-2 text-amber-700 dark:text-amber-300/80">{ACCOUNT_EXPORT_COPY.limitations}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-lantern-text mb-2">You will permanently lose:</p>
              <ul className="text-sm text-lantern-text-secondary space-y-1 list-disc pl-5">
                {ACCOUNT_DATA_LOSS_ITEMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="secondary" onClick={() => void onExport()} disabled={exporting || loading} className="flex-1">
                {exporting ? 'Exporting…' : 'Export my data first'}
              </Button>
              <Button variant="primary" onClick={() => setStep('choose')} disabled={loading} className="flex-1">
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 'choose' && (
          <>
            <div className="space-y-3">
              <label className="flex gap-3 p-3 rounded-lg border border-lantern-border cursor-pointer hover:bg-lantern-background-secondary">
                <input
                  type="radio"
                  name="deletion-choice"
                  checked={choice === 'pause'}
                  onChange={() => setChoice('pause')}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-lantern-text">Pause account ({ACCOUNT_DELETION_GRACE_DAYS}-day grace period)</p>
                  <p className="text-sm text-lantern-text-secondary mt-1">
                    Your account is disabled immediately, but your data is kept for {ACCOUNT_DELETION_GRACE_DAYS} days.
                    Sign back in anytime to reactivate.
                  </p>
                </div>
              </label>

              <label className="flex gap-3 p-3 rounded-lg border border-red-300 dark:border-red-800 cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/10">
                <input
                  type="radio"
                  name="deletion-choice"
                  checked={choice === 'immediate'}
                  onChange={() => setChoice('immediate')}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-red-700 dark:text-red-300">Delete permanently now</p>
                  <p className="text-sm text-lantern-text-secondary mt-1">
                    Removes your account and data right away. You will need your password. This cannot be undone.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep('warn')} disabled={loading}>
                Back
              </Button>
              <Button variant={choice === 'immediate' ? 'danger' : 'primary'} onClick={() => setStep('confirm')} disabled={loading}>
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            {choice === 'pause' ? (
              <p className="text-sm text-lantern-text-secondary">
                Your account will be paused and scheduled for permanent deletion in{' '}
                <strong>{ACCOUNT_DELETION_GRACE_DAYS} days</strong>. You can reactivate by signing in before that date.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-red-600 dark:text-red-400">
                  Type <strong>{ACCOUNT_DELETE_CONFIRM_TEXT}</strong> and enter your password to confirm permanent deletion.
                </p>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={ACCOUNT_DELETE_CONFIRM_TEXT}
                  autoComplete="off"
                  aria-label="Type DELETE to confirm"
                />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Account password"
                  autoComplete="current-password"
                  aria-label="Account password"
                />
              </div>
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep('choose')} disabled={loading}>
                Back
              </Button>
              <Button
                variant={choice === 'immediate' ? 'danger' : 'primary'}
                onClick={() => void handleFinalConfirm()}
                disabled={loading || (choice === 'immediate' && !canConfirmImmediate)}
              >
                {loading
                  ? 'Working…'
                  : choice === 'pause'
                    ? 'Pause my account'
                    : 'Delete permanently'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default AccountDeletionModal;

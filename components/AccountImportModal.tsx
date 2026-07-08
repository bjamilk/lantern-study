import React, { useRef, useState } from 'react';
import { ACCOUNT_EXPORT_COPY, isSignedExportV2 } from '@lantern/shared';
import { Button, Input } from './ui';
import { Card } from './ui/Card';
import { CloudArrowUpIcon, XCircleIcon } from '@heroicons/react/24/outline';

export interface AccountImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (payload: {
    exportDoc: Record<string, unknown>;
    password: string;
    confirmEmailMismatch: boolean;
  }) => Promise<void>;
  loading?: boolean;
}

export const AccountImportModal: React.FC<AccountImportModalProps> = ({
  open,
  onClose,
  onImport,
  loading = false,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [exportDoc, setExportDoc] = useState<Record<string, unknown> | null>(null);
  const [password, setPassword] = useState('');
  const [confirmEmailMismatch, setConfirmEmailMismatch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFileName(null);
    setExportDoc(null);
    setPassword('');
    setConfirmEmailMismatch(false);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const nested = parsed.data;
      const doc =
        nested && typeof nested === 'object' && isSignedExportV2(nested)
          ? (nested as Record<string, unknown>)
          : isSignedExportV2(parsed)
            ? parsed
            : null;

      if (!doc) {
        setError(
          'This backup is unsigned or outdated. Export a fresh backup from Settings → Export my data, then try again.'
        );
        setExportDoc(null);
        setFileName(null);
        return;
      }

      setExportDoc(doc);
      setFileName(file.name);
    } catch {
      setError('Could not read backup file. Choose a valid Lantern Study JSON export.');
      setExportDoc(null);
      setFileName(null);
    }
  };

  const handleSubmit = async () => {
    if (!exportDoc || password.length < 8) return;
    setError(null);
    try {
      await onImport({ exportDoc, password, confirmEmailMismatch });
      reset();
      onClose();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Import failed';
      setError(message);
      if (message.includes('email does not match')) {
        setConfirmEmailMismatch(true);
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-import-title"
    >
      <Card className="w-full max-w-lg space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="account-import-title" className="text-lg font-semibold text-lantern-text">
              Import account backup
            </h2>
            <p className="text-sm text-lantern-text-secondary mt-1">{ACCOUNT_EXPORT_COPY.restoreHint}</p>
          </div>
          <button type="button" onClick={handleClose} disabled={loading} aria-label="Close">
            <XCircleIcon className="w-6 h-6 text-lantern-text-secondary" />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        <Button
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="w-full"
        >
          <CloudArrowUpIcon className="w-5 h-5 mr-2" />
          {fileName ? fileName : 'Choose backup file (.json)'}
        </Button>

        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your account password"
          autoComplete="current-password"
          aria-label="Account password"
          disabled={loading}
        />

        {confirmEmailMismatch && (
          <label className="flex items-start gap-2 text-sm text-lantern-text-secondary">
            <input
              type="checkbox"
              checked={confirmEmailMismatch}
              onChange={(e) => setConfirmEmailMismatch(e.target.checked)}
              className="mt-1"
            />
            <span>
              This backup was exported from a different email address. I understand and want to import into this account anyway.
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={loading || !exportDoc || password.length < 8}
          >
            {loading ? 'Importing…' : 'Import backup'}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default AccountImportModal;

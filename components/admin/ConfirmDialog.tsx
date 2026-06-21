import React from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { ConfirmState } from './types';

interface ConfirmDialogProps {
  state: ConfirmState;
  confirmInput: string;
  confirmLoading: boolean;
  reasonInput: string;
  onConfirmInputChange: (value: string) => void;
  onReasonInputChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  state,
  confirmInput,
  confirmLoading,
  reasonInput,
  onConfirmInputChange,
  onReasonInputChange,
  onClose,
  onConfirm,
}) => {
  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 p-4">
      <Card className="w-full max-w-md space-y-4">
        <h3 className="text-lg font-semibold text-lantern-text">{state.title}</h3>
        <p className="text-sm text-lantern-text-muted">{state.message}</p>
        {state.reasonField ? (
          <Textarea
            value={reasonInput}
            onChange={(e) => onReasonInputChange(e.target.value)}
            placeholder="Reason (stored in audit log)"
            rows={3}
          />
        ) : null}
        {state.requiredText ? (
          <Input
            value={confirmInput}
            onChange={(e) => onConfirmInputChange(e.target.value)}
            placeholder={`Type ${state.requiredText}`}
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={confirmLoading}>
            Cancel
          </Button>
          <Button variant={state.danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={confirmLoading}>
            {confirmLoading ? 'Working…' : state.confirmLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
};

import React from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import Modal from '../ui/Modal';
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
  return (
    <Modal
      isOpen={state.open}
      onClose={onClose}
      ariaLabelledBy="admin-confirm-dialog-title"
      maxWidthClass="max-w-md"
      loading={confirmLoading}
      closeOnBackdrop={!confirmLoading}
      panelClassName="!p-0 bg-transparent shadow-none dark:bg-transparent"
    >
      <Card className="w-full space-y-4">
        <h3 id="admin-confirm-dialog-title" className="text-lg font-semibold text-lantern-text">{state.title}</h3>
        <p className="text-sm text-lantern-text-muted">{state.message}</p>
        {state.reasonField ? (
          <Textarea
            value={reasonInput}
            onChange={(e) => onReasonInputChange(e.target.value)}
            placeholder="Reason (stored in audit log)"
            rows={3}
            aria-label="Audit reason"
          />
        ) : null}
        {state.requiredText ? (
          <Input
            value={confirmInput}
            onChange={(e) => onConfirmInputChange(e.target.value)}
            placeholder={`Type ${state.requiredText}`}
            aria-label="Confirmation text"
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
    </Modal>
  );
};

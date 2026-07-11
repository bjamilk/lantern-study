import React from 'react';
import { Button } from './Button';
import { Card } from './Card';
import Modal from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <Modal
      isOpen={open}
      onClose={onCancel}
      ariaLabelledBy="confirm-dialog-title"
      maxWidthClass="max-w-md"
      loading={loading}
      closeOnBackdrop={!loading}
      zIndexClass="z-[60]"
      panelClassName="!p-0 bg-transparent shadow-none dark:bg-transparent"
    >
      <Card className="w-full space-y-4">
        <h3 id="confirm-dialog-title" className="text-lg font-semibold text-lantern-text">{title}</h3>
        <p className="text-sm text-lantern-text-muted">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading}>
            {loading ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </Card>
    </Modal>
  );
};

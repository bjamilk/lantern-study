import React, { useEffect } from 'react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Accessible label for the dialog when no visible title is rendered. */
  ariaLabelledBy?: string;
  /** Accessible description id when the modal has supplementary helper text. */
  ariaDescribedBy?: string;
  maxWidthClass?: string;
  loading?: boolean;
  closeOnBackdrop?: boolean;
  panelClassName?: string;
  /** Override stacking when nested above other modals (e.g. z-[80], z-[90]). */
  zIndexClass?: string;
}

/**
 * Shared modal shell: focus trap, Escape to close, body scroll lock, backdrop dismiss.
 */
export function Modal({
  isOpen,
  onClose,
  children,
  ariaLabelledBy,
  ariaDescribedBy,
  maxWidthClass = 'max-w-md',
  loading = false,
  closeOnBackdrop = true,
  panelClassName = '',
  zIndexClass = 'z-50',
}: ModalProps) {
  const dialogRef = useModalFocusTrap(isOpen, onClose, { loading });

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center bg-black/60 p-4 transition-opacity duration-300`}
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && !loading && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className={`w-full ${maxWidthClass} transform rounded-lg bg-white p-6 shadow-xl transition-all duration-300 dark:bg-gray-800 ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

export default Modal;

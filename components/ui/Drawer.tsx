import React, { useEffect } from 'react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  maxWidthClass?: string;
  loading?: boolean;
  closeOnBackdrop?: boolean;
  panelClassName?: string;
  zIndexClass?: string;
  backdropClassName?: string;
  side?: 'left' | 'right';
}

/**
 * Shared slide-in drawer: focus trap, Escape to close, body scroll lock, backdrop dismiss.
 */
export function Drawer({
  isOpen,
  onClose,
  children,
  ariaLabelledBy,
  ariaDescribedBy,
  maxWidthClass = 'max-w-sm',
  loading = false,
  closeOnBackdrop = true,
  panelClassName = '',
  zIndexClass = 'z-[70]',
  backdropClassName = 'bg-black/40',
  side = 'right',
}: DrawerProps) {
  const panelRef = useModalFocusTrap(isOpen, onClose, { loading });

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sideClass = side === 'left' ? 'left-0' : 'right-0';

  return (
    <div className={`fixed inset-0 ${zIndexClass}`} role="presentation">
      <div
        className={`absolute inset-0 ${backdropClassName}`}
        aria-hidden
        onMouseDown={(event) => {
          if (closeOnBackdrop && !loading && event.target === event.currentTarget) {
            onClose();
          }
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className={`fixed top-0 ${sideClass} h-full w-full ${maxWidthClass} flex flex-col bg-lantern-surface shadow-2xl transition-transform duration-300 dark:bg-lantern-surface ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

export default Drawer;

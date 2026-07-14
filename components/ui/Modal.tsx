import React, { useEffect } from 'react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { useModalStackLayer } from '../../hooks/useModalStackLayer';

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
  /** Re-run focus trap when modal inner content changes (e.g. tab panels). */
  focusContentKey?: string;
  closeOnBackdrop?: boolean;
  panelClassName?: string;
  /** Override stacking when nested above other modals (e.g. z-[80], z-[90]). */
  zIndexClass?: string;
  /** Backdrop flex alignment (e.g. items-end sm:items-center for mobile bottom sheets). */
  alignClass?: string;
  /** Backdrop padding (e.g. p-0 sm:p-4 for edge-to-edge mobile sheets). */
  paddingClass?: string;
  /** Extra classes on the backdrop container. */
  backdropClassName?: string;
  /** Inline styles on the dialog panel (e.g. accent border color). */
  panelStyle?: React.CSSProperties;
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
  focusContentKey,
  closeOnBackdrop = true,
  panelClassName = '',
  zIndexClass = 'z-50',
  alignClass = 'items-center justify-center',
  paddingClass = 'p-4',
  backdropClassName = '',
  panelStyle,
}: ModalProps) {
  const stackLayerClass = useModalStackLayer(isOpen);
  const resolvedZIndexClass = zIndexClass === 'z-50' ? stackLayerClass : zIndexClass;
  const dialogRef = useModalFocusTrap(isOpen, onClose, { loading, contentKey: focusContentKey });

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
      className={`fixed inset-0 ${resolvedZIndexClass} flex ${alignClass} bg-black/60 ${paddingClass} transition-opacity duration-300 ${backdropClassName}`}
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
        className={`w-full ${maxWidthClass} max-h-[min(90dvh,920px)] overflow-y-auto overscroll-contain transform rounded-lg bg-lantern-surface p-6 shadow-xl transition-all duration-300 dark:bg-lantern-surface ${panelClassName}`}
        style={panelStyle}
      >
        {children}
      </div>
    </div>
  );
}

export default Modal;

import React, { useEffect } from 'react';
import { AppIcon } from './AppIcon';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  /** When true, toast stays until dismissed and survives navigation/tab changes. */
  sticky?: boolean;
}

interface ToastBannerProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
  autoHideMs?: number;
}

const typeStyles: Record<ToastType, string> = {
  success: 'bg-lantern-success text-white',
  error: 'bg-lantern-error-strong text-white',
  info: 'bg-lantern-primary text-white',
};

export const ToastBanner: React.FC<ToastBannerProps> = ({
  toast,
  onDismiss,
  autoHideMs = 5000,
}) => {
  useEffect(() => {
    if (!toast || toast.sticky) return;
    const timer = setTimeout(onDismiss, autoHideMs);
    return () => clearTimeout(timer);
  }, [toast, onDismiss, autoHideMs]);

  if (!toast) return null;

  const isUrgent = toast.type === 'error';
  const livePoliteness = isUrgent ? 'assertive' : 'polite';

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-[100] flex max-w-md -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-3 shadow-lg ${typeStyles[toast.type]}`}
      role={isUrgent ? 'alert' : 'status'}
      aria-live={livePoliteness}
    >
      <span className="flex-1 text-sm font-medium">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 opacity-80 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        aria-label="Dismiss notification"
      >
        <AppIcon name="close" size={16} />
      </button>
    </div>
  );
};

import React, { useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastBannerProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
  autoHideMs?: number;
}

const typeStyles: Record<ToastType, string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-indigo-600 text-white',
};

export const ToastBanner: React.FC<ToastBannerProps> = ({ toast, onDismiss, autoHideMs = 5000 }) => {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, autoHideMs);
    return () => clearTimeout(timer);
  }, [toast, onDismiss, autoHideMs]);

  if (!toast) return null;

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-[100] flex max-w-md -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-3 shadow-lg ${typeStyles[toast.type]}`}
      role="alert"
      aria-live="assertive"
    >
      <span className="flex-1 text-sm font-medium">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-1 opacity-80 hover:opacity-100"
        aria-label="Dismiss notification"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

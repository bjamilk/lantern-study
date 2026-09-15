/**
 * Single-slot transient toast message for the app-level toast host.
 *
 * Main export: `useToastStore` — `showToast(message, type)` and
 * `dismissToast()`. No queue and no auto-dismiss timer here: a second
 * `showToast` replaces the first, and the host component owns the timeout.
 *
 * Touches: zustand only.
 */
import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  message: string | null;
  type: ToastType;
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  type: 'info',
  showToast: (message, type = 'info') => set({ message, type }),
  dismissToast: () => set({ message: null }),
}));

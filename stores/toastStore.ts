import { create } from 'zustand';
import type { ToastMessage, ToastType } from '../components/ui/ToastBanner';

interface ToastState {
  toast: ToastMessage | null;
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: () => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  showToast: (message, type = 'info') => {
    toastCounter += 1;
    set({ toast: { id: `toast-${toastCounter}`, message, type } });
  },
  dismissToast: () => set({ toast: null }),
}));

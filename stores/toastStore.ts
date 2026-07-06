import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ToastMessage, ToastType } from '../components/ui/ToastBanner';

interface ToastState {
  toast: ToastMessage | null;
  showToast: (message: string, type?: ToastType) => void;
  showStickyToast: (message: string, type?: ToastType) => void;
  dismissToast: () => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastState>()(
  persist(
    (set) => ({
      toast: null,
      showToast: (message, type = 'info') => {
        toastCounter += 1;
        set({ toast: { id: `toast-${toastCounter}`, message, type, sticky: false } });
      },
      showStickyToast: (message, type = 'info') => {
        toastCounter += 1;
        set({ toast: { id: `toast-${toastCounter}`, message, type, sticky: true } });
      },
      dismissToast: () => set({ toast: null }),
    }),
    {
      name: 'lantern-sticky-toast',
      partialize: (state) =>
        state.toast?.sticky ? { toast: state.toast } : { toast: null },
    }
  )
);

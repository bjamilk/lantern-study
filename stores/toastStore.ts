/**
 * The single app-wide toast slot.
 *
 * Exports: `useToastStore` — `toast` (one message, or null) with `showToast`,
 * `showStickyToast` and `dismissToast`. `ToastBanner` renders it.
 *
 * Touches: zustand `persist`, localStorage key `lantern-sticky-toast`.
 * `partialize` persists the message ONLY when it is sticky, so an ordinary
 * toast dies with the page while a sticky one (an unrecoverable state the user
 * must still see) survives a reload.
 *
 * Gotchas:
 *  - There is one slot, not a queue: a second `showToast` replaces the first,
 *    including replacing a sticky one. The changing `id` is what makes the
 *    banner re-animate for a repeated message.
 *  - The persisted sticky toast is not user-scoped and nothing clears it on
 *    sign-out, so a sticky error raised for one account is rehydrated for the
 *    next one in the same browser until it is dismissed.
 *  - `toastCounter` is module-level and resets on reload, so ids are unique
 *    only within a page load — never use one as a storage key.
 */
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

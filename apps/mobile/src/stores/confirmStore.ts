/**
 * Promise-based confirmation sheet, so a caller can `await confirmSheet(...)`
 * instead of threading modal state through a screen.
 *
 * Main exports: `useConfirmStore` (the mounted sheet reads `open`/`options` and
 * calls `handleConfirm`/`handleCancel`), `confirmSheet(options)` for callers.
 *
 * Touches: zustand only — no persistence, no API, no native modules.
 *
 * Gotchas: a single slot. Calling `confirm` while a sheet is already open
 * replaces `resolve`, and the earlier promise never settles. Dismissing the
 * sheet by any path other than `handleConfirm`/`handleCancel` also leaves the
 * promise pending forever.
 */
import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  handleConfirm: () => void;
  handleCancel: () => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      set({ open: true, options, resolve });
    }),
  handleConfirm: () => {
    get().resolve?.(true);
    set({ open: false, options: null, resolve: null });
  },
  handleCancel: () => {
    get().resolve?.(false);
    set({ open: false, options: null, resolve: null });
  },
}));

export function confirmSheet(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().confirm(options);
}

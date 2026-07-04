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

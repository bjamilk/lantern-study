import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** A confirm request that is waiting behind the one currently on screen. */
interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
  /**
   * Requests that arrived while a dialog was already open, in arrival order.
   * FIFO: each drains onto the screen only after the one ahead of it is
   * answered, so no request's promise is ever dropped or overwritten.
   */
  queue: PendingConfirm[];
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  handleConfirm: () => void;
  handleCancel: () => void;
}

/**
 * Settle the on-screen dialog with the user's answer, then show the next queued
 * request (if any) or close. This is the ONLY place a resolve is called, and it
 * is always called with the value the user actually chose — a queued request is
 * never resolved on its behalf, so no answer is invented and none is lost.
 */
function settleAndAdvance(
  get: () => ConfirmState,
  set: (partial: Partial<ConfirmState>) => void,
  value: boolean,
): void {
  const { resolve, queue } = get();
  // Settle the current caller FIRST, so its `await confirmDialog()` always
  // returns and any finally-block guard it holds is released.
  resolve?.(value);
  if (queue.length > 0) {
    const [next, ...rest] = queue;
    set({ open: true, options: next.options, resolve: next.resolve, queue: rest });
  } else {
    set({ open: false, options: null, resolve: null, queue: [] });
  }
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  queue: [],
  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      const { open, queue } = get();
      if (open) {
        // A dialog is already on screen. Queue this request instead of
        // overwriting the live `resolve` — overwriting would strand the first
        // promise forever, and any re-entrancy guard awaiting it (a ref set
        // true before the await, cleared in a finally) would stay stuck true
        // for the life of the page, permanently disabling its button.
        set({ queue: [...queue, { options, resolve }] });
        return;
      }
      set({ open: true, options, resolve });
    }),
  handleConfirm: () => settleAndAdvance(get, set, true),
  handleCancel: () => settleAndAdvance(get, set, false),
}));

/** Imperative confirm dialog (replaces window.confirm). */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().confirm(options);
}

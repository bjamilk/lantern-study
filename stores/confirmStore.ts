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
  /**
   * Timestamp (Date.now) at which the on-screen dialog was DRAINED from the
   * queue to replace its predecessor, or null when the on-screen dialog is the
   * first of its run (or nothing is open). While this is a recent timestamp the
   * dialog is brand-new and has not yet been seen, so an answer arriving inside
   * the ignore window is treated as spillover from the dialog it replaced — see
   * `DRAINED_IGNORE_MS`.
   */
  drainedAt: number | null;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  handleConfirm: () => void;
  handleCancel: () => void;
}

/**
 * How long a freshly DRAINED dialog refuses to be answered.
 *
 * The hazard: the FIFO queue surfaces the next dialog in the same instant the
 * current one settles, directly under the pointer. The trailing click of a
 * double-click aimed at the first dialog's button then lands on the newly
 * drained dialog and answers a question the user never saw.
 *
 * The window is sized to a platform double-click interval (~500ms), so the
 * trailing click of a real double-click is always absorbed. It is applied ONLY
 * to drained dialogs — the first dialog of a run has no window — so a
 * deliberately fast user answering a dialog they opened is never delayed. And a
 * dialog a user has genuinely never seen cannot be read and decided on in half
 * a second, so the only clicks this ever swallows are unintended spillover.
 *
 * Swallowing a click never strands a caller: the drained dialog simply stays
 * open and its awaiting promise settles on the user's next, intended click — no
 * answer is invented, none is dropped.
 */
const DRAINED_IGNORE_MS = 500;

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
  const { resolve, queue, drainedAt } = get();
  // Spillover guard: if the on-screen dialog was drained onto the screen only a
  // moment ago, this answer is a click that was aimed at the dialog it replaced
  // (the trailing half of a double-click). Swallow it — leave the dialog open
  // and unanswered so the user can read it and answer it themselves. Nothing is
  // resolved here, so no awaiting caller is settled on the user's behalf.
  //
  // `Date.now()` is a wall clock, not a monotonic one: an NTP correction or a
  // manual clock change while the dialog is open can make the elapsed time
  // NEGATIVE. A bare `elapsed < WINDOW` test would then be true for as long as
  // the clock stayed behind — minutes or hours — and every click on the dialog
  // would be swallowed, which is the one thing this guard must never do: strand
  // an awaiting caller behind a dialog that can no longer be answered. Negative
  // elapsed means "the stamp is in the future, so it is not a fresh drain":
  // treat it as outside the window and answer the dialog.
  const sinceDrain = drainedAt === null ? null : Date.now() - drainedAt;
  if (sinceDrain !== null && sinceDrain >= 0 && sinceDrain < DRAINED_IGNORE_MS) {
    return;
  }
  // Settle the current caller FIRST, so its `await confirmDialog()` always
  // returns and any finally-block guard it holds is released.
  resolve?.(value);
  if (queue.length > 0) {
    const [next, ...rest] = queue;
    // The next dialog appears now; stamp it so its own ignore window begins.
    set({
      open: true,
      options: next.options,
      resolve: next.resolve,
      queue: rest,
      drainedAt: Date.now(),
    });
  } else {
    set({ open: false, options: null, resolve: null, queue: [], drainedAt: null });
  }
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  queue: [],
  drainedAt: null,
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
      // The first dialog of a run is one the user asked for and is looking at,
      // so it carries NO ignore window — a deliberately fast answer is honoured.
      set({ open: true, options, resolve, drainedAt: null });
    }),
  handleConfirm: () => settleAndAdvance(get, set, true),
  handleCancel: () => settleAndAdvance(get, set, false),
}));

/** Imperative confirm dialog (replaces window.confirm). */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().confirm(options);
}

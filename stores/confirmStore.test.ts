import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmDialog, useConfirmStore } from './confirmStore';

// Fake timers so the drained-dialog ignore window is deterministic: the store
// stamps a drained dialog with Date.now() and swallows answers that arrive
// within the window. Tests advance the clock to model a user taking time to
// read a newly surfaced dialog before answering it.
beforeEach(() => {
  vi.useFakeTimers();
  // A fresh store for every test: reset the whole state, since a leaked
  // `resolve`, `queue` or `drainedAt` from one test would otherwise bleed into
  // the next.
  useConfirmStore.setState({
    open: false,
    options: null,
    resolve: null,
    queue: [],
    drainedAt: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const opts = (title: string) => ({ title, message: `${title} body` });

// Long enough that a freshly drained dialog is no longer inside its ignore
// window — models a user who has now actually read the surfaced dialog.
const READ_DELAY_MS = 500;

describe('confirmStore: a single confirm', () => {
  it('opens the dialog and settles true on confirm', async () => {
    const p = confirmDialog(opts('A'));
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().options?.title).toBe('A');

    useConfirmStore.getState().handleConfirm();
    await expect(p).resolves.toBe(true);
    // Closed and fully cleared after answering.
    expect(useConfirmStore.getState().open).toBe(false);
    expect(useConfirmStore.getState().resolve).toBeNull();
  });

  it('settles false on cancel', async () => {
    const p = confirmDialog(opts('A'));
    useConfirmStore.getState().handleCancel();
    await expect(p).resolves.toBe(false);
    expect(useConfirmStore.getState().open).toBe(false);
  });
});

describe('confirmStore: a second call while one is open', () => {
  it('does NOT open a second dialog — the first stays on screen', () => {
    void confirmDialog(opts('first'));
    void confirmDialog(opts('second'));

    // Only one dialog is ever visible, and it is still the first.
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().options?.title).toBe('first');
    // The second is parked in the queue, not shown.
    expect(useConfirmStore.getState().queue).toHaveLength(1);
    expect(useConfirmStore.getState().queue[0].options.title).toBe('second');
  });

  it('never strands the first promise — the incumbent still settles with the user\'s answer', async () => {
    // This is the regression guard. Before the fix, the second call overwrote
    // the single `resolve`, so `first` could never settle. If the store is
    // reverted to a single-slot resolve, `first` hangs and this test FAILS
    // (the awaited promise never resolves → the test times out).
    const first = confirmDialog(opts('first'));
    void confirmDialog(opts('second'));

    // The user answers the dialog they can see (the first) — it must resolve.
    useConfirmStore.getState().handleConfirm();
    await expect(first).resolves.toBe(true);
  });

  it('drains the queue in FIFO order, and every awaiting caller settles', async () => {
    const first = confirmDialog(opts('first'));
    const second = confirmDialog(opts('second'));
    const third = confirmDialog(opts('third'));

    // Answer the first: the second must now be the visible dialog.
    useConfirmStore.getState().handleCancel();
    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().options?.title).toBe('second');

    // The user reads the freshly surfaced 'second' before answering it.
    vi.advanceTimersByTime(READ_DELAY_MS);

    // Answer the second: the third surfaces.
    useConfirmStore.getState().handleConfirm();
    await expect(second).resolves.toBe(true);
    expect(useConfirmStore.getState().options?.title).toBe('third');

    // ...and reads 'third' before answering it.
    vi.advanceTimersByTime(READ_DELAY_MS);

    // Answer the last: dialog closes and the store is fully cleared.
    useConfirmStore.getState().handleConfirm();
    await expect(third).resolves.toBe(true);
    expect(useConfirmStore.getState().open).toBe(false);
    expect(useConfirmStore.getState().queue).toHaveLength(0);
    expect(useConfirmStore.getState().resolve).toBeNull();
  });
});

describe('confirmStore: the stuck-guard scenario', () => {
  // Models a re-entrancy guard: a ref set true before awaiting a confirm and
  // cleared in a finally. If the awaited promise never settles, the guard stays
  // true forever and the button it protects never works again.
  it('an orphaned second call cannot leave the guard stuck true', async () => {
    let guard = false;

    const guardedAction = async (title: string) => {
      guard = true;
      try {
        return await confirmDialog(opts(title));
      } finally {
        guard = false;
      }
    };

    // The guarded action opens a dialog and takes the guard.
    const firstRun = guardedAction('tap-1');
    expect(guard).toBe(true);

    // A competing confirm fires while the first dialog is still open. Before the
    // fix this overwrote the live resolve and stranded 'tap-1' forever — its
    // finally never ran, so `guard` stayed true for the life of the page. Now it
    // is queued, so 'tap-1' still settles below. Revert the store and firstRun
    // never resolves → this test times out and FAILS.
    const competing = confirmDialog(opts('competing'));

    // Answer the visible dialog ('tap-1'): the guarded run settles, its finally
    // runs, and the guard is released.
    useConfirmStore.getState().handleConfirm();
    await firstRun;
    expect(guard).toBe(false);

    // The queued 'competing' request also surfaces and settles — nothing lost.
    // It was just drained under the pointer, so the user reads it first.
    expect(useConfirmStore.getState().options?.title).toBe('competing');
    vi.advanceTimersByTime(READ_DELAY_MS);
    useConfirmStore.getState().handleCancel();
    await expect(competing).resolves.toBe(false);

    // Proof the guard is usable again: a later action opens a fresh dialog.
    const secondRun = guardedAction('tap-2');
    expect(guard).toBe(true);
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().options?.title).toBe('tap-2');
    useConfirmStore.getState().handleCancel();
    await secondRun;
    expect(guard).toBe(false);
  });
});

describe('confirmStore: the drained-under-the-cursor double-click', () => {
  it('a click meant for the first dialog cannot answer the freshly drained second', async () => {
    const first = confirmDialog(opts('first'));
    const second = confirmDialog(opts('second'));

    // First half of a double-click on the first dialog's button: it answers the
    // dialog the user is looking at and drains 'second' into its place, directly
    // under the pointer, in the same instant.
    useConfirmStore.getState().handleConfirm();
    await expect(first).resolves.toBe(true);
    expect(useConfirmStore.getState().options?.title).toBe('second');

    // Second half of that same double-click lands a few milliseconds later on
    // the newly surfaced 'second' — a dialog the user has never seen.
    vi.advanceTimersByTime(40);
    useConfirmStore.getState().handleConfirm();

    // It is swallowed: 'second' is still open and still unanswered. The user was
    // NOT made to answer a question they never saw.
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().options?.title).toBe('second');

    // 'second' is still fully awaitable — the queue never strands a caller. Once
    // the user has actually read it, their genuine click settles it.
    vi.advanceTimersByTime(READ_DELAY_MS);
    useConfirmStore.getState().handleCancel();
    await expect(second).resolves.toBe(false);
    expect(useConfirmStore.getState().open).toBe(false);
  });

  it('does NOT delay a deliberately fast answer to the first (un-drained) dialog', async () => {
    // The ignore window is only ever applied to a drained dialog. The first
    // dialog of a run carries none, so a fast user is answered immediately —
    // this asserts the window does not punish legitimate speed.
    const p = confirmDialog(opts('only'));
    // No time advanced: answered the very instant it opened.
    useConfirmStore.getState().handleConfirm();
    await expect(p).resolves.toBe(true);
    expect(useConfirmStore.getState().open).toBe(false);
  });

  it('still answers a drained dialog after the wall clock steps BACKWARDS', async () => {
    // `drainedAt` is a wall-clock stamp, so an NTP correction (or the user
    // changing the clock) while the dialog is open can put the stamp in the
    // future. A bare "elapsed < window" test would then hold for as long as the
    // clock stayed behind and swallow EVERY click — stranding the awaiting
    // caller behind a dialog that could no longer be answered, the exact
    // failure this guard exists to prevent. Negative elapsed is not a fresh
    // drain, so the answer must go through.
    const first = confirmDialog(opts('first'));
    const second = confirmDialog(opts('second'));

    useConfirmStore.getState().handleConfirm();
    await expect(first).resolves.toBe(true);
    expect(useConfirmStore.getState().options?.title).toBe('second');

    // The clock steps back a minute, long after the user has read 'second'.
    vi.setSystemTime(new Date(Date.now() - 60_000));

    useConfirmStore.getState().handleConfirm();
    await expect(second).resolves.toBe(true);
    expect(useConfirmStore.getState().open).toBe(false);
  });
});

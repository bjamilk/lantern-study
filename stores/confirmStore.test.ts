import { beforeEach, describe, expect, it } from 'vitest';

import { confirmDialog, useConfirmStore } from './confirmStore';

// A fresh store for every test: reset the whole state, since a leaked `resolve`
// or `queue` from one test would otherwise bleed into the next.
beforeEach(() => {
  useConfirmStore.setState({ open: false, options: null, resolve: null, queue: [] });
});

const opts = (title: string) => ({ title, message: `${title} body` });

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

    // Answer the second: the third surfaces.
    useConfirmStore.getState().handleConfirm();
    await expect(second).resolves.toBe(true);
    expect(useConfirmStore.getState().options?.title).toBe('third');

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
    expect(useConfirmStore.getState().options?.title).toBe('competing');
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

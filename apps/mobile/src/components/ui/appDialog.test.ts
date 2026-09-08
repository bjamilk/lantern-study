/**
 * The dialog planner: ordering and dismiss semantics.
 *
 * Everything asserted here is what the stock `Alert.alert` did for free and
 * what the app now has to do itself — one dialog at a time, FIFO, an omitted
 * `buttons` meaning a lone OK, and a backdrop tap that cannot be mistaken for
 * a "yes".
 */
import {
  cancelButtonIndex,
  confirmAsync,
  createDialogQueue,
  dialogQueue,
  isCancelable,
  preferredButtonIndex,
} from './appDialog';

afterEach(() => {
  dialogQueue.clear();
});

describe('dialog queue', () => {
  it('shows one dialog at a time, in the order they were raised', () => {
    const q = createDialogQueue();
    q.push('First');
    q.push('Second');
    q.push('Third');

    expect(q.current()?.title).toBe('First');
    expect(q.pending().map((d) => d.title)).toEqual(['First', 'Second', 'Third']);

    q.press(0);
    expect(q.current()?.title).toBe('Second');
    q.press(0);
    expect(q.current()?.title).toBe('Third');
    q.press(0);
    expect(q.current()).toBeNull();
  });

  it('gives every dialog a distinct id', () => {
    const q = createDialogQueue();
    const a = q.push('A');
    const b = q.push('B');
    expect(a).not.toBe(b);
  });

  it('substitutes a lone OK when buttons are omitted or empty', () => {
    const q = createDialogQueue();
    q.push('Heads up', 'Something happened');
    expect(q.current()?.buttons).toEqual([{ text: 'OK' }]);

    q.press(0);
    q.push('Heads up', undefined, []);
    expect(q.current()?.buttons).toEqual([{ text: 'OK' }]);
  });

  it('labels a text-less button OK rather than rendering a blank target', () => {
    const q = createDialogQueue();
    q.push('T', undefined, [{ style: 'cancel' }, { text: '' }]);
    expect(q.current()?.buttons.map((b) => b.text)).toEqual(['OK', 'OK']);
  });

  it('runs the pressed button and nothing else', () => {
    const q = createDialogQueue();
    const cancel = jest.fn();
    const ok = jest.fn();
    q.push('Delete?', undefined, [
      { text: 'Cancel', style: 'cancel', onPress: cancel },
      { text: 'Delete', style: 'destructive', onPress: ok },
    ]);

    q.press(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(q.current()).toBeNull();
  });

  it('closes before the callback runs, so a dialog raised from onPress queues behind', () => {
    const q = createDialogQueue();
    q.push('First', undefined, [
      {
        text: 'Next',
        onPress: () => {
          q.push('Second');
        },
      },
    ]);

    q.press(0);
    // Not still on 'First' with 'Second' stuck behind a head that never popped.
    expect(q.current()?.title).toBe('Second');
    expect(q.pending()).toHaveLength(1);
  });

  it('survives a callback that throws, and still advances', () => {
    const q = createDialogQueue();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    q.push('Boom', undefined, [
      {
        text: 'OK',
        onPress: () => {
          throw new Error('screen blew up');
        },
      },
    ]);
    q.push('Next');

    expect(() => q.press(0)).not.toThrow();
    expect(q.current()?.title).toBe('Next');
    spy.mockRestore();
  });

  it('ignores a press with no dialog on screen, or an index that is not there', () => {
    const q = createDialogQueue();
    expect(() => q.press(0)).not.toThrow();

    q.push('T', undefined, [{ text: 'OK' }]);
    q.press(7);
    // An out-of-range index still closes the dialog rather than wedging it.
    expect(q.current()).toBeNull();
  });

  it('notifies subscribers on push and on close, and stops after unsubscribe', () => {
    const q = createDialogQueue();
    const listener = jest.fn();
    const off = q.subscribe(listener);

    q.push('T');
    expect(listener).toHaveBeenCalledTimes(1);
    q.press(0);
    expect(listener).toHaveBeenCalledTimes(2);

    off();
    q.push('U');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('clears everything without running any callback', () => {
    const q = createDialogQueue();
    const onPress = jest.fn();
    const onDismiss = jest.fn();
    q.push('T', undefined, [{ text: 'Cancel', style: 'cancel', onPress }], { onDismiss });
    q.push('U');

    q.clear();
    expect(q.current()).toBeNull();
    expect(onPress).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('dismiss semantics', () => {
  it('runs the cancel button when a cancelable dialog is dismissed', () => {
    for (const source of ['backdrop', 'back'] as const) {
      const q = createDialogQueue();
      const cancel = jest.fn();
      const confirm = jest.fn();
      q.push(
        'T',
        undefined,
        [
          { text: 'Cancel', style: 'cancel', onPress: cancel },
          { text: 'Go', onPress: confirm },
        ],
        { cancelable: true }
      );

      q.dismiss(source);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(confirm).not.toHaveBeenCalled();
      expect(q.current()).toBeNull();
    }
  });

  it('falls back to onDismiss when there is no cancel button', () => {
    const q = createDialogQueue();
    const onDismiss = jest.fn();
    q.push('T', undefined, [{ text: 'OK' }], { cancelable: true, onDismiss });

    q.dismiss('backdrop');
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(q.current()).toBeNull();
  });

  it('does not run onDismiss as well as the cancel button', () => {
    const q = createDialogQueue();
    const cancel = jest.fn();
    const onDismiss = jest.fn();
    q.push('T', undefined, [{ text: 'Cancel', style: 'cancel', onPress: cancel }], {
      cancelable: true,
      onDismiss,
    });

    q.dismiss('back');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('closes on dismiss even with no cancel button and no onDismiss', () => {
    const q = createDialogQueue();
    q.push('T', undefined, [{ text: 'OK' }], { cancelable: true });
    q.dismiss('backdrop');
    expect(q.current()).toBeNull();
  });

  it('keeps the backdrop inert on a non-cancelable dialog, while BACK runs its cancel', () => {
    const q = createDialogQueue();
    const cancel = jest.fn();
    const onDismiss = jest.fn();
    q.push('Cannot escape', undefined, [{ text: 'Cancel', style: 'cancel', onPress: cancel }], {
      cancelable: false,
      onDismiss,
    });

    q.dismiss('backdrop');
    expect(q.current()?.title).toBe('Cannot escape');
    expect(cancel).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();

    q.dismiss('back');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(q.current()).toBeNull();
  });

  it('treats a dialog with no options as NOT cancelable, exactly like Alert.alert', () => {
    // RN 0.81 Alert.js sends Android `cancelable: false` unless asked, and
    // iOS never dismisses on a tap outside. The sweep was a mechanical swap,
    // so the default must not change under 400 call sites.
    const q = createDialogQueue();
    q.push('T');
    expect(isCancelable(q.current()!)).toBe(false);
    q.push('U', undefined, [{ text: 'OK' }], { cancelable: true });
    q.press(0);
    expect(isCancelable(q.current()!)).toBe(true);
  });

  it('cannot skip a lone OK whose onPress is the only way forward', () => {
    // AddInvestmentScreen / SetBudgetScreen / MakeOfferScreen: "Saved" with
    // `OK.onPress: () => navigation.goBack()`. A backdrop tap that closed the
    // dialog without pressing OK would leave the user on the submitted form.
    const q = createDialogQueue();
    const ok = jest.fn();
    q.push('Success', 'Investment logged!', [{ text: 'OK', onPress: ok }]);

    q.dismiss('backdrop');
    expect(q.current()?.title).toBe('Success');
    expect(ok).not.toHaveBeenCalled();

    // Hardware BACK is never a dead key: on a lone-button notice it RUNS that
    // button, so the continuation still happens and nobody is stranded.
    q.dismiss('back');
    expect(ok).toHaveBeenCalledTimes(1);
    expect(q.current()).toBeNull();
  });

  it('ignores a dismiss with nothing on screen', () => {
    const q = createDialogQueue();
    expect(() => q.dismiss('back')).not.toThrow();
  });
});

describe('button roles', () => {
  it('finds the cancel button, or reports -1', () => {
    const q = createDialogQueue();
    q.push('T', undefined, [{ text: 'No', style: 'cancel' }, { text: 'Yes' }]);
    expect(cancelButtonIndex(q.current()!)).toBe(0);

    q.press(1);
    q.push('U', undefined, [{ text: 'Yes' }]);
    expect(cancelButtonIndex(q.current()!)).toBe(-1);
  });

  it('prefers isPreferred, then the last non-cancel button', () => {
    const q = createDialogQueue();
    q.push('T', undefined, [
      { text: 'Later' },
      { text: 'Now', isPreferred: true },
      { text: 'Cancel', style: 'cancel' },
    ]);
    expect(preferredButtonIndex(q.current()!)).toBe(1);

    q.press(1);
    q.push('U', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete' }]);
    expect(preferredButtonIndex(q.current()!)).toBe(1);

    q.press(1);
    q.push('V', undefined, [{ text: 'Cancel', style: 'cancel' }]);
    expect(preferredButtonIndex(q.current()!)).toBe(-1);
  });
});

describe('confirmAsync', () => {
  it('resolves true when the confirming action is pressed', async () => {
    const promise = confirmAsync('Delete note?', 'This cannot be undone', {
      confirmLabel: 'Delete',
      destructive: true,
    });
    const request = dialogQueue.current()!;
    expect(request.buttons.map((b) => b.text)).toEqual(['Cancel', 'Delete']);
    expect(request.buttons[1].style).toBe('destructive');

    dialogQueue.press(1);
    await expect(promise).resolves.toBe(true);
  });

  it('resolves false on cancel', async () => {
    const promise = confirmAsync('Leave?');
    dialogQueue.press(0);
    await expect(promise).resolves.toBe(false);
  });

  it('resolves false on a backdrop dismiss — a tap outside is never consent', async () => {
    const promise = confirmAsync('Leave?');
    dialogQueue.dismiss('backdrop');
    await expect(promise).resolves.toBe(false);
  });

  it('defaults its labels and marks the confirming action preferred', () => {
    void confirmAsync('Sure?');
    const request = dialogQueue.current()!;
    expect(request.buttons.map((b) => b.text)).toEqual(['Cancel', 'Confirm']);
    expect(request.buttons[1].style).toBe('default');
    expect(preferredButtonIndex(request)).toBe(1);
  });
});

describe('hardware BACK on a non-cancelable dialog', () => {
  it('runs the cancel-styled button', () => {
    const q = createDialogQueue();
    const cancel = jest.fn();
    const go = jest.fn();
    q.push('Exit Test', undefined, [{ text: 'Cancel', style: 'cancel', onPress: cancel }, { text: 'Exit', onPress: go }]);
    q.dismiss('back');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
    expect(q.current()).toBeNull();
  });

  it('runs the only button of a one-button notice, so BACK is never a dead key', () => {
    const q = createDialogQueue();
    const ok = jest.fn();
    q.push('Invalid goal', undefined, [{ text: 'OK', onPress: ok }]);
    q.dismiss('back');
    expect(ok).toHaveBeenCalledTimes(1);
    expect(q.current()).toBeNull();
  });

  it('keeps a two-way choice with no cancel open on BACK, and the backdrop stays inert', () => {
    const q = createDialogQueue();
    q.push('Keep or discard?', undefined, [{ text: 'Keep' }, { text: 'Discard', style: 'destructive' }]);
    q.dismiss('back');
    q.dismiss('backdrop');
    expect(q.current()).not.toBeNull();
  });
});

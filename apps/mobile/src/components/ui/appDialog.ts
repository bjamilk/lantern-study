/**
 * `appAlert` — the app's own dialog, with React Native's `Alert.alert`
 * signature.
 *
 * The founder rejected the stock Material dialog: a white card with teal
 * CANCEL/EXIT in caps and Roboto, which is the one surface in the app that
 * ignores the theme, the type scale and dark mode entirely. Every such prompt
 * has to be drawn by us instead.
 *
 * The signature here is EXACTLY `Alert.alert(title, message?, buttons?,
 * options?)`, down to `AlertButton.isPreferred` and `AlertOptions.onDismiss`,
 * so migrating a screen is an import swap and nothing else:
 *
 *   -import { Alert, View } from 'react-native';
 *   +import { View } from 'react-native';
 *   +import { appAlert } from '../components/ui/appDialog';
 *   -Alert.alert('Delete note?', 'This cannot be undone', [...]);
 *   +appAlert('Delete note?', 'This cannot be undone', [...]);
 *
 * This file is the PLANNER: a pure queue with no React and no react-native
 * import, so the ordering and dismiss rules are testable in the node jest
 * environment this project runs. `AppDialogHost.tsx` is the view that renders
 * whatever `currentDialog()` returns, and `noSystemAlertLint.test.ts` is what
 * stops a new `Alert.alert` from creeping back in.
 */

/** Mirrors react-native's `AlertButton`. */
export interface AppAlertButton {
  text?: string;
  onPress?: ((value?: string) => void) | undefined;
  style?: 'default' | 'cancel' | 'destructive';
  isPreferred?: boolean;
}

/** Mirrors react-native's `AlertOptions`. */
export interface AppAlertOptions {
  cancelable?: boolean | undefined;
  onDismiss?: (() => void) | undefined;
  /** Accepted for signature parity; the app's dialog always follows the app theme. */
  userInterfaceStyle?: 'unspecified' | 'light' | 'dark';
}

/** One queued dialog, normalised: `buttons` is never empty, `text` never blank. */
export interface AppDialogRequest {
  /** Monotonic; the host uses it as the React key so a new dialog remounts. */
  id: number;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
  options: AppAlertOptions;
}

/** How a dialog was closed without a button being pressed. */
export type DismissSource = 'backdrop' | 'back';

type Listener = () => void;

/**
 * RN shows a lone "OK" when `buttons` is omitted or empty, and labels a
 * text-less button "OK" too. Normalising here keeps the host dumb.
 */
function normaliseButtons(buttons?: AppAlertButton[]): AppAlertButton[] {
  const list = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
  return list.map((b) => ({ ...b, text: b.text && b.text.length > 0 ? b.text : 'OK' }));
}

/** The cancel affordance, if the caller gave one. */
export function cancelButtonIndex(request: AppDialogRequest): number {
  return request.buttons.findIndex((b) => b.style === 'cancel');
}

/**
 * Which button the dialog leads with. `isPreferred` wins (that is what it is
 * for); otherwise the last non-cancel button, which is where the affirmative
 * action sits in every RN call site in this app.
 */
export function preferredButtonIndex(request: AppDialogRequest): number {
  const explicit = request.buttons.findIndex((b) => b.isPreferred);
  if (explicit !== -1) return explicit;
  for (let i = request.buttons.length - 1; i >= 0; i -= 1) {
    if (request.buttons[i].style !== 'cancel') return i;
  }
  return -1;
}

/**
 * `cancelable` defaults to FALSE, matching `Alert.alert` exactly: RN's
 * Alert.js sends Android `cancelable: false` unless the caller opts in, and
 * iOS's UIAlertController never dismisses on a tap outside. Every migrated
 * call site was written against that, and several one-button notices carry
 * their only continuation in `OK.onPress` (a "Saved" that navigates back) —
 * a backdrop tap that closed those without pressing OK would strand the user
 * on a form they had already submitted. Pass `{ cancelable: true }` to let
 * BACK and the backdrop close a dialog; `confirmAsync` does.
 */
export function isCancelable(request: AppDialogRequest): boolean {
  return request.options.cancelable === true;
}

/**
 * A callback from a screen must never wedge the queue. If an `onPress` throws,
 * the dialog still closes and the next one still opens; the error is reported
 * rather than swallowed silently.
 */
function runSafely(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[appDialog] a dialog callback threw', err);
  }
}

export interface DialogQueue {
  /** Enqueue a dialog. Returns its id. */
  push(
    title: string,
    message?: string,
    buttons?: AppAlertButton[],
    options?: AppAlertOptions
  ): number;
  /** The dialog on screen, or null. Stable reference between changes. */
  current(): AppDialogRequest | null;
  /** Everything waiting, head first. Test/diagnostic view. */
  pending(): AppDialogRequest[];
  /** Press the button at `index` of the current dialog. */
  press(index: number): void;
  /**
   * Backdrop tap or hardware BACK. Cancelable → run the cancel button if there
   * is one, else `onDismiss`, then close. Non-cancelable (the default, as with
   * `Alert.alert`) → do nothing at all.
   */
  dismiss(source: DismissSource): void;
  /** Drop everything without running any callback (sign-out, hard reset). */
  clear(): void;
  subscribe(listener: Listener): () => void;
}

export function createDialogQueue(): DialogQueue {
  let nextId = 1;
  let queue: AppDialogRequest[] = [];
  const listeners = new Set<Listener>();

  const emit = () => {
    for (const l of Array.from(listeners)) l();
  };

  /** Close the head. Callbacks run BEFORE this, never inside it. */
  const shift = () => {
    queue = queue.slice(1);
    emit();
  };

  return {
    push(title, message, buttons, options) {
      const id = nextId;
      nextId += 1;
      queue = [
        ...queue,
        {
          id,
          title: title ?? '',
          message,
          buttons: normaliseButtons(buttons),
          options: options ?? {},
        },
      ];
      emit();
      return id;
    },
    current() {
      return queue.length > 0 ? queue[0] : null;
    },
    pending() {
      return queue;
    },
    press(index) {
      const request = queue[0];
      if (!request) return;
      const button = request.buttons[index];
      // Close first, then call back: an `onPress` that opens a second dialog
      // must queue behind this one, not behind a corpse that never pops.
      shift();
      if (button) runSafely(button.onPress as (() => void) | undefined);
    },
    dismiss(source) {
      const request = queue[0];
      if (!request) return;
      const cancelIndex = cancelButtonIndex(request);
      const cancel = cancelIndex === -1 ? undefined : request.buttons[cancelIndex];
      if (!isCancelable(request)) {
        // The backdrop stays inert on a non-cancelable dialog (RN parity),
        // but hardware BACK must never be a dead key: the device pass found
        // students trapped on an OK-only notice and on a Delete confirm.
        // BACK runs the cancel-styled button, else the ONLY button when there
        // is exactly one, else nothing (a two-way choice with no cancel keeps
        // the student in the dialog until they choose).
        if (source !== 'back') return;
        if (cancel) {
          shift();
          runSafely(cancel.onPress as (() => void) | undefined);
          return;
        }
        if (request.buttons.length === 1) {
          const only = request.buttons[0];
          shift();
          runSafely(only?.onPress as (() => void) | undefined);
          return;
        }
        return;
      }
      shift();
      if (cancel) {
        runSafely(cancel.onPress as (() => void) | undefined);
      } else {
        runSafely(request.options.onDismiss);
      }
    },
    clear() {
      if (queue.length === 0) return;
      queue = [];
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The one queue the mounted `<AppDialogHost/>` renders. */
export const dialogQueue = createDialogQueue();

/**
 * Drop-in replacement for `Alert.alert`. Same four arguments, same order, same
 * optionality, same `void` return.
 */
export function appAlert(
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
  options?: AppAlertOptions
): void {
  dialogQueue.push(title, message, buttons, options);
}

/** What the host reads. */
export function currentDialog(): AppDialogRequest | null {
  return dialogQueue.current();
}

export interface ConfirmAsyncOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirming action in the error ink. */
  destructive?: boolean;
}

/**
 * The two-button case, which is most of them, without the callback pyramid:
 *
 *   if (!(await confirmAsync('Delete note?', 'This cannot be undone',
 *         { confirmLabel: 'Delete', destructive: true }))) return;
 *
 * Resolves `false` on cancel AND on dismiss, so a backdrop tap can never be
 * read as consent.
 */
export function confirmAsync(
  title: string,
  message?: string,
  opts: ConfirmAsyncOptions = {}
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    dialogQueue.push(
      title,
      message,
      [
        { text: opts.cancelLabel ?? 'Cancel', style: 'cancel', onPress: () => settle(false) },
        {
          text: opts.confirmLabel ?? 'Confirm',
          style: opts.destructive ? 'destructive' : 'default',
          isPreferred: true,
          onPress: () => settle(true),
        },
      ],
      { cancelable: true, onDismiss: () => settle(false) }
    );
  });
}

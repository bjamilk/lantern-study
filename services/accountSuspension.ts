/**
 * Account-suspension state for the web client (Phase 1 · E §4).
 *
 * The API answers every authenticated call from a suspended account with
 * 403 { code: 'ACCOUNT_SUSPENDED', suspendedUntil, message } and does NOT
 * revoke the session. The fetch helpers call `noteSuspendedResponse` on any
 * 403 so the first such answer flips this store; App.tsx renders the blocking
 * notice from it. Nothing here signs the user out.
 */
import { create } from 'zustand';
import { readSuspensionFromBody, type SuspensionBody } from '../utils/moderationForms';

interface AccountSuspensionState {
  suspended: boolean;
  suspendedUntil: string | null;
  message: string | null;
  /** The user closed the blocking modal; keep the inline banner only. */
  acknowledged: boolean;
  setSuspended: (suspendedUntil: string | null, message: string) => void;
  acknowledge: () => void;
  clear: () => void;
}

export const useAccountSuspensionStore = create<AccountSuspensionState>((set) => ({
  suspended: false,
  suspendedUntil: null,
  message: null,
  acknowledged: false,
  setSuspended: (suspendedUntil, message) =>
    set((prev) => ({
      suspended: true,
      suspendedUntil,
      message,
      // A new (later) suspension date re-opens the modal.
      acknowledged: prev.suspended && prev.suspendedUntil === suspendedUntil ? prev.acknowledged : false,
    })),
  acknowledge: () => set({ acknowledged: true }),
  clear: () => set({ suspended: false, suspendedUntil: null, message: null, acknowledged: false }),
}));

/**
 * Inspect an API response; when it is the ACCOUNT_SUSPENDED 403, record it
 * and return true. Safe to call on any response (clones before reading).
 */
export async function noteSuspendedResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  let body: SuspensionBody | null = null;
  try {
    body = (await response.clone().json()) as SuspensionBody;
  } catch {
    return false;
  }
  const suspension = readSuspensionFromBody(response.status, body);
  if (!suspension) return false;
  useAccountSuspensionStore.getState().setSuspended(suspension.suspendedUntil, suspension.message);
  return true;
}

/** Same check for callers that already parsed the error body themselves. */
export function noteSuspendedBody(status: number, body: SuspensionBody | null | undefined): boolean {
  const suspension = readSuspensionFromBody(status, body);
  if (!suspension) return false;
  useAccountSuspensionStore.getState().setSuspended(suspension.suspendedUntil, suspension.message);
  return true;
}

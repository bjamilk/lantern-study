/**
 * Account-moderation state the API reports back to this device (Phase 1 · E,
 * docs/phase1-rights-moderation-contract.md §3 "Enforcement" + §5).
 *
 * A suspended account gets 403 `{ code: 'ACCOUNT_SUSPENDED', suspendedUntil }`
 * on every authenticated call — deliberately WITHOUT a global sign-out, so the
 * account comes back by itself when the date passes. The API client
 * (services/api.ts → services/accountSuspension.ts) sets `suspendedUntil`
 * here and RootNavigator renders the blocking AccountSuspendedBanner.
 */
import { create } from 'zustand';

interface ModerationState {
  /** ISO date the suspension lifts; null when the account is not suspended. */
  suspendedUntil: string | null;
  /** Server-written sentence ("Account suspended until 5 September 2026"). */
  suspensionMessage: string | null;
  /** Strike count from GET /users/me/moderation (null until fetched). */
  activeStrikes: number | null;
  setSuspended: (input: { suspendedUntil: string | null; message?: string | null }) => void;
  clearSuspension: () => void;
  setActiveStrikes: (count: number | null) => void;
}

export const useModerationStore = create<ModerationState>((set) => ({
  suspendedUntil: null,
  suspensionMessage: null,
  activeStrikes: null,
  setSuspended: ({ suspendedUntil, message }) =>
    set({ suspendedUntil: suspendedUntil ?? null, suspensionMessage: message ?? null }),
  clearSuspension: () => set({ suspendedUntil: null, suspensionMessage: null }),
  setActiveStrikes: (activeStrikes) => set({ activeStrikes }),
}));

/**
 * Web feature-tip progress store — local cache + sync into profile.settings.featureTips.
 *
 * Exports: `useFeatureTipStore` and `getTipCopy(tipId)`. State: `tips` (the
 * normalised progress record), `readyTips` / `allowedByTip` (which surfaces are
 * currently mounted and eligible), `onboardingComplete`, `hydrated` and the
 * derived `activeTipId`. Actions: `hydrate`, `syncFromUserSettings`,
 * `setTipReady` / `setTipAllowed` / `setOnboardingComplete` / `recomputeActive`,
 * and the user gestures `dismiss`, `skipAll`, `dontShowAgain`, `replay`,
 * `markChecklist`, `dismissGettingStarted`, `persistRemote`.
 *
 * Touches: utils/featureTipsStorage (sessionStorage for the per-session "Got
 * it" map, localStorage for the durable flags), `saveUserSettingsDetailed`
 * (a `featureTips`-only settings patch, deep-merged server-side), and it writes
 * back into `useAuthStore.currentUser.settings`; failures toast via
 * `useToastStore`.
 *
 * Gotchas:
 *  - The durable hide flags (`skippedAll`, `dontShowAgain`, `checklistDismissed`)
 *    are MONOTONIC on the way out: `schedulePersist` ORs local with remote so a
 *    client that has not loaded the profile yet cannot flip a saved "don't show
 *    again" back to false. Only `replay` passes `allowRegress`.
 *  - `schedulePersist` is a single module-level 400ms timer shared by every
 *    caller, and it reads `useAuthStore.getState()` when it FIRES. The gestures
 *    that must survive an immediate refresh (`skipAll`, `dontShowAgain`,
 *    `replay`) write through to local storage synchronously as well.
 *  - Nothing here is user-scoped in local storage; correctness on an account
 *    switch depends on `syncFromUserSettings` running with the new profile.
 */
import { create } from 'zustand';
import {
  FEATURE_TIP_CATALOG,
  FEATURE_TIPS_VERSION,
  normalizeFeatureTips,
  pickActiveTip,
  type FeatureTipId,
  type FeatureTipsState,
  type ChecklistItemKey,
} from '@lantern/shared/featureTips';
import {
  dismissTip,
  skipAllTips,
  setDontShowAgain,
  replayFeatureTips,
  markChecklistItem,
  dismissChecklist,
  loadLocalFeatureTips,
  saveLocalFeatureTips,
  mergeRemoteFeatureTips,
  toPersistentFeatureTips,
} from '../utils/featureTipsStorage';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { saveUserSettingsDetailed } from '../services/supabase';
import { useAuthStore } from './authStore';
import { useToastStore } from './toastStore';

interface FeatureTipStore {
  tips: FeatureTipsState;
  /** Surfaces currently mounted / eligible */
  readyTips: FeatureTipId[];
  allowedByTip: Partial<Record<FeatureTipId, boolean>>;
  onboardingComplete: boolean;
  hydrated: boolean;
  activeTipId: FeatureTipId | null;

  hydrate: () => void;
  syncFromUserSettings: (raw: unknown) => void;
  setOnboardingComplete: (value: boolean) => void;
  setTipReady: (tipId: FeatureTipId, ready: boolean) => void;
  setTipAllowed: (tipId: FeatureTipId, allowed: boolean) => void;
  recomputeActive: () => void;
  dismiss: (tipId: FeatureTipId) => void;
  skipAll: () => void;
  dontShowAgain: () => void;
  replay: () => void;
  markChecklist: (key: ChecklistItemKey, done?: boolean) => void;
  dismissGettingStarted: () => void;
  persistRemote: () => void;
}

function computeActive(s: {
  tips: FeatureTipsState;
  readyTips: FeatureTipId[];
  allowedByTip: Partial<Record<FeatureTipId, boolean>>;
  onboardingComplete: boolean;
}): FeatureTipId | null {
  return pickActiveTip(s.tips, s.readyTips, {
    onboardingComplete: s.onboardingComplete,
    allowedByTip: s.allowedByTip,
  });
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(
  getTips: () => FeatureTipsState,
  opts: { allowRegress?: boolean } = {}
) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const tips = getTips();
    // Session Got-it map stays in sessionStorage via saveLocal; profile gets durable flags only.
    saveLocalFeatureTips(tips);
    const durable = toPersistentFeatureTips(tips);
    const user = useAuthStore.getState().currentUser;
    if (!user?.id) return;
    const latest = useAuthStore.getState().currentUser || user;
    const current = normalizeUserSettings(latest.settings);
    // Durable hide flags are MONOTONIC: a client that hasn't loaded the
    // remote value yet must not flip a saved "Don't show again" back to
    // false (that stomp is how tips kept resurrecting after re-login).
    // Only the explicit Replay flow may regress them.
    const remoteFlags = normalizeFeatureTips(current.featureTips);
    const keepTrue = (local?: boolean, remote?: boolean) =>
      opts.allowRegress ? Boolean(local) : Boolean(local || remote);
    const featureTipsPatch = {
      version: durable.version,
      dismissed: {},
      skippedAll: keepTrue(durable.skippedAll, remoteFlags.skippedAll),
      dontShowAgain: keepTrue(durable.dontShowAgain, remoteFlags.dontShowAgain),
      checklistDismissed: keepTrue(durable.checklistDismissed, remoteFlags.checklistDismissed),
      checklist: durable.checklist as Record<string, boolean>,
    };
    const next = {
      ...current,
      featureTips: featureTipsPatch,
      updatedAt: new Date().toISOString(),
    };
    useAuthStore.getState().setCurrentUser({ ...latest, settings: next });
    // Category patch only — server deep-merges; concurrent theme/study saves stay intact.
    void saveUserSettingsDetailed(latest.id, { featureTips: featureTipsPatch }).then((result) => {
      if (!result.ok) {
        console.warn('Failed to sync feature tips settings after retries');
        useToastStore.getState().showToast(
          'Failed to sync feature tip progress. Please try again.',
          'error'
        );
        return;
      }
      if (result.settings) {
        const authUser = useAuthStore.getState().currentUser;
        if (authUser?.id === latest.id) {
          useAuthStore.getState().setCurrentUser({
            ...authUser,
            settings: normalizeUserSettings(result.settings),
          });
        }
      }
    });
  }, 400);
}

export const useFeatureTipStore = create<FeatureTipStore>((set, get) => ({
  tips: normalizeFeatureTips(null),
  readyTips: [],
  allowedByTip: {},
  onboardingComplete: false,
  hydrated: false,
  activeTipId: null,

  hydrate: () => {
    if (get().hydrated) return;
    const local = loadLocalFeatureTips();
    set({ tips: local, hydrated: true });
    get().recomputeActive();
  },

  syncFromUserSettings: (raw) => {
    const settings = normalizeUserSettings(raw);
    const remote = normalizeFeatureTips(settings.featureTips);
    const merged = mergeRemoteFeatureTips(get().tips, settings.featureTips);
    set({ tips: merged });
    saveLocalFeatureTips(merged);
    get().recomputeActive();
    // Self-heal: if this device knows a durable hide the profile lost (a
    // failed save, or an older client overwrote it), push it back up —
    // otherwise the next localStorage wipe (logout) resurrects the tips.
    if (
      (merged.dontShowAgain && !remote.dontShowAgain) ||
      (merged.skippedAll && !remote.skippedAll) ||
      (merged.checklistDismissed && !remote.checklistDismissed)
    ) {
      schedulePersist(() => get().tips);
    }
  },

  setOnboardingComplete: (value) => {
    set({ onboardingComplete: value });
    get().recomputeActive();
  },

  setTipReady: (tipId, ready) => {
    const already = get().readyTips.includes(tipId);
    if (ready && already) {
      get().recomputeActive();
      return;
    }
    if (!ready && !already) {
      get().recomputeActive();
      return;
    }
    set((s) => {
      const setReady = new Set(s.readyTips);
      if (ready) setReady.add(tipId);
      else setReady.delete(tipId);
      return { readyTips: [...setReady] };
    });
    get().recomputeActive();
  },

  setTipAllowed: (tipId, allowed) => {
    set((s) => ({
      allowedByTip: { ...s.allowedByTip, [tipId]: allowed },
    }));
    get().recomputeActive();
  },

  recomputeActive: () => {
    const s = get();
    const next = computeActive(s);
    if (s.activeTipId === next) return;
    set({ activeTipId: next });
  },

  dismiss: (tipId) => {
    const next = dismissTip(get().tips, tipId);
    set({ tips: next });
    get().recomputeActive();
    schedulePersist(() => get().tips);
  },

  skipAll: () => {
    const next = skipAllTips(get().tips);
    set({ tips: next });
    // Write-through NOW: the 400ms debounce lost the click when the user
    // refreshed right away.
    saveLocalFeatureTips(next);
    get().recomputeActive();
    schedulePersist(() => get().tips);
  },

  dontShowAgain: () => {
    const next = setDontShowAgain(get().tips, true);
    set({ tips: next });
    saveLocalFeatureTips(next);
    get().recomputeActive();
    schedulePersist(() => get().tips);
  },

  replay: () => {
    const next = replayFeatureTips(get().tips);
    set({ tips: { ...next, version: FEATURE_TIPS_VERSION } });
    saveLocalFeatureTips({ ...next, version: FEATURE_TIPS_VERSION });
    get().recomputeActive();
    // Replay is the ONE flow allowed to turn the durable hide flags off.
    schedulePersist(() => get().tips, { allowRegress: true });
  },

  markChecklist: (key, done = true) => {
    if (get().tips.checklist[key] === done) return;
    const next = markChecklistItem(get().tips, key, done);
    set({ tips: next });
    schedulePersist(() => get().tips);
  },

  dismissGettingStarted: () => {
    const next = dismissChecklist(get().tips);
    set({ tips: next });
    schedulePersist(() => get().tips);
  },

  persistRemote: () => schedulePersist(() => get().tips),
}));

export function getTipCopy(tipId: FeatureTipId) {
  return FEATURE_TIP_CATALOG[tipId];
}

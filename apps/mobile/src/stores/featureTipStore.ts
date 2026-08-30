/**
 * Mobile feature-tip progress — AsyncStorage cache + sync into profile.settings.featureTips.
 * "Got it" is session-only (in-memory); Don't show again / Skip all persist until Replay.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FEATURE_TIP_CATALOG,
  FEATURE_TIPS_VERSION,
  FEATURE_TIPS_LOCAL_KEY,
  normalizeFeatureTips,
  pickActiveTip,
  toPersistentFeatureTips,
  mergeFeatureTipsProgress,
  dismissTip as dismissTipHelper,
  skipAllTips as skipAllTipsHelper,
  setDontShowAgain as setDontShowAgainHelper,
  replayFeatureTips as replayHelper,
  markChecklistItem as markChecklistHelper,
  dismissChecklist as dismissChecklistHelper,
  type FeatureTipId,
  type FeatureTipsState,
  type ChecklistItemKey,
} from '@lantern/shared/featureTips';
import { useSettingsStore } from './settingsStore';

interface FeatureTipStore {
  tips: FeatureTipsState;
  readyTips: FeatureTipId[];
  allowedByTip: Partial<Record<FeatureTipId, boolean>>;
  onboardingComplete: boolean;
  hydrated: boolean;
  activeTipId: FeatureTipId | null;

  hydrate: () => Promise<void>;
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

async function writeLocal(tips: FeatureTipsState) {
  try {
    await AsyncStorage.setItem(
      FEATURE_TIPS_LOCAL_KEY,
      JSON.stringify(toPersistentFeatureTips(tips))
    );
    // Drop legacy v1 key that stored permanent Got-it dismissals.
    await AsyncStorage.removeItem('lantern_feature_tips_v1');
  } catch {
    /* ignore */
  }
}

function schedulePersist(
  getTips: () => FeatureTipsState,
  opts: { allowRegress?: boolean } = {}
) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const tips = getTips();
    const durable = toPersistentFeatureTips(tips);
    void writeLocal(tips);
    // Durable hide flags are MONOTONIC: a push fired before this device
    // loaded the profile (e.g. a Got-it tap right after boot) must not
    // flip a saved "Don't show again" back to false — that overwrite is
    // how tips resurrected on the web after re-login. Only Replay
    // regresses them.
    const remoteFlags = normalizeFeatureTips(useSettingsStore.getState().settings.featureTips);
    const keepTrue = (local?: boolean, remote?: boolean) =>
      opts.allowRegress ? Boolean(local) : Boolean(local || remote);
    void useSettingsStore.getState().updateSettings('featureTips', {
      version: durable.version,
      dismissed: {},
      skippedAll: keepTrue(durable.skippedAll, remoteFlags.skippedAll),
      dontShowAgain: keepTrue(durable.dontShowAgain, remoteFlags.dontShowAgain),
      checklistDismissed: keepTrue(durable.checklistDismissed, remoteFlags.checklistDismissed),
      checklist: durable.checklist as Record<string, boolean>,
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

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw =
        (await AsyncStorage.getItem(FEATURE_TIPS_LOCAL_KEY)) ||
        (await AsyncStorage.getItem('lantern_feature_tips_v1'));
      const local = normalizeFeatureTips(raw ? JSON.parse(raw) : null);
      const remote = useSettingsStore.getState().settings.featureTips;
      // Preserve in-memory session dismissals (none on cold start).
      const merged = remote
        ? mergeFeatureTipsProgress({ ...toPersistentFeatureTips(local), dismissed: {} }, remote)
        : { ...toPersistentFeatureTips(local), dismissed: {} };
      set({ tips: merged, hydrated: true });
      get().recomputeActive();
      await writeLocal(merged);
    } catch {
      set({ tips: normalizeFeatureTips(null), hydrated: true });
      get().recomputeActive();
    }
  },

  syncFromUserSettings: (raw) => {
    const remote = normalizeFeatureTips(raw);
    const merged = mergeFeatureTipsProgress(get().tips, raw);
    set({ tips: merged });
    void writeLocal(merged);
    get().recomputeActive();
    // Self-heal: push a durable hide the profile lost back up, or the next
    // fresh install / web re-login resurrects the tips.
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
    set({ activeTipId: computeActive(s) });
  },

  dismiss: (tipId) => {
    // Session-only: advances tips this visit; not written as durable dismissals.
    const next = dismissTipHelper(get().tips, tipId);
    set({ tips: next });
    get().recomputeActive();
    schedulePersist(() => get().tips);
  },

  skipAll: () => {
    const next = skipAllTipsHelper(get().tips);
    set({ tips: next });
    get().recomputeActive();
    schedulePersist(() => get().tips);
  },

  dontShowAgain: () => {
    const next = setDontShowAgainHelper(get().tips, true);
    set({ tips: next });
    get().recomputeActive();
    schedulePersist(() => get().tips);
  },

  replay: () => {
    const next = replayHelper(get().tips);
    set({ tips: { ...next, version: FEATURE_TIPS_VERSION } });
    get().recomputeActive();
    // Replay is the ONE flow allowed to turn the durable hide flags off.
    schedulePersist(() => get().tips, { allowRegress: true });
  },

  markChecklist: (key, done = true) => {
    if (get().tips.checklist[key] === done) return;
    const next = markChecklistHelper(get().tips, key, done);
    set({ tips: next });
    schedulePersist(() => get().tips);
  },

  dismissGettingStarted: () => {
    const next = dismissChecklistHelper(get().tips);
    set({ tips: next });
    schedulePersist(() => get().tips);
  },
}));

export function getTipCopy(tipId: FeatureTipId) {
  return FEATURE_TIP_CATALOG[tipId];
}

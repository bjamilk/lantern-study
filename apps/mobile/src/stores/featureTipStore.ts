/**
 * Mobile feature-tip progress — AsyncStorage cache + sync into profile.settings.featureTips.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FEATURE_TIP_CATALOG,
  FEATURE_TIPS_VERSION,
  FEATURE_TIPS_LOCAL_KEY,
  normalizeFeatureTips,
  pickActiveTip,
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
    await AsyncStorage.setItem(FEATURE_TIPS_LOCAL_KEY, JSON.stringify(tips));
  } catch {
    /* ignore */
  }
}

function schedulePersist(getTips: () => FeatureTipsState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const tips = getTips();
    void writeLocal(tips);
    void useSettingsStore.getState().updateSettings('featureTips', {
      version: tips.version,
      dismissed: tips.dismissed,
      skippedAll: tips.skippedAll,
      dontShowAgain: tips.dontShowAgain,
      checklistDismissed: tips.checklistDismissed,
      checklist: tips.checklist as Record<string, boolean>,
    });
  }, 400);
}

function mergeTips(local: FeatureTipsState, remote: unknown): FeatureTipsState {
  const remoteNorm = normalizeFeatureTips(remote);
  return {
    version: FEATURE_TIPS_VERSION,
    skippedAll: local.skippedAll || remoteNorm.skippedAll,
    dontShowAgain: local.dontShowAgain || remoteNorm.dontShowAgain,
    checklistDismissed: local.checklistDismissed || remoteNorm.checklistDismissed,
    dismissed: { ...remoteNorm.dismissed, ...local.dismissed },
    checklist: { ...remoteNorm.checklist, ...local.checklist },
  };
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
      const raw = await AsyncStorage.getItem(FEATURE_TIPS_LOCAL_KEY);
      const local = normalizeFeatureTips(raw ? JSON.parse(raw) : null);
      const remote = useSettingsStore.getState().settings.featureTips;
      const merged = remote ? mergeTips(local, remote) : local;
      set({ tips: merged, hydrated: true });
      get().recomputeActive();
      await writeLocal(merged);
    } catch {
      set({ tips: normalizeFeatureTips(null), hydrated: true });
      get().recomputeActive();
    }
  },

  syncFromUserSettings: (raw) => {
    const merged = mergeTips(get().tips, raw);
    set({ tips: merged });
    void writeLocal(merged);
    get().recomputeActive();
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
    schedulePersist(() => get().tips);
  },

  markChecklist: (key, done = true) => {
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

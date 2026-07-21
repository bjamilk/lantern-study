/**
 * Web feature-tip progress store — local cache + sync into profile.settings.featureTips.
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
import { saveUserSettings } from '../services/supabase';
import { useAuthStore } from './authStore';

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

function schedulePersist(getTips: () => FeatureTipsState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const tips = getTips();
    // Session Got-it map stays in sessionStorage via saveLocal; profile gets durable flags only.
    saveLocalFeatureTips(tips);
    const durable = toPersistentFeatureTips(tips);
    const user = useAuthStore.getState().currentUser;
    if (!user?.id) return;
    const current = normalizeUserSettings(user.settings);
    const next = {
      ...current,
      featureTips: {
        version: durable.version,
        dismissed: {},
        skippedAll: durable.skippedAll,
        dontShowAgain: durable.dontShowAgain,
        checklistDismissed: durable.checklistDismissed,
        checklist: durable.checklist as Record<string, boolean>,
      },
      updatedAt: new Date().toISOString(),
    };
    useAuthStore.getState().setCurrentUser({ ...user, settings: next });
    void saveUserSettings(user.id, next).catch((err) => {
      console.warn('Failed to sync feature tips settings', err);
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
    const merged = mergeRemoteFeatureTips(get().tips, settings.featureTips);
    set({ tips: merged });
    saveLocalFeatureTips(merged);
    get().recomputeActive();
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
    get().recomputeActive();
    schedulePersist(() => get().tips);
  },

  dontShowAgain: () => {
    const next = setDontShowAgain(get().tips, true);
    set({ tips: next });
    get().recomputeActive();
    schedulePersist(() => get().tips);
  },

  replay: () => {
    const next = replayFeatureTips(get().tips);
    set({ tips: { ...next, version: FEATURE_TIPS_VERSION } });
    get().recomputeActive();
    schedulePersist(() => get().tips);
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

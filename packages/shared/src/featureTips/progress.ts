/**
 * Feature tip progress helpers — shared between web and mobile.
 */
import {
  CHECKLIST_ITEMS,
  FEATURE_TIP_CATALOG,
  FEATURE_TIP_SEQUENCE,
  FEATURE_TIPS_VERSION,
  LEGACY_GETTING_STARTED_KEY,
  type ChecklistItemKey,
  type FeatureTipId,
} from './catalog';

export interface FeatureTipsState {
  version: number;
  /**
   * Per-tip "Got it" dismissals for the current visit/session only.
   * Not written to durable storage — returning users see tips again unless
   * they chose Don't show again / Skip all.
   */
  dismissed: Record<string, boolean>;
  /** Permanently hide coach tips until Replay (returning users). */
  skippedAll?: boolean;
  /** "Don't show again" for coach tips specifically. */
  dontShowAgain?: boolean;
  checklistDismissed?: boolean;
  checklist: Partial<Record<ChecklistItemKey, boolean>>;
}

export const DEFAULT_FEATURE_TIPS: FeatureTipsState = {
  version: FEATURE_TIPS_VERSION,
  dismissed: {},
  skippedAll: false,
  dontShowAgain: false,
  checklistDismissed: false,
  checklist: {},
};

export function normalizeFeatureTips(raw: unknown): FeatureTipsState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_FEATURE_TIPS, checklist: {} };
  }
  const record = raw as Record<string, unknown>;
  const checklist =
    record.checklist && typeof record.checklist === 'object' && !Array.isArray(record.checklist)
      ? (record.checklist as Partial<Record<ChecklistItemKey, boolean>>)
      : {};

  // Durable storage never keeps Got-it dismissals (session-only). Legacy v1 profiles
  // that stored dismissed maps are cleared here so returning users see tips again.
  return {
    version: FEATURE_TIPS_VERSION,
    dismissed: {},
    skippedAll: Boolean(record.skippedAll),
    dontShowAgain: Boolean(record.dontShowAgain),
    checklistDismissed: Boolean(record.checklistDismissed),
    checklist: { ...checklist },
  };
}

/** Shape written to localStorage / profile — never persist session Got-it map. */
export function toPersistentFeatureTips(state: FeatureTipsState): FeatureTipsState {
  return {
    version: FEATURE_TIPS_VERSION,
    dismissed: {},
    skippedAll: Boolean(state.skippedAll),
    dontShowAgain: Boolean(state.dontShowAgain),
    checklistDismissed: Boolean(state.checklistDismissed),
    checklist: { ...(state.checklist || {}) },
  };
}

/** Merge remote durable flags with the current session's Got-it map. */
export function mergeFeatureTipsProgress(
  local: FeatureTipsState,
  remote: unknown
): FeatureTipsState {
  const remoteNorm = normalizeFeatureTips(remote);
  return {
    version: FEATURE_TIPS_VERSION,
    skippedAll: Boolean(local.skippedAll || remoteNorm.skippedAll),
    dontShowAgain: Boolean(local.dontShowAgain || remoteNorm.dontShowAgain),
    checklistDismissed: Boolean(local.checklistDismissed || remoteNorm.checklistDismissed),
    // Keep in-visit Got it progress; never re-import legacy remote dismissals.
    dismissed: { ...local.dismissed },
    checklist: { ...remoteNorm.checklist, ...local.checklist },
  };
}

export function isTipDismissed(state: FeatureTipsState, tipId: FeatureTipId): boolean {
  return Boolean(state.dismissed[tipId]);
}

export function dismissTip(state: FeatureTipsState, tipId: FeatureTipId): FeatureTipsState {
  return {
    ...state,
    version: FEATURE_TIPS_VERSION,
    dismissed: { ...state.dismissed, [tipId]: true },
  };
}

export function skipAllTips(state: FeatureTipsState): FeatureTipsState {
  const dismissed = { ...state.dismissed };
  for (const id of FEATURE_TIP_SEQUENCE) {
    dismissed[id] = true;
  }
  return {
    ...state,
    version: FEATURE_TIPS_VERSION,
    dismissed,
    skippedAll: true,
  };
}

export function setDontShowAgain(state: FeatureTipsState, value = true): FeatureTipsState {
  if (!value) {
    return { ...state, version: FEATURE_TIPS_VERSION, dontShowAgain: false };
  }
  return {
    ...skipAllTips(state),
    dontShowAgain: true,
  };
}

export function replayFeatureTips(state: FeatureTipsState): FeatureTipsState {
  return {
    ...DEFAULT_FEATURE_TIPS,
    version: FEATURE_TIPS_VERSION,
    checklist: { ...state.checklist },
    checklistDismissed: false,
  };
}

export interface TipVisibilityContext {
  /** Account onboarding finished */
  onboardingComplete: boolean;
  /** Tip anchor is mounted / surface visible */
  surfaceReady: boolean;
  /** Optional gate (e.g. admin-only tips) */
  allowed?: boolean;
  reduceMotion?: boolean;
}

export function shouldShowTip(
  state: FeatureTipsState,
  tipId: FeatureTipId,
  context: TipVisibilityContext
): boolean {
  if (!context.onboardingComplete) return false;
  if (!context.surfaceReady) return false;
  if (context.allowed === false) return false;
  if (state.skippedAll || state.dontShowAgain) return false;
  if (isTipDismissed(state, tipId)) return false;
  if (!FEATURE_TIP_CATALOG[tipId]) return false;
  return true;
}

/**
 * Pick the highest-priority tip that is eligible among candidates currently ready.
 */
export function pickActiveTip(
  state: FeatureTipsState,
  readyTips: FeatureTipId[],
  context: Omit<TipVisibilityContext, 'surfaceReady' | 'allowed'> & {
    allowedByTip?: Partial<Record<FeatureTipId, boolean>>;
  }
): FeatureTipId | null {
  if (!context.onboardingComplete) return null;
  if (state.skippedAll || state.dontShowAgain) return null;

  const ready = new Set(readyTips);
  for (const tipId of FEATURE_TIP_SEQUENCE) {
    if (!ready.has(tipId)) continue;
    const allowed = context.allowedByTip?.[tipId];
    if (
      shouldShowTip(state, tipId, {
        onboardingComplete: true,
        surfaceReady: true,
        allowed,
      })
    ) {
      return tipId;
    }
  }
  return null;
}

export function markChecklistItem(
  state: FeatureTipsState,
  key: ChecklistItemKey,
  done = true
): FeatureTipsState {
  return {
    ...state,
    version: FEATURE_TIPS_VERSION,
    checklist: { ...state.checklist, [key]: done },
  };
}

export function dismissChecklist(state: FeatureTipsState): FeatureTipsState {
  return {
    ...state,
    version: FEATURE_TIPS_VERSION,
    checklistDismissed: true,
  };
}

export function shouldShowChecklist(state: FeatureTipsState): boolean {
  if (state.checklistDismissed) return false;
  const allDone = CHECKLIST_ITEMS.every((item) => state.checklist[item.key]);
  return !allDone;
}

/** Migrate legacy web localStorage getting-started checklist into featureTips.checklist. */
export function migrateLegacyGettingStarted(raw: unknown): Partial<FeatureTipsState> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const legacy = raw as Record<string, unknown>;
  const checklist: Partial<Record<ChecklistItemKey, boolean>> = {};
  if (legacy.createDeck) checklist.createDeck = true;
  if (legacy.takeTest) checklist.takeTest = true;
  if (legacy.joinGroup) checklist.joinGroup = true;
  if (legacy.setBudget) checklist.setBudget = true;
  return {
    checklistDismissed: Boolean(legacy.dismissed),
    checklist,
  };
}

export { LEGACY_GETTING_STARTED_KEY };

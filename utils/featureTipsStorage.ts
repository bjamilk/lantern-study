import {
  FEATURE_TIPS_VERSION,
  FEATURE_TIPS_LOCAL_KEY,
  LEGACY_GETTING_STARTED_KEY,
  normalizeFeatureTips,
  migrateLegacyGettingStarted,
  type FeatureTipsState,
  type FeatureTipId,
  type ChecklistItemKey,
  dismissTip as dismissTipHelper,
  skipAllTips as skipAllTipsHelper,
  setDontShowAgain as setDontShowAgainHelper,
  replayFeatureTips as replayHelper,
  markChecklistItem as markChecklistHelper,
  dismissChecklist as dismissChecklistHelper,
} from '@lantern/shared/featureTips';

function readLocalRaw(): unknown {
  try {
    const raw = localStorage.getItem(FEATURE_TIPS_LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(state: FeatureTipsState): void {
  try {
    localStorage.setItem(FEATURE_TIPS_LOCAL_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

function migrateLegacyIfNeeded(state: FeatureTipsState): FeatureTipsState {
  try {
    const legacyRaw = localStorage.getItem(LEGACY_GETTING_STARTED_KEY);
    if (!legacyRaw) return state;
    const migrated = migrateLegacyGettingStarted(JSON.parse(legacyRaw));
    if (!migrated) return state;
    const next: FeatureTipsState = {
      ...state,
      version: FEATURE_TIPS_VERSION,
      checklistDismissed: state.checklistDismissed || Boolean(migrated.checklistDismissed),
      checklist: { ...migrated.checklist, ...state.checklist },
    };
    writeLocal(next);
    localStorage.removeItem(LEGACY_GETTING_STARTED_KEY);
    return next;
  } catch {
    return state;
  }
}

export function loadLocalFeatureTips(): FeatureTipsState {
  const base = normalizeFeatureTips(readLocalRaw());
  return migrateLegacyIfNeeded(base);
}

export function saveLocalFeatureTips(state: FeatureTipsState): void {
  writeLocal({ ...state, version: FEATURE_TIPS_VERSION });
}

export function mergeRemoteFeatureTips(
  local: FeatureTipsState,
  remote: unknown
): FeatureTipsState {
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

export {
  dismissTipHelper as dismissTip,
  skipAllTipsHelper as skipAllTips,
  setDontShowAgainHelper as setDontShowAgain,
  replayHelper as replayFeatureTips,
  markChecklistHelper as markChecklistItem,
  dismissChecklistHelper as dismissChecklist,
};

export type { FeatureTipsState, FeatureTipId, ChecklistItemKey };

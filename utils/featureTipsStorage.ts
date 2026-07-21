import {
  FEATURE_TIPS_VERSION,
  FEATURE_TIPS_LOCAL_KEY,
  FEATURE_TIPS_SESSION_KEY,
  LEGACY_GETTING_STARTED_KEY,
  normalizeFeatureTips,
  migrateLegacyGettingStarted,
  toPersistentFeatureTips,
  mergeFeatureTipsProgress,
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
    // Prefer v2; fall back to v1 key once for migration.
    const raw =
      localStorage.getItem(FEATURE_TIPS_LOCAL_KEY) ||
      localStorage.getItem('lantern_feature_tips_v1');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(state: FeatureTipsState): void {
  try {
    localStorage.setItem(
      FEATURE_TIPS_LOCAL_KEY,
      JSON.stringify(toPersistentFeatureTips(state))
    );
    localStorage.removeItem('lantern_feature_tips_v1');
  } catch {
    /* ignore quota */
  }
}

function loadSessionDismissed(): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(FEATURE_TIPS_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function saveSessionDismissed(dismissed: Record<string, boolean>): void {
  try {
    sessionStorage.setItem(FEATURE_TIPS_SESSION_KEY, JSON.stringify(dismissed || {}));
  } catch {
    /* ignore */
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
  const base = migrateLegacyIfNeeded(normalizeFeatureTips(readLocalRaw()));
  return {
    ...toPersistentFeatureTips(base),
    dismissed: loadSessionDismissed(),
  };
}

export function saveLocalFeatureTips(state: FeatureTipsState): void {
  writeLocal(state);
  saveSessionDismissed(state.dismissed || {});
}

export function mergeRemoteFeatureTips(
  local: FeatureTipsState,
  remote: unknown
): FeatureTipsState {
  return mergeFeatureTipsProgress(local, remote);
}

export {
  dismissTipHelper as dismissTip,
  skipAllTipsHelper as skipAllTips,
  setDontShowAgainHelper as setDontShowAgain,
  replayHelper as replayFeatureTips,
  markChecklistHelper as markChecklistItem,
  dismissChecklistHelper as dismissChecklist,
  toPersistentFeatureTips,
};

export type { FeatureTipsState, FeatureTipId, ChecklistItemKey };

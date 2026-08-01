import type { PausedSessionSummary, TestSessionData, TestSessionKind } from '../types';
import {
  createTestDraft,
  getSessionRemainingSeconds,
  patchTestDraft,
  writeLocalSessionMirror,
} from '../services/testDrafts';
import { useTestStore } from '../stores/testStore';
import { useAuthStore } from '../stores/authStore';

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;
/** Bumps whenever a new flush starts; stale in-flight flushes must not clobber newer local UI state. */
let flushEpoch = 0;

function answeredCount(session: TestSessionData): number {
  return Object.keys(session.userAnswers || {}).length;
}

/**
 * Prefer local answers for overlapping question ids (active session is source of truth),
 * while keeping any remote-only keys.
 */
export function mergeUserAnswersPreferLocal(
  local: TestSessionData['userAnswers'] | undefined,
  remote: TestSessionData['userAnswers'] | undefined,
): TestSessionData['userAnswers'] {
  return { ...(remote || {}), ...(local || {}) };
}

/**
 * Merge a server/draft snapshot onto the live local session without regressing
 * navigation, answers, or the live countdown.
 *
 * Draft create/patch responses (and stale flush snapshots) must never bounce the
 * UI back to an older currentQuestionIndex or wipe newer userAnswers.
 */
export function mergeDraftOntoSession(
  local: TestSessionData,
  remote: TestSessionData,
  kind: TestSessionKind,
  status?: TestSessionData['status'],
): TestSessionData {
  return {
    ...local,
    ...remote,
    // Durable identity / metadata from remote when present
    id: remote.id || local.id,
    updatedAt: remote.updatedAt || local.updatedAt,
    pausedAt: remote.pausedAt ?? local.pausedAt,
    // Never let a stale draft response wipe the live timer
    endTime: local.endTime ?? remote.endTime,
    remainingTime: remote.remainingTime ?? local.remainingTime,
    config: local.config?.questionIds?.length
      ? local.config
      : remote.config?.questionIds?.length
        ? remote.config
        : local.config || remote.config,
    questions: local.questions?.length ? local.questions : remote.questions,
    // Local navigation + answers win during an active attempt
    currentQuestionIndex: local.currentQuestionIndex ?? remote.currentQuestionIndex ?? 0,
    userAnswers: mergeUserAnswersPreferLocal(local.userAnswers, remote.userAnswers),
    sessionKind: kind,
    status: status ?? local.status ?? remote.status,
    title: local.title || remote.title,
  };
}

function readActiveSession(): {
  kind: TestSessionKind | null;
  session: TestSessionData | null;
  setActiveTestSession: (s: TestSessionData | null) => void;
  setActiveStudySession: (s: TestSessionData | null) => void;
  upsertPausedSessionSummary: (summary: PausedSessionSummary) => void;
} {
  const state = useTestStore.getState();
  const kind: TestSessionKind | null = state.activeTestSession
    ? 'test'
    : state.activeStudySession
      ? 'study'
      : null;
  return {
    kind,
    session: state.activeTestSession || state.activeStudySession,
    setActiveTestSession: state.setActiveTestSession,
    setActiveStudySession: state.setActiveStudySession,
    upsertPausedSessionSummary: state.upsertPausedSessionSummary,
  };
}

function writeActiveSession(kind: TestSessionKind, session: TestSessionData): void {
  const { setActiveTestSession, setActiveStudySession } = useTestStore.getState();
  if (kind === 'test') setActiveTestSession(session);
  else setActiveStudySession(session);
}

/**
 * Apply a draft network result onto whatever is currently in the store.
 * Returns null if the user already left the session (nothing to write).
 */
export function applyDraftResultToLatestLocal(
  kind: TestSessionKind,
  remote: TestSessionData,
  status?: TestSessionData['status'],
): TestSessionData | null {
  const { kind: currentKind, session: local } = readActiveSession();
  if (!local || currentKind !== kind) return null;
  return mergeDraftOntoSession(local, remote, kind, status);
}

export function toPausedSummary(
  session: TestSessionData,
  kind: TestSessionKind,
  status: 'in_progress' | 'paused' = 'paused',
): PausedSessionSummary | null {
  if (!session.id) return null;
  return {
    id: session.id,
    sessionKind: kind,
    status,
    title:
      session.title ||
      session.config?.groupName ||
      (kind === 'study' ? 'Study session' : 'Test'),
    answeredCount: answeredCount(session),
    totalQuestions: session.questions.length,
    currentQuestionIndex: session.currentQuestionIndex || 0,
    remainingTimeSeconds: getSessionRemainingSeconds(session),
    startTime:
      session.startTime instanceof Date
        ? session.startTime.toISOString()
        : String(session.startTime || new Date().toISOString()),
    updatedAt: session.updatedAt || new Date().toISOString(),
    pausedAt: session.pausedAt || null,
    groupId: session.config?.groupId,
  };
}

function mirrorLocalState(): void {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return;
  const state = useTestStore.getState();
  writeLocalSessionMirror(userId, {
    pausedSessions: state.pausedSessions,
    activeTestSession: state.activeTestSession,
    activeStudySession: state.activeStudySession,
  });
}

export async function ensureSessionDraft(
  session: TestSessionData,
  kind: TestSessionKind,
): Promise<TestSessionData> {
  if (session.id) return session;
  if (session.isOffline || !navigator.onLine) {
    const localId = `local-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
    return { ...session, id: localId, sessionKind: kind, status: 'in_progress' };
  }
  try {
    const created = await createTestDraft({ ...session, sessionKind: kind }, kind);
    // Prefer the caller's session for answers/index; only take server id/metadata.
    return mergeDraftOntoSession(session, created, kind, 'in_progress');
  } catch (error) {
    console.error('[sessionDraftSync] create draft failed', error);
    const localId = `local-${Date.now()}`;
    return { ...session, id: localId, sessionKind: kind, status: 'in_progress' };
  }
}

/**
 * Persist draft id (and only non-regressive fields) onto the latest active session.
 * Safe to call after async create — will not wipe newer local answers/index.
 */
export function bindDraftIdToActiveSession(
  kind: TestSessionKind,
  drafted: TestSessionData,
): TestSessionData | null {
  return applyDraftResultToLatestLocal(kind, drafted, drafted.status || 'in_progress');
}

export async function flushActiveSessionDraft(options?: {
  status?: 'in_progress' | 'paused';
  remainingTime?: number;
}): Promise<void> {
  if (flushInFlight) {
    await flushInFlight;
  }
  const epoch = ++flushEpoch;
  flushInFlight = (async () => {
    let { kind, session } = readActiveSession();
    if (!kind || !session) {
      mirrorLocalState();
      return;
    }

    let working = { ...session };
    if (typeof options?.remainingTime === 'number') {
      working.remainingTime = options.remainingTime;
    }

    // Create draft if needed; always bind the server id onto latest local state
    // (even if a newer flush superseded us — otherwise the id is lost).
    if (!working.id) {
      working = await ensureSessionDraft(working, kind);
      const bound = bindDraftIdToActiveSession(kind, working);
      if (!bound) return;
      writeActiveSession(kind, bound);
      if (epoch !== flushEpoch) return;
      working = bound;
    }

    // Re-read immediately before PATCH so we never send a stale index/answers.
    const beforePatch = readActiveSession();
    if (!beforePatch.kind || !beforePatch.session || beforePatch.kind !== kind) return;
    if (epoch !== flushEpoch) return;

    working = { ...beforePatch.session };
    if (typeof options?.remainingTime === 'number') {
      working.remainingTime = options.remainingTime;
    }

    const status = options?.status || 'in_progress';
    const remainingForPatch =
      typeof options?.remainingTime === 'number'
        ? options.remainingTime
        : getSessionRemainingSeconds(working);

    if (working.id && !String(working.id).startsWith('local-') && navigator.onLine) {
      try {
        const patched = await patchTestDraft(working.id, {
          userAnswers: working.userAnswers,
          currentQuestionIndex: working.currentQuestionIndex,
          remainingTime: remainingForPatch,
          status,
        });
        if (epoch !== flushEpoch) return;

        // Re-read again before apply — user may have advanced during the network round-trip.
        const merged = applyDraftResultToLatestLocal(kind, patched, status);
        if (!merged) return;
        working = merged;

        // Live countdown uses endTime; keep remainingTime only while paused.
        if (status !== 'paused') {
          working = { ...working, remainingTime: undefined };
        } else if (typeof remainingForPatch === 'number') {
          working = { ...working, remainingTime: remainingForPatch };
        }
      } catch (error) {
        console.error('[sessionDraftSync] patch draft failed', error);
        if (epoch !== flushEpoch) return;
        const latest = applyDraftResultToLatestLocal(
          kind,
          { ...working, status },
          status,
        );
        if (!latest) return;
        working = latest;
      }
    } else {
      if (epoch !== flushEpoch) return;
      const latest = applyDraftResultToLatestLocal(
        kind,
        { ...working, status },
        status,
      );
      if (!latest) return;
      working = latest;
    }

    if (epoch !== flushEpoch) return;

    // Final CAS: merge onto whatever is newest right now, never regress index/answers.
    const finalWrite = applyDraftResultToLatestLocal(kind, working, status);
    if (!finalWrite) return;

    let toWrite = finalWrite;
    if (status !== 'paused') {
      toWrite = { ...toWrite, remainingTime: undefined };
    } else if (typeof remainingForPatch === 'number') {
      toWrite = { ...toWrite, remainingTime: remainingForPatch };
    }

    writeActiveSession(kind, toWrite);

    const { upsertPausedSessionSummary } = useTestStore.getState();
    const summary = toPausedSummary(toWrite, kind, status === 'paused' ? 'paused' : 'in_progress');
    if (summary && status === 'paused') {
      upsertPausedSessionSummary(summary);
    }
    mirrorLocalState();
  })();

  try {
    await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

export function scheduleSessionDraftAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    void flushActiveSessionDraft({ status: 'in_progress' });
  }, 1500);
}

export function cancelScheduledSessionDraftAutosave(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

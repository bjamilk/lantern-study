import type { PausedSessionSummary, TestSessionData, TestSessionKind } from '../types';
import {
  createTestDraft,
  patchTestDraft,
  writeLocalSessionMirror,
} from '../services/testDrafts';
import { useTestStore } from '../stores/testStore';
import { useAuthStore } from '../stores/authStore';

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;

function answeredCount(session: TestSessionData): number {
  return Object.keys(session.userAnswers || {}).length;
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
    remainingTimeSeconds:
      typeof session.remainingTime === 'number' ? session.remainingTime : null,
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
    return { ...session, ...created, sessionKind: kind, status: 'in_progress' };
  } catch (error) {
    console.error('[sessionDraftSync] create draft failed', error);
    const localId = `local-${Date.now()}`;
    return { ...session, id: localId, sessionKind: kind, status: 'in_progress' };
  }
}

export async function flushActiveSessionDraft(options?: {
  status?: 'in_progress' | 'paused';
  remainingTime?: number;
}): Promise<void> {
  if (flushInFlight) {
    await flushInFlight;
  }
  flushInFlight = (async () => {
    const { activeTestSession, activeStudySession, setActiveTestSession, setActiveStudySession, upsertPausedSessionSummary } =
      useTestStore.getState();
    const kind: TestSessionKind | null = activeTestSession
      ? 'test'
      : activeStudySession
        ? 'study'
        : null;
    const session = activeTestSession || activeStudySession;
    if (!kind || !session) {
      mirrorLocalState();
      return;
    }

    let working = { ...session };
    if (typeof options?.remainingTime === 'number') {
      working.remainingTime = options.remainingTime;
    }
    working = await ensureSessionDraft(working, kind);

    const status = options?.status || 'in_progress';
    if (working.id && !String(working.id).startsWith('local-') && navigator.onLine) {
      try {
        const patched = await patchTestDraft(working.id, {
          userAnswers: working.userAnswers,
          currentQuestionIndex: working.currentQuestionIndex,
          remainingTime:
            typeof working.remainingTime === 'number' ? working.remainingTime : null,
          status,
        });
        working = { ...working, ...patched, status };
      } catch (error) {
        console.error('[sessionDraftSync] patch draft failed', error);
        working = { ...working, status };
      }
    } else {
      working = { ...working, status };
    }

    if (kind === 'test') setActiveTestSession(working);
    else setActiveStudySession(working);

    const summary = toPausedSummary(working, kind, status === 'paused' ? 'paused' : 'in_progress');
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

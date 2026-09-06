/**
 * Whole-queue pending-work aggregator.
 *
 * A student has work waiting to upload in three different places, and until
 * now the UI only counted one of them (offline test results), so a queued
 * flashcard or chat message showed as "Pending Sync 0" — the app claiming
 * everything was uploaded while it was not. That is exactly the dishonesty the
 * silent-work-loss rule forbids, so every source is folded together here:
 *
 *   1. the shared SyncQueue's pending operations (messages, flashcards, decks,
 *      notes, budget rows, ...) — services/syncService.ts
 *   2. unsynced offline test results — stores/offlineStore.ts pendingResults
 *   3. queued question-bank scores — utils/pendingQuestionBankScores.ts
 *
 * Pure module by design: no store, no service, no AsyncStorage. Callers pass
 * the counts in, which is what makes this testable in the mobile jest env.
 */

export type PendingWorkKind =
  | 'message'
  | 'flashcard'
  | 'flashcardReview'
  | 'deck'
  | 'note'
  | 'testResult'
  | 'score'
  | 'other';

export interface PendingWorkItem {
  kind: PendingWorkKind;
  count: number;
  /** Already pluralised for `count`, e.g. "2 flashcards". */
  label: string;
}

export interface PendingWorkSummary {
  total: number;
  breakdown: PendingWorkItem[];
  /** Full honest sentence, e.g. "2 items waiting to sync: 1 message, 1 flashcard". */
  label: string;
  /** Just the parts, e.g. "1 message, 1 flashcard" (empty when nothing is pending). */
  breakdownLabel: string;
}

export interface PendingWorkInput {
  /**
   * Entity types of the SyncQueue's pending operations, in queue order.
   * Unknown types are counted, never dropped — an operation the student
   * cannot see is work we might silently lose.
   */
  queueEntityTypes?: readonly string[];
  /** Unsynced entries in offlineStore.pendingResults. */
  pendingResults?: number;
  /** Entries from readPendingQuestionBankScores(userId). */
  pendingScores?: number;
}

/** Nouns, singular/plural. Deliberately student-facing, not schema names. */
const NOUNS: Record<PendingWorkKind, [string, string]> = {
  message: ['message', 'messages'],
  flashcard: ['flashcard', 'flashcards'],
  flashcardReview: ['flashcard review', 'flashcard reviews'],
  deck: ['deck', 'decks'],
  note: ['note', 'notes'],
  testResult: ['test result', 'test results'],
  score: ['quiz score', 'quiz scores'],
  other: ['change', 'changes'],
};

/** Display order, so the same queue always reads the same way. */
const KIND_ORDER: PendingWorkKind[] = [
  'message',
  'flashcard',
  'flashcardReview',
  'deck',
  'note',
  'testResult',
  'score',
  'other',
];

const ENTITY_KINDS: Record<string, PendingWorkKind> = {
  message: 'message',
  flashcard: 'flashcard',
  flashcard_review: 'flashcardReview',
  deck: 'deck',
  note: 'note',
  test_result: 'testResult',
};

/** Map a SyncQueue entityType onto a student-facing kind. */
export function pendingWorkKindForEntity(entityType: string): PendingWorkKind {
  return ENTITY_KINDS[entityType] ?? 'other';
}

function noun(kind: PendingWorkKind, count: number): string {
  const [one, many] = NOUNS[kind];
  return count === 1 ? one : many;
}

/** "2 flashcards", "1 message". */
export function pendingWorkItemLabel(kind: PendingWorkKind, count: number): string {
  return `${count} ${noun(kind, count)}`;
}

function sanitiseCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/**
 * Fold every source of pending work into one honest total plus a breakdown.
 *
 * Never claims more or less than it was given: an unknown queue entity type
 * still counts (as a generic "change") rather than disappearing.
 */
export function summarisePendingWork(input: PendingWorkInput): PendingWorkSummary {
  const counts = new Map<PendingWorkKind, number>();
  const add = (kind: PendingWorkKind, n: number) => {
    if (n <= 0) return;
    counts.set(kind, (counts.get(kind) ?? 0) + n);
  };

  for (const entityType of input.queueEntityTypes ?? []) {
    add(pendingWorkKindForEntity(String(entityType ?? '')), 1);
  }
  add('testResult', sanitiseCount(input.pendingResults));
  add('score', sanitiseCount(input.pendingScores));

  const breakdown: PendingWorkItem[] = KIND_ORDER.filter(kind => (counts.get(kind) ?? 0) > 0).map(
    kind => {
      const count = counts.get(kind) as number;
      return { kind, count, label: pendingWorkItemLabel(kind, count) };
    }
  );

  const total = breakdown.reduce((sum, item) => sum + item.count, 0);
  const breakdownLabel = breakdown.map(item => item.label).join(', ');

  let label: string;
  if (total === 0) {
    label = 'Everything is synced';
  } else if (breakdown.length === 1) {
    // "1 flashcard waiting to sync" — saying "1 item waiting to sync:
    // 1 flashcard" twice over reads like a bug.
    label = `${breakdownLabel} waiting to sync`;
  } else {
    label = `${total} item${total === 1 ? '' : 's'} waiting to sync: ${breakdownLabel}`;
  }

  return { total, breakdown, label, breakdownLabel };
}

export default summarisePendingWork;

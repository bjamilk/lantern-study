/**
 * Everything the AI companion is told about the student, built from what is on
 * screen.
 *
 * Exports: `buildCompanionContext` and the `CompanionContext` it returns.
 * Touches: nothing but its arguments — no stores, no network, no DOM. That is
 *  the point: this is the one part of the companion that is a pure function of
 *  the app's state, so it is the one part that can be asserted directly.
 * Gotchas:
 *  - Moved verbatim out of App.tsx's `companionContext` memo (M7); the closure
 *    reads became the argument object and nothing else changed.
 *  - `noteContext` is capped at 6,000 characters because a note body has no
 *    length bound, and every character here is sent to the model.
 *  - `weakTopics` used to read `result.tagBreakdown`, a field nothing on this
 *    path produces, so it was always empty (#70). It is now tallied from the
 *    data the web actually has — `session.questions` + `session.userAnswers`
 *    — under the same rules the server companion uses
 *    (apps/api-server/src/services/companionWeakTopics.ts): untagged
 *    questions fall under "General", a tag needs 3 answered questions before
 *    it can be called weak, weak is under 60% accuracy, weakest first, five
 *    at most, from the 10 most recent sessions.
 *  - The game and offline `currentScreen` cases used to name `AppMode.GAME`
 *    and `AppMode.OFFLINE`, neither of which is an enum member, so both read
 *    as `undefined` and never matched (#69). They now name the live members
 *    GAME_ACTIVE, GAME_RESULTS and OFFLINE_MODE.
 */
import { AppMode, TransactionType } from '../types';
import type {
    Budget,
    ChatItem,
    Deck,
    NoteAttachment,
    StudyGoalMode,
    StudyNote,
    StudySessionData,
    TestResult,
    TestSessionData,
    Transaction,
    User,
} from '../types';
import type { Group } from '../types';
import { getNoteStudyContent } from '@lantern/shared';
import { parseAppRoute } from './appRoutes';

/** A tag needs this many answered questions before it can be called weak. */
export const WEAK_TOPIC_MIN_QUESTIONS = 3;
/** Accuracy strictly below this (0..1) is weak. */
export const WEAK_TOPIC_MAX_ACCURACY = 0.6;
/** How many weak topics the companion context carries. */
export const WEAK_TOPIC_LIMIT = 5;
/** Sessions tallied — keeps the companion on current standing, not all-time. */
export const WEAK_TOPIC_SESSION_LIMIT = 10;

/** Explicit tags, else "General" — the same bucket the dashboards show. */
function questionTags(question: { tags?: string[] | null }): string[] {
    const tags = new Set<string>();
    for (const tag of question.tags ?? []) {
        if (typeof tag !== 'string') continue;
        const trimmed = tag.trim();
        if (trimmed) tags.add(trimmed);
    }
    return tags.size > 0 ? [...tags] : ['General'];
}

/**
 * Tags the student is weak on, weakest first, from their most recent sessions.
 *
 * `testResults` is oldest-first on this path (the last entry is the newest
 * test), so the newest sessions are taken from the end.
 */
export function deriveWeakTopics(testResults: TestResult[]): string[] {
    const breakdown = new Map<string, { total: number; correct: number }>();

    for (const result of testResults.slice(-WEAK_TOPIC_SESSION_LIMIT)) {
        const questions = result?.session?.questions;
        const answers = result?.session?.userAnswers;
        if (!Array.isArray(questions) || !answers) continue;

        for (const question of questions) {
            if (!question || typeof question.id !== 'string') continue;
            const answer = answers[question.id];
            // Same rule as the dashboard: an answer record means the question
            // was attempted; isCorrect decides the tally.
            if (!answer) continue;

            for (const tag of questionTags(question)) {
                const entry = breakdown.get(tag) ?? { total: 0, correct: 0 };
                entry.total++;
                if (answer.isCorrect) entry.correct++;
                breakdown.set(tag, entry);
            }
        }
    }

    return [...breakdown.entries()]
        .filter(([, stats]) => stats.total >= WEAK_TOPIC_MIN_QUESTIONS)
        .map(([tag, stats]) => ({ tag, accuracy: stats.correct / stats.total }))
        .filter(({ accuracy }) => accuracy < WEAK_TOPIC_MAX_ACCURACY)
        .sort((a, b) => a.accuracy - b.accuracy || a.tag.localeCompare(b.tag))
        .slice(0, WEAK_TOPIC_LIMIT)
        .map(({ tag }) => tag);
}

/** Exactly what App.tsx's memo closed over. */
export interface CompanionContextInput {
    testResults: TestResult[];
    groups: Group[];
    dueCardsCount: number;
    currentUser: User | null;
    transactions: Transaction[];
    budget: Budget | null;
    appMode: AppMode;
    selectedChat: ChatItem | null;
    selectedDeck: Deck | null;
    activeTestSession: TestSessionData | null;
    activeStudySession: StudySessionData | null;
    selectedNote: (StudyNote & { attachments?: NoteAttachment[] }) | null;
    studyGoal: StudyGoalMode;
    /** `location.pathname`, read for the course id on the workspace route. */
    pathname: string;
}

export function buildCompanionContext({
    testResults,
    groups,
    dueCardsCount,
    currentUser,
    transactions,
    budget,
    appMode,
    selectedChat,
    selectedDeck,
    activeTestSession,
    activeStudySession,
    selectedNote,
    studyGoal,
    pathname,
}: CompanionContextInput) {
    const uniqueWeak = deriveWeakTopics(testResults);
    const recentScore = testResults.length > 0
        ? `Last test: ${Math.round(testResults[testResults.length - 1]!.score)}%`
        : undefined;
    // Budget summary for current month
    let budgetSummary: string | undefined;
    if (transactions.length > 0) {
        const thisMonth = new Date().toISOString().slice(0, 7);
        const monthlyExpenses = transactions.filter(t => t.type === TransactionType.EXPENSE && t.date?.startsWith(thisMonth));
        const totalSpent = monthlyExpenses.reduce((s, t) => s + (t.amount || 0), 0);
        if (budget?.monthlyLimit && budget.monthlyLimit > 0) {
            budgetSummary = `Spent ₦${totalSpent.toFixed(0)} of ₦${budget.monthlyLimit.toFixed(0)} monthly budget this month`;
        } else if (totalSpent > 0) {
            budgetSummary = `Spent ₦${totalSpent.toFixed(0)} this month (no budget limit set)`;
        }
    }
    return {
        userName: currentUser?.firstName || currentUser?.name,
        groups: groups.filter(g => !g.isArchived).map(g => g.name).slice(0, 5),
        weakTopics: uniqueWeak,
        dueCardsCount,
        recentTestSummary: recentScore,
        budgetSummary,
        currentScreen: (() => {
            switch (appMode) {
                case AppMode.DASHBOARD: return 'Dashboard';
                case AppMode.CHAT: return selectedChat ? `Group chat: ${(selectedChat as any).name || 'Chat'}` : 'Chat (no group selected)';
                case AppMode.FLASHCARDS: return selectedDeck ? `Flashcards – deck: ${selectedDeck.name}` : 'Flashcards (deck list)';
                case AppMode.TEST_ACTIVE: return 'Active test session';
                case AppMode.STUDY_ACTIVE: return 'Active study session';
                case AppMode.GAME_ACTIVE: return 'Multiplayer quiz game';
                case AppMode.GAME_RESULTS: return 'Multiplayer quiz game results';
                case AppMode.MARKETPLACE: return 'Marketplace';
                case AppMode.BUDGET_TRACKER: return 'Budget Tracker';
                case AppMode.OFFLINE_MODE: return 'Offline mode';
                case AppMode.NOTES: return 'Notes library';
                case AppMode.NOTE_EDITOR: return selectedNote ? `Note: ${selectedNote.title}` : 'Note editor';
                case AppMode.COURSE_WORKSPACE: return selectedNote ? `Course – ${selectedNote.title}` : 'Course workspace';
                case AppMode.STUDY_SET_WORKSPACE: return selectedNote ? `Study set – ${selectedNote.title}` : 'Study set';
                default: return undefined;
            }
        })(),
        courseId:
            selectedNote?.courseId ||
            (appMode === AppMode.COURSE_WORKSPACE
                ? parseAppRoute(pathname).params.courseId
                : undefined),
        noteId: appMode === AppMode.NOTE_EDITOR || appMode === AppMode.COURSE_WORKSPACE || appMode === AppMode.STUDY_SET_WORKSPACE ? selectedNote?.id : undefined,
        noteContext: (appMode === AppMode.NOTE_EDITOR || appMode === AppMode.COURSE_WORKSPACE || appMode === AppMode.STUDY_SET_WORKSPACE) && selectedNote
            ? getNoteStudyContent({
                sourceType: selectedNote.sourceType,
                body: selectedNote.body,
                summary: selectedNote.summary,
                attachments: selectedNote.attachments,
              }).substring(0, 6000) || undefined
            : undefined,
        noteTitle: appMode === AppMode.NOTE_EDITOR || appMode === AppMode.COURSE_WORKSPACE || appMode === AppMode.STUDY_SET_WORKSPACE ? selectedNote?.title : undefined,
        studyGoal,
        activeSessionSummary: activeTestSession
            ? `Taking a ${activeTestSession.config?.mode || 'test'} with ${activeTestSession.questions?.length ?? 0} questions`
            : activeStudySession
            ? `Study session with ${activeStudySession.questions?.length ?? 0} questions`
            : undefined,
    };
}

export type CompanionContext = ReturnType<typeof buildCompanionContext>;

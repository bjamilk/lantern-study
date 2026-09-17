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
 *    — under the ONE shared rule (`@lantern/shared/study/weakTopics`), which
 *    the server companion uses too. The thresholds and the ordering live
 *    there and nowhere here: all `deriveWeakTopics` below does is pick the 10
 *    most recent sessions out of this side's oldest-first list and hand their
 *    sessions to the shared tally.
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
import {
    WEAK_TOPIC_SESSION_LIMIT,
    buildTagBreakdown,
    deriveWeakTopics as deriveWeakTopicsFromBreakdown,
} from '@lantern/shared/study/weakTopics';
import { parseAppRoute } from './appRoutes';

/**
 * The web's adapter onto the shared weak-topic rule.
 *
 * All this does is choose which sessions the rule sees: `testResults` is
 * oldest-first on this path (the last entry is the newest test), so the newest
 * sessions are taken from the END — the server's adapter slices the other end
 * because its rows arrive newest-first. No threshold, ordering or cap lives
 * here; they are all in `@lantern/shared/study/weakTopics`.
 */
export function deriveWeakTopics(testResults: TestResult[]): string[] {
    return deriveWeakTopicsFromBreakdown(
        buildTagBreakdown(
            testResults.slice(-WEAK_TOPIC_SESSION_LIMIT).map((result) => result?.session),
        ),
    );
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

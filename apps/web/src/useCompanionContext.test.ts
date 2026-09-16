/**
 * The contract for the AI companion's context (M7 step 3).
 *
 * `buildCompanionContext` (utils/companionContext.ts) decides what the model is
 * told about the student: which topics they are weak on, what is on screen,
 * what they have spent, and up to 6,000 characters of the open note. Until this
 * step it was a 68-line memo inside App.tsx with no way in, so none of that had
 * ever been asserted. It is a pure function now, and these are real calls.
 *
 * The hook's surface — the parameters App.tsx passes and the two keys it reads
 * back — is pinned from the source, the same way
 * `apps/web/src/useAppEffects.surface.test.ts` does it: rendering the hook would
 * need the companion store, the flashcard store and two services mocked.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { AppMode, TransactionType } from '../../../types';
import { buildCompanionContext } from '../../../utils/companionContext';
import type { CompanionContextInput } from '../../../utils/companionContext';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HOOK = path.join(REPO_ROOT, 'hooks/useCompanionContext.ts');
const source = () => fs.readFileSync(HOOK, 'utf8');

const base: CompanionContextInput = {
    testResults: [],
    groups: [],
    dueCardsCount: 0,
    currentUser: null,
    transactions: [],
    budget: null,
    appMode: AppMode.DASHBOARD,
    selectedChat: null,
    selectedDeck: null,
    activeTestSession: null,
    activeStudySession: null,
    selectedNote: null,
    studyGoal: 'casual',
    pathname: '/',
};

const result = (score: number, tags: Record<string, { correct: number; total: number }>) =>
    ({ score, tagBreakdown: tags }) as unknown as CompanionContextInput['testResults'][number];

describe('buildCompanionContext — what the model is told', () => {
    it('counts a topic as weak below 60% and leaves the rest out', () => {
        const context = buildCompanionContext({
            ...base,
            testResults: [
                result(50, {
                    Cardio: { correct: 1, total: 4 }, // 25% — weak
                    Renal: { correct: 3, total: 4 }, // 75% — not weak
                    Neuro: { correct: 3, total: 5 }, // exactly 60% — not weak
                    Empty: { correct: 0, total: 0 }, // never attempted — not weak
                }),
            ],
        });
        expect(context.weakTopics).toEqual(['Cardio']);
    });

    it('never sends more than five weak topics, and never sends one twice', () => {
        const tags = Object.fromEntries(
            ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t) => [t, { correct: 0, total: 4 }]),
        );
        const context = buildCompanionContext({
            ...base,
            testResults: [result(0, tags), result(0, tags)],
        });
        expect(context.weakTopics).toHaveLength(5);
        expect(new Set(context.weakTopics).size).toBe(5);
    });

    it('summarises the most recent test, not the best one', () => {
        const context = buildCompanionContext({
            ...base,
            testResults: [result(90, {}), result(41.4, {})],
        });
        expect(context.recentTestSummary).toBe('Last test: 41%');
    });

    it('says nothing about a budget when there is nothing to say', () => {
        expect(buildCompanionContext(base).budgetSummary).toBeUndefined();
    });

    it('compares this month’s spend against the limit, and ignores other months', () => {
        const thisMonth = `${new Date().toISOString().slice(0, 7)}-05`;
        const context = buildCompanionContext({
            ...base,
            budget: { monthlyLimit: 20000 } as CompanionContextInput['budget'],
            transactions: [
                { type: TransactionType.EXPENSE, date: thisMonth, amount: 1500 },
                { type: TransactionType.EXPENSE, date: '2001-01-09', amount: 900 },
                { type: TransactionType.INCOME, date: thisMonth, amount: 5000 },
            ] as unknown as CompanionContextInput['transactions'],
        });
        expect(context.budgetSummary).toBe('Spent ₦1500 of ₦20000 monthly budget this month');
    });

    it('is honest that there is no limit when none is set', () => {
        const thisMonth = `${new Date().toISOString().slice(0, 7)}-05`;
        const context = buildCompanionContext({
            ...base,
            transactions: [
                { type: TransactionType.EXPENSE, date: thisMonth, amount: 700 },
            ] as unknown as CompanionContextInput['transactions'],
        });
        expect(context.budgetSummary).toBe('Spent ₦700 this month (no budget limit set)');
    });

    it('names the screen the student is looking at', () => {
        expect(buildCompanionContext(base).currentScreen).toBe('Dashboard');
        expect(
            buildCompanionContext({ ...base, appMode: AppMode.TEST_ACTIVE }).currentScreen,
        ).toBe('Active test session');
    });

    it('caps the note it sends at 6000 characters', () => {
        const context = buildCompanionContext({
            ...base,
            appMode: AppMode.NOTE_EDITOR,
            selectedNote: {
                id: 'n1',
                title: 'Long one',
                body: 'x'.repeat(9000),
            } as CompanionContextInput['selectedNote'],
        });
        expect(context.noteContext).toHaveLength(6000);
        expect(context.noteId).toBe('n1');
        expect(context.noteTitle).toBe('Long one');
    });

    it('sends no note at all from a screen that is not about a note', () => {
        const context = buildCompanionContext({
            ...base,
            appMode: AppMode.DASHBOARD,
            selectedNote: {
                id: 'n1',
                title: 'Long one',
                body: 'body',
            } as CompanionContextInput['selectedNote'],
        });
        expect(context.noteContext).toBeUndefined();
        expect(context.noteId).toBeUndefined();
    });

    it('lists at most five live groups and drops archived ones', () => {
        const context = buildCompanionContext({
            ...base,
            groups: [
                { name: 'Gone', isArchived: true },
                ...Array.from({ length: 6 }, (_, i) => ({ name: `G${i}` })),
            ] as unknown as CompanionContextInput['groups'],
        });
        expect(context.groups).toEqual(['G0', 'G1', 'G2', 'G3', 'G4']);
    });

    it('describes an active session so the companion knows not to interrupt', () => {
        const context = buildCompanionContext({
            ...base,
            activeTestSession: {
                config: { mode: 'exam' },
                questions: [{}, {}, {}],
            } as unknown as CompanionContextInput['activeTestSession'],
        });
        expect(context.activeSessionSummary).toBe('Taking a exam with 3 questions');
    });
});

describe('useCompanionContext surface', () => {
    const parameterKeys = () => {
        const text = source();
        const start = text.indexOf('export function useCompanionContext({');
        const end = text.indexOf('}: UseCompanionContextParams', start);
        return text
            .slice(start + 'export function useCompanionContext({'.length, end)
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
    };

    it('takes exactly the parameters App.tsx passes', () => {
        expect(parameterKeys()).toEqual([
            'testResults',
            'groups',
            'dueCardsCount',
            'currentUser',
            'transactions',
            'budget',
            'appMode',
            'selectedChat',
            'selectedDeck',
            'activeTestSession',
            'activeStudySession',
            'selectedNote',
            'notes',
            'studyGoal',
            'pathname',
            'setAppMode',
            'setSelectedDeck',
            'setActiveTestConfigMode',
            'openModal',
            'getUserSettings',
            'handleSelectChat',
            'navigateTo',
            'showToast',
            'addNotification',
            'noteHandlers',
        ]);
    });

    it('returns exactly the two things AICompanionPanel is handed', () => {
        expect(source()).toContain('return { companionContext, handleCompanionAction };');
    });

    it('keeps the pending-group effect that replaced the 50 ms timer', () => {
        // FIXED (F9) in the original: opening the test-config modal on a timer
        // built the test against the previous chat on a slow render. The effect
        // is the fix, and it has to travel with the executor.
        expect(source()).toContain('pendingTestConfigGroupRef');
        expect(source()).toContain('[selectedChat, setActiveTestConfigMode, openModal, getUserSettings]');
    });
});

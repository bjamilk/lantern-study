/**
 * The safety net for the `hooks/useAppEffects.ts` decomposition.
 *
 * `useAppEffects` is App.tsx's effect barrel: 29 `useEffect`s in one 2,400-line
 * function. Breaking it into `hooks/effects/*` modules is only behaviour-
 * preserving if THREE things survive the move:
 *
 *  1. the hook's parameter object keys — App.tsx passes exactly these,
 *  2. the hook's returned keys — App.tsx reads exactly these,
 *  3. the ORDER the effects run in. React runs effects in registration order,
 *     and this file depends on it (the cross-account queue purge has to land
 *     before the sync/persist effects observe the queue, and every realtime
 *     channel has to be created after the token-ready promotion). Once the
 *     bodies live in separate modules, nothing but this test can see that order.
 *
 * Each effect is identified by its dependency array plus the first line of the
 * comment banner directly above it. Both move verbatim with the body, so the
 * snapshot below was frozen against the UNTOUCHED file and must keep passing
 * after every extraction step.
 *
 * The lists are read out of the SOURCE rather than by mounting the hook on
 * purpose: mounting it would need ~35 module mocks (supabase, eight stores, the
 * Realtime client), and a mock that drifts is exactly how a surface test starts
 * lying. Reading the text cannot drift.
 *
 * Reading order for a reviewer: this file first, then `hooks/useAppEffects.ts`
 * (the composer), then the modules under `hooks/effects/` in the order the
 * composer calls them.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPOSER = path.join(REPO_ROOT, 'hooks/useAppEffects.ts');

const read = (file: string) => fs.readFileSync(file, 'utf8');

/** `}, [a, b]);` — how every `useEffect` in this family closes. */
const EFFECT_CLOSE = /\}\s*,\s*\[([^\]]*)\]\s*\)\s*;/;

interface EffectIdentity {
    /** First line of the comment banner directly above the effect. */
    name: string;
    /** Normalised dependency array text. */
    deps: string;
}

/** Identify the `useEffect` that starts at `at`: its banner and its deps. */
function identityAt(source: string, at: number): EffectIdentity {
    const match = EFFECT_CLOSE.exec(source.slice(at));
    // `match[1]` is '' for a `[]` dependency array, which is a real answer.
    const deps = match
        ? (match[1] ?? '')
              .replace(/\/\/[^\n]*/g, '')
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean)
              .join(', ')
        : '<unparsed>';

    const linesAbove = source.slice(0, at).split('\n');
    let index = linesAbove.length - 1;
    while (index >= 0 && (linesAbove[index] ?? '').trim() === '') index--;
    const banner: string[] = [];
    while (index >= 0 && (linesAbove[index] ?? '').trim().startsWith('//')) {
        banner.unshift((linesAbove[index] ?? '').trim().replace(/^\/\/\s?/, ''));
        index--;
    }

    return { name: banner[0] || '<no banner>', deps: `[${deps}]` };
}

/** Every `useEffect` in one module, in source order. */
function effectsInSource(source: string): EffectIdentity[] {
    const found: EffectIdentity[] = [];
    let cursor = 0;
    for (;;) {
        const at = source.indexOf('useEffect(', cursor);
        if (at === -1) break;
        found.push(identityAt(source, at));
        cursor = at + 'useEffect('.length;
    }
    return found;
}

/**
 * The effects the composer runs, in the order it runs them: its own, plus —
 * spliced in at the call site — those of every `hooks/effects/*` module it
 * calls. This is what makes a reordered hook call a test failure.
 */
function composedEffectOrder(): EffectIdentity[] {
    const source = read(COMPOSER);

    const moduleOf = new Map<string, string>();
    const importRe = /import\s*\{([^}]*)\}\s*from\s*'\.\/effects\/([\w]+)'/g;
    for (const match of source.matchAll(importRe)) {
        const file = path.join(REPO_ROOT, 'hooks/effects', `${match[2] ?? ''}.ts`);
        for (const name of (match[1] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
            moduleOf.set(name, fs.existsSync(file) ? file : `${file}x`);
        }
    }

    const body = source.slice(source.indexOf('export function useAppEffects'));
    const ordered: EffectIdentity[] = [];
    let cursor = 0;
    for (;;) {
        // Next event in the body: an inline effect, or a call to an extracted hook.
        const candidates: Array<{ at: number; hook?: string }> = [];
        const inline = body.indexOf('useEffect(', cursor);
        if (inline !== -1) candidates.push({ at: inline });
        for (const hook of moduleOf.keys()) {
            const at = body.indexOf(`${hook}(`, cursor);
            if (at !== -1) candidates.push({ at, hook });
        }
        if (candidates.length === 0) break;
        candidates.sort((a, b) => a.at - b.at);
        const next = candidates[0]!;

        if (next.hook) {
            ordered.push(...effectsInSource(read(moduleOf.get(next.hook)!)));
            cursor = next.at + next.hook.length;
        } else {
            ordered.push(identityAt(body, next.at));
            cursor = next.at + 'useEffect('.length;
        }
    }
    return ordered;
}

/** The destructured parameter names in `useAppEffects({ … })`. */
function parameterKeys(): string[] {
    const source = read(COMPOSER);
    const start = source.indexOf('export function useAppEffects({');
    const end = source.indexOf('}: UseAppEffectsParams', start);
    return source
        .slice(start + 'export function useAppEffects({'.length, end)
        .split(',')
        .map((entry) => entry.replace(/\/\/[^\n]*/g, '').trim())
        .filter(Boolean)
        .map((entry) => (entry.split(/[:=]/)[0] ?? '').trim());
}

/** The keys of the object the composer returns. */
function returnedKeys(): string[] {
    const source = read(COMPOSER);
    const start = source.lastIndexOf('    return {');
    const end = source.indexOf('};', start);
    return source
        .slice(start + '    return {'.length, end)
        .split(',')
        .map((entry) => entry.replace(/\/\/[^\n]*/g, '').trim())
        .filter(Boolean)
        .map((entry) => (entry.split(':')[0] ?? '').trim());
}

/** Frozen against the untouched 2,409-line `hooks/useAppEffects.ts`. */
const FROZEN_PARAMETER_KEYS = [
    'dataLoaded',
    'setDataLoaded',
    'bootstrapLoad',
    'setBootstrapLoad',
    'onChallengeNotification',
];

/** Frozen against the untouched file — App.tsx reads exactly these. */
const FROZEN_RETURNED_KEYS = [
    'refreshDashboardGamification',
    'dailyQuests',
    'serverStreak',
    'streakFreezes',
    'questsLoaded',
    'authTokenReady',
];

/**
 * The 29 effects in the order they ran in the untouched file. Extraction may
 * move a body into another module; it may not change this list or its order.
 */
const FROZEN_EFFECT_ORDER: EffectIdentity[] = [
    {
        name: 'Mount-once ([] deps): lets any code that already knows the new streak (e.g. a review',
        deps: '[]',
    },
    {
        name: '--- Presence heartbeat for online status ---',
        deps: '[currentUser?.id, currentUser?.settings, authTokenReady]',
    },
    { name: '--- Restore session on app load ---', deps: '[]' },
    {
        name: 'Promote token-ready after login when AuthScreen cached the token before SIGNED_IN fires',
        deps: '[currentUser?.id, isAuthLoading, authTokenReady]',
    },
    {
        name: 'Cross-account guard: the offline queues live under fixed localStorage',
        deps: '[currentUser?.id]',
    },
    {
        name: '<no banner>',
        deps: '[currentUser?.id, appearanceSettings, accessibilitySettings, setTheme, setLowDataMode]',
    },
    {
        name: '--- Sync canonical settings from API (cross-device) ---',
        deps: '[currentUser?.id, authTokenReady]',
    },
    {
        name: '--- Profile setup check (username, and academic identity once per dismissal) ---',
        deps: '[currentUser?.id, currentUser?.username, currentUser?.institutionId]',
    },
    {
        name: '--- Data loading ---',
        deps: '[currentUser?.id, dataLoaded, isAuthLoading, authTokenReady, refreshDashboardGamification, setBootstrapLoad]',
    },
    {
        name: 'Sync budget extras (goals, splits, category budgets) — never walletBalance (server-owned)',
        deps: '[currentUser?.id, dataLoaded, savingsGoals, expenseSplits, budget?.categoryBudgets]',
    },
    {
        name: '--- Real-time notifications subscription ---',
        deps: '[currentUser?.id, authTokenReady, realtimeEpoch, updateNotifications, openModal, onChallengeNotification, refreshDmThreadsForUser, bumpRealtimeEpoch]',
    },
    {
        name: 'Manual refresh hook (e.g. after contact-seller creates a DM thread)',
        deps: '[currentUser?.id, refreshDmThreadsForUser]',
    },
    {
        name: 'New / updated DM threads (contact-seller, first message, message requests).',
        deps: '[currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, refreshDmThreadsForUser, bumpRealtimeEpoch]',
    },
    { name: '<no banner>', deps: '[dmThreadIdsKey]' },
    {
        name: '--- Real-time DM messages: one channel for all threads (RLS + client filter) ---',
        deps: '[currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, refreshDmThreadsForUser, updateDirectMessages, updateDmThreads, bumpRealtimeEpoch]',
    },
    { name: '<no banner>', deps: '[groupIdsKey]' },
    {
        name: '--- Real-time group messages for all joined groups (so chat updates before/with notifications) ---',
        deps: '[currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, updateMessages, bumpRealtimeEpoch]',
    },
    {
        name: '--- Recover missed chat/note events after tab sleep or reconnect ---',
        deps: '[currentUser?.id, authTokenReady, lowDataMode, bumpRealtimeEpoch, refreshDmThreadsForUser, updateMessages, updateDirectMessages]',
    },
    {
        name: 'Notes list / collaborator content — pick up shares and remote edits without full reload.',
        deps: '[currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, bumpRealtimeEpoch]',
    },
    {
        name: '--- Real-time profile updates subscription ---',
        deps: '[currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, bumpRealtimeEpoch]',
    },
    {
        name: '--- Real-time group membership subscription ---',
        deps: '[currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, updateGroups, bumpRealtimeEpoch]',
    },
    { name: '--- Persist offline data ---', deps: '[offlineBundles, currentUser]' },
    {
        name: 'Persists the offline test-result queue and opportunistically backs it up to the cloud.',
        deps: '[pendingSyncResults, currentUser]',
    },
    {
        name: '--- Theme sync to DOM (signed-out visitors always see light — landing & auth) ---',
        deps: '[theme, currentUser]',
    },
    {
        name: 'Routes a click on an OS notification (including one delivered by the service worker',
        deps: '[setAppMode]',
    },
    {
        name: 'Keep due-count badge in sync without notifying on every card review.',
        deps: '[currentUser?.id, flashcards, setDueCardsCount]',
    },
    {
        name: 'SRS reminder scheduler. Re-runs on srsUserId / checkForDueCardsAndNotify / lowDataMode.',
        deps: '[srsUserId, checkForDueCardsAndNotify, lowDataMode]',
    },
    {
        name: 'Auto-sync queued flashcard reviews when back online',
        deps: '[currentUser?.id, isOnline]',
    },
    {
        name: 'Auto-sync queued offline test results when back online',
        deps: '[currentUser?.id, isOnline]',
    },
];

describe('useAppEffects surface', () => {
    it('takes exactly the parameters App.tsx passes', () => {
        expect(parameterKeys()).toEqual(FROZEN_PARAMETER_KEYS);
    });

    it('returns exactly the keys App.tsx reads', () => {
        expect(returnedKeys()).toEqual(FROZEN_RETURNED_KEYS);
    });

    it('still runs all 29 effects', () => {
        expect(composedEffectOrder()).toHaveLength(FROZEN_EFFECT_ORDER.length);
    });

    it('runs them in the order the untouched file ran them', () => {
        expect(composedEffectOrder()).toEqual(FROZEN_EFFECT_ORDER);
    });

    it('keeps every effect banner attached to the effect it documents', () => {
        // A body moved without its comment loses the Sentry evidence behind it.
        const moved = composedEffectOrder().map((effect) => effect.name);
        expect(moved.filter((name) => name === '<no banner>')).toHaveLength(3);
    });
});

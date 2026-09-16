/**
 * The safety net for the `App.tsx` screen-switch decomposition (lane M7).
 *
 * `App.tsx` is 4,451 lines, one 4,200-line component, and the biggest single
 * thing inside it is `renderScreen` — a 1,282-line `switch (appMode)` with one
 * case per `AppMode`. Moving that switch into `routes/screenRegistry.tsx` as a
 * `Record<AppMode, (ctx) => ReactNode>` is only behaviour-preserving if TWO
 * things survive the move:
 *
 *  1. the set of modes that have a screen. The switch is exhaustive today —
 *     all 56 `AppMode` members, each appearing exactly once — and a `Record`
 *     makes that structural rather than incidental, so a mode dropped in the
 *     move would silently fall through to "Mode not implemented yet." instead
 *     of rendering. That fallback must also still exist, because it is what a
 *     mode the registry does not know renders as.
 *  2. `App.tsx`'s exports. `index.tsx` imports exactly one name from it.
 *
 * `handledModes()` reads whichever file currently owns the switch: the registry
 * when it exists, `App.tsx` before the move. So the same frozen list checks the
 * untouched file and every later extraction step — that is the point of it.
 *
 * The lists are read out of the SOURCE rather than by importing the modules on
 * purpose, the same call `apps/web/src/useAppEffects.surface.test.ts` makes:
 * importing `App.tsx` pulls in 118 modules (Supabase, every store, every lazy
 * screen) and the mock wall needed to survive that is exactly how a surface
 * test starts lying about the thing it is guarding. Reading the text cannot
 * drift.
 *
 * Reading order for a reviewer: this file first, then `routes/screenRegistry.tsx`,
 * then what is left of `renderScreen` in `App.tsx`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const APP = path.join(REPO_ROOT, 'App.tsx');
const REGISTRY = path.join(REPO_ROOT, 'routes/screenRegistry.tsx');
const SHARED_TYPES = path.join(REPO_ROOT, 'packages/shared/src/types/index.ts');

const read = (file: string) => fs.readFileSync(file, 'utf8');

/** Every `AppMode` member, in declaration order. */
function enumMembers(): string[] {
    const source = read(SHARED_TYPES);
    const start = source.indexOf('export enum AppMode {');
    const end = source.indexOf('}', start);
    return [...source.slice(start, end).matchAll(/^\s*([A-Z_0-9]+) = /gm)].map((match) => match[1] ?? '');
}

/** The body of `renderScreen` in App.tsx — the switch, while it still lives there. */
function renderScreenBody(): string {
    const source = read(APP);
    const start = source.indexOf('const renderScreen = () => {');
    if (start === -1) return '';
    return source.slice(start, source.indexOf('\n    };', start));
}

/**
 * The modes that have a screen, in source order, read from whichever module
 * owns the switch right now. Duplicates are preserved: "exactly one" is an
 * assertion below, not something this function is allowed to tidy away.
 */
function handledModes(): string[] {
    if (fs.existsSync(REGISTRY)) {
        // `[AppMode.X]: …` — one Record key per mode.
        return [...read(REGISTRY).matchAll(/^\s*\[AppMode\.([A-Z_0-9]+)\]\s*:/gm)].map((match) => match[1] ?? '');
    }
    return [...renderScreenBody().matchAll(/^\s*case AppMode\.([A-Z_0-9]+):/gm)].map((match) => match[1] ?? '');
}

/** The names `App.tsx` exports. */
function appExports(): string[] {
    const names: string[] = [];
    for (const match of read(APP).matchAll(/^export\s+(?:const|function|class|let|var)\s+([A-Za-z0-9_$]+)/gm)) {
        names.push(match[1] ?? '');
    }
    for (const match of read(APP).matchAll(/^export\s+(?:type|interface)\s+([A-Za-z0-9_$]+)/gm)) {
        names.push(match[1] ?? '');
    }
    if (/^export\s+default/m.test(read(APP))) names.push('default');
    return names.sort();
}

/**
 * The 56 `AppMode` members the untouched `renderScreen` switched on, in
 * declaration order. Frozen against App.tsx at fabf099d.
 */
const FROZEN_APP_MODES = [
    'CHAT',
    'TEST_ACTIVE',
    'STUDY_ACTIVE',
    'TEST_REVIEW',
    'DASHBOARD',
    'OFFLINE_MODE',
    'GAME_ACTIVE',
    'GAME_RESULTS',
    'FLASHCARDS',
    'FLASHCARD_REVIEW',
    'DECK_DETAIL',
    'FLASHCARD_CRAM',
    'FLASHCARD_MATCH',
    'FLASHCARD_LEARN',
    'CREATE_GROUP',
    'BUDGET_TRACKER',
    'DISCOVER',
    'INVITE_FRIENDS',
    'SEMESTER_PRODUCTS',
    'STUDY_ROOM',
    'CAMPUS_PAGE',
    'COMMUNITY_DETAIL',
    'MARKETPLACE',
    'MARKETPLACE_LISTING_DETAIL',
    'CREATE_MARKETPLACE_LISTING',
    'MY_LISTINGS',
    'MARKETPLACE_PURCHASES',
    'STUDY_PRODUCT_DRAFTS',
    'CREATOR_PROFILE',
    'MARKETPLACE_FAVORITES',
    'MARKETPLACE_INQUIRIES',
    'MARKETPLACE_ORDERS',
    'MARKETPLACE_CART',
    'MARKETPLACE_CHECKOUT',
    'MARKETPLACE_YOU',
    'MARKETPLACE_ADDRESSES',
    'MARKETPLACE_ORDER_DETAIL',
    'SELLER_CUSTOMERS',
    'SELLER_PROFILE',
    'MARKETPLACE_JOBS',
    'MARKETPLACE_JOB_DETAIL',
    'CREATE_MARKETPLACE_JOB',
    'MY_JOB_POSTINGS',
    'MY_JOB_APPLICATIONS',
    'JOB_EMPLOYER',
    'JOB_EMPLOYER_PIPELINE',
    'JOB_COMPANY',
    'ADMIN',
    'NOTES',
    'NOTE_EDITOR',
    'LIBRARY',
    'STUDY_HUB',
    'COURSE_WORKSPACE',
    'STUDY_SET_WORKSPACE',
    'TESTS_HOME',
    'AI_TOOLS',
];

/** Frozen against the untouched file — `index.tsx` imports exactly this. */
const FROZEN_APP_EXPORTS = ['App'];

describe('App screen registry surface', () => {
    it('still has exactly the 56 AppMode members the switch was written against', () => {
        // A mode added to the enum without a screen fails HERE rather than as a
        // blank page: the next assertion would otherwise report it as a hole in
        // the registry and read like the refactor dropped it.
        expect(enumMembers()).toEqual(FROZEN_APP_MODES);
    });

    it('gives every AppMode exactly one screen', () => {
        const handled = handledModes();
        expect([...handled].sort()).toEqual([...FROZEN_APP_MODES].sort());
        expect(handled.filter((mode, index) => handled.indexOf(mode) !== index)).toEqual([]);
    });

    it('keeps the fallback an unknown mode renders as', () => {
        const owner = fs.existsSync(REGISTRY) ? read(APP) : renderScreenBody();
        expect(owner).toContain('Mode not implemented yet.');
    });

    it('exports exactly what index.tsx imports', () => {
        expect(appExports()).toEqual(FROZEN_APP_EXPORTS);
    });
});

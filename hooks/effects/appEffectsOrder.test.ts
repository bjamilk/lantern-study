/**
 * The order lock for the `useAppEffects` composition root.
 *
 * Adopted as-is (paths and directory aside) from a parallel session that wrote
 * it into this worktree; it was verified against the pre-split file and agrees
 * with apps/web/src/useAppEffects.surface.test.ts, which pins the same order by
 * reading the source instead of rendering it. Both are kept: one fails if a hook
 * call moves, the other if an effect body moves between modules.
 *
 * `useAppEffects` is a composer: it calls one hook per responsibility, and the
 * ORDER those hooks run in is behaviour. Effects that subscribe Realtime
 * channels must register after the ones that establish the auth token; the
 * cross-account queue purge must register before the persist/sync effects that
 * would otherwise re-upload the previous student's work. Nothing in the type
 * system protects that order, so this suite pins it: the hook is rendered
 * through a spy harness and every effect's dependency signature is asserted, in
 * registration order, against the list the pre-split file produced.
 *
 * Touches: only the harness and mocked stores — no network, no Supabase, no DOM.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from './testing/hookHarness';

const { reactMock } = await vi.hoisted(async () => await import('./testing/hookHarness'));

// Spread over the real module: the composer's own imports are replaced, while
// anything else in the graph that touches React.Component still finds it.
vi.mock('react', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        ...reactMock,
        default: { ...(actual.default as object), ...reactMock },
    };
});

const fx = await vi.hoisted(async () => (await import('./testing/storeFixtures')).createStoreFixtures());
const { noop } = await vi.hoisted(async () => await import('./testing/storeFixtures'));

vi.mock('../../stores/authStore', () => fx.modules.authStore);
vi.mock('../../stores/groupStore', () => fx.modules.groupStore);
vi.mock('../../stores/testStore', () => fx.modules.testStore);
vi.mock('../../stores/flashcardStore', () => fx.modules.flashcardStore);
vi.mock('../../stores/budgetStore', () => fx.modules.budgetStore);
vi.mock('../../stores/uiStore', () => fx.modules.uiStore);
vi.mock('../../stores/notesStore', () => fx.modules.notesStore);
vi.mock('../../stores/toastStore', () => fx.modules.toastStore);

import { useAppEffects } from '../useAppEffects';

const setDataLoaded = noop('setDataLoaded');
const setBootstrapLoad = noop('setBootstrapLoad');
const onChallengeNotification = noop('onChallengeNotification');

const renderComposer = () =>
    renderHook(() =>
        useAppEffects({
            dataLoaded: false,
            setDataLoaded,
            bootstrapLoad: {} as any,
            setBootstrapLoad: setBootstrapLoad as any,
            onChallengeNotification,
        })
    );

/**
 * Every effect `useAppEffects` registers, in order, named for the responsibility
 * that owns it and paired with the dependency signature the harness reads back.
 *
 * This list was captured from the single-function `useAppEffects.ts` BEFORE it
 * was split into `hooks/effects/`, and it is deliberately written out in full
 * rather than snapshotted: a snapshot can be rewritten by `vitest -u` without
 * anyone reading it, and the whole point of this file is that nobody changes
 * this order by accident.
 */
const LOCKED_EFFECT_ORDER: Array<[owner: string, signature: string]> = [
    ['useDailyStudyReminder', '["user-1", true, "20:00", 20, 1]'],
    ['useGamificationEffects: lantern:streak-updated listener', '[]'],
    ['usePresenceEffects: heartbeat interval', '["user-1", {"appearance":{"theme":"dark"},"accessibility":{}}, false]'],
    ['useAuthBootstrapEffects: session restore + onAuthStateChange', '[]'],
    ['useAuthBootstrapEffects: promote token-ready after login', '["user-1", false, false]'],
    ['useOfflineQueueOwnerEffects: cross-account queue purge', '["user-1"]'],
    ['useAppearanceEffects: settings → DOM', '["user-1", {"theme":"dark"}, {}, fn:setTheme, fn:setLowDataMode]'],
    ['useSettingsSyncEffects: canonical settings from API', '["user-1", false]'],
    ['useProfileSetupEffects: username / academic identity prompt', '["user-1", "ada", "inst-1"]'],
    ['useBootstrapDataEffects: signed-in fan-out', '["user-1", false, false, false, fn:anonymous, fn:setBootstrapLoad]'],
    ['useBudgetExtrasEffects: debounced extras save', '["user-1", false, [], [], {}]'],
    ['useRealtimeNotificationEffects: notifications channel', '["user-1", false, 0, fn:updateNotifications, fn:openModal, fn:onChallengeNotification, fn:anonymous, fn:anonymous]'],
    ['useRealtimeDmEffects: lantern:refresh-dm-threads listener', '["user-1", fn:anonymous]'],
    ['useRealtimeDmEffects: dm_threads channel', '["user-1", false, false, 0, fn:anonymous, fn:anonymous]'],
    ['useRealtimeDmEffects: dmThreadIdsRef sync', '["thread-1"]'],
    ['useRealtimeDmEffects: dm_messages channel', '["user-1", false, false, 0, fn:anonymous, fn:updateDirectMessages, fn:updateDmThreads, fn:anonymous]'],
    ['useRealtimeGroupEffects: groupIdsRef sync', '["group-1"]'],
    ['useRealtimeGroupEffects: messages channel', '["user-1", false, false, 0, fn:updateMessages, fn:anonymous]'],
    ['useChatRecoveryEffects: visibility / online recovery', '["user-1", false, false, fn:anonymous, fn:anonymous, fn:updateMessages, fn:updateDirectMessages]'],
    ['useRealtimeNotesEffects: notes + collaborators channel', '["user-1", false, false, 0, fn:anonymous]'],
    ['useRealtimeProfileEffects: own profile channel', '["user-1", false, false, 0, fn:anonymous]'],
    ['useRealtimeMembershipEffects: group_members channel', '["user-1", false, false, 0, fn:updateGroups, fn:anonymous]'],
    ['useOfflinePersistenceEffects: persist offline bundles', '[[], {"id":"user-1","name":"Ada","email":"ada@example.com","username":"ada","institutionId":"inst-1","settings":{"appearance":{"theme":"dark"},"accessibility":{}}}]'],
    ['useOfflinePersistenceEffects: persist pending results queue', '[[], {"id":"user-1","name":"Ada","email":"ada@example.com","username":"ada","institutionId":"inst-1","settings":{"appearance":{"theme":"dark"},"accessibility":{}}}]'],
    ['useThemeDomEffects: theme → dark class', '["dark", {"id":"user-1","name":"Ada","email":"ada@example.com","username":"ada","institutionId":"inst-1","settings":{"appearance":{"theme":"dark"},"accessibility":{}}}]'],
    ['useSrsReminderEffects: OS notification click routing', '[fn:setAppMode]'],
    ['useSrsReminderEffects: due-cards badge', '["user-1", [], fn:setDueCardsCount]'],
    ['useSrsReminderEffects: reminder scheduler', '["user-1", fn:anonymous, false]'],
    ['useOfflineSyncEffects: flashcard review replay', '["user-1", true]'],
    ['useOfflineSyncEffects: test result replay', '["user-1", true]'],
];

describe('useAppEffects effect order', () => {
    it('registers every effect in the locked order, with unchanged dependencies', () => {
        const harness = renderComposer();
        expect(harness.effectSignatures).toEqual(LOCKED_EFFECT_ORDER.map(([, signature]) => signature));
    });

    it('registers exactly the effects the composition root claims to own', () => {
        const harness = renderComposer();
        expect(harness.effectSignatures).toHaveLength(LOCKED_EFFECT_ORDER.length);
    });

    // The two orderings the file's own comments call out as load-bearing.
    it('purges a foreign offline queue before anything persists or replays it', () => {
        const harness = renderComposer();
        const purge = LOCKED_EFFECT_ORDER.findIndex(([owner]) => owner.includes('queue purge'));
        const persist = LOCKED_EFFECT_ORDER.findIndex(([owner]) => owner.includes('pending results queue'));
        const replay = LOCKED_EFFECT_ORDER.findIndex(([owner]) => owner.includes('test result replay'));
        expect(purge).toBeGreaterThanOrEqual(0);
        expect(purge).toBeLessThan(persist);
        expect(persist).toBeLessThan(replay);
        expect(harness.effectSignatures[purge]).toBe(LOCKED_EFFECT_ORDER[purge][1]);
    });

    it('subscribes every Realtime channel after the auth-token effects', () => {
        renderComposer();
        const lastAuth = LOCKED_EFFECT_ORDER.map(([owner]) => owner)
            .lastIndexOf('useAuthBootstrapEffects: promote token-ready after login');
        const firstChannel = LOCKED_EFFECT_ORDER.findIndex(([owner]) => owner.includes('channel'));
        expect(lastAuth).toBeGreaterThanOrEqual(0);
        expect(firstChannel).toBeGreaterThan(lastAuth);
    });

    it('keeps the hook signature App.tsx depends on', () => {
        const harness = renderComposer();
        expect(Object.keys(harness.result).sort()).toEqual([
            'authTokenReady',
            'dailyQuests',
            'questsLoaded',
            'refreshDashboardGamification',
            'serverStreak',
            'streakFreezes',
        ]);
    });
});

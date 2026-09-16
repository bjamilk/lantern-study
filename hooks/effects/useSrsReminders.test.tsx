// @vitest-environment jsdom
/**
 * Contract test for `hooks/effects/useSrsReminders`.
 *
 * What the hook promises: it returns nothing; it keeps the due-cards badge in
 * step with the flashcard store; and it shows an OS reminder only after all four
 * gates pass — reminders enabled, permission granted, throttle elapsed, and the
 * send claim taken.
 *
 * Two of these cases are regressions the banners record. An EMPTY card list must
 * reset the badge to zero (F9: the early return left the previous student's
 * count on the nav badge on a shared browser), and every gate must be able to
 * stop the toast on its own.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => {
    const flashcardState = {
        flashcards: [] as unknown[],
        setDueCardsCount: vi.fn(),
    };
    const uiState = { setAppMode: vi.fn(), lowDataMode: false };
    const store = <T extends object>(state: T) => {
        const hook = (() => state) as (() => T) & { getState: () => T };
        hook.getState = () => state;
        return hook;
    };
    return {
        flashcardState,
        uiState,
        store,
        getCardsDue: vi.fn((cards: unknown[]) => cards),
        getWebNotificationPermission: vi.fn(() => 'granted'),
        requestWebNotificationPermission: vi.fn(),
        shouldSendSrsWebReminder: vi.fn(() => true),
        beginSrsWebReminderSend: vi.fn(() => true),
        markSrsWebReminderSent: vi.fn(),
        showWebNotification: vi.fn(() => Promise.resolve()),
    };
});

vi.mock('../../stores/flashcardStore', () => ({
    useFlashcardStore: fx.store(fx.flashcardState),
}));
vi.mock('../../stores/uiStore', () => ({ useUIStore: fx.store(fx.uiState) }));
vi.mock('../../utils/webNotifications', () => ({
    getWebNotificationPermission: fx.getWebNotificationPermission,
    requestWebNotificationPermission: fx.requestWebNotificationPermission,
    shouldSendSrsWebReminder: fx.shouldSendSrsWebReminder,
    beginSrsWebReminderSend: fx.beginSrsWebReminderSend,
    markSrsWebReminderSent: fx.markSrsWebReminderSent,
    showWebNotification: fx.showWebNotification,
}));
vi.mock('@lantern/shared/utils', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return { ...actual, getCardsDue: fx.getCardsDue };
});

import { useSrsReminders } from './useSrsReminders';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Reminders on: the hook reads this through normalizeUserSettings. */
const USER = {
    id: 'user-1',
    settings: { notifications: { srsReminders: true } },
} as never;

let container: HTMLDivElement;
let root: Root;
let returned: unknown;

function Probe({ currentUser }: { currentUser: unknown }) {
    returned = useSrsReminders({ currentUser: currentUser as never });
    return null;
}

const mount = async (currentUser: unknown = USER) => {
    await act(async () => {
        root.render(<Probe currentUser={currentUser} />);
    });
};

beforeEach(() => {
    fx.flashcardState.flashcards = [];
    fx.flashcardState.setDueCardsCount.mockClear();
    fx.uiState.lowDataMode = false;
    fx.getCardsDue.mockClear().mockImplementation((cards: unknown[]) => cards);
    fx.getWebNotificationPermission.mockClear().mockReturnValue('granted');
    fx.shouldSendSrsWebReminder.mockClear().mockReturnValue(true);
    fx.beginSrsWebReminderSend.mockClear().mockReturnValue(true);
    fx.markSrsWebReminderSent.mockClear();
    fx.showWebNotification.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
});

describe('useSrsReminders', () => {
    it('returns nothing — it is a pure side effect', async () => {
        await mount();
        expect(returned).toBeUndefined();
    });

    it('sets the badge from the due cards', async () => {
        fx.flashcardState.flashcards = [{ id: 'c1' }, { id: 'c2' }];
        await mount();
        expect(fx.flashcardState.setDueCardsCount).toHaveBeenCalledWith(2);
    });

    it('resets the badge to zero for an empty card list (F9)', async () => {
        await mount();
        expect(fx.flashcardState.setDueCardsCount).toHaveBeenCalledWith(0);
        // Zero is an answer, not a reason to skip the write.
        expect(fx.getCardsDue).not.toHaveBeenCalled();
    });

    it('zeroes the badge for a signed-out visitor', async () => {
        fx.flashcardState.flashcards = [{ id: 'c1' }];
        await mount(null);
        expect(fx.flashcardState.setDueCardsCount).toHaveBeenCalledWith(0);
    });

    it('shows the reminder once all four gates pass, claiming the send first', async () => {
        fx.flashcardState.flashcards = [{ id: 'c1' }];
        await mount();
        expect(fx.beginSrsWebReminderSend).toHaveBeenCalledWith('user-1');
        expect(fx.markSrsWebReminderSent).toHaveBeenCalled();
        expect(fx.showWebNotification).toHaveBeenCalledWith(
            expect.objectContaining({ tag: 'srs-reminder' }),
        );
    });

    it('sends nothing when the claim is already taken', async () => {
        fx.flashcardState.flashcards = [{ id: 'c1' }];
        fx.beginSrsWebReminderSend.mockReturnValue(false);
        await mount();
        expect(fx.markSrsWebReminderSent).not.toHaveBeenCalled();
        expect(fx.showWebNotification).not.toHaveBeenCalled();
    });

    it('sends nothing when the throttle window has not elapsed', async () => {
        fx.flashcardState.flashcards = [{ id: 'c1' }];
        fx.shouldSendSrsWebReminder.mockReturnValue(false);
        await mount();
        expect(fx.showWebNotification).not.toHaveBeenCalled();
    });

    it('sends nothing without notification permission', async () => {
        fx.flashcardState.flashcards = [{ id: 'c1' }];
        fx.getWebNotificationPermission.mockReturnValue('denied');
        await mount();
        expect(fx.showWebNotification).not.toHaveBeenCalled();
    });

    it('sends nothing for a student who turned SRS reminders off', async () => {
        fx.flashcardState.flashcards = [{ id: 'c1' }];
        await mount({
            id: 'user-1',
            settings: { notifications: { srsReminders: false } },
        });
        expect(fx.showWebNotification).not.toHaveBeenCalled();
    });
});

/**
 * The contract for `hooks/useCommunityNavigation.ts` (M7 step 2).
 *
 * Two different things are pinned here, because they fail in two different ways:
 *
 *  1. `announceStudyGroupToBoard` (utils/boardHandoff.ts) — the §7 board-handoff
 *     rule, which until this step lived inside a JSX prop on `CreateGroupScreen`
 *     and therefore had no test at all. It lives in its own leaf module so this
 *     suite can import it without dragging the store graph into apps/web's tsc
 *     project. It is exercised for real, with the send injected: the rule is
 *     "post a pointer back to the originating board, fire-and-forget, and never
 *     let a failed post stop the handoff", and all three halves of that are
 *     assertions below.
 *  2. The hook's SURFACE — the parameter keys App.tsx passes, the keys it reads
 *     back, and the five effects it registers in order. The effect order is
 *     behaviour: the column-close effect has to see a mode change before the
 *     slug-seed effect re-seeds `activeCommunity` from the URL. Read from the
 *     source rather than by rendering, for the same reason
 *     `useAppEffects.surface.test.ts` does it: rendering this hook needs the
 *     community store, the group store, the UI store, the auth store and four
 *     Supabase calls mocked, and a mock that drifts is how a surface test starts
 *     lying.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';

import { announceStudyGroupToBoard } from '../../../utils/boardHandoff';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HOOK = path.join(REPO_ROOT, 'hooks/useCommunityNavigation.ts');
const source = () => fs.readFileSync(HOOK, 'utf8');

/** The destructured parameter names in `useCommunityNavigation({ … })`. */
function parameterKeys(): string[] {
    const text = source();
    const start = text.indexOf('export function useCommunityNavigation({');
    const end = text.indexOf('}: UseCommunityNavigationParams', start);
    return text
        .slice(start + 'export function useCommunityNavigation({'.length, end)
        .split(',')
        .map((entry) => entry.replace(/\/\/[^\n]*/g, '').trim())
        .filter(Boolean);
}

/** The keys of the object the hook returns. */
function returnedKeys(): string[] {
    const text = source();
    const start = text.lastIndexOf('    return {');
    return text
        .slice(start + '    return {'.length, text.indexOf('};', start))
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/** Each effect's dependency array, in registration order. */
function effectDeps(): string[] {
    const text = source();
    const found: string[] = [];
    let cursor = 0;
    for (;;) {
        const at = text.indexOf('useEffect(', cursor);
        if (at === -1) break;
        const match = /\}\s*,\s*\[([^\]]*)\]\s*\)\s*;/.exec(text.slice(at));
        found.push(`[${(match?.[1] ?? '').split(',').map((d) => d.trim()).filter(Boolean).join(', ')}]`);
        cursor = at + 'useEffect('.length;
    }
    return found;
}

const FROZEN_PARAMETER_KEYS = [
    'appMode',
    'currentUser',
    'location',
    'groups',
    'selectedChat',
    'setSelectedChat',
    'selectedChatIsBoard',
    'myCommunities',
    'activeCommunity',
    'activeCommunityDetail',
    'setActiveCommunity',
    'handleSelectChat',
    'handleInitiateDm',
    'setAppMode',
    'navigateTo',
    'showToast',
    'setDiscoverSection',
    'setStudyRoomJoin',
    'setSelectedStudyRoomId',
    'setCreateLabCommunity',
    'setCreateLabOpen',
    'setCreateGroupPreset',
    'setCreateGroupReturnMode',
];

const FROZEN_RETURNED_KEYS = [
    'communityRoute',
    'communityChannelId',
    'selectedChatCommunityId',
    'handleCommunityNavigate',
    'openCommunityChannel',
    'openDiscoverGroup',
];

/** The five effects in the order App.tsx ran them before the extraction. */
const FROZEN_EFFECT_ORDER = [
    '[appMode, setActiveCommunity]',
    '[currentUser?.id]',
    '[selectedChatIsBoard, selectedChat, myCommunities, navigateTo, setSelectedChat, showToast]',
    '[selectedChatCommunityId, currentUser?.id]',
    '[communityRouteSlug, setActiveCommunity]',
];

describe('announceStudyGroupToBoard', () => {
    const actor = { id: 'u1', name: 'Ada' };

    it('posts the pointer back to the board the group was started from', () => {
        const send = vi.fn(() => Promise.resolve());
        announceStudyGroupToBoard({ announceInGroupId: 'board-9' }, actor, 'Cardio crew', send);
        expect(send).toHaveBeenCalledWith('board-9', 'u1', 'Ada started a study group: Cardio crew');
    });

    it('posts nothing when the group did not come from a board post', () => {
        const send = vi.fn(() => Promise.resolve());
        announceStudyGroupToBoard({}, actor, 'Cardio crew', send);
        expect(send).not.toHaveBeenCalled();
    });

    it('posts nothing when there is no signed-in actor to attribute it to', () => {
        const send = vi.fn(() => Promise.resolve());
        announceStudyGroupToBoard({ announceInGroupId: 'board-9' }, null, 'Cardio crew', send);
        expect(send).not.toHaveBeenCalled();
    });

    it('does not wait on the post, and swallows a failed one', async () => {
        // The handoff lands the student in the new group immediately; a board
        // that could not be posted to must not become an unhandled rejection or
        // a thrown error on the way there.
        const send = vi.fn(() => Promise.reject(new Error('board unreachable')));
        expect(() =>
            announceStudyGroupToBoard({ announceInGroupId: 'board-9' }, actor, 'Cardio crew', send),
        ).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();
    });
});

describe('useCommunityNavigation surface', () => {
    it('takes exactly the parameters App.tsx passes', () => {
        expect(parameterKeys()).toEqual(FROZEN_PARAMETER_KEYS);
    });

    it('returns exactly the keys App.tsx reads', () => {
        expect(returnedKeys()).toEqual(FROZEN_RETURNED_KEYS);
    });

    it('registers the five community effects in the order App.tsx ran them', () => {
        expect(effectDeps()).toEqual(FROZEN_EFFECT_ORDER);
    });
});

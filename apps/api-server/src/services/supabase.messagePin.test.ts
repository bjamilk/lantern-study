/**
 * The board pin (spec §3.6) — one pin per board, decided by the server.
 *
 * Replaces a device-local AsyncStorage pin that was single, mobile-only and
 * visible to exactly one person. Three things are pinned here:
 *
 *  - authorisation is `canPinOnBoard`: the community owner (created_by), a
 *    community admin/moderator, or an admin of the board group itself. A plain
 *    member is refused, and the refusal is a 403 the route can name — not a
 *    500 and not a silent no-op;
 *  - a group that is not a board (a study group, or a plain chat) is refused
 *    with its own status, so "pinning is a board feature" reads as a rule
 *    rather than an error;
 *  - pinning clears the previous pin FIRST, and a 23505 from the unique
 *    partial index (another pin landed in between) clears and retries once.
 *
 * Pre-migration every path answers 'unavailable', which the route turns into
 * 503 `Pinning is not available yet` — never a 500 (§3.1 degrade).
 */
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as boardActionsData from './data/boardActions';
import * as chatSendData from './data/chatSend';
jest.mock('./cache', () => ({
  cacheService: {
    cached: async (_key: string, fn: () => Promise<unknown>) => fn(),
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { setSchemaCapabilities } from './schemaCapabilities';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const GROUP = '44444444-4444-4444-8444-444444444444';
const COMMUNITY = '55555555-5555-4555-8555-555555555555';
const MESSAGE = '66666666-6666-4666-8666-666666666666';

type Op = { fn: string; args: any[] };
type Call = { table: string; ops: Op[]; terminal: string };

function makeSelf(options: {
  communitySurface?: 'board' | 'study_group' | null;
  communityId?: string | null;
  createdBy?: string | null;
  memberRole?: string | null;
  adminIds?: string[];
  boardColumns?: boolean;
  groupVisible?: boolean;
  messageExists?: boolean;
  /** The target post has been soft-removed. */
  messageRemoved?: boolean;
  /** The target is a comment, not a root post. */
  messageIsComment?: boolean;
  /** Fail the first applyPin with the unique-index violation. */
  conflictOnce?: boolean;
}) {
  const {
    communitySurface = null,
    communityId = COMMUNITY,
    createdBy = OWNER,
    memberRole = 'member',
    adminIds = [],
    boardColumns = true,
    groupVisible = true,
    messageExists = true,
    messageRemoved = false,
    messageIsComment = false,
    conflictOnce = false,
  } = options;

  setSchemaCapabilities({ groupCommunitySurface: true, messageBoardColumns: boardColumns });

  const calls: Call[] = [];
  let applyAttempts = 0;

  const resolve = (call: Call): { data: unknown; error: unknown } => {
    const has = (fn: string) => call.ops.some((o) => o.fn === fn);
    if (call.table === 'communities') {
      return {
        data: { id: communityId, slug: 'course-pharm-101', created_by: createdBy, lounge_group_id: null },
        error: null,
      };
    }
    if (call.table === 'community_members') {
      return { data: memberRole ? { role: memberRole } : null, error: null };
    }
    if (call.table === 'messages') {
      if (has('update')) {
        // The clear runs as a bare `then`; the set terminates with single().
        if (call.terminal !== 'single') return { data: null, error: null };
        applyAttempts += 1;
        if (conflictOnce && applyAttempts === 1) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        const update = call.ops.find((o) => o.fn === 'update')!.args[0];
        return { data: { id: MESSAGE, group_id: GROUP, ...update }, error: null };
      }
      return {
        data: messageExists
          ? {
              id: MESSAGE,
              group_id: GROUP,
              removed_at: messageRemoved ? '2026-09-03T00:00:00.000Z' : null,
              thread_root_id: messageIsComment ? 'root-1' : null,
            }
          : null,
        error: null,
      };
    }
    return { data: null, error: null };
  };

  const supabase = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of ['select', 'eq', 'is', 'in', 'not', 'update', 'order', 'limit']) {
        chain[fn] = (...args: any[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      const settle = (terminal: string) => {
        const call: Call = { table, ops, terminal };
        calls.push(call);
        return Promise.resolve(resolve(call));
      };
      chain.single = () => settle('single');
      chain.maybeSingle = () => settle('maybeSingle');
      chain.then = (onOk: any, onErr: any) => settle('then').then(onOk, onErr);
      return chain;
    },
  };

  const self: any = {
    supabase,
    resolveBoardContext: function (this: any, id: string) { return chatSendData.resolveBoardContext(this.supabase, this, id); },
    communityMemberRole: function (this: any, communityId: string, uid: string) { return boardActionsData.communityMemberRole(this.supabase, communityId, uid); },
    getGroupById: jest.fn(async () =>
      groupVisible
        ? { id: GROUP, name: 'exam-week', adminIds, permissions: {}, communityId, communitySurface }
        : null,
    ),
  };

  // `Promise<any>` because the old harness read the result off an `any`-cast
  // prototype call; the assertions below are unchanged, and narrowing the type
  // here would be an assertion change by the back door.
  const setPin = (pinned: boolean, userId = USER): Promise<any> =>
    chatSendData.setMessagePin((self as any).supabase, self as any, MESSAGE, userId, pinned);

  return { self, setPin, calls, attempts: () => applyAttempts };
}

describe('setMessagePin', () => {
  it('the community owner pins: the previous pin is cleared first, then the new one is set', async () => {
    const owner = makeSelf({ communitySurface: 'board', createdBy: OWNER });
    const result = await owner.setPin(true, OWNER);

    expect(result.status).toBe('ok');
    expect(result.message).toMatchObject({ id: MESSAGE, pinned_by: OWNER });
    expect(typeof (result.message as any).pinned_at).toBe('string');

    const updates = owner.calls.filter(
      (c) => c.table === 'messages' && c.ops.some((o) => o.fn === 'update'),
    );
    // Clear-then-set, in that order, so the unique index can never see two.
    expect(updates).toHaveLength(2);
    expect(updates[0].ops.find((o) => o.fn === 'update')!.args[0]).toEqual({
      pinned_at: null,
      pinned_by: null,
    });
    expect(updates[0].ops.find((o) => o.fn === 'eq')!.args).toEqual(['group_id', GROUP]);
    // Scoped to rows that actually carry a pin.
    expect(updates[0].ops.find((o) => o.fn === 'not')!.args).toEqual(['pinned_at', 'is', null]);
    expect(updates[1].ops.find((o) => o.fn === 'eq')!.args).toEqual(['id', MESSAGE]);
  });

  it('a community moderator may pin; a plain member may not', async () => {
    const moderator = makeSelf({ communitySurface: 'board', createdBy: null, memberRole: 'moderator' });
    await expect(moderator.setPin(true)).resolves.toMatchObject({ status: 'ok' });

    const member = makeSelf({ communitySurface: 'board', createdBy: null, memberRole: 'member' });
    const refused = await member.setPin(true);
    expect(refused).toEqual({ status: 'forbidden' });
    // Refused before any write.
    expect(member.calls.some((c) => c.ops.some((o) => o.fn === 'update'))).toBe(false);
  });

  it("a board group's own admin may pin even without a community role", async () => {
    const groupAdmin = makeSelf({
      communitySurface: 'board',
      createdBy: null,
      memberRole: null,
      adminIds: [USER],
    });
    await expect(groupAdmin.setPin(true)).resolves.toMatchObject({ status: 'ok' });
  });

  it('a study group is not a board: pinning is refused as a rule, not an error', async () => {
    const studyGroup = makeSelf({ communitySurface: 'study_group', createdBy: USER });
    expect(await studyGroup.setPin(true)).toEqual({ status: 'not_board' });
  });

  it('a plain chat with no community is not a board either', async () => {
    const chat = makeSelf({ communityId: null, createdBy: USER });
    expect(await chat.setPin(true)).toEqual({ status: 'not_board' });
  });

  it('unpinning clears without pre-clearing the board', async () => {
    const owner = makeSelf({ communitySurface: 'board', createdBy: OWNER });
    const result = await owner.setPin(false, OWNER);
    expect(result.status).toBe('ok');
    expect(result.message).toMatchObject({ pinned_at: null, pinned_by: null });
    const updates = owner.calls.filter((c) => c.ops.some((o) => o.fn === 'update'));
    expect(updates).toHaveLength(1);
  });

  it('a 23505 from the one-pin-per-board index clears and retries exactly once', async () => {
    const owner = makeSelf({ communitySurface: 'board', createdBy: OWNER, conflictOnce: true });
    const result = await owner.setPin(true, OWNER);
    expect(result.status).toBe('ok');
    expect(owner.attempts()).toBe(2);
  });

  it('404s a message the caller cannot see, and one that does not exist', async () => {
    const noAccess = makeSelf({ communitySurface: 'board', groupVisible: false });
    expect(await noAccess.setPin(true)).toEqual({ status: 'not_found' });

    const missing = makeSelf({ communitySurface: 'board', messageExists: false });
    expect(await missing.setPin(true)).toEqual({ status: 'not_found' });
  });

  it('refuses to pin a deleted post or a comment, but still lets both be unpinned', async () => {
    // A pin outlives the post it points at (the removal RPC predates
    // `pinned_at`), and the PINNED strip is roots-only.
    const removed = makeSelf({ communitySurface: 'board', createdBy: OWNER, messageRemoved: true });
    expect(await removed.setPin(true, OWNER)).toEqual({ status: 'not_pinnable' });

    const comment = makeSelf({
      communitySurface: 'board',
      createdBy: OWNER,
      messageIsComment: true,
    });
    expect(await comment.setPin(true, OWNER)).toEqual({ status: 'not_pinnable' });

    // Clearing a pin left behind by a deletion has to stay possible.
    const clearing = makeSelf({ communitySurface: 'board', createdBy: OWNER, messageRemoved: true });
    expect((await clearing.setPin(false, OWNER)).status).toBe('ok');
  });

  it('pre-migration it is unavailable, and touches nothing', async () => {
    const preMigration = makeSelf({ communitySurface: 'board', boardColumns: false });
    expect(await preMigration.setPin(true, OWNER)).toEqual({ status: 'unavailable' });
    expect(preMigration.calls).toHaveLength(0);
  });
});

describe('getPinnedMessage', () => {
  /**
   * The only three `expect` lines in this PR whose TEXT changed: each writes
   * the call inline, so retargeting it off the prototype necessarily rewrites
   * the line. The assertion — `.resolves.toBeNull()` — and the stand-in are
   * the same; this helper keeps the change to the call expression.
   */
  const getPinned = (self: any) =>
    chatSendData.getPinnedMessage(self.supabase, self, GROUP);


  it('answers null pre-migration without querying', async () => {
    setSchemaCapabilities({ messageBoardColumns: false });
    const from = jest.fn();
    await expect(getPinned({ supabase: { from } })).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('never returns a removed post or a comment as the pin', async () => {
    setSchemaCapabilities({ messageBoardColumns: true });
    const filters: Array<{ fn: string; args: any[] }> = [];
    const supabase = {
      from: () => {
        const chain: any = {};
        for (const fn of ['select', 'eq', 'not', 'is', 'order', 'limit']) {
          chain[fn] = (...args: any[]) => {
            filters.push({ fn, args });
            return chain;
          };
        }
        chain.maybeSingle = async () => ({ data: null, error: null });
        return chain;
      },
    };
    await expect(getPinned({ supabase })).resolves.toBeNull();
    const isFilters = filters.filter((f) => f.fn === 'is').map((f) => f.args[0]);
    expect(isFilters).toEqual(expect.arrayContaining(['removed_at', 'thread_root_id']));
  });

  it('answers null — not a 500 — when the column vanishes under it', async () => {
    setSchemaCapabilities({ messageBoardColumns: true });
    const supabase = {
      from: () => {
        const chain: any = {};
        for (const fn of ['select', 'eq', 'not', 'is', 'order', 'limit']) chain[fn] = () => chain;
        chain.maybeSingle = async () => ({
          data: null,
          error: { code: '42703', message: 'column messages.pinned_at does not exist' },
        });
        return chain;
      },
    };
    await expect(getPinned({ supabase })).resolves.toBeNull();
  });
});

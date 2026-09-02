/**
 * Communities (Phase 3 · L). The audit found NOTHING pinning the two rules the
 * whole design rests on, both of which fail silently if broken:
 *
 *   1. the auto-vs-joined privacy boundary — being AUTO-added to your
 *      institution's community is not consent to be listed to everyone else who
 *      was auto-added to it;
 *   2. leaving an AUTO community records an opt-out instead of deleting, or the
 *      next profile save silently re-adds the user.
 */
import { CommunitiesService } from './communities';

const VIEWER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, unknown>;

/**
 * Minimal PostgREST double. listMembers consults maybeSingle twice (the
 * viewer's own membership row, then the community row for created_by) and
 * the roster once (limit). Every maybeSingle answers with the membership
 * shape; the community read simply sees no created_by, which is 'member'.
 */
function makeService(opts: { viewerSource?: string | null; roster: Row[] }) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const db: any = {
    from(table: string) {
      const api: any = {};
      const self = () => api;
      api.select = self;
      api.eq = self;
      api.is = self;
      api.in = self;
      api.gt = self;
      api.neq = self;
      api.or = self;
      api.order = self;
      api.maybeSingle = () =>
        Promise.resolve({
          data: opts.viewerSource ? { user_id: VIEWER, source: opts.viewerSource } : null,
          error: null,
        });
      api.limit = () => Promise.resolve({ data: opts.roster, error: null });
      api.single = () => Promise.resolve({ data: opts.roster[0], error: null });
      api.update = (payload: unknown) => {
        writes.push({ table, op: 'update', payload });
        return api;
      };
      api.delete = () => {
        writes.push({ table, op: 'delete', payload: null });
        return api;
      };
      api.upsert = (payload: unknown) => {
        writes.push({ table, op: 'upsert', payload });
        return Promise.resolve({ error: null });
      };
      api.insert = (payload: unknown) => {
        writes.push({ table, op: 'insert', payload });
        return api;
      };
      return api;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const service = new CommunitiesService({
    getClient: () => db,
    listBlockedUserIds: async () => [],
  } as never);
  return { service, writes };
}

const member = (id: string, source: string, visibility?: string): Row => ({
  user_id: id,
  source,
  profiles: {
    id,
    name: `User ${id.slice(0, 4)}`,
    avatar_url: null,
    programme: 'Pharmacy',
    settings: visibility ? { privacy: { profileVisibility: visibility } } : {},
  },
});

describe('listMembers privacy', () => {
  it('hides a private profile from co-members', async () => {
    const { service } = makeService({
      viewerSource: 'joined',
      roster: [member(OTHER, 'joined', 'private')],
    });
    await expect(service.listMembers(VIEWER, COMMUNITY)).resolves.toEqual({ members: [], nextCursor: null });
  });

  it('shows a public profile', async () => {
    const { service } = makeService({
      viewerSource: 'auto',
      roster: [member(OTHER, 'auto', 'public')],
    });
    const { members } = await service.listMembers(VIEWER, COMMUNITY);
    expect(members).toHaveLength(1);
  });

  it('treats an absent visibility setting as public (the product default)', async () => {
    const { service } = makeService({ viewerSource: 'auto', roster: [member(OTHER, 'auto')] });
    expect((await service.listMembers(VIEWER, COMMUNITY)).members).toHaveLength(1);
  });

  it('THE INVARIANT: a shared AUTO community does not expose a groups-tier profile', async () => {
    // Both were auto-added to their institution's community. Neither chose to
    // be here, so neither is exposed to the other.
    const { service } = makeService({
      viewerSource: 'auto',
      roster: [member(OTHER, 'auto', 'groups')],
    });
    await expect(service.listMembers(VIEWER, COMMUNITY)).resolves.toEqual({ members: [], nextCursor: null });
  });

  it('a shared JOINED community does expose a groups-tier profile', async () => {
    const { service } = makeService({
      viewerSource: 'joined',
      roster: [member(OTHER, 'joined', 'groups')],
    });
    expect((await service.listMembers(VIEWER, COMMUNITY)).members).toHaveLength(1);
  });

  it('requires BOTH sides to have joined — viewer auto is not enough', async () => {
    const { service } = makeService({
      viewerSource: 'auto',
      roster: [member(OTHER, 'joined', 'groups')],
    });
    await expect(service.listMembers(VIEWER, COMMUNITY)).resolves.toEqual({ members: [], nextCursor: null });
  });

  it('always shows the viewer their own row whatever their visibility', async () => {
    const { service } = makeService({
      viewerSource: 'auto',
      roster: [member(VIEWER, 'auto', 'private')],
    });
    expect((await service.listMembers(VIEWER, COMMUNITY)).members).toHaveLength(1);
  });

  it('refuses the roster to a non-member', async () => {
    const { service } = makeService({ viewerSource: null, roster: [] });
    await expect(service.listMembers(VIEWER, COMMUNITY)).rejects.toThrow(/Join this community/);
  });
});

describe('leave semantics', () => {
  it('records an opt-out for an AUTO membership instead of deleting it', async () => {
    // A DELETE would be undone by the next profile save, because
    // refresh_auto_communities re-derives membership from the academic profile.
    const { service, writes } = makeService({ viewerSource: 'auto', roster: [{ source: 'auto' }] });
    await service.leave(VIEWER, COMMUNITY);
    const update = writes.find((w) => w.op === 'update');
    expect(update).toBeTruthy();
    expect((update?.payload as { opted_out_at?: string }).opted_out_at).toBeTruthy();
    expect(writes.some((w) => w.op === 'delete')).toBe(false);
  });

  it('deletes a JOINED membership outright', async () => {
    const { service, writes } = makeService({
      viewerSource: 'joined',
      roster: [{ source: 'joined' }],
    });
    await service.leave(VIEWER, COMMUNITY);
    expect(writes.some((w) => w.op === 'delete')).toBe(true);
  });
});

describe('createTopicCommunity', () => {
  it('rejects a name too short to slug meaningfully', async () => {
    const { service } = makeService({ viewerSource: 'joined', roster: [] });
    await expect(service.createTopicCommunity(VIEWER, { name: 'ab' })).rejects.toThrow(/3-60/);
  });

  it('creates a public, NON-official topic community and joins the creator', async () => {
    const { service, writes } = makeService({
      viewerSource: 'joined',
      roster: [{ id: COMMUNITY, kind: 'topic', slug: 'topic-past-questions', name: 'Past questions' }],
    });
    await service.createTopicCommunity(VIEWER, { name: 'Past questions', tags: ['exams'] });
    const insert = writes.find((w) => w.op === 'insert')?.payload as Row;
    expect(insert.kind).toBe('topic');
    expect(insert.visibility).toBe('public');
    // is_official is reserved for derived campus scopes.
    expect(insert.is_official).toBe(false);
    const join = writes.find((w) => w.op === 'upsert')?.payload as Row;
    expect(join.source).toBe('joined');
  });
});

const GROUP = '44444444-4444-4444-8444-444444444444';

describe('joinDiscoverableGroup', () => {
  function makeJoinService(group: Row | null, opts: { inCommunity?: boolean } = {}) {
    const inCommunity = opts.inCommunity !== false;
    const writes: Array<{ table: string; op: string; payload: unknown }> = [];
    const db: any = {
      from(table: string) {
        const api: any = {};
        const self = () => api;
        api.select = self;
        api.eq = self;
        api.is = self;
        api.in = self;
        api.or = self;
        api.order = self;
        api.gt = self;
        api.neq = self;
        api.maybeSingle = () =>
          Promise.resolve({
            data: table === 'groups' ? group : null,
            error: null,
          });
        api.limit = () =>
          Promise.resolve({
            data:
              table === 'community_members' && inCommunity
                ? [
                    {
                      role: 'member',
                      source: 'joined',
                      communities: {
                        id: COMMUNITY,
                        kind: 'topic',
                        slug: 'topic-x',
                        name: 'X',
                        description: null,
                        institution_id: null,
                        programme: null,
                        study_level: null,
                        course_id: null,
                        tags: [],
                        visibility: 'public',
                        is_official: false,
                        member_count: 1,
                      },
                    },
                  ]
                : [],
            error: null,
          });
        api.upsert = (payload: unknown) => {
          writes.push({ table, op: 'upsert', payload });
          return Promise.resolve({ error: null });
        };
        return api;
      },
    };
    const service = new CommunitiesService({
      getClient: () => db,
      listBlockedUserIds: async () => [],
    } as never);
    return { service, writes };
  }

  it('refuses a private group', async () => {
    const { service, writes } = makeJoinService({
      id: GROUP,
      name: 'Secret',
      visibility: 'private',
      community_id: null,
      is_archived: false,
    });
    await expect(service.joinDiscoverableGroup(VIEWER, GROUP)).rejects.toThrow(/invite only/);
    expect(writes.some((w) => w.op === 'upsert')).toBe(false);
  });

  it('joins a public group', async () => {
    const { service, writes } = makeJoinService({
      id: GROUP,
      name: 'Open study',
      visibility: 'public',
      community_id: null,
      is_archived: false,
    });
    await expect(service.joinDiscoverableGroup(VIEWER, GROUP)).resolves.toEqual({ joined: true });
    const join = writes.find((w) => w.op === 'upsert')?.payload as Row;
    expect(join.group_id).toBe(GROUP);
    expect(join.user_id).toBe(VIEWER);
    expect(join.pending).toBe(false);
  });

  it('joins a community-visible group when the viewer is in that community', async () => {
    const { service } = makeJoinService({
      id: GROUP,
      name: 'Campus BIO',
      visibility: 'community',
      community_id: COMMUNITY,
      is_archived: false,
    });
    await expect(service.joinDiscoverableGroup(VIEWER, GROUP)).resolves.toEqual({ joined: true });
  });

  it('refuses a community-visible group when the viewer is not in that community', async () => {
    const outsider = '55555555-5555-4555-8555-555555555555';
    const { service, writes } = makeJoinService(
      {
        id: GROUP,
        name: 'Campus BIO',
        visibility: 'community',
        community_id: COMMUNITY,
        is_archived: false,
      },
      { inCommunity: false }
    );
    await expect(service.joinDiscoverableGroup(outsider, GROUP)).rejects.toThrow(/community first/);
    expect(writes.some((w) => w.op === 'upsert')).toBe(false);
  });
});

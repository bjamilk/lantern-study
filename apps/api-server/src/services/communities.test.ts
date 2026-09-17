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
const INSTITUTION = '99999999-9999-4999-8999-999999999999';

type Row = Record<string, unknown>;

/**
 * Minimal PostgREST double. listMembers consults maybeSingle twice (the
 * viewer's own membership row, then the community row for created_by) and
 * the roster once (limit). Every maybeSingle answers with the membership
 * shape; the community read simply sees no created_by, which is 'member'.
 */
function makeService(opts: {
  viewerSource?: string | null;
  /** The viewer's own `community_members.role`, for the moderator-only fields. */
  viewerRole?: string | null;
  isPlatformAdmin?: boolean;
  roster: Row[];
}) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  /** Every column list this service asked for, so a test can assert one was NOT asked for. */
  const selects: Array<{ table: string; columns: string }> = [];
  const db: any = {
    from(table: string) {
      const api: any = {};
      const self = () => api;
      api.select = (columns?: string) => {
        if (typeof columns === 'string') selects.push({ table, columns });
        return api;
      };
      api.eq = self;
      api.is = self;
      api.in = self;
      api.gt = self;
      api.neq = self;
      api.or = self;
      api.order = self;
      api.maybeSingle = () =>
        Promise.resolve({
          data:
            // The `profiles` read is the community GATE
            // (assertCanAccessCommunities): every write path checks that the
            // caller has an institution AND a programme before it runs, so
            // the double has to answer it or every test 403s.
            table === 'profiles'
              ? { id: VIEWER, institution_id: INSTITUTION, programme: 'MBBS' }
              : opts.viewerSource
                ? { user_id: VIEWER, source: opts.viewerSource, role: opts.viewerRole ?? null }
                : null,
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
    getClient: () => db as never,
    directMessages: { listBlockedUserIds: async () => [] },
    client: { isPlatformAdmin: async () => opts.isPlatformAdmin === true },
    readState: { getAllGroupUnreadCounts: async () => ({}) },
  });
  return { service, writes, selects };
}

const member = (
  id: string,
  source: string,
  visibility?: string,
  mutedUntil?: string | null
): Row => ({
  user_id: id,
  source,
  ...(mutedUntil === undefined ? {} : { muted_until: mutedUntil }),
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

/**
 * `muted_until` says a NAMED PERSON was punished. It goes to someone who could
 * have done the punishing and to nobody else — otherwise the roster quietly
 * publishes every mute in the community to the whole community.
 */
describe('listMembers mute state', () => {
  const MUTED_UNTIL = '2099-01-01T00:00:00Z';
  const rosterSelect = (selects: Array<{ table: string; columns: string }>) =>
    // The roster embed names the fkey (community_members has two FKs to
    // profiles since 20260908120000's muted_by), so match the disambiguated
    // hint rather than the old ambiguous `profiles!inner`.
    selects.find((s) => s.columns.includes('profiles!community_members_user_id_fkey'))?.columns ??
    '';

  it('a moderator sees mutedUntil on every row, null for a member who is not muted', async () => {
    const { service, selects } = makeService({
      viewerSource: 'joined',
      viewerRole: 'moderator',
      roster: [member(OTHER, 'joined', 'public', MUTED_UNTIL), member(VIEWER, 'joined', 'public')],
    });
    const { members } = await service.listMembers(VIEWER, COMMUNITY);
    expect(rosterSelect(selects)).toContain('muted_until');
    expect(members.map((m) => m.mutedUntil)).toEqual([MUTED_UNTIL, null]);
  });

  it('a plain member is not told who is muted — the column is never even selected', async () => {
    const { service, selects } = makeService({
      viewerSource: 'joined',
      viewerRole: 'member',
      roster: [member(OTHER, 'joined', 'public', MUTED_UNTIL)],
    });
    const { members } = await service.listMembers(VIEWER, COMMUNITY);
    expect(rosterSelect(selects)).not.toContain('muted_until');
    expect(members[0]).not.toHaveProperty('mutedUntil');
  });

  it('a platform admin with no community role is told, because they are the only moderation an auto room has', async () => {
    const { service } = makeService({
      viewerSource: 'auto',
      viewerRole: 'member',
      isPlatformAdmin: true,
      roster: [member(OTHER, 'auto', 'public', MUTED_UNTIL)],
    });
    const { members } = await service.listMembers(VIEWER, COMMUNITY);
    expect(members[0].mutedUntil).toBe(MUTED_UNTIL);
  });

  it('an admin is told, and an unmuted member reads as null rather than absent', async () => {
    const { service } = makeService({
      viewerSource: 'joined',
      viewerRole: 'admin',
      roster: [member(OTHER, 'joined', 'public', null)],
    });
    expect((await service.listMembers(VIEWER, COMMUNITY)).members[0].mutedUntil).toBeNull();
  });
});

/**
 * The detail payload is what the community screen resolves its KIND from, and
 * a tag-derived kind needs the tags in the same response — a second request to
 * learn what the room is means the header renders as "Community" first and
 * changes under the reader. Both columns are in COMMUNITY_COLUMNS today; this
 * pins them there, because the fallback path in `selectCommunity` trims
 * columns by name and a careless addition to OPTIONAL would drop one silently.
 */
describe('getBySlug payload', () => {
  it('asks for kind AND tags', async () => {
    const { service, selects } = makeService({ viewerSource: 'joined', roster: [] });
    await service.getBySlug(VIEWER, 'campus-unilag');
    const columns = selects.find((s) => s.table === 'communities')?.columns ?? '';
    expect(columns).toContain('kind');
    expect(columns).toContain('tags');
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

describe('createCommunity — the campus-life kinds', () => {
  const roster = (kind: string): Row[] => [
    { id: COMMUNITY, kind, slug: `${kind}-law-society`, name: 'Law Society' },
  ];

  it.each(['interest', 'club', 'hostel', 'faith', 'sports', 'general', 'event'])(
    'lets a student create a %s community, never official',
    async (kind) => {
      const { service, writes } = makeService({ viewerSource: 'joined', roster: roster(kind) });
      await service.createCommunity(VIEWER, { name: 'Law Society', kind });
      const insert = writes.find((w) => w.op === 'insert')?.payload as Row;
      expect(insert.kind).toBe(kind);
      expect(insert.is_official).toBe(false);
      expect(insert.created_by).toBe(VIEWER);
      expect(insert.slug).toBe(`${kind}-law-society`);
    },
  );

  it('refuses an academic kind — those are derived from the profile, not minted', async () => {
    const { service, writes } = makeService({ viewerSource: 'joined', roster: roster('course') });
    await expect(
      service.createCommunity(VIEWER, { name: 'Pharmacology', kind: 'course' }),
    ).rejects.toThrow(/made from your profile/);
    expect(writes.some((w) => w.op === 'insert')).toBe(false);
  });

  it('refuses a kind that does not exist', async () => {
    const { service } = makeService({ viewerSource: 'joined', roster: roster('quidditch') });
    await expect(
      service.createCommunity(VIEWER, { name: 'Quidditch', kind: 'quidditch' }),
    ).rejects.toThrow(/community type/);
  });

  it('carries an event schedule, and drops an end before its start', async () => {
    const { service, writes } = makeService({ viewerSource: 'joined', roster: roster('event') });
    await service.createCommunity(VIEWER, {
      name: 'Rag Week',
      kind: 'event',
      startsAt: '2026-10-01T09:00:00Z',
      endsAt: '2026-09-30T09:00:00Z',
      location: 'Main Auditorium',
    });
    const insert = writes.find((w) => w.op === 'insert')?.payload as Row;
    expect(insert.starts_at).toBe('2026-10-01T09:00:00.000Z');
    expect(insert.ends_at).toBeNull();
    expect(insert.location).toBe('Main Auditorium');
  });

  it('never writes a schedule onto a kind that is not an event', async () => {
    const { service, writes } = makeService({ viewerSource: 'joined', roster: roster('club') });
    await service.createCommunity(VIEWER, {
      name: 'Law Society',
      kind: 'club',
      startsAt: '2026-10-01T09:00:00Z',
    });
    const insert = writes.find((w) => w.op === 'insert')?.payload as Row;
    expect(insert.starts_at).toBeUndefined();
  });

  it('makes a private community, which join() then refuses (code only)', async () => {
    const { service, writes } = makeService({ viewerSource: 'joined', roster: roster('club') });
    await service.createCommunity(VIEWER, {
      name: 'Law Society',
      kind: 'club',
      visibility: 'private',
    });
    expect((writes.find((w) => w.op === 'insert')?.payload as Row).visibility).toBe('private');
  });
});

describe('the community gate (assertCanAccessCommunities)', () => {
  /** A profile with no programme: the gate has to refuse, not 500. */
  function makeGatedService(profile: Row | null) {
    const db: any = {
      from() {
        const api: any = {};
        const self = () => api;
        for (const m of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit']) api[m] = self;
        api.maybeSingle = () => Promise.resolve({ data: profile, error: null });
        return api;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
    return new CommunitiesService({
      getClient: () => db as never,
      directMessages: { listBlockedUserIds: async () => [] },
      client: { isPlatformAdmin: async () => false },
      readState: { getAllGroupUnreadCounts: async () => ({}) },
    });
  }

  it('refuses a half-filled academic profile with 403, not 500', async () => {
    const service = makeGatedService({ id: VIEWER, institution_id: INSTITUTION, programme: null });
    await expect(service.assertCanAccessCommunities(VIEWER)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('lets a student with institution AND programme through', async () => {
    const service = makeGatedService({
      id: VIEWER,
      institution_id: INSTITUTION,
      programme: 'MBBS',
    });
    await expect(service.assertCanAccessCommunities(VIEWER)).resolves.toEqual({
      institutionId: INSTITUTION,
    });
  });

  it('lets a platform admin through with no academic profile at all', async () => {
    const db: any = {
      from() {
        const api: any = {};
        const self = () => api;
        for (const m of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit']) api[m] = self;
        api.maybeSingle = () => Promise.resolve({ data: { id: VIEWER }, error: null });
        return api;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
    const service = new CommunitiesService({
      getClient: () => db as never,
      directMessages: { listBlockedUserIds: async () => [] },
      client: { isPlatformAdmin: async () => true },
      readState: { getAllGroupUnreadCounts: async () => ({}) },
    });
    await expect(service.assertCanAccessCommunities(VIEWER)).resolves.toEqual({
      institutionId: null,
    });
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
      getClient: () => db as never,
      directMessages: { listBlockedUserIds: async () => [] },
      client: { isPlatformAdmin: async () => false },
      readState: { getAllGroupUnreadCounts: async () => ({}) },
    });
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

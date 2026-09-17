/**
 * GET /api/v1/communities/public/:slug — the ONE unauthenticated community read
 * (Gap 5 · the crawler join card at /discover/c/:slug).
 *
 * This endpoint runs as the SERVICE ROLE, so RLS protects nothing here. What
 * this file pins is everything that would fail silently and leak:
 *   - the route is registered, is genuinely unauthenticated, and sits ahead of
 *     the two-segment `/:communityId/*` routes that could otherwise swallow it;
 *   - the select names five columns and never `*`;
 *   - the response body is HAND-BUILT — five keys — so a widened select cannot
 *     spill member ids, member names, the lounge pointer or the creator;
 *   - a PRIVATE community answers exactly like an unknown one, so the card is
 *     not an oracle for whether a private room exists;
 *   - a malformed slug never becomes a database query.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'probe-user', permissions: [], credentialType: 'jwt' };
    next();
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../services/cache', () => ({
  cacheService: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
  },
}));

import router, { initializeCommunityRoutes } from './communities';
import { normalizePublicCommunitySlug } from '../services/communities';
import { cacheService } from '../services/cache';
import { stubDataLayer } from '../services/data/testStub';

const CAMPUS_ID = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, unknown> | null;

/**
 * getCommunitiesService memoises the FIRST SupabaseService it is handed, so a
 * fresh double per test would be ignored. One stable service over mutable
 * state is the only shape that works here.
 */
const state: {
  tables: Record<string, Row>;
  selects: Array<{ table: string; columns: string }>;
  filters: Array<{ table: string; column: string; value: unknown }>;
} = { tables: {}, selects: [], filters: [] };

const client = {
  from(table: string) {
    const builder: any = {
      select(columns: string) {
        state.selects.push({ table, columns });
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ table, column, value });
        return builder;
      },
      async maybeSingle() {
        return { data: state.tables[table] ?? null, error: null };
      },
    };
    return builder;
  },
};
initializeCommunityRoutes(stubDataLayer({ getClient: () => client }) as any);

function makeRes() {
  let settle: () => void = () => undefined;
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    done: new Promise<void>((resolve) => {
      settle = resolve;
    }),
    set(key: string, value: string) {
      res.headers[key] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      settle();
      return res;
    },
    fail() {
      settle();
    },
  };
  return res;
}

const layers = (method: 'get' | 'post' | 'delete') =>
  (router as any).stack.filter((l: any) => l.route?.methods?.[method]);

const publicLayer = () =>
  layers('get').find((l: any) => l.route.path === '/public/:slug');

async function callPublic(slug: string, tables: Record<string, Row>) {
  state.tables = tables;
  state.selects = [];
  state.filters = [];
  const res = makeRes();
  const errors: unknown[] = [];
  const next = jest.fn((err?: unknown) => {
    errors.push(err);
    res.fail();
  });
  publicLayer().route.stack[0].handle({ params: { slug }, query: {} } as any, res, next);
  await res.done;
  expect(errors).toEqual([]);
  return { res, selects: state.selects, filters: state.filters, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  (cacheService.get as jest.Mock).mockResolvedValue(null);
});

describe('routing', () => {
  it('registers GET /public/:slug ahead of the two-segment /:communityId routes', () => {
    const paths = layers('get').map((l: any) => l.route.path);
    expect(paths).toContain('/public/:slug');
    // A community slugged "members" must not be captured by /:communityId/members.
    expect(paths.indexOf('/public/:slug')).toBeLessThan(paths.indexOf('/:communityId/members'));
    expect(paths.indexOf('/public/:slug')).toBeLessThan(paths.indexOf('/:communityId/channels'));
    // /:slug is one segment and can never shadow it, but pin the order anyway.
    expect(paths.indexOf('/public/:slug')).toBeLessThan(paths.indexOf('/:slug'));
  });

  it('is unauthenticated — one handler, no authMiddleware in the chain', () => {
    expect(publicLayer().route.stack).toHaveLength(1);
    const authed = layers('get').find((l: any) => l.route.path === '/:slug');
    expect(authed.route.stack.length).toBeGreaterThan(1);
  });
});

describe('GET /communities/public/:slug', () => {
  // Deliberately fat: the double returns columns a widened select would expose.
  const fatRow = {
    slug: 'campus-unilag',
    name: 'University of Lagos',
    kind: 'institution',
    institution_id: CAMPUS_ID,
    member_count: 412,
    created_by: '44444444-4444-4444-8444-444444444444',
    lounge_group_id: '55555555-5555-4555-8555-555555555555',
    description: 'private-ish blurb',
    last_message: 'see you at the 8am test',
    members: [{ user_id: 'leak', name: 'Ada Obi' }],
  };

  it('returns exactly the five public fields and nothing else', async () => {
    const { res } = await callPublic('campus-unilag', {
      communities: fatRow,
      marketplace_campuses: { name: 'University of Lagos' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        slug: 'campus-unilag',
        name: 'University of Lagos',
        kind: 'institution',
        institutionName: 'University of Lagos',
        memberCount: 412,
      },
    });
    expect(Object.keys(res.body.data).sort()).toEqual([
      'institutionName',
      'kind',
      'memberCount',
      'name',
      'slug',
    ]);
  });

  it('leaks no member identity, no creator, no lounge pointer and no message text', async () => {
    const { res } = await callPublic('campus-unilag', {
      communities: fatRow,
      marketplace_campuses: { name: 'University of Lagos' },
    });
    const serialized = JSON.stringify(res.body);
    for (const secret of [
      'created_by',
      'createdBy',
      'lounge_group_id',
      'loungeGroupId',
      'members',
      'Ada Obi',
      'see you at the 8am test',
      fatRow.created_by,
      fatRow.lounge_group_id,
      CAMPUS_ID,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('scopes the select to the five columns and never `*`', async () => {
    const { selects } = await callPublic('campus-unilag', {
      communities: fatRow,
      marketplace_campuses: { name: 'University of Lagos' },
    });
    const communitySelect = selects.find((s) => s.table === 'communities');
    expect(communitySelect?.columns).toBe('slug, name, kind, institution_id, member_count');
    expect(communitySelect?.columns).not.toContain('*');
    // The campus lookup takes the display name only — not its id or geography.
    expect(selects.find((s) => s.table === 'marketplace_campuses')?.columns).toBe('name');
    // Nothing else is read: no member roster, no groups, no messages.
    expect([...new Set(selects.map((s) => s.table))].sort()).toEqual([
      'communities',
      'marketplace_campuses',
    ]);
  });

  it('hand-writes the visibility guard (service role bypasses RLS) and the active-campus guard', async () => {
    const { filters } = await callPublic('campus-unilag', {
      communities: fatRow,
      marketplace_campuses: { name: 'University of Lagos' },
    });
    expect(filters).toContainEqual({
      table: 'communities',
      column: 'visibility',
      value: 'public',
    });
    expect(filters).toContainEqual({ table: 'communities', column: 'slug', value: 'campus-unilag' });
    expect(filters).toContainEqual({
      table: 'marketplace_campuses',
      column: 'active',
      value: true,
    });
  });

  it('caches hard on both sides, and caches only the five-field payload', async () => {
    const { res } = await callPublic('campus-unilag', {
      communities: fatRow,
      marketplace_campuses: { name: 'University of Lagos' },
    });
    expect(res.headers['Cache-Control']).toBe('public, max-age=600');
    expect(cacheService.set).toHaveBeenCalledWith(
      'communities:public:campus-unilag',
      res.body.data,
      600
    );
  });

  it('serves the cached payload without touching the database', async () => {
    const cached = {
      slug: 'topic-anatomy-club',
      name: 'Anatomy Club',
      kind: 'topic',
      institutionName: null,
      memberCount: 9,
    };
    (cacheService.get as jest.Mock).mockResolvedValue(cached);
    const { res, selects } = await callPublic('topic-anatomy-club', {});
    expect(res.body).toEqual({ success: true, data: cached });
    expect(selects).toHaveLength(0);
  });

  it('omits the institution when the community has none (a topic community)', async () => {
    const { res, selects } = await callPublic('topic-anatomy-club', {
      communities: {
        slug: 'topic-anatomy-club',
        name: 'Anatomy Club',
        kind: 'topic',
        institution_id: null,
        member_count: 9,
      },
    });
    expect(res.body.data.institutionName).toBeNull();
    expect(selects.some((s) => s.table === 'marketplace_campuses')).toBe(false);
  });

  it('answers a private community exactly like an unknown one', async () => {
    // The visibility filter excludes it, so PostgREST returns no row.
    const unknown = await callPublic('campus-unilag', { communities: null });
    const priv = await callPublic('topic-secret-society', { communities: null });
    expect(unknown.res.statusCode).toBe(404);
    expect(priv.res.statusCode).toBe(404);
    expect(priv.res.body).toEqual(unknown.res.body);
    expect(priv.res.body).toEqual({ success: false, error: 'Community not found' });
  });

  it.each([
    ['path traversal', '../../etc/passwd'],
    ['a PostgREST filter injection', 'a,visibility.eq.private'],
    ['whitespace', 'campus unilag'],
    ['empty', ''],
    ['a single character', 'a'],
  ])('rejects a malformed slug (%s) with a 404 and no query', async (_label, slug) => {
    const { res, selects } = await callPublic(slug, { communities: null });
    expect(res.statusCode).toBe(404);
    expect(selects).toHaveLength(0);
    expect(cacheService.get).not.toHaveBeenCalled();
  });

  it('normalises a member count that arrives null or negative', async () => {
    const { res } = await callPublic('topic-anatomy-club', {
      communities: {
        slug: 'topic-anatomy-club',
        name: 'Anatomy Club',
        kind: 'topic',
        institution_id: null,
        member_count: null,
      },
    });
    expect(res.body.data.memberCount).toBe(0);
  });

  it('falls back to a known kind when the row carries an unexpected one', async () => {
    const { res } = await callPublic('topic-anatomy-club', {
      communities: {
        slug: 'topic-anatomy-club',
        name: 'Anatomy Club',
        kind: 'not-a-kind',
        institution_id: null,
        member_count: 3,
      },
    });
    expect(res.body.data.kind).toBe('topic');
  });
});

describe('normalizePublicCommunitySlug', () => {
  it('accepts the machine-minted shapes and lowercases', () => {
    expect(normalizePublicCommunitySlug('campus-unilag')).toBe('campus-unilag');
    expect(normalizePublicCommunitySlug('  Campus-UNILAG  ')).toBe('campus-unilag');
    expect(normalizePublicCommunitySlug(`course-${'a'.repeat(32)}`)).toBe(
      `course-${'a'.repeat(32)}`
    );
  });

  it('rejects anything that is not one', () => {
    for (const bad of ['', 'a', '-leading', 'has space', 'has/slash', 'a'.repeat(200)]) {
      expect(normalizePublicCommunitySlug(bad)).toBeNull();
    }
    // Non-strings never coerce into the valid-looking slugs "null" and "42".
    for (const bad of [null, undefined, 42, {}, ['campus-unilag']]) {
      expect(normalizePublicCommunitySlug(bad)).toBeNull();
    }
  });
});

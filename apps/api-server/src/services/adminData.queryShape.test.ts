/**
 * Query shapes for every admin database access (M4 step 3).
 *
 * `routes/admin.ts` held 57 direct `.from()` calls across 18 tables and 27
 * `getClient()` escapes, with 117 lines of test over 2,039 lines of source.
 * Step 3 moved all of it into `services/adminData.ts`. A move is only
 * behaviour-preserving if each query still asks the same question, so this test
 * records, per function: the table, the projected columns, and every filter and
 * modifier in the order they were applied.
 *
 * How: a recording double stands in for the PostgREST client. Every builder
 * method appends `name(args)` to a trace and returns the builder, so the trace
 * is the query — `from('profiles') select(...) eq(id, x) maybeSingle()`. It is
 * asserted literally, because a query is exactly the kind of thing that is easy
 * to "clean up" into a different question.
 *
 * Read the expectations as the spec they are. Three in particular are not
 * cosmetic:
 *   - `listAiTokenEstimates` filters `not('token_estimate', 'is', null)`.
 *     Without it the dashboard's AI spend counts cache replays, which cost
 *     nothing, and over-reports spend.
 *   - `listDecksForAdmin` and the deck counter filter
 *     `is('removed_by_admin_at', null)`. Without it the console lists decks it
 *     has already removed.
 *   - `head: true` on the dashboard counters. Dropping it turns thirteen counts
 *     into thirteen full table reads.
 *
 * What this test deliberately does NOT do is assert results. These functions
 * return PostgREST's `{data, error}` untouched — the routes branch on `error`
 * (`GET /audit` degrades on a 42P01, `GET /users` falls back when the email RPC
 * is missing), and a double that invented results would hide that.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type { SupabaseService } from './supabase';
import * as adminData from './adminData';

/** One recorded call: the builder method and the arguments it was given. */
type Call = string;

const CHAIN_METHODS = [
  'select',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'is',
  'not',
  'in',
  'or',
  'ilike',
  'order',
  'limit',
  'range',
  'update',
  'delete',
  'upsert',
  'insert',
  'maybeSingle',
  'single',
] as const;

function fmt(args: unknown[]): string {
  return args.map((a) => JSON.stringify(a)).join(', ');
}

/**
 * A PostgREST double that records the chain instead of running it. Thenable, so
 * `await`ing a builder resolves like a real query — several of these functions
 * are awaited directly rather than having `.then` called on them.
 */
function recorder() {
  const trace: Call[] = [];
  const result = { data: [], error: null, count: 0 };

  const builder: any = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of CHAIN_METHODS) {
    builder[method] = (...args: unknown[]) => {
      trace.push(`${method}(${fmt(args)})`);
      return builder;
    };
  }

  const authCalls: Call[] = [];
  const client = {
    from: (table: string) => {
      trace.push(`from(${JSON.stringify(table)})`);
      return builder;
    },
    rpc: (fn: string, params: unknown) => {
      trace.push(`rpc(${JSON.stringify(fn)}, ${JSON.stringify(params)})`);
      return builder;
    },
    auth: {
      admin: {
        getUserById: (...a: unknown[]) => (authCalls.push(`getUserById(${fmt(a)})`), Promise.resolve({ data: null, error: null })),
        updateUserById: (...a: unknown[]) => (authCalls.push(`updateUserById(${fmt(a)})`), Promise.resolve({ data: null, error: null })),
        signOut: (...a: unknown[]) => (authCalls.push(`signOut(${fmt(a)})`), Promise.resolve({ error: null })),
        listUsers: (...a: unknown[]) => (authCalls.push(`listUsers(${fmt(a)})`), Promise.resolve({ data: { users: [] }, error: null })),
      },
    },
  };

  const svc = { getClient: () => client } as unknown as SupabaseService;
  return { svc, trace, authCalls, client };
}

/** Run one data-layer call and return the chain it built. */
async function traceOf(run: (svc: SupabaseService) => unknown): Promise<string[]> {
  const rec = recorder();
  await run(rec.svc);
  return rec.trace;
}

const USER_COLUMNS = adminData.ADMIN_USER_COLUMNS;

describe('adminData query shapes — profiles', () => {
  it('reads one user in the list projection', async () => {
    expect(await traceOf((s) => adminData.getUserForAdminList(s, 'u1'))).toEqual([
      'from("profiles")',
      `select(${JSON.stringify(USER_COLUMNS)})`,
      'eq("id", "u1")',
      'maybeSingle()',
    ]);
  });

  it('hydrates a set of ids in the same projection, so search results match the list', async () => {
    expect(await traceOf((s) => adminData.getUsersForAdminList(s, ['a', 'b']))).toEqual([
      'from("profiles")',
      `select(${JSON.stringify(USER_COLUMNS)})`,
      'in("id", ["a","b"])',
    ]);
  });

  it('pages users newest first with an exact total', async () => {
    expect(await traceOf((s) => adminData.listUsersPage(s, { offset: 40, limit: 20 }))).toEqual([
      'from("profiles")',
      `select(${JSON.stringify(USER_COLUMNS)}, {"count":"exact"})`,
      'order("created_at", {"ascending":false})',
      'range(40, 59)',
    ]);
  });

  it('adds the four-column ilike filter only when a search term is given', async () => {
    const trace = await traceOf((s) =>
      adminData.listUsersPage(s, { escapedSearch: 'ada', offset: 0, limit: 20 })
    );
    expect(trace).toContain(
      'or("name.ilike.%ada%,username.ilike.%ada%,first_name.ilike.%ada%,last_name.ilike.%ada%")'
    );
  });

  it('passes the escaped term through verbatim — escaping is the route\'s job', async () => {
    // The route escapes % _ , before calling; this layer must not double-escape
    // or the filter stops matching what the admin typed.
    const trace = await traceOf((s) =>
      adminData.listUsersPage(s, { escapedSearch: 'a\\%b', offset: 0, limit: 1 })
    );
    expect(trace.join('\n')).toContain('name.ilike.%a\\\\%b%');
  });

  it('reads the detail projection, which adds badges and stats', async () => {
    expect(await traceOf((s) => adminData.getUserDetail(s, 'u1'))).toEqual([
      'from("profiles")',
      `select(${JSON.stringify(adminData.ADMIN_USER_DETAIL_COLUMNS)})`,
      'eq("id", "u1")',
      'maybeSingle()',
    ]);
  });

  it('reads settings with single(), so a missing user surfaces as an error', async () => {
    expect(await traceOf((s) => adminData.getUserSettings(s, 'u1'))).toEqual([
      'from("profiles")',
      'select("settings")',
      'eq("id", "u1")',
      'single()',
    ]);
  });

  it('writes the whole settings blob for exactly one user', async () => {
    // Scoped by id and by nothing else: an unfiltered update here would ban
    // every account on the platform.
    expect(await traceOf((s) => adminData.setUserSettings(s, 'u1', { is_banned: true }))).toEqual([
      'from("profiles")',
      'update({"settings":{"is_banned":true}})',
      'eq("id", "u1")',
    ]);
  });

  it('reads actor and owner labels in one narrow projection', async () => {
    expect(await traceOf((s) => adminData.getProfileSummaries(s, ['a']))).toEqual([
      'from("profiles")',
      'select("id, name, username")',
      'in("id", ["a"])',
    ]);
  });

  it('lists newest sign-ups for the activity feed', async () => {
    expect(await traceOf((s) => adminData.listRecentUsers(s, 10))).toEqual([
      'from("profiles")',
      'select("id, name, username, created_at")',
      'order("created_at", {"ascending":false})',
      'limit(10)',
    ]);
  });
});

describe('adminData query shapes — GoTrue and platform_admins', () => {
  it('searches auth.users through the RPC, not a page scan', async () => {
    expect(await traceOf((s) => adminData.searchUsersByEmail(s, 'ada@x.com', 20))).toEqual([
      'rpc("admin_search_users_by_email", {"search_query":"ada@x.com","result_limit":20})',
    ]);
  });

  it('reads, writes and signs out through the GoTrue admin API', async () => {
    const rec = recorder();
    await adminData.getAuthUser(rec.svc, 'u1');
    await adminData.setAuthUserMetadata(rec.svc, 'u1', { is_platform_admin: true });
    await adminData.signOutEverywhere(rec.svc, 'u1');
    await adminData.listAuthUsers(rec.svc, 2, 200);
    expect(rec.authCalls).toEqual([
      'getUserById("u1")',
      'updateUserById("u1", {"app_metadata":{"is_platform_admin":true}})',
      'signOut("u1", "global")',
      'listUsers({"page":2,"perPage":200})',
    ]);
    expect(rec.trace).toEqual([]);
  });

  it('bans at the auth layer with a duration far beyond any appeal window', async () => {
    const rec = recorder();
    await expect(adminData.applyAuthBan(rec.svc, 'u1', adminData.AUTH_BAN_DURATION)).resolves.toBe(true);
    expect(rec.authCalls).toEqual([`updateUserById("u1", {"ban_duration":"876000h"})`]);
    expect(Number(adminData.AUTH_BAN_DURATION.replace('h', ''))).toBeGreaterThan(24 * 365 * 50);
  });

  it('upserts a grant on user_id, so re-granting is not a duplicate-key error', async () => {
    expect(await traceOf((s) => adminData.grantPlatformAdmin(s, 'u1', 'admin-1'))).toEqual([
      'from("platform_admins")',
      'upsert({"user_id":"u1","granted_by":"admin-1"}, {"onConflict":"user_id"})',
    ]);
  });

  it('revokes by deleting exactly that one row', async () => {
    expect(await traceOf((s) => adminData.revokePlatformAdmin(s, 'u1'))).toEqual([
      'from("platform_admins")',
      'delete()',
      'eq("user_id", "u1")',
    ]);
  });
});

describe('adminData query shapes — dashboard counters', () => {
  it('asks thirteen head-only exact counts across ten tables in one round trip', async () => {
    const trace = await traceOf((s) =>
      adminData.getDashboardCounts(s, {
        todayStart: '2026-09-15T00:00:00.000Z',
        last7d: '2026-09-08T00:00:00.000Z',
        last24h: '2026-09-14T00:00:00.000Z',
      })
    );
    expect(trace).toEqual([
      'from("profiles")',
      'select("id", {"count":"exact","head":true})',
      'from("marketplace_listings")',
      'select("id", {"count":"exact","head":true})',
      'from("marketplace_listings")',
      'select("id", {"count":"exact","head":true})',
      'eq("status", "active")',
      'from("marketplace_reports")',
      'select("id", {"count":"exact","head":true})',
      'eq("status", "pending")',
      'from("ai_analytics")',
      'select("id", {"count":"exact","head":true})',
      'gte("created_at", "2026-09-14T00:00:00.000Z")',
      'from("profiles")',
      'select("id", {"count":"exact","head":true})',
      'gte("created_at", "2026-09-15T00:00:00.000Z")',
      'from("marketplace_reports")',
      'select("id", {"count":"exact","head":true})',
      'eq("status", "resolved")',
      'gte("resolved_at", "2026-09-08T00:00:00.000Z")',
      'from("ai_analytics")',
      'select("id", {"count":"exact","head":true})',
      'gte("created_at", "2026-09-08T00:00:00.000Z")',
      'from("groups")',
      'select("id", {"count":"exact","head":true})',
      'eq("is_archived", false)',
      'from("messages")',
      'select("id", {"count":"exact","head":true})',
      'gte("timestamp", "2026-09-14T00:00:00.000Z")',
      'from("decks")',
      'select("id", {"count":"exact","head":true})',
      'is("removed_by_admin_at", null)',
      'from("offline_bundles")',
      'select("id", {"count":"exact","head":true})',
      'from("marketplace_orders")',
      'select("id", {"count":"exact","head":true})',
      'eq("status", "disputed")',
    ]);
  });

  it('counts a single user\'s groups, listings, live decks and recent AI events', async () => {
    expect(await traceOf((s) => adminData.getUserCounts(s, 'u1', '2026-09-08T00:00:00.000Z'))).toEqual([
      'from("group_members")',
      'select("group_id", {"count":"exact","head":true})',
      'eq("user_id", "u1")',
      'from("marketplace_listings")',
      'select("id", {"count":"exact","head":true})',
      'eq("user_id", "u1")',
      'from("decks")',
      'select("id", {"count":"exact","head":true})',
      'eq("user_id", "u1")',
      'is("removed_by_admin_at", null)',
      'from("ai_analytics")',
      'select("id", {"count":"exact","head":true})',
      'eq("user_id", "u1")',
      'gte("created_at", "2026-09-08T00:00:00.000Z")',
    ]);
  });

  it('counts distinct study-activity users over a bounded scan', async () => {
    expect(await traceOf((s) => adminData.listRecentStudyActivityUsers(s, '2026-09-09'))).toEqual([
      'from("study_activity")',
      'select("user_id")',
      'gte("activity_date", "2026-09-09")',
      'gt("count", 0)',
      'limit(10000)',
    ]);
  });
});

describe('adminData query shapes — marketplace and reports', () => {
  it('pages listings with the seller embed disambiguated by constraint name', async () => {
    // The `!marketplace_listings_user_id_fkey` hint is not decoration: a second
    // foreign key between these tables makes an unqualified embed a PGRST201.
    const trace = await traceOf((s) => adminData.listListingsForAdmin(s, { offset: 0, limit: 20 }));
    expect(trace[0]).toBe('from("marketplace_listings")');
    expect(trace[1]).toContain('seller:profiles!marketplace_listings_user_id_fkey(id, name)');
    expect(trace).toEqual([
      trace[0],
      trace[1],
      'order("created_at", {"ascending":false})',
      'range(0, 19)',
    ]);
  });

  it('filters listings by status only when one is asked for', async () => {
    const withStatus = await traceOf((s) =>
      adminData.listListingsForAdmin(s, { status: 'active', offset: 0, limit: 5 })
    );
    expect(withStatus).toContain('eq("status", "active")');
  });

  it('reads the four listing fields a moderation decision needs', async () => {
    expect(await traceOf((s) => adminData.getListingForModeration(s, 'l1'))).toEqual([
      'from("marketplace_listings")',
      'select("id, status, user_id, title")',
      'eq("id", "l1")',
      'maybeSingle()',
    ]);
  });

  it('writes a listing status for one listing', async () => {
    expect(await traceOf((s) => adminData.setListingStatus(s, 'l1', 'suspended_by_admin'))).toEqual([
      'from("marketplace_listings")',
      'update({"status":"suspended_by_admin"})',
      'eq("id", "l1")',
    ]);
  });

  it('records the takedown fields a suspended seller sees and appeals from', async () => {
    expect(
      await traceOf((s) =>
        adminData.setListingUnderReview(s, 'l1', { reason: 'r', at: 'T', by: 'admin-1' })
      )
    ).toEqual([
      'from("marketplace_listings")',
      'update({"rights_status":"under_review","takedown_reason":"r","takedown_at":"T","takedown_by":"admin-1"})',
      'eq("id", "l1")',
    ]);
  });

  it('lists newest listings and newest marketplace reports for the activity feed', async () => {
    expect(await traceOf((s) => adminData.listRecentListings(s, 10))).toEqual([
      'from("marketplace_listings")',
      'select("id, title, created_at, user_id, status")',
      'order("created_at", {"ascending":false})',
      'limit(10)',
    ]);
    expect(await traceOf((s) => adminData.listRecentMarketplaceReports(s, 10))).toEqual([
      'from("marketplace_reports")',
      'select("id, reason, created_at, reporter_id")',
      'order("created_at", {"ascending":false})',
      'limit(10)',
    ]);
  });

  it('reads what a report points at, to decide which caches a takedown clears', async () => {
    expect(await traceOf((s) => adminData.getReportTarget(s, 'r1'))).toEqual([
      'from("content_reports")',
      'select("target_type, target_id")',
      'eq("id", "r1")',
      'maybeSingle()',
    ]);
  });

  it('resolves a report and returns its id, so "no such report" is a 404 not a 500', async () => {
    expect(
      await traceOf((s) =>
        adminData.resolveReport(s, 'r1', { note: 'n', resolvedBy: 'admin-1', resolvedAt: 'T' })
      )
    ).toEqual([
      'from("content_reports")',
      'update({"status":"resolved","admin_note":"n","resolved_by":"admin-1","resolved_at":"T"})',
      'eq("id", "r1")',
      'select("id")',
      'maybeSingle()',
    ]);
  });
});

describe('adminData query shapes — groups, messages, decks, bundles', () => {
  it('pages groups newest first, filtering by name only when asked', async () => {
    expect(await traceOf((s) => adminData.listGroupsForAdmin(s, { offset: 0, limit: 20 }))).toEqual([
      'from("groups")',
      'select("id, name, description, is_archived, created_at, last_message_time", {"count":"exact"})',
      'order("created_at", {"ascending":false})',
      'range(0, 19)',
    ]);
    const searched = await traceOf((s) =>
      adminData.listGroupsForAdmin(s, { escapedSearch: 'ada', offset: 0, limit: 20 })
    );
    expect(searched).toContain('ilike("name", "%ada%")');
  });

  it('archives a group rather than deleting it, so removal is reversible', async () => {
    expect(await traceOf((s) => adminData.setGroupArchived(s, 'g1', true))).toEqual([
      'from("groups")',
      'update({"is_archived":true})',
      'eq("id", "g1")',
    ]);
  });

  it('pages messages with the sender embed disambiguated, newest first', async () => {
    const trace = await traceOf((s) => adminData.listMessagesForAdmin(s, { offset: 0, limit: 20 }));
    expect(trace[0]).toBe('from("messages")');
    expect(trace[1]).toContain('sender:profiles!messages_sender_id_fkey(id, name, username)');
    expect(trace.slice(2)).toEqual(['order("timestamp", {"ascending":false})', 'range(0, 19)']);
    const scoped = await traceOf((s) =>
      adminData.listMessagesForAdmin(s, { groupId: 'g1', offset: 0, limit: 20 })
    );
    expect(scoped).toContain('eq("group_id", "g1")');
  });

  it('deletes one message — the one hard delete in the console', async () => {
    expect(await traceOf((s) => adminData.deleteMessage(s, 'm1'))).toEqual([
      'from("messages")',
      'delete()',
      'eq("id", "m1")',
    ]);
  });

  it('lists only decks that are not already removed', async () => {
    const trace = await traceOf((s) => adminData.listDecksForAdmin(s, { offset: 0, limit: 20 }));
    expect(trace).toContain('is("removed_by_admin_at", null)');
    expect(trace[1]).toContain('owner:profiles!decks_user_id_fkey(id, name, username)');
  });

  it('counts cards by reading deck ids only', async () => {
    expect(await traceOf((s) => adminData.listFlashcardDeckIds(s, ['d1']))).toEqual([
      'from("flashcards")',
      'select("deck_id")',
      'in("deck_id", ["d1"])',
    ]);
  });

  it('removes a deck by stamping it, not by deleting it', async () => {
    expect(await traceOf((s) => adminData.removeDeck(s, 'd1', 'T'))).toEqual([
      'from("decks")',
      'update({"removed_by_admin_at":"T"})',
      'eq("id", "d1")',
    ]);
  });

  it('reads 50 bundles with an exact total, so the cap is visible in the UI', async () => {
    expect(await traceOf((s) => adminData.listOfflineBundles(s))).toEqual([
      'from("offline_bundles")',
      'select("id, user_id, display_name, group_name, updated_at, created_at", {"count":"exact"})',
      'order("updated_at", {"ascending":false})',
      'limit(50)',
    ]);
  });
});

describe('adminData query shapes — AI analytics and audit', () => {
  it('reads AI events newest first within the window', async () => {
    expect(await traceOf((s) => adminData.listAiEvents(s, 'T', 5000))).toEqual([
      'from("ai_analytics")',
      'select("event, created_at, user_id")',
      'gte("created_at", "T")',
      'order("created_at", {"ascending":false})',
      'limit(5000)',
    ]);
  });

  it('reads the per-user leaderboard rows unordered, since it aggregates them', async () => {
    expect(await traceOf((s) => adminData.listAiEventsByUser(s, 'T', 20000))).toEqual([
      'from("ai_analytics")',
      'select("user_id, event, created_at")',
      'gte("created_at", "T")',
      'limit(20000)',
    ]);
  });

  it('reads newest AI events for the activity feed', async () => {
    expect(await traceOf((s) => adminData.listRecentAiEvents(s, 10))).toEqual([
      'from("ai_analytics")',
      'select("id, event, created_at, user_id")',
      'order("created_at", {"ascending":false})',
      'limit(10)',
    ]);
  });

  it('excludes NULL token estimates, so cache replays do not inflate spend', async () => {
    expect(await traceOf((s) => adminData.listAiTokenEstimates(s, 'T', 10000))).toEqual([
      'from("ai_inference_log")',
      'select("token_estimate")',
      'gte("created_at", "T")',
      'not("token_estimate", "is", null)',
      'limit(10000)',
    ]);
  });

  it('reads the per-feature inference rows behind GET /ai-tokens', async () => {
    expect(await traceOf((s) => adminData.listAiInferenceRows(s, 'T', 10000))).toEqual([
      'from("ai_inference_log")',
      'select("feature, provider, token_estimate, created_at")',
      'gte("created_at", "T")',
      'order("created_at", {"ascending":false})',
      'limit(10000)',
    ]);
  });

  it('reads the product-event stream within the window', async () => {
    expect(await traceOf((s) => adminData.listProductEvents(s, 'T', 10000))).toEqual([
      'from("product_events")',
      'select("event, surface, user_id, created_at")',
      'gte("created_at", "T")',
      'order("created_at", {"ascending":false})',
      'limit(10000)',
    ]);
  });

  it('reads one student\'s companion history, scoped to that student', async () => {
    // Scoped by user_id and nothing else: this is the console's most sensitive
    // read, and an unfiltered version would hand an admin everyone's messages.
    expect(await traceOf((s) => adminData.listCompanionMessages(s, 'u1', 20))).toEqual([
      'from("ai_companion_messages")',
      'select("id, role, content, created_at")',
      'eq("user_id", "u1")',
      'order("created_at", {"ascending":false})',
      'limit(20)',
    ]);
  });

  it('reads the audit trail newest first', async () => {
    expect(await traceOf((s) => adminData.listAuditEntries(s, 30))).toEqual([
      'from("admin_audit_log")',
      'select("id, actor_id, action, target_type, target_id, metadata, reason, created_at")',
      'order("created_at", {"ascending":false})',
      'limit(30)',
    ]);
  });
});

describe('adminData table inventory', () => {
  /**
   * Every table the admin console may touch. The point is not the count but
   * the closure: a new table appearing here is a new thing the console can
   * read or write, and that is a decision, not an implementation detail.
   */
  const EXPECTED_TABLES = [
    'admin_audit_log',
    'ai_analytics',
    'ai_companion_messages',
    'ai_inference_log',
    'content_reports',
    'decks',
    'flashcards',
    'group_members',
    'groups',
    'marketplace_listings',
    'marketplace_orders',
    'marketplace_reports',
    'messages',
    'offline_bundles',
    'platform_admins',
    'product_events',
    'profiles',
    'study_activity',
  ];

  it('touches exactly the eighteen tables the pre-refactor route file did', () => {
    const source = require('fs').readFileSync(require.resolve('./adminData.ts'), 'utf8');
    const found = [...source.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m: any) => m[1]);
    expect([...new Set(found)].sort()).toEqual(EXPECTED_TABLES);
  });

  it('is the only module the admin routes reach the database through', () => {
    const routes = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/admin.ts'),
      'utf8'
    );
    // Comments may name them; code may not.
    const code = routes
      .split('\n')
      .filter((line: string) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/\.from\(/);
    expect(code).not.toMatch(/getClient\(\)/);
    expect(code).not.toMatch(/auth\.admin\./);
    expect(code).not.toMatch(/\.rpc\(/);
  });
});

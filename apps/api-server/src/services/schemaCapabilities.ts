/**
 * Which of the 20260903120000 (community boards) columns this database
 * actually has — resolved once per process, then cached.
 *
 * This repo hand-applies migrations and they lag, so the API is deployed
 * BEFORE the migration and must answer every board request without a 500
 * (spec §1.1 ship order, §3.1 degrade table):
 *
 *   groups.community_surface absent -> every community group is a board,
 *                                      studyGroups: [], POST /groups with
 *                                      communitySurface 'study_group' -> 503
 *   messages.subject absent         -> posts have no title, a submitted
 *                                      subject is dropped
 *   messages.pinned_at absent       -> pinnedMessage null, PUT .../pin -> 503
 *
 * Why one module and not a per-query retry: the group select lists are
 * enumerated in three places in supabase.ts plus GROUP_CHANNEL_COLUMNS in
 * communities.ts, and `selectCommunity`'s existing fallback hardcodes
 * stripping `lounge_group_id`, so it cannot be reused (§13 trap 1).
 *
 * Two layers, deliberately:
 *   1. a `select <col> limit 1` probe, resolved once and shared by every
 *      caller (concurrent callers await the same promise);
 *   2. every query that still sees 42703 / PGRST204 calls the matching
 *      `mark…Missing()` and retries once without the column — the probe can
 *      race a migration, and a false "present" must degrade, not throw.
 *
 * A probe that fails for an UNRELATED reason (network, auth) is not cached
 * and assumes the column is present: layer 2 is the safety net, and caching
 * "absent" off a transient failure would silently disable pinning for the
 * lifetime of the process.
 *
 * "Absent" is remembered for CAPABILITY_RECHECK_MS, not forever. The ship
 * order guarantees this process starts pre-migration and gets a false answer
 * within seconds of the deploy, and every degraded path returns before it
 * touches the database — so a false that never expires would keep answering
 * "pre-migration" on a fully migrated database until someone restarted the
 * API. `librarySearch.ts` caches the identical fact (a hand-applied migration
 * has not landed yet) the same way, behind TOPIC_COLUMN_RECHECK_MS. "Present"
 * stays cached for the process: a column does not disappear, and layer 2
 * covers being wrong.
 */

type ProbeClient = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (n: number) => PromiseLike<{ error?: unknown }>;
    };
  };
};

/** PostgREST reports a missing column as 42703 on read and PGRST204 on write. */
export function isMissingColumnError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === '42703' || code === 'PGRST204';
}

/**
 * A missing TABLE, not a missing column: Postgres says 42P01 and PostgREST
 * says PGRST205 (unknown relation) or PGRST202 (unknown function). A probe
 * for a table a migration has not created yet has to treat these the same way
 * it treats 42703, or the capability answers "present" and every caller 500s.
 */
export function isMissingRelationError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202';
}

/** Either shape of "the 20260908120000 migration has not been applied here". */
export function isMissingSchemaError(error: unknown): boolean {
  return isMissingColumnError(error) || isMissingRelationError(error);
}

type Capability =
  | 'groupCommunitySurface'
  | 'messageBoardColumns'
  | 'messageReactionsColumn'
  // 20260908120000 — community governance
  | 'messagePostKind'
  | 'communityMemberMute'
  | 'communityEventFields'
  | 'communityInvites';

/**
 * How long an "absent" answer is trusted before the next caller re-probes.
 * Long enough that a pre-migration database is not probed per request, short
 * enough that hand-applying the migration takes effect without a redeploy.
 */
export const CAPABILITY_RECHECK_MS = 5 * 60 * 1000;

/** `at` is when the answer was recorded; only a `false` expires. */
type CachedAnswer = { value: boolean; at: number };

const resolved: Record<Capability, CachedAnswer | null> = {
  groupCommunitySurface: null,
  messageBoardColumns: null,
  messageReactionsColumn: null,
  messagePostKind: null,
  communityMemberMute: null,
  communityEventFields: null,
  communityInvites: null,
};
const inFlight: Record<Capability, Promise<boolean> | null> = {
  groupCommunitySurface: null,
  messageBoardColumns: null,
  messageReactionsColumn: null,
  messagePostKind: null,
  communityMemberMute: null,
  communityEventFields: null,
  communityInvites: null,
};

/** A cached answer is usable while it is `true`, or while a `false` is fresh. */
function readCache(capability: Capability): boolean | null {
  const cached = resolved[capability];
  if (!cached) return null;
  if (cached.value) return true;
  if (Date.now() - cached.at < CAPABILITY_RECHECK_MS) return false;
  resolved[capability] = null;
  return null;
}

const PROBES: Record<Capability, { table: string; column: string }> = {
  groupCommunitySurface: { table: 'groups', column: 'community_surface' },
  messageBoardColumns: { table: 'messages', column: 'subject, pinned_at, pinned_by' },
  // 20260830120000 adds `reactions` to BOTH messages and dm_messages in one
  // migration, so one probe answers for both listing paths.
  messageReactionsColumn: { table: 'messages', column: 'reactions' },
  // 20260908120000 adds all three message columns in one statement, so one
  // probe answers for post kinds, removal reasons and accepted answers.
  messagePostKind: { table: 'messages', column: 'post_kind, removed_reason, answered_message_id' },
  communityMemberMute: { table: 'community_members', column: 'muted_until, muted_by, muted_reason' },
  communityEventFields: { table: 'communities', column: 'starts_at, ends_at, location' },
  // A missing TABLE, not a missing column — see isMissingRelationError.
  communityInvites: { table: 'community_invites', column: 'code' },
};

async function resolveCapability(db: unknown, capability: Capability): Promise<boolean> {
  const cached = readCache(capability);
  if (cached !== null) return cached;
  const pending = inFlight[capability];
  if (pending) return pending;

  const { table, column } = PROBES[capability];
  const probe = (async () => {
    try {
      const { error } = await (db as ProbeClient).from(table).select(column).limit(1);
      if (error && isMissingSchemaError(error)) {
        resolved[capability] = { value: false, at: Date.now() };
        return false;
      }
      if (error) return true; // Unrelated failure: assume present, do not cache.
      resolved[capability] = { value: true, at: Date.now() };
      return true;
    } catch {
      return true;
    } finally {
      inFlight[capability] = null;
    }
  })();
  inFlight[capability] = probe;
  return probe;
}

/** Is `groups.community_surface` available? */
export function hasGroupCommunitySurface(db: unknown): Promise<boolean> {
  return resolveCapability(db, 'groupCommunitySurface');
}

/** Are `messages.subject` / `pinned_at` / `pinned_by` available? */
export function hasMessageBoardColumns(db: unknown): Promise<boolean> {
  return resolveCapability(db, 'messageBoardColumns');
}

/** Call from a query that saw 42703 on `community_surface`, then retry without it. */
export function markGroupCommunitySurfaceMissing(): void {
  resolved.groupCommunitySurface = { value: false, at: Date.now() };
  inFlight.groupCommunitySurface = null;
}

/** Call from a query that saw 42703 on the board message columns, then retry without them. */
export function markMessageBoardColumnsMissing(): void {
  resolved.messageBoardColumns = { value: false, at: Date.now() };
  inFlight.messageBoardColumns = null;
}

/** Are `messages.post_kind` / `removed_reason` / `answered_message_id` available? */
export function hasMessagePostKind(db: unknown): Promise<boolean> {
  return resolveCapability(db, 'messagePostKind');
}

/** Call from a query that saw 42703 on `post_kind`, then retry without it. */
export function markMessagePostKindMissing(): void {
  resolved.messagePostKind = { value: false, at: Date.now() };
  inFlight.messagePostKind = null;
}

/** Is `community_members.muted_until` available? */
export function hasCommunityMemberMute(db: unknown): Promise<boolean> {
  return resolveCapability(db, 'communityMemberMute');
}

export function markCommunityMemberMuteMissing(): void {
  resolved.communityMemberMute = { value: false, at: Date.now() };
  inFlight.communityMemberMute = null;
}

/** Are `communities.starts_at` / `ends_at` / `location` available? */
export function hasCommunityEventFields(db: unknown): Promise<boolean> {
  return resolveCapability(db, 'communityEventFields');
}

export function markCommunityEventFieldsMissing(): void {
  resolved.communityEventFields = { value: false, at: Date.now() };
  inFlight.communityEventFields = null;
}

/** Does the `community_invites` TABLE exist? */
export function hasCommunityInvites(db: unknown): Promise<boolean> {
  return resolveCapability(db, 'communityInvites');
}

export function markCommunityInvitesMissing(): void {
  resolved.communityInvites = { value: false, at: Date.now() };
  inFlight.communityInvites = null;
}

/** Is the denormalised `messages.reactions` / `dm_messages.reactions` available? */
export function hasMessageReactionsColumn(db: unknown): Promise<boolean> {
  return resolveCapability(db, 'messageReactionsColumn');
}

/** Call from a query that saw 42703 on `reactions`, then retry without it. */
export function markMessageReactionsColumnMissing(): void {
  resolved.messageReactionsColumn = { value: false, at: Date.now() };
  inFlight.messageReactionsColumn = null;
}

/** Appends `, community_surface` when the column exists. */
export async function groupColumns(db: unknown, base: string): Promise<string> {
  if (!(await hasGroupCommunitySurface(db))) return base;
  return `${base.trimEnd().replace(/,$/, '')}, community_surface`;
}

/** Appends `, subject, pinned_at, pinned_by` when those columns exist. */
export async function messageColumns(db: unknown, base: string): Promise<string> {
  if (!(await hasMessageBoardColumns(db))) return base;
  const withBoard = `${base.trimEnd().replace(/,$/, '')}, subject, pinned_at, pinned_by`;
  // 20260908120000 is a SEPARATE migration from 20260903120000, so a database
  // with board columns but no post kinds is a real, shipped state — exactly
  // like reactions above.
  if (!(await hasMessagePostKind(db))) return withBoard;
  return `${withBoard}, post_kind, removed_reason, answered_message_id`;
}

/**
 * Appends `, reactions` when the column exists. Separate from
 * `messageColumns` because the two live in different migrations: a database
 * with boards but no reactions is a real, shipped state.
 */
export async function reactionColumns(db: unknown, base: string): Promise<string> {
  if (!(await hasMessageReactionsColumn(db))) return base;
  return `${base.trimEnd().replace(/,$/, '')}, reactions`;
}

/**
 * Force the cached answers. Tests use it so a scripted database does not have
 * to serve a probe query; operations can use it to short-circuit a probe on a
 * database known to be migrated. `null` clears the cache and re-probes.
 */
export function setSchemaCapabilities(next: {
  groupCommunitySurface?: boolean | null;
  messageBoardColumns?: boolean | null;
  messageReactionsColumn?: boolean | null;
  messagePostKind?: boolean | null;
  communityMemberMute?: boolean | null;
  communityEventFields?: boolean | null;
  communityInvites?: boolean | null;
}): void {
  for (const key of Object.keys(next) as Capability[]) {
    const value = next[key];
    if (value === undefined) continue;
    resolved[key] = value === null ? null : { value, at: Date.now() };
    inFlight[key] = null;
  }
}

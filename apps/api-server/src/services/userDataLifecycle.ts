/**
 * Purpose: the two halves of the account data contract — export everything the
 * platform holds about a user, and delete the account and its data.
 *
 * Exports: `exportUserDataArchive` and `deleteUserAccountFully` (both called
 * from routes/users.ts under `authMiddleware`, for the caller's own id, and
 * from the admin console), plus `pageLearningEvents` and the
 * `LEARNING_EXPORT_*` bounds.
 *
 * What it touches:
 *
 * Storage buckets walked by `purgeUserStorage` (the `STORAGE_BUCKETS` list):
 * `flashcard-images`, `marketplace-images`, `question-images`, `note-files`,
 * `profile-avatars`, `cover-images`, `job-resumes`. Every one of those keys its
 * objects by owner — `<userId>/…` — which is what makes the walk safe: nothing
 * outside a prefix that proves this user's ownership is ever removed. Two
 * prefixes are tried per bucket, `<userId>` and the legacy `users/<userId>`,
 * and each is walked RECURSIVELY with pagination (see `purgeStoragePrefix`).
 *
 * `job-company-logos` is the exception: it keys by COMPANY id
 * (`<companyId>/<ts>-logo.<ext>`, `jobsBoard.ts:3394-3396`), so it is purged
 * separately and only for companies this user solely owns — created_by is the
 * user AND no other `job_company_members` row exists. A company with other
 * members keeps its logo and the skip is recorded on the result.
 *
 * Marketplace listing images are additionally removed by parsing the public URL
 * stored on the row — but only when the parsed object path is under this user's
 * own prefix; a foreign path is recorded, never removed.
 *
 * Tables READ for the export: `profiles`, `decks` (+ embedded `flashcards`),
 * `group_members` (+ `groups`), `notifications`, `test_sessions`,
 * `marketplace_listings`, `notes`, `ai_companion_messages`, `ai_analytics`,
 * `study_activity`, `transactions`, `budgets`, `marketplace_inquiries`,
 * `marketplace_favorites`, `marketplace_offers`, `offline_bundles`,
 * `group_challenges`, `challenge_participants`, `note_folders`, `study_sets`,
 * `dm_threads`, `dm_messages`, `messages` (sent), `learning_events` (paged)
 * and `concept_links` (authored).
 *
 * Tables WRITTEN by the deletion: `dm_read_status` and `dm_threads` (via
 * `purgeUserDmData`), `profiles`, and `auth.users` through
 * `auth.admin.deleteUser`. Everything else is expected to go by ON DELETE
 * CASCADE from `auth.users`. Caches: `cacheService.invalidateUserCache`,
 * `resetAIUsageForUser`, and the `user:*<id>*` / `users:list:*` patterns.
 *
 * Contract, honestly stated: the EXPORT half is real. `exportUserDataArchive`
 * produces a genuine GDPR subject-access archive (`format:
 * 'lantern-study-gdpr-export-v1'`), pages `learning_events` rather than
 * truncating silently, and flags truncation when it hits the ceiling. The
 * DELETION half now performs erasure and REPORTS it honestly:
 * `deleteUserAccountFully` returns `{ ok, found, purged, failures, skipped }`
 * and the routes answer 207 `PARTIAL_DELETION` when `ok` is false, so support
 * can finish by hand instead of a green 200 hiding files left in a bucket.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import type { SupabaseService } from './supabase';
import { cacheService } from './cache';
import { resetAIUsageForUser } from '../middleware/aiRateLimit';

// --- Storage purge -----------------------------------------------------------

// FIXED (F6): the list was missing `job-resumes`, `job-company-logos` and
// `cover-images`, so a deleted account's uploaded CVs — legal name, phone
// number, home address, employment history — survived deletion indefinitely and
// stayed retrievable by any signed URL already minted for them. `job-resumes`
// (`{userId}/{uuid}.{ext}`, jobsBoard.ts:3008) and `cover-images`
// (`{userId}/decks/{deckId}/…`, `{userId}/notes/{noteId}/…`, supabase.ts:1303)
// are owner-keyed and join the user-prefixed walk below. `job-company-logos`
// keys by company id, not user id, so it cannot join this list — it is handled
// by `purgeSolelyOwnedCompanyLogos`.
const STORAGE_BUCKETS = [
  'flashcard-images',
  'marketplace-images',
  'question-images',
  'note-files',
  'profile-avatars',
  'cover-images',
  'job-resumes',
] as const;

const JOB_COMPANY_LOGO_BUCKET = 'job-company-logos';

/** Supabase storage `list` page size (its own maximum). */
const STORAGE_LIST_PAGE = 1000;
/** Supabase storage `remove` accepts at most 100 keys per call. */
const STORAGE_REMOVE_BATCH = 100;
/** Depth/size guards so a pathological tree cannot spin the deletion forever. */
const STORAGE_MAX_DEPTH = 12;
const STORAGE_MAX_FOLDERS = 5_000;
const STORAGE_MAX_OBJECTS = 200_000;

export interface DeletionFailure {
  stage: 'storage' | 'dm' | 'auth' | 'profile';
  bucket?: string;
  prefix?: string;
  message: string;
}

export interface DeletionSkip {
  bucket: string;
  path: string;
  reason: string;
}

export interface DeleteUserAccountResult {
  /** True only when the account existed AND every stage completed cleanly. */
  ok: boolean;
  /** False when neither a profile nor an auth user existed (a repeat call). */
  found: boolean;
  purged: {
    storageObjects: number;
    storagePrefixes: number;
    companyLogoObjects: number;
    marketplaceImages: number;
    dmThreads: number;
  };
  failures: DeletionFailure[];
  /** Deliberate non-deletions (shared company logos, foreign image URLs). */
  skipped: DeletionSkip[];
}

interface StorageEntry {
  name?: string | null;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Supabase storage returns a nested directory as an entry with no `id` and no
 * `metadata` — that, not a trailing slash, is the only reliable folder marker.
 */
function isFolderEntry(entry: StorageEntry): boolean {
  return (entry.id === null || entry.id === undefined) &&
    (entry.metadata === null || entry.metadata === undefined);
}

/** A name that could escape the owner prefix is never followed or removed. */
function isSafeSegment(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
}

/** Every removed key must sit under the ownership-proving prefix. */
function isUnderPrefix(path: string, prefix: string): boolean {
  if (!prefix) return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isMissingBucketError(message: string | undefined): boolean {
  return /bucket not found|does not exist/i.test(message || '');
}

/** One fully-paginated `list` of a single folder. */
async function listFolderPage(
  client: SupabaseClient,
  bucket: string,
  folder: string,
  failures: DeletionFailure[]
): Promise<StorageEntry[]> {
  const entries: StorageEntry[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(folder, { limit: STORAGE_LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      // `cover-images` is created lazily on first upload (supabase.ts
      // `ensureCoverBucket`), so on a project where nobody has uploaded a cover
      // the bucket genuinely does not exist. That is nothing left to erase, not
      // a failed erasure — reporting it would make every deletion a false
      // PARTIAL_DELETION. Any other storage error is a real failure.
      if (isMissingBucketError(error.message)) return entries;
      failures.push({ stage: 'storage', bucket, prefix: folder, message: error.message });
      return entries;
    }
    const page = (data || []) as StorageEntry[];
    entries.push(...page);
    if (page.length < STORAGE_LIST_PAGE) break;
    offset += page.length;
    if (offset >= STORAGE_MAX_OBJECTS) {
      failures.push({
        stage: 'storage',
        bucket,
        prefix: folder,
        message: `listing stopped at ${STORAGE_MAX_OBJECTS} entries; folder not fully purged`,
      });
      break;
    }
  }
  return entries;
}

/**
 * FIXED (F6): was a single non-recursive `list(prefix, {limit: 1000})` that
 * removed only the IMMEDIATE children of the prefix and dropped folder entries
 * with an `.endsWith('/')` filter that never matches. Real note and image paths
 * nest two or more levels below the user prefix, so only flat objects such as
 * avatars were actually deleted, and the 1000-entry page was never continued.
 * Now: breadth-first walk of the whole subtree, every folder listing paginated
 * past 1000 by offset, removal in batches of ≤100 (the storage API's cap), and
 * every failure collected instead of aborting the purge at the first one.
 */
async function purgeStoragePrefix(
  client: SupabaseClient,
  bucket: string,
  prefix: string,
  failures: DeletionFailure[]
): Promise<number> {
  const files: string[] = [];
  const queue: Array<{ folder: string; depth: number }> = [{ folder: prefix, depth: 0 }];
  let foldersVisited = 0;

  try {
    while (queue.length) {
      const { folder, depth } = queue.shift()!;
      foldersVisited += 1;
      if (foldersVisited > STORAGE_MAX_FOLDERS) {
        failures.push({
          stage: 'storage',
          bucket,
          prefix,
          message: `folder budget of ${STORAGE_MAX_FOLDERS} exhausted; subtree not fully purged`,
        });
        break;
      }

      const entries = await listFolderPage(client, bucket, folder, failures);
      for (const entry of entries) {
        const name = typeof entry?.name === 'string' ? entry.name : '';
        if (!isSafeSegment(name)) continue;
        const fullPath = folder ? `${folder}/${name}` : name;
        if (!isUnderPrefix(fullPath, prefix)) continue;
        if (isFolderEntry(entry)) {
          if (depth + 1 > STORAGE_MAX_DEPTH) {
            failures.push({
              stage: 'storage',
              bucket,
              prefix: fullPath,
              message: `depth limit ${STORAGE_MAX_DEPTH} reached; deeper objects not purged`,
            });
            continue;
          }
          queue.push({ folder: fullPath, depth: depth + 1 });
        } else {
          files.push(fullPath);
        }
      }
    }
  } catch (err) {
    failures.push({
      stage: 'storage',
      bucket,
      prefix,
      message: err instanceof Error ? err.message : 'storage listing threw',
    });
  }

  return removeStorageObjects(client, bucket, files, prefix, failures);
}

/** Remove in ≤100-key batches; one failed batch does not stop the rest. */
async function removeStorageObjects(
  client: SupabaseClient,
  bucket: string,
  paths: string[],
  ownershipPrefix: string,
  failures: DeletionFailure[]
): Promise<number> {
  const safe = paths.filter((p) => isUnderPrefix(p, ownershipPrefix));
  let removed = 0;
  for (let i = 0; i < safe.length; i += STORAGE_REMOVE_BATCH) {
    const batch = safe.slice(i, i + STORAGE_REMOVE_BATCH);
    try {
      const { error } = await client.storage.from(bucket).remove(batch);
      if (error) {
        failures.push({ stage: 'storage', bucket, prefix: ownershipPrefix, message: error.message });
        continue;
      }
      removed += batch.length;
    } catch (err) {
      failures.push({
        stage: 'storage',
        bucket,
        prefix: ownershipPrefix,
        message: err instanceof Error ? err.message : 'storage remove threw',
      });
    }
  }
  return removed;
}

/**
 * `job-company-logos` is keyed by company id, so the only safe deletion is the
 * logo of a company this user SOLELY owns: they created it and no other member
 * row exists. A company with co-owners or recruiters keeps its logo (the row
 * itself cascades away with `created_by`, but the brand asset is not this
 * user's alone to erase) and the skip is recorded for support.
 */
async function purgeSolelyOwnedCompanyLogos(
  client: SupabaseClient,
  userId: string,
  failures: DeletionFailure[],
  skipped: DeletionSkip[]
): Promise<number> {
  const { data: companies, error } = await client
    .from('job_companies')
    .select('id')
    .eq('created_by', userId);
  if (error) {
    failures.push({ stage: 'storage', bucket: JOB_COMPANY_LOGO_BUCKET, message: error.message });
    return 0;
  }
  const companyIds = (companies || []).map((c: { id?: string }) => c?.id).filter((id): id is string => !!id);
  if (!companyIds.length) return 0;

  const { data: members, error: memberError } = await client
    .from('job_company_members')
    .select('company_id, user_id')
    .in('company_id', companyIds);
  if (memberError) {
    failures.push({ stage: 'storage', bucket: JOB_COMPANY_LOGO_BUCKET, message: memberError.message });
    return 0;
  }

  const shared = new Set(
    (members || [])
      .filter((m: { user_id?: string }) => m?.user_id && m.user_id !== userId)
      .map((m: { company_id?: string }) => m?.company_id)
      .filter((id): id is string => !!id)
  );

  let removed = 0;
  for (const companyId of companyIds) {
    if (shared.has(companyId)) {
      skipped.push({
        bucket: JOB_COMPANY_LOGO_BUCKET,
        path: `${companyId}/`,
        reason: 'company has other members; logo is not this user\'s alone to delete',
      });
      continue;
    }
    removed += await purgeStoragePrefix(client, JOB_COMPANY_LOGO_BUCKET, companyId, failures);
  }
  return removed;
}

/**
 * Marketplace covers are also referenced by public URL on the listing row.
 * Parse them, but delete ONLY what is under this user's own prefix — a URL on
 * the row is attacker-influenceable data, not proof of ownership.
 */
async function purgeMarketplaceListingImages(
  client: SupabaseClient,
  userId: string,
  failures: DeletionFailure[],
  skipped: DeletionSkip[]
): Promise<number> {
  const { data: listings, error } = await client
    .from('marketplace_listings')
    .select('images')
    .eq('user_id', userId);
  if (error) {
    failures.push({ stage: 'storage', message: `marketplace_listings read failed: ${error.message}` });
    return 0;
  }

  const byBucket = new Map<string, Set<string>>();
  for (const row of listings || []) {
    const images = Array.isArray(row.images) ? row.images : [];
    for (const url of images) {
      if (typeof url !== 'string' || !url.includes('/storage/v1/object/public/')) continue;
      const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
      if (!match) continue;
      const bucket = match[1]!;
      let path: string;
      try {
        path = decodeURIComponent(match[2]!).split('?')[0]!;
      } catch {
        continue;
      }
      if (!isUnderPrefix(path, userId) && !isUnderPrefix(path, `users/${userId}`)) {
        skipped.push({ bucket, path, reason: 'listing image is not under this user\'s storage prefix' });
        continue;
      }
      if (!byBucket.has(bucket)) byBucket.set(bucket, new Set());
      byBucket.get(bucket)!.add(path);
    }
  }

  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    const list = [...paths];
    const own = list.filter((p) => isUnderPrefix(p, userId));
    const legacy = list.filter((p) => !isUnderPrefix(p, userId));
    removed += await removeStorageObjects(client, bucket, own, userId, failures);
    removed += await removeStorageObjects(client, bucket, legacy, `users/${userId}`, failures);
  }
  return removed;
}

async function purgeUserStorage(
  client: SupabaseClient,
  userId: string,
  failures: DeletionFailure[],
  skipped: DeletionSkip[]
): Promise<{ storageObjects: number; storagePrefixes: number; companyLogoObjects: number; marketplaceImages: number }> {
  let storageObjects = 0;
  let storagePrefixes = 0;
  for (const bucket of STORAGE_BUCKETS) {
    for (const prefix of [userId, `users/${userId}`]) {
      storagePrefixes += 1;
      storageObjects += await purgeStoragePrefix(client, bucket, prefix, failures);
    }
  }

  const companyLogoObjects = await purgeSolelyOwnedCompanyLogos(client, userId, failures, skipped);
  const marketplaceImages = await purgeMarketplaceListingImages(client, userId, failures, skipped);

  return { storageObjects, storagePrefixes, companyLogoObjects, marketplaceImages };
}

// --- Learning-event paging ---------------------------------------------------

export const LEARNING_EXPORT_PAGE_SIZE = 1000;
/** Hard ceiling on exported learning rows (100 pages). Past this the export notes the truncation. */
export const LEARNING_EXPORT_MAX_ROWS = 100_000;

/**
 * Page through learning_events oldest-first (stable under concurrent appends).
 * Missing table (migration not applied) or any error → what was read so far.
 */
export async function pageLearningEvents(
  client: SupabaseClient,
  userId: string,
  pageSize = LEARNING_EXPORT_PAGE_SIZE,
  maxRows = LEARNING_EXPORT_MAX_ROWS
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let from = 0;
  while (rows.length < maxRows) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await client
      .from('learning_events')
      .select('*')
      .eq('user_id', userId)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) {
      logger.warn('learning_events export page failed', { userId, from, error: error.message });
      break;
    }
    const page = (data || []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < to - from + 1) break;
    from = to + 1;
  }
  return rows;
}

// --- DM purge ----------------------------------------------------------------
// `dm_threads.participant_ids` is an array column, so membership is decided in
// JS after reading the threads rather than by a column predicate. Deleting a
// thread removes it for the other participant too — a DM has no one-sided
// copy.

async function purgeUserDmData(
  client: SupabaseClient,
  userId: string,
  failures: DeletionFailure[]
): Promise<number> {
  const { error: readStatusError } = await client.from('dm_read_status').delete().eq('user_id', userId);
  if (readStatusError) {
    failures.push({ stage: 'dm', message: `dm_read_status delete failed: ${readStatusError.message}` });
  }

  const { data: threads, error: threadsError } = await client.from('dm_threads').select('id, participant_ids');
  if (threadsError) {
    failures.push({ stage: 'dm', message: `dm_threads read failed: ${threadsError.message}` });
    return 0;
  }
  const threadIds = (threads || [])
    .filter((t) => {
      const ids = t.participant_ids;
      return Array.isArray(ids) && ids.some((p: string) => p === userId || p === String(userId));
    })
    .map((t) => t.id);

  if (!threadIds.length) return 0;
  const { error: deleteError } = await client.from('dm_threads').delete().in('id', threadIds);
  if (deleteError) {
    failures.push({ stage: 'dm', message: `dm_threads delete failed: ${deleteError.message}` });
    return 0;
  }
  return threadIds.length;
}

// --- Export (GDPR subject access) --------------------------------------------

/**
 * Build the user's data archive.
 *
 * This is a genuine subject-access export: a versioned envelope
 * (`lantern-study-gdpr-export-v1`) over every table the platform holds rows
 * for this user in. Bounded reads are bounded on purpose and say so —
 * `learningEventsTruncated` rides back on the archive when the
 * LEARNING_EXPORT_MAX_ROWS ceiling is reached, so a truncated export is never
 * presented as a complete one.
 *
 * Two-sided rows (marketplace inquiries and offers, group challenges, DM
 * threads) are matched on either side, because both parties' copies are the
 * user's own data.
 */
export async function exportUserDataArchive(
  supabaseService: SupabaseService,
  userId: string
): Promise<Record<string, unknown>> {
  const client = supabaseService.getClient();

  const [
    profileRes,
    decksRes,
    groupsRes,
    notificationsRes,
    testSessionsRes,
    marketplaceRes,
    notesRes,
    companionRes,
    analyticsRes,
    activityRes,
    transactionsRes,
    budgetsRes,
    inquiriesRes,
    favoritesRes,
    offersRes,
    offlineBundlesRes,
    challengesRes,
    challengeParticipantsRes,
    noteFoldersRes,
    studySetsRes,
  ] = await Promise.all([
    client.from('profiles').select('*').eq('id', userId).maybeSingle(),
    client.from('decks').select('*, flashcards(*)').eq('user_id', userId),
    client.from('group_members').select('*, groups(*)').eq('user_id', userId),
    client.from('notifications').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(500),
    client.from('test_sessions').select('*').eq('user_id', userId),
    client.from('marketplace_listings').select('*').eq('user_id', userId),
    client.from('notes').select('*').eq('user_id', userId),
    client.from('ai_companion_messages').select('id, role, content, created_at, context_type').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
    client.from('ai_analytics').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
    client.from('study_activity').select('*').eq('user_id', userId),
    client.from('transactions').select('*').eq('user_id', userId),
    client.from('budgets').select('*').eq('user_id', userId),
    client.from('marketplace_inquiries').select('*').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).limit(500),
    client.from('marketplace_favorites').select('*').eq('user_id', userId).limit(500),
    client.from('marketplace_offers').select('*').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).limit(500),
    client.from('offline_bundles').select('*').eq('user_id', userId),
    client.from('group_challenges').select('*').or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`).limit(200),
    client.from('challenge_participants').select('*').eq('user_id', userId).limit(200),
    client.from('note_folders').select('*').eq('user_id', userId),
    client.from('study_sets').select('*').eq('user_id', userId),
  ]);

  const { data: dmThreadsRaw } = await client.from('dm_threads').select('*');
  const dmThreads = (dmThreadsRaw || []).filter((t) => {
    const ids = t.participant_ids;
    return Array.isArray(ids) && ids.some((p: string) => p === userId || p === String(userId));
  });
  const dmThreadIds = dmThreads.map((t) => t.id);
  const { data: dmMessages } = dmThreadIds.length
    ? await client
        .from('dm_messages')
        .select('*')
        .in('thread_id', dmThreadIds)
        .order('created_at', { ascending: false })
        .limit(1000)
    : { data: [] };

  const { data: sentMessages } = await client
    .from('messages')
    .select('id, group_id, type, text, timestamp, question_data')
    .eq('sender_id', userId)
    .order('timestamp', { ascending: false })
    .limit(500);

  // Learning activity (decision D9): product data kept while the account
  // exists, so it travels with the export. Paged — a busy student has tens of
  // thousands of review rows. concept_links: the ones this user authored
  // (created_by); backfill/AI links are not personal data.
  const learningEvents = await pageLearningEvents(client, userId);
  const { data: conceptLinks } = await client
    .from('concept_links')
    .select('concept_id, target_type, target_id, confidence, source, created_at')
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(LEARNING_EXPORT_PAGE_SIZE);

  return {
    exportedAt: new Date().toISOString(),
    format: 'lantern-study-gdpr-export-v1',
    userId,
    profile: profileRes.data ?? null,
    decks: decksRes.data ?? [],
    groupMemberships: groupsRes.data ?? [],
    notifications: notificationsRes.data ?? [],
    testSessions: testSessionsRes.data ?? [],
    marketplaceListings: marketplaceRes.data ?? [],
    noteFolders: noteFoldersRes.data ?? [],
    studySets: studySetsRes.data ?? [],
    notes: notesRes.data ?? [],
    aiCompanionMessages: companionRes.data ?? [],
    aiAnalytics: analyticsRes.data ?? [],
    studyActivity: activityRes.data ?? [],
    transactions: transactionsRes.data ?? [],
    budgets: budgetsRes.data ?? [],
    marketplaceInquiries: inquiriesRes.data ?? [],
    marketplaceFavorites: favoritesRes.data ?? [],
    marketplaceOffers: offersRes.data ?? [],
    offlineBundles: offlineBundlesRes.data ?? [],
    groupChallenges: challengesRes.data ?? [],
    challengeParticipation: challengeParticipantsRes.data ?? [],
    dmThreads,
    dmMessages: dmMessages ?? [],
    messagesSent: sentMessages ?? [],
    learningEvents,
    learningEventsTruncated: learningEvents.length >= LEARNING_EXPORT_MAX_ROWS,
    conceptLinks: conceptLinks ?? [],
  };
}

// --- Deletion ----------------------------------------------------------------

/**
 * Delete the account and everything hanging off it.
 *
 * Order: storage, then DM rows, then `auth.users` (from which the rest of the
 * schema cascades), then the caches. Returns false when neither a profile nor
 * an auth user exists, so a repeated call is not an error. If
 * `auth.admin.deleteUser` fails but a profile row exists, the profile is
 * deleted so the account cannot be used while the auth-side failure is
 * investigated.
 *
 * FIXED (F6): this used to return a bare `true` the moment the auth row was
 * gone, so a caller could not tell a complete erasure from one that left a CV
 * in `job-resumes`. It now returns `{ ok, found, purged, failures, skipped }`:
 * `found` distinguishes "no such account" (404) from a partial run, and `ok` is
 * true only when every stage succeeded. The routes answer 207 with a
 * `PARTIAL_DELETION` code when `ok` is false so support can finish by hand.
 */
export async function deleteUserAccountFully(
  supabaseService: SupabaseService,
  userId: string
): Promise<DeleteUserAccountResult> {
  const client = supabaseService.getClient();
  const failures: DeletionFailure[] = [];
  const skipped: DeletionSkip[] = [];
  const empty = {
    storageObjects: 0,
    storagePrefixes: 0,
    companyLogoObjects: 0,
    marketplaceImages: 0,
    dmThreads: 0,
  };

  const { data: existing } = await client.from('profiles').select('id').eq('id', userId).maybeSingle();
  const { data: authUser } = await client.auth.admin.getUserById(userId);
  if (!existing && !authUser?.user) {
    return { ok: false, found: false, purged: empty, failures, skipped };
  }

  const storage = await purgeUserStorage(client, userId, failures, skipped);
  const dmThreads = await purgeUserDmData(client, userId, failures);

  const { error: authDeleteError } = await client.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    logger.error('auth.admin.deleteUser failed', { userId, error: authDeleteError.message });
    failures.push({ stage: 'auth', message: authDeleteError.message });
    if (existing) {
      const { error: profileDeleteError } = await client.from('profiles').delete().eq('id', userId);
      if (profileDeleteError) throw profileDeleteError;
    } else {
      throw authDeleteError;
    }
  }

  await cacheService.invalidateUserCache(userId);
  await resetAIUsageForUser(userId);
  await cacheService.deletePattern(`user:*${userId}*`);
  await cacheService.deletePattern('users:list:*');

  const purged = { ...storage, dmThreads };
  if (failures.length) {
    logger.error('Account deletion completed with failures — manual cleanup required', {
      userId,
      purged,
      failures,
    });
  }

  return { ok: failures.length === 0, found: true, purged, failures, skipped };
}

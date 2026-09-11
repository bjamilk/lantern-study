import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import type { SupabaseService } from './supabase';
import { cacheService } from './cache';
import { resetAIUsageForUser } from '../middleware/aiRateLimit';

const STORAGE_BUCKETS = [
  'flashcard-images',
  'marketplace-images',
  'question-images',
  'note-files',
  'profile-avatars',
] as const;

async function listAndRemoveStoragePrefix(client: SupabaseClient, bucket: string, prefix: string): Promise<void> {
  try {
    const { data: files, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error || !files?.length) return;
    const paths = files
      .filter((f) => f.name && !f.name.endsWith('/'))
      .map((f) => (prefix ? `${prefix}/${f.name}` : f.name));
    if (paths.length) {
      await client.storage.from(bucket).remove(paths);
    }
  } catch (err) {
    logger.warn('Storage purge partial failure', { bucket, prefix, err });
  }
}

async function purgeUserStorage(client: SupabaseClient, userId: string): Promise<void> {
  for (const bucket of STORAGE_BUCKETS) {
    await listAndRemoveStoragePrefix(client, bucket, userId);
    await listAndRemoveStoragePrefix(client, bucket, `users/${userId}`);
  }

  const { data: listings } = await client
    .from('marketplace_listings')
    .select('images')
    .eq('user_id', userId);
  const imagePaths: string[] = [];
  for (const row of listings || []) {
    const images = Array.isArray(row.images) ? row.images : [];
    for (const url of images) {
      if (typeof url === 'string' && url.includes('/storage/v1/object/public/')) {
        const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
        if (match) {
          try {
            await client.storage.from(match[1]).remove([decodeURIComponent(match[2])]);
          } catch {
            /* best effort */
          }
        }
      }
    }
  }
  void imagePaths;
}

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

async function purgeUserDmData(client: SupabaseClient, userId: string): Promise<void> {
  await client.from('dm_read_status').delete().eq('user_id', userId);

  const { data: threads } = await client.from('dm_threads').select('id, participant_ids');
  const threadIds = (threads || [])
    .filter((t) => {
      const ids = t.participant_ids;
      return Array.isArray(ids) && ids.some((p: string) => p === userId || p === String(userId));
    })
    .map((t) => t.id);

  if (threadIds.length) {
    await client.from('dm_threads').delete().in('id', threadIds);
  }
}

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

export async function deleteUserAccountFully(
  supabaseService: SupabaseService,
  userId: string
): Promise<boolean> {
  const client = supabaseService.getClient();

  const { data: existing } = await client.from('profiles').select('id').eq('id', userId).maybeSingle();
  const { data: authUser } = await client.auth.admin.getUserById(userId);
  if (!existing && !authUser?.user) {
    return false;
  }

  await purgeUserStorage(client, userId);
  await purgeUserDmData(client, userId);

  const { error: authDeleteError } = await client.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    logger.error('auth.admin.deleteUser failed', { userId, error: authDeleteError.message });
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

  return true;
}

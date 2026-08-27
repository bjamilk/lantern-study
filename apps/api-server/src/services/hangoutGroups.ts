/**
 * Internal hangout groups — community lounges and study-room threads.
 *
 * These are ordinary `groups` + `group_members` rows. Clients must not POST
 * /groups to create them; the communities / study-rooms services call this.
 */
import { randomUUID } from 'crypto';
import { resolveGroupDiscovery } from '@lantern/shared/network';
import { cacheService } from './cache';
import { logger } from '../utils/logger';

export type HangoutDb = {
  from: (table: string) => any;
};

export async function insertHangoutGroup(
  db: HangoutDb,
  input: {
    name: string;
    visibility: 'private' | 'community' | 'public';
    communityId?: string | null;
    courseId?: string | null;
    adminUserId: string;
    description?: string | null;
  }
): Promise<string> {
  const discovery = resolveGroupDiscovery({
    visibility: input.visibility,
    communityId: input.communityId,
  });
  const name = String(input.name || 'Hangout').trim().slice(0, 120) || 'Hangout';
  const { data, error } = await db
    .from('groups')
    .insert({
      name,
      description: input.description ?? null,
      admin_ids: [input.adminUserId],
      permissions: {},
      invite_id: randomUUID(),
      course_id: input.courseId || null,
      visibility: discovery.visibility,
      community_id: discovery.communityId,
      is_archived: false,
    })
    .select('id')
    .single();
  if (error || !data?.id) {
    throw error || new Error('Could not create hangout group');
  }
  return String(data.id);
}

export async function joinHangoutGroup(
  db: HangoutDb,
  groupId: string,
  userId: string
): Promise<void> {
  const { error } = await db.from('group_members').upsert(
    { group_id: groupId, user_id: userId, pending: false },
    { onConflict: 'group_id,user_id' }
  );
  if (error) throw error;
  await cacheService.deletePattern('groups:discover:*');
  await cacheService.deletePattern('groups:user:*');
  await cacheService.deletePattern('groups:list:*');
  await cacheService.deletePattern(`group:${groupId}:*`);
  await cacheService.deletePattern(`user:groups:${userId}:*`);
}

/**
 * Idempotent link: reuse the parent row's group id, or create one and CAS-write
 * the column so two concurrent joins cannot attach two groups.
 */
export async function ensureLinkedHangoutGroup(
  db: HangoutDb,
  opts: {
    parentTable: 'communities' | 'study_sessions';
    parentId: string;
    linkColumn: 'lounge_group_id' | 'group_id';
    existingGroupId?: string | null;
    create: () => Promise<string>;
  }
): Promise<string> {
  if (opts.existingGroupId) return opts.existingGroupId;

  const { data: fresh, error: readError } = await db
    .from(opts.parentTable)
    .select(`id, ${opts.linkColumn}`)
    .eq('id', opts.parentId)
    .maybeSingle();
  if (readError) throw readError;
  const linked = (fresh as { [k: string]: unknown } | null)?.[opts.linkColumn];
  if (typeof linked === 'string' && linked) return linked;

  const groupId = await opts.create();

  const { data: updated, error: updateError } = await db
    .from(opts.parentTable)
    .update({ [opts.linkColumn]: groupId })
    .eq('id', opts.parentId)
    .is(opts.linkColumn, null)
    .select(opts.linkColumn)
    .maybeSingle();
  if (updateError) throw updateError;
  const won = (updated as { [k: string]: unknown } | null)?.[opts.linkColumn];
  if (won === groupId) return groupId;

  const { data: winner, error: winnerError } = await db
    .from(opts.parentTable)
    .select(opts.linkColumn)
    .eq('id', opts.parentId)
    .maybeSingle();
  if (winnerError) throw winnerError;
  const winnerId = (winner as { [k: string]: unknown } | null)?.[opts.linkColumn];
  if (typeof winnerId === 'string' && winnerId) {
    logger.warn('hangout group race lost; using winner', {
      parentTable: opts.parentTable,
      parentId: opts.parentId,
    });
    return winnerId;
  }
  return groupId;
}

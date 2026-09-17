import {
  isQuestionTestable,
  shuffleArray,
  scoreDuelAnswers,
} from '../utils/challengeScoring';
import type { GroupChallenge, ChallengeConfig, ChallengeParticipant } from '../types/challenges';
import type { User } from '../types';
import type { DataLayer } from './data';
import { cacheService } from './cache';
import { CacheKeys } from './cachePolicy';
import { logger } from '../utils/logger';

const CHALLENGE_EXPIRY_HOURS = 24;

/**
 * A `messages` row's type-specific content, as the client `Message` spells it:
 * TEXT carries `text`, QUESTION spreads `question_data`. Verbatim copy of the
 * facade's private `SupabaseService.parseMessageContent` — see the FIXED note
 * in `resolveQuestions` for why it is here rather than reached through a cast.
 */
export function parseChallengeMessageContent(msg: any): Record<string, unknown> {
  if (msg.type === 'TEXT') {
    return { type: 'TEXT', text: msg.text };
  } else if (msg.type === 'QUESTION') {
    return { type: 'QUESTION', ...msg.question_data };
  }
  return {};
}

export class ChallengeService {
  constructor(private data: DataLayer) {}

  private get db() {
    return this.data.getClient();
  }

  private async ensureGroupMember(groupId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  private async expireStalePending(): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .from('group_challenges')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', now);
  }

  private async fetchProfileBasics(userId: string) {
    const user = await this.data.users.getUserById(userId);
    if (!user) return { id: userId, name: 'Unknown', avatarUrl: undefined as string | undefined };
    return {
      id: userId,
      name: (user as any).name || 'Unknown',
      avatarUrl: (user as any).avatar_url || (user as any).avatarUrl,
    };
  }

  private async fetchProfilesBatch(
    userIds: string[]
  ): Promise<Map<string, { id: string; name: string; avatarUrl?: string }>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const map = new Map<string, { id: string; name: string; avatarUrl?: string }>();
    if (!unique.length) return map;

    const { data, error } = await this.db
      .from('profiles')
      .select('id, name, avatar_url')
      .in('id', unique);

    if (error) {
      logger.warn('Batch profile fetch failed, falling back to empty names', { error: error.message });
    }

    for (const row of data || []) {
      map.set(row.id, {
        id: row.id,
        name: row.name || 'Unknown',
        avatarUrl: row.avatar_url || undefined,
      });
    }
    for (const id of unique) {
      if (!map.has(id)) {
        map.set(id, { id, name: 'Unknown', avatarUrl: undefined });
      }
    }
    return map;
  }

  private profileFromMap(
    profileMap: Map<string, { id: string; name: string; avatarUrl?: string }>,
    userId: string
  ) {
    return profileMap.get(userId) || { id: userId, name: 'Unknown', avatarUrl: undefined };
  }

  /**
   * Load question candidates for duel creation without the chat-page pipeline
   * (reply previews, thread counts, profiles). That path was the main create latency.
   */
  private async loadCandidateQuestions(groupId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('messages')
      .select('id, group_id, type, question_data, upvotes, downvotes, is_archived, image_url, timestamp')
      .eq('group_id', groupId)
      .eq('type', 'QUESTION')
      .eq('is_archived', false)
      .order('timestamp', { ascending: false })
      .limit(500);

    if (error) throw error;

    return (data || []).map((msg: any) => {
      const questionData =
        msg.question_data && typeof msg.question_data === 'object' ? msg.question_data : {};
      return {
        id: msg.id,
        groupId: msg.group_id,
        type: msg.type || 'QUESTION',
        upvotes: msg.upvotes || 0,
        downvotes: msg.downvotes || 0,
        isArchived: !!msg.is_archived,
        imageUrl: msg.image_url,
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
        ...questionData,
      };
    });
  }

  private async invalidateChallengeCaches(...userIds: string[]): Promise<void> {
    // PERF-01: scoped per-user list keys only — never wipe global challenges:*.
    const unique = [...new Set(userIds.filter(Boolean))];
    const statuses = ['all', 'pending', 'accepted', 'completed', 'declined', 'cancelled', 'expired'];
    await Promise.all(
      unique.flatMap((userId) => [
        cacheService.deletePattern(`challenges:list:${userId}:*`),
        ...statuses.map((status) => cacheService.delete(CacheKeys.challengeList(userId, status))),
      ])
    );
  }

  private async resolveQuestions(questionIds: string[]): Promise<any[]> {
    if (!questionIds.length) return [];
    const { data, error } = await this.db
      .from('messages')
      .select(`
        id, group_id, sender_id, type, text, question_data, timestamp,
        upvotes, downvotes, is_archived, image_url,
        profiles!sender_id ( id, name, avatar_url )
      `)
      .in('id', questionIds);

    if (error) throw error;

    const byId = new Map<string, any>();
    for (const msg of data || []) {
      // FIXED (hotfix after #92): this read `(this.data as any).parseMessageContent`.
      // `this.data` became a `DataLayer` in #92, which has no such member — it
      // was a PRIVATE method of the `SupabaseService` facade, reached through an
      // `any` cast, so tsc could not see the break and every challenge question
      // resolution threw `parseMessageContent is not a function`. The body is
      // pure, so it lives here until the facade-deletion lane publishes it as
      // `data.mappers.parseMessageContent`.
      const parsed = parseChallengeMessageContent(msg);
      const mapped = {
        id: msg.id,
        groupId: msg.group_id,
        sender: {
          id: (msg.profiles as any)?.id || msg.sender_id,
          name: (msg.profiles as any)?.name || 'Unknown',
          avatarUrl: (msg.profiles as any)?.avatar_url,
          points: 0,
          badges: [],
          stats: {},
        },
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
        flaggedAsSimilarUserIds: [],
        upvotes: msg.upvotes || 0,
        downvotes: msg.downvotes || 0,
        isArchived: msg.is_archived || false,
        imageUrl: msg.image_url,
        type: msg.type || 'TEXT',
        ...parsed,
      };
      if (isQuestionTestable(mapped as any)) {
        byId.set(msg.id, mapped);
      }
    }

    return questionIds
      .map((id, i) => {
        const q = byId.get(id);
        return q ? { ...q, questionNumber: i + 1 } : null;
      })
      .filter(Boolean) as any[];
  }

  private mapParticipant(row: any, profile?: { name?: string; avatarUrl?: string }): ChallengeParticipant {
    return {
      userId: row.user_id,
      score: row.score ?? 0,
      totalTime: Number(row.total_time ?? 0),
      correctCount: row.correct_count ?? 0,
      maxStreak: row.max_streak ?? 0,
      answers: row.answers || {},
      finishedAt: row.finished_at || undefined,
      name: profile?.name,
      avatarUrl: profile?.avatarUrl,
    };
  }

  private async mapChallenge(
    row: any,
    viewerId: string,
    options?: {
      profileMap?: Map<string, { id: string; name: string; avatarUrl?: string }>;
      participantRows?: any[];
      skipQuestions?: boolean;
    }
  ): Promise<GroupChallenge> {
    const questionIds: string[] = Array.isArray(row.question_ids) ? row.question_ids : [];
    const profileMap = options?.profileMap;
    const challenger = profileMap
      ? this.profileFromMap(profileMap, row.challenger_id)
      : await this.fetchProfileBasics(row.challenger_id);
    const opponent = profileMap
      ? this.profileFromMap(profileMap, row.opponent_id)
      : await this.fetchProfileBasics(row.opponent_id);

    let participantRows = options?.participantRows;
    if (!participantRows) {
      const { data } = await this.db
        .from('challenge_participants')
        .select('*')
        .eq('challenge_id', row.id);
      participantRows = data || [];
    }

    const participants = profileMap
      ? (participantRows || []).map((p: any) =>
          this.mapParticipant(p, this.profileFromMap(profileMap, p.user_id))
        )
      : await Promise.all(
          (participantRows || []).map(async (p: any) => {
            const prof = await this.fetchProfileBasics(p.user_id);
            return this.mapParticipant(p, prof);
          })
        );

    const myParticipant = participants.find((p: ChallengeParticipant) => p.userId === viewerId);
    const opponentParticipant = participants.find((p: ChallengeParticipant) => p.userId !== viewerId);

    const canSeeOpponentAnswers = row.status === 'completed' && opponentParticipant?.finishedAt;
    const questions =
      !options?.skipQuestions &&
      (row.status === 'accepted' || row.status === 'completed')
        ? await this.resolveQuestions(questionIds)
        : undefined;

    return {
      id: row.id,
      groupId: row.group_id,
      challengerId: row.challenger_id,
      opponentId: row.opponent_id,
      status: row.status,
      config: row.config || {},
      questionIds,
      questions,
      winnerId: row.winner_id || undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      completedAt: row.completed_at || undefined,
      challenger,
      opponent,
      participants: canSeeOpponentAnswers ? participants : myParticipant ? [myParticipant] : participants,
      myParticipant,
      opponentParticipant: canSeeOpponentAnswers ? opponentParticipant : opponentParticipant?.finishedAt ? {
        ...opponentParticipant,
        answers: {},
      } : opponentParticipant,
    };
  }

  private async findPendingChallenge(
    groupId: string,
    challengerId: string,
    opponentId: string
  ): Promise<any | null> {
    const { data, error } = await this.db
      .from('group_challenges')
      .select('*')
      .eq('group_id', groupId)
      .eq('challenger_id', challengerId)
      .eq('opponent_id', opponentId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  private async ensureChallengeInviteNotification(challenge: any): Promise<void> {
    const { data: existing, error } = await this.db
      .from('notifications')
      .select('id')
      .eq('user_id', challenge.opponent_id)
      .eq('type', 'challenge_invite')
      .contains('data', { challengeId: challenge.id })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (existing) return;

    const challengerProfile = await this.fetchProfileBasics(challenge.challenger_id);
    try {
      await this.data.notifications.createNotification(challenge.opponent_id, {
        type: 'challenge_invite',
        message: `${challengerProfile.name} challenged you to a duel!`,
        link: `challenge:${challenge.id}`,
        data: {
          challengeId: challenge.id,
          groupId: challenge.group_id,
          challengerId: challenge.challenger_id,
        },
      });
    } catch (notificationError: any) {
      // The database uniqueness boundary makes concurrent notification creation
      // an idempotent replay rather than a second visible invite.
      if (notificationError?.code !== '23505') throw notificationError;
    }
  }

  async createChallenge(
    challengerId: string,
    payload: { groupId: string; opponentId: string; config: ChallengeConfig }
  ): Promise<GroupChallenge> {
    await this.expireStalePending();

    const { groupId, opponentId, config } = payload;
    if (challengerId === opponentId) {
      throw Object.assign(new Error('Cannot challenge yourself'), { statusCode: 400 });
    }

    const [challengerMember, opponentMember] = await Promise.all([
      this.ensureGroupMember(groupId, challengerId),
      this.ensureGroupMember(groupId, opponentId),
    ]);
    if (!challengerMember || !opponentMember) {
      throw Object.assign(new Error('Both users must be group members'), { statusCode: 403 });
    }

    const existingPending = await this.findPendingChallenge(groupId, challengerId, opponentId);
    if (existingPending) {
      await this.ensureChallengeInviteNotification(existingPending);
      const profileMap = await this.fetchProfilesBatch([
        existingPending.challenger_id,
        existingPending.opponent_id,
      ]);
      return this.mapChallenge(existingPending, challengerId, {
        profileMap,
        participantRows: [],
        skipQuestions: true,
      });
    }

    const messages = await this.loadCandidateQuestions(groupId);
    const candidateQuestions = messages.filter(
      (msg) =>
        isQuestionTestable(msg as any) &&
        (!config.allowedQuestionTypes?.length ||
          config.allowedQuestionTypes.includes(String((msg as any).questionType))) &&
        (!config.selectedTags?.length ||
          (msg as any).tags?.some((tag: string) => config.selectedTags!.includes(tag)))
    );

    if (candidateQuestions.length < config.numberOfQuestions) {
      throw Object.assign(
        new Error(`Not enough questions. Found ${candidateQuestions.length}, need ${config.numberOfQuestions}.`),
        { statusCode: 400 }
      );
    }

    const selected = shuffleArray(candidateQuestions).slice(0, config.numberOfQuestions);
    const questionIds = selected.map((q: any) => q.id);
    const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

    const { data: insertedChallenge, error } = await this.db
      .from('group_challenges')
      .insert({
        group_id: groupId,
        challenger_id: challengerId,
        opponent_id: opponentId,
        status: 'pending',
        config,
        question_ids: questionIds,
        expires_at: expiresAt,
      })
      .select()
      .single();

    let challenge = insertedChallenge;
    if (error) {
      if (error.code === '23505') {
        challenge = await this.findPendingChallenge(groupId, challengerId, opponentId);
      }
      if (!challenge) throw error;
    }

    // Invite + cache invalidation after insert; keep invite awaited for delivery integrity.
    await this.ensureChallengeInviteNotification(challenge);
    void this.invalidateChallengeCaches(challengerId, opponentId).catch((err) => {
      logger.warn('Failed to invalidate challenge caches after create', { err });
    });

    const profileMap = await this.fetchProfilesBatch([
      challenge.challenger_id,
      challenge.opponent_id,
    ]);
    return this.mapChallenge(challenge, challengerId, {
      profileMap,
      participantRows: [],
      skipQuestions: true,
    });
  }

  async listChallenges(userId: string, status?: string): Promise<GroupChallenge[]> {
    await this.expireStalePending();

    let query = this.db
      .from('group_challenges')
      .select('*')
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    if (!rows.length) return [];

    const challengeIds = rows.map((r: any) => r.id);
    const { data: allParticipantRows } = await this.db
      .from('challenge_participants')
      .select('*')
      .in('challenge_id', challengeIds);

    const participantsByChallenge = new Map<string, any[]>();
    for (const p of allParticipantRows || []) {
      const list = participantsByChallenge.get(p.challenge_id) || [];
      list.push(p);
      participantsByChallenge.set(p.challenge_id, list);
    }

    const profileIds = [
      ...rows.flatMap((r: any) => [r.challenger_id, r.opponent_id]),
      ...(allParticipantRows || []).map((p: any) => p.user_id),
    ];
    const profileMap = await this.fetchProfilesBatch(profileIds);

    return Promise.all(
      rows.map((row: any) =>
        this.mapChallenge(row, userId, {
          profileMap,
          participantRows: participantsByChallenge.get(row.id) || [],
          skipQuestions: true,
        })
      )
    );
  }

  async getChallenge(challengeId: string, userId: string): Promise<GroupChallenge | null> {
    await this.expireStalePending();

    const { data, error } = await this.db
      .from('group_challenges')
      .select('*')
      .eq('id', challengeId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    if (data.challenger_id !== userId && data.opponent_id !== userId) return null;

    if (data.status === 'pending' && new Date(data.expires_at) < new Date()) {
      await this.db.from('group_challenges').update({ status: 'expired' }).eq('id', challengeId);
      data.status = 'expired';
    }

    const { data: participantRows } = await this.db
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', challengeId);

    const profileIds = [
      data.challenger_id,
      data.opponent_id,
      ...(participantRows || []).map((p: { user_id: string }) => p.user_id),
    ];
    const profileMap = await this.fetchProfilesBatch(profileIds);

    return this.mapChallenge(data, userId, {
      profileMap,
      participantRows: participantRows || [],
    });
  }

  async acceptChallenge(challengeId: string, userId: string): Promise<GroupChallenge> {
    const challenge = await this.getChallenge(challengeId, userId);
    if (!challenge) throw Object.assign(new Error('Challenge not found'), { statusCode: 404 });
    if (challenge.opponentId !== userId) throw Object.assign(new Error('Only the opponent can accept'), { statusCode: 403 });
    if (challenge.status !== 'pending') throw Object.assign(new Error(`Challenge is ${challenge.status}`), { statusCode: 400 });

    // RC-02: only one of accept/decline can win the pending → accepted transition.
    const { data, error } = await this.db
      .from('group_challenges')
      .update({ status: 'accepted' })
      .eq('id', challengeId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw Object.assign(new Error('Challenge is no longer pending'), { statusCode: 409 });
    }

    const opponentName = challenge.opponent?.name || 'Opponent';
    void this.data.notifications
      .createNotification(challenge.challengerId, {
        type: 'challenge_accepted',
        message: `${opponentName} accepted your duel challenge!`,
        link: `challenge:${challengeId}`,
        data: { challengeId, groupId: challenge.groupId },
      })
      .catch((err) => {
        logger.warn('Failed to notify challenger of accept', { challengeId, err });
      });

    void this.invalidateChallengeCaches(challenge.challengerId, challenge.opponentId).catch((err) => {
      logger.warn('Failed to invalidate challenge caches after accept', { challengeId, err });
    });

    // Play setup loads questions via GET /:id; skip them here to keep accept snappy.
    const profileMap = await this.fetchProfilesBatch([data.challenger_id, data.opponent_id]);
    return this.mapChallenge(data, userId, {
      profileMap,
      participantRows: [],
      skipQuestions: true,
    });
  }

  async declineChallenge(challengeId: string, userId: string): Promise<GroupChallenge> {
    const challenge = await this.getChallenge(challengeId, userId);
    if (!challenge) throw Object.assign(new Error('Challenge not found'), { statusCode: 404 });
    if (challenge.opponentId !== userId) throw Object.assign(new Error('Only the opponent can decline'), { statusCode: 403 });
    if (challenge.status !== 'pending') throw Object.assign(new Error(`Challenge is ${challenge.status}`), { statusCode: 400 });

    // RC-02: conditional transition so concurrent accept cannot be overwritten.
    const { data, error } = await this.db
      .from('group_challenges')
      .update({ status: 'declined' })
      .eq('id', challengeId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw Object.assign(new Error('Challenge is no longer pending'), { statusCode: 409 });
    }

    const opponentName = challenge.opponent?.name || 'Opponent';
    void this.data.notifications
      .createNotification(challenge.challengerId, {
        type: 'challenge_declined',
        message: `${opponentName} declined your duel challenge.`,
        link: `challenge:${challengeId}`,
        data: { challengeId, groupId: challenge.groupId },
      })
      .catch((err) => {
        logger.warn('Failed to notify challenger of decline', { challengeId, err });
      });

    void this.invalidateChallengeCaches(challenge.challengerId, challenge.opponentId).catch((err) => {
      logger.warn('Failed to invalidate challenge caches after decline', { challengeId, err });
    });

    const profileMap = await this.fetchProfilesBatch([data.challenger_id, data.opponent_id]);
    return this.mapChallenge(data, userId, {
      profileMap,
      participantRows: [],
      skipQuestions: true,
    });
  }

  private computeWinner(
    challengerId: string,
    opponentId: string,
    a: ChallengeParticipant,
    b: ChallengeParticipant
  ): string | undefined {
    if (a.score > b.score) return a.userId;
    if (b.score > a.score) return b.userId;
    if (a.totalTime < b.totalTime) return a.userId;
    if (b.totalTime < a.totalTime) return b.userId;
    if (a.finishedAt && b.finishedAt) {
      return new Date(a.finishedAt) < new Date(b.finishedAt) ? a.userId : opponentId;
    }
    return undefined;
  }

  private async awardWinner(winnerId: string): Promise<void> {
    await this.data.gamification.incrementUserStatsAndAwardBadges(winnerId, { gamesWon: 1 });
  }

  private async recordDuelActivity(challengerId: string, opponentId: string): Promise<void> {
    await Promise.all([
      this.data.gamification.recordStudyActivity(challengerId, 'game', 1).catch((err) => {
        logger.warn('Failed to record duel activity for challenger', { challengerId, err });
      }),
      this.data.gamification.recordStudyActivity(opponentId, 'game', 1).catch((err) => {
        logger.warn('Failed to record duel activity for opponent', { opponentId, err });
      }),
    ]);
  }

  async submitChallenge(
    challengeId: string,
    userId: string,
    answers: Record<string, any>
  ): Promise<GroupChallenge & { gamification?: Awaited<ReturnType<DataLayer['gamification']['syncGamificationProgress']>> }> {
    const challenge = await this.getChallenge(challengeId, userId);
    if (!challenge) throw Object.assign(new Error('Challenge not found'), { statusCode: 404 });
    if (challenge.status !== 'accepted') {
      throw Object.assign(new Error('Challenge must be accepted before submitting'), { statusCode: 400 });
    }

    const questions = await this.resolveQuestions(challenge.questionIds);
    const scored = scoreDuelAnswers(questions, answers);
    const finishedAt = new Date().toISOString();

    const { error: upsertError } = await this.db
      .from('challenge_participants')
      .upsert({
        challenge_id: challengeId,
        user_id: userId,
        score: scored.score,
        total_time: scored.totalTime,
        correct_count: scored.correctCount,
        max_streak: scored.maxStreak,
        answers,
        finished_at: finishedAt,
      }, { onConflict: 'challenge_id,user_id' });

    if (upsertError) throw upsertError;

    const { data: allParticipants, error: partError } = await this.db
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', challengeId);

    if (partError) throw partError;

    const finished = (allParticipants || []).filter(p => p.finished_at);
    const bothDone =
      finished.length >= 2 &&
      finished.some(p => p.user_id === challenge.challengerId) &&
      finished.some(p => p.user_id === challenge.opponentId);

    if (bothDone) {
      const challengerPart = this.mapParticipant(
        allParticipants!.find(p => p.user_id === challenge.challengerId)!
      );
      const opponentPart = this.mapParticipant(
        allParticipants!.find(p => p.user_id === challenge.opponentId)!
      );
      const winnerId = this.computeWinner(
        challenge.challengerId,
        challenge.opponentId,
        challengerPart,
        opponentPart
      );

      // RC-03: only the first accepted → completed transition awards / notifies.
      const { data: completed, error: completeError } = await this.db
        .from('group_challenges')
        .update({
          status: 'completed',
          winner_id: winnerId || null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', challengeId)
        .eq('status', 'accepted')
        .select()
        .maybeSingle();

      if (completeError) throw completeError;

      if (!completed) {
        await this.invalidateChallengeCaches(challenge.challengerId, challenge.opponentId);
        const settled = await this.getChallenge(challengeId, userId);
        if (!settled) throw Object.assign(new Error('Challenge not found'), { statusCode: 404 });
        return settled;
      }

      if (winnerId) {
        await this.awardWinner(winnerId);
      }

      await this.recordDuelActivity(challenge.challengerId, challenge.opponentId);

      // Phase 3 M: completed_challenge had no feed writer. Same guard as the
      // connections below — past the `if (!completed)` CAS check, so a replay
      // cannot double-post.
      {
        const { getActivityFeedService } = await import('./activityFeed');
        // TRANSITIONAL (M2d): `getActivityFeedService` still takes the `SupabaseService` facade whole.
        await getActivityFeedService(this.data.legacyService).record({
          actorId: userId,
          verb: 'completed_challenge',
          objectType: 'challenge',
          objectId: challengeId,
          audienceType: 'group',
          audienceId: challenge.groupId,
        });
      }

      // North-star metric (Phase 3 · O). A duel is mutual: each player gave the
      // other someone to practise against, so BOTH directions are recorded.
      // Writing the pair also makes an actor/beneficiary inversion impossible
      // here by construction. Only reachable past the `if (!completed)` guard
      // above, so a replayed request cannot double-write.
      {
        const { getLearningConnectionsService } = await import('./learningConnections');
        // TRANSITIONAL (M2d): `getLearningConnectionsService` still takes the `SupabaseService` facade whole.
        const connections = getLearningConnectionsService(this.data.legacyService);
        await Promise.all([
          connections.record({
            actorId: challenge.challengerId,
            beneficiaryId: challenge.opponentId,
            kind: 'challenge_completed',
            objectType: 'challenge',
            objectId: challengeId,
          }),
          connections.record({
            actorId: challenge.opponentId,
            beneficiaryId: challenge.challengerId,
            kind: 'challenge_completed',
            objectType: 'challenge',
            objectId: challengeId,
          }),
        ]);
      }

      const [challengerProfile, opponentProfile] = await Promise.all([
        this.fetchProfileBasics(challenge.challengerId),
        this.fetchProfileBasics(challenge.opponentId),
      ]);

      const resultMessage = winnerId
        ? `${winnerId === challenge.challengerId ? challengerProfile.name : opponentProfile.name} won the duel!`
        : 'The duel ended in a draw!';

      await Promise.all([
        this.data.notifications.createNotification(challenge.challengerId, {
          type: 'challenge_result',
          message: resultMessage,
          link: `challenge:${challengeId}`,
          data: { challengeId, winnerId, groupId: challenge.groupId },
        }),
        this.data.notifications.createNotification(challenge.opponentId, {
          type: 'challenge_result',
          message: resultMessage,
          link: `challenge:${challengeId}`,
          data: { challengeId, winnerId, groupId: challenge.groupId },
        }),
      ]);

      await this.invalidateChallengeCaches(challenge.challengerId, challenge.opponentId);
      const gamification = await this.data.gamification.syncGamificationProgress(userId).catch((err) => {
        logger.warn('Failed to sync gamification after duel completion', { userId, err });
        return undefined;
      });
      return {
        ...this.mapChallenge(completed, userId),
        ...(gamification ? { gamification } : {}),
      };
    }

    // Notify opponent that user finished (optional lightweight notification)
    const otherUserId = userId === challenge.challengerId ? challenge.opponentId : challenge.challengerId;
    const myProfile = await this.fetchProfileBasics(userId);
    const otherPart = allParticipants?.find(p => p.user_id === otherUserId);
    if (!otherPart?.finished_at) {
      await this.data.notifications.createNotification(otherUserId, {
        type: 'challenge_opponent_finished',
        message: `${myProfile.name} finished their duel attempt. Your turn!`,
        link: `challenge:${challengeId}`,
        data: { challengeId, groupId: challenge.groupId },
      });
    }

    await this.invalidateChallengeCaches(challenge.challengerId, challenge.opponentId);
    const { data: refreshed } = await this.db.from('group_challenges').select('*').eq('id', challengeId).single();
    return this.mapChallenge(refreshed, userId);
  }

  async forfeitChallenge(challengeId: string, userId: string): Promise<GroupChallenge> {
    const challenge = await this.getChallenge(challengeId, userId);
    if (!challenge) throw Object.assign(new Error('Challenge not found'), { statusCode: 404 });
    if (challenge.challengerId !== userId && challenge.opponentId !== userId) {
      throw Object.assign(new Error('Not a participant in this challenge'), { statusCode: 403 });
    }
    if (challenge.status !== 'accepted') {
      throw Object.assign(new Error(`Challenge cannot be forfeited while ${challenge.status}`), { statusCode: 400 });
    }

    const winnerId = userId === challenge.challengerId ? challenge.opponentId : challenge.challengerId;
    const now = new Date().toISOString();

    const { data, error } = await this.db
      .from('group_challenges')
      .update({
        status: 'cancelled',
        winner_id: winnerId,
        completed_at: now,
      })
      .eq('id', challengeId)
      .eq('status', 'accepted')
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw Object.assign(new Error('Challenge can no longer be forfeited'), { statusCode: 409 });
    }

    await this.awardWinner(winnerId);
    await this.recordDuelActivity(challenge.challengerId, challenge.opponentId);

    const quitterProfile = await this.fetchProfileBasics(userId);

    await this.data.notifications.createNotification(winnerId, {
      type: 'challenge_result',
      message: `${quitterProfile.name} left the duel. You win by default!`,
      link: `challenge:${challengeId}`,
      data: { challengeId, winnerId, groupId: challenge.groupId, forfeit: true },
    });

    logger.info('Challenge forfeited', { challengeId, userId, winnerId });

    await this.invalidateChallengeCaches(challenge.challengerId, challenge.opponentId);
    return this.mapChallenge(data, userId);
  }
}

import {
  isQuestionTestable,
  shuffleArray,
  scoreDuelAnswers,
  checkAndAwardBadges,
} from '../utils/challengeScoring';
import type { GroupChallenge, ChallengeConfig, ChallengeParticipant } from '../types/challenges';
import type { User } from '../types';
import { SupabaseService } from './supabase';
import { cacheService } from './cache';
import { logger } from '../utils/logger';

const CHALLENGE_EXPIRY_HOURS = 24;

export class ChallengeService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
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
    const user = await this.supabaseService.getUserById(userId);
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
      const parsed = (this.supabaseService as any).parseMessageContent(msg);
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

    const messages = await this.supabaseService.getGroupMessages(groupId, { limit: 500, page: 1 });
    const candidateQuestions = messages.filter(msg =>
      isQuestionTestable(msg as any) &&
      (!config.allowedQuestionTypes?.length || config.allowedQuestionTypes.includes(String((msg as any).questionType))) &&
      (!config.selectedTags?.length || (msg as any).tags?.some((tag: string) => config.selectedTags!.includes(tag)))
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

    const { data: challenge, error } = await this.db
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

    if (error) throw error;

    const challengerProfile = await this.fetchProfileBasics(challengerId);
    await this.supabaseService.createNotification(opponentId, {
      type: 'challenge_invite',
      message: `${challengerProfile.name} challenged you to a duel!`,
      link: `challenge:${challenge.id}`,
      data: { challengeId: challenge.id, groupId, challengerId },
    });

    await cacheService.deletePattern(`challenges:${challengerId}:*`);
    await cacheService.deletePattern(`challenges:${opponentId}:*`);

    return this.mapChallenge(challenge, challengerId);
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

    return this.mapChallenge(data, userId);
  }

  async acceptChallenge(challengeId: string, userId: string): Promise<GroupChallenge> {
    const challenge = await this.getChallenge(challengeId, userId);
    if (!challenge) throw Object.assign(new Error('Challenge not found'), { statusCode: 404 });
    if (challenge.opponentId !== userId) throw Object.assign(new Error('Only the opponent can accept'), { statusCode: 403 });
    if (challenge.status !== 'pending') throw Object.assign(new Error(`Challenge is ${challenge.status}`), { statusCode: 400 });

    const { data, error } = await this.db
      .from('group_challenges')
      .update({ status: 'accepted' })
      .eq('id', challengeId)
      .select()
      .single();

    if (error) throw error;

    const opponentProfile = await this.fetchProfileBasics(userId);
    await this.supabaseService.createNotification(challenge.challengerId, {
      type: 'challenge_accepted',
      message: `${opponentProfile.name} accepted your duel challenge!`,
      link: `challenge:${challengeId}`,
      data: { challengeId, groupId: challenge.groupId },
    });

    await cacheService.deletePattern(`challenges:*`);

    return this.mapChallenge(data, userId);
  }

  async declineChallenge(challengeId: string, userId: string): Promise<GroupChallenge> {
    const challenge = await this.getChallenge(challengeId, userId);
    if (!challenge) throw Object.assign(new Error('Challenge not found'), { statusCode: 404 });
    if (challenge.opponentId !== userId) throw Object.assign(new Error('Only the opponent can decline'), { statusCode: 403 });
    if (challenge.status !== 'pending') throw Object.assign(new Error(`Challenge is ${challenge.status}`), { statusCode: 400 });

    const { data, error } = await this.db
      .from('group_challenges')
      .update({ status: 'declined' })
      .eq('id', challengeId)
      .select()
      .single();

    if (error) throw error;

    const opponentProfile = await this.fetchProfileBasics(userId);
    await this.supabaseService.createNotification(challenge.challengerId, {
      type: 'challenge_declined',
      message: `${opponentProfile.name} declined your duel challenge.`,
      link: `challenge:${challengeId}`,
      data: { challengeId, groupId: challenge.groupId },
    });

    await cacheService.deletePattern(`challenges:*`);

    return this.mapChallenge(data, userId);
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
    const raw = await this.supabaseService.getUserById(winnerId);
    if (!raw) return;

    const row = raw as any;
    const user: User = {
      id: row.id,
      name: row.name,
      points: row.points || 0,
      badges: row.badges || [],
      stats: row.stats || {},
      avatarUrl: row.avatar_url || row.avatarUrl,
    };

    const stats = { ...(user.stats || {}), gamesWon: (user.stats?.gamesWon || 0) + 1 };
    const { updatedUser } = checkAndAwardBadges({ ...user, stats });
    await this.supabaseService.updateUser(winnerId, {
      stats: updatedUser.stats,
      badges: updatedUser.badges,
      points: updatedUser.points,
    });
  }

  async submitChallenge(
    challengeId: string,
    userId: string,
    answers: Record<string, any>
  ): Promise<GroupChallenge> {
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

      const { data: completed, error: completeError } = await this.db
        .from('group_challenges')
        .update({
          status: 'completed',
          winner_id: winnerId || null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', challengeId)
        .select()
        .single();

      if (completeError) throw completeError;

      if (winnerId) {
        await this.awardWinner(winnerId);
      }

      const [challengerProfile, opponentProfile] = await Promise.all([
        this.fetchProfileBasics(challenge.challengerId),
        this.fetchProfileBasics(challenge.opponentId),
      ]);

      const resultMessage = winnerId
        ? `${winnerId === challenge.challengerId ? challengerProfile.name : opponentProfile.name} won the duel!`
        : 'The duel ended in a draw!';

      await Promise.all([
        this.supabaseService.createNotification(challenge.challengerId, {
          type: 'challenge_result',
          message: resultMessage,
          link: `challenge:${challengeId}`,
          data: { challengeId, winnerId, groupId: challenge.groupId },
        }),
        this.supabaseService.createNotification(challenge.opponentId, {
          type: 'challenge_result',
          message: resultMessage,
          link: `challenge:${challengeId}`,
          data: { challengeId, winnerId, groupId: challenge.groupId },
        }),
      ]);

      await cacheService.deletePattern(`challenges:*`);
      return this.mapChallenge(completed, userId);
    }

    // Notify opponent that user finished (optional lightweight notification)
    const otherUserId = userId === challenge.challengerId ? challenge.opponentId : challenge.challengerId;
    const myProfile = await this.fetchProfileBasics(userId);
    const otherPart = allParticipants?.find(p => p.user_id === otherUserId);
    if (!otherPart?.finished_at) {
      await this.supabaseService.createNotification(otherUserId, {
        type: 'challenge_opponent_finished',
        message: `${myProfile.name} finished their duel attempt. Your turn!`,
        link: `challenge:${challengeId}`,
        data: { challengeId, groupId: challenge.groupId },
      });
    }

    await cacheService.deletePattern(`challenges:*`);
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
      .select()
      .single();

    if (error) throw error;

    await this.awardWinner(winnerId);

    const [quitterProfile, winnerProfile] = await Promise.all([
      this.fetchProfileBasics(userId),
      this.fetchProfileBasics(winnerId),
    ]);

    await this.supabaseService.createNotification(winnerId, {
      type: 'challenge_result',
      message: `${quitterProfile.name} left the duel. You win by default!`,
      link: `challenge:${challengeId}`,
      data: { challengeId, winnerId, groupId: challenge.groupId, forfeit: true },
    });

    logger.info('Challenge forfeited', { challengeId, userId, winnerId });

    await cacheService.deletePattern(`challenges:*`);
    return this.mapChallenge(data, userId);
  }
}

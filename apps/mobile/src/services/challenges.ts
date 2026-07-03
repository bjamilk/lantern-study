import type { GroupChallenge, ChallengeConfig, UserAnswerRecord } from '@lantern/shared/types';
import { api } from './api';

export async function createChallenge(payload: {
  groupId: string;
  opponentId: string;
  config: ChallengeConfig;
}): Promise<GroupChallenge> {
  return api.createChallenge(payload) as Promise<GroupChallenge>;
}

export async function fetchChallenges(status?: string): Promise<GroupChallenge[]> {
  return api.fetchChallenges(status) as Promise<GroupChallenge[]>;
}

export async function fetchChallenge(challengeId: string): Promise<GroupChallenge> {
  return api.fetchChallenge(challengeId) as Promise<GroupChallenge>;
}

export async function acceptChallenge(challengeId: string): Promise<GroupChallenge> {
  return api.acceptChallenge(challengeId) as Promise<GroupChallenge>;
}

export async function declineChallenge(challengeId: string): Promise<GroupChallenge> {
  return api.declineChallenge(challengeId) as Promise<GroupChallenge>;
}

export async function submitChallenge(
  challengeId: string,
  answers: Record<string, UserAnswerRecord>
): Promise<GroupChallenge> {
  return api.submitChallenge(challengeId, answers) as Promise<GroupChallenge>;
}

export async function forfeitChallenge(challengeId: string): Promise<GroupChallenge> {
  return api.forfeitChallenge(challengeId) as Promise<GroupChallenge>;
}

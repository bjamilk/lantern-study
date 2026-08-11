import type { GroupChallenge, ChallengeConfig, UserAnswerRecord } from '@lantern/shared/types';
import { api } from './api';

export async function createChallenge(payload: {
  groupId: string;
  opponentId: string;
  config: ChallengeConfig;
}): Promise<GroupChallenge> {
  return api.createChallenge(payload);
}

export async function fetchChallenges(status?: string): Promise<GroupChallenge[]> {
  return api.fetchChallenges(status);
}

export async function fetchChallenge(challengeId: string): Promise<GroupChallenge> {
  return api.fetchChallenge(challengeId);
}

export async function acceptChallenge(challengeId: string): Promise<GroupChallenge> {
  return api.acceptChallenge(challengeId);
}

export async function declineChallenge(challengeId: string): Promise<GroupChallenge> {
  return api.declineChallenge(challengeId);
}

export async function submitChallenge(
  challengeId: string,
  answers: Record<string, UserAnswerRecord>
): Promise<GroupChallenge> {
  return api.submitChallenge(challengeId, answers);
}

export async function forfeitChallenge(challengeId: string): Promise<GroupChallenge> {
  return api.forfeitChallenge(challengeId);
}

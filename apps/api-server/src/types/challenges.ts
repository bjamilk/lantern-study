export type ChallengeStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'completed'
  | 'cancelled';

export interface ChallengeConfig {
  numberOfQuestions: number;
  allowedQuestionTypes?: string[];
  selectedTags?: string[];
}

export interface ChallengeParticipant {
  userId: string;
  score: number;
  totalTime: number;
  correctCount: number;
  maxStreak: number;
  answers: Record<string, any>;
  finishedAt?: string;
  name?: string;
  avatarUrl?: string;
}

export interface GroupChallenge {
  id: string;
  groupId: string;
  challengerId: string;
  opponentId: string;
  status: ChallengeStatus;
  config: ChallengeConfig;
  questionIds: string[];
  questions?: any[];
  winnerId?: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  challenger?: { id: string; name: string; avatarUrl?: string };
  opponent?: { id: string; name: string; avatarUrl?: string };
  participants?: ChallengeParticipant[];
  myParticipant?: ChallengeParticipant;
  opponentParticipant?: ChallengeParticipant;
}

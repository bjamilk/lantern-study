import { User } from '../types';

export {
    initialUserStats,
    shuffleArray,
    checkAndAwardBadges,
    checkAnswerIsCorrect,
    isQuestionTestable,
    createShuffledQuestionSet,
    shuffleQuestionOptionsOnly,
    computeDuelQuestionPoints,
    isUserAnswerAnswered,
    lockedIdsAfterLeaving,
    nearestPreviousUnlockedIndex,
} from '@lantern/shared/utils';

// --- MOCK DATA ---
export const MOCK_USERS: User[] = import.meta.env.DEV ? [
  {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Alice Johnson',
    avatarUrl: `https://ui-avatars.com/api/?name=Alice+Johnson&background=random&color=fff&size=100`,
    email: 'alice@example.com',
    password: 'dev-mock-placeholder', // DEV-only mock user; never used for auth
    phoneNumber: '123-456-7890',
    points: 1250,
    badges: [],
    stats: { testsCompleted: 5, questionsCreated: 10, groupsCreated: 2, highScoreTests: 3, perfectScoreTests: 1, gamesWon: 2 },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Bob Williams',
    avatarUrl: `https://ui-avatars.com/api/?name=Bob+Williams&background=random&color=fff&size=100`,
    email: 'bob@example.com',
    password: 'dev-mock-placeholder', // DEV-only mock user; never used for auth
    phoneNumber: '234-567-8901',
    points: 800,
    badges: [],
    stats: { testsCompleted: 3, questionsCreated: 5, groupsCreated: 1, highScoreTests: 1, perfectScoreTests: 0, gamesWon: 1 },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'Charlie Brown',
    avatarUrl: `https://ui-avatars.com/api/?name=Charlie+Brown&background=random&color=fff&size=100`,
    email: 'charlie@example.com',
    password: 'dev-mock-placeholder', // DEV-only mock user; never used for auth
    phoneNumber: '345-678-9012',
    points: 200,
    badges: [],
    stats: { testsCompleted: 1, questionsCreated: 2, groupsCreated: 0, highScoreTests: 0, perfectScoreTests: 0, gamesWon: 0 },
  },
   {
    id: '550e8400-e29b-41d4-a716-446655440003',
    name: 'Diana Prince',
    avatarUrl: `https://ui-avatars.com/api/?name=Diana+Prince&background=random&color=fff&size=100`,
    email: 'diana@example.com',
    password: 'dev-mock-placeholder', // DEV-only mock user; never used for auth
    phoneNumber: '456-789-0123',
    points: 2500,
    badges: [],
    stats: { testsCompleted: 10, questionsCreated: 15, groupsCreated: 3, highScoreTests: 8, perfectScoreTests: 2, gamesWon: 5 },
  }
] : [];

export const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

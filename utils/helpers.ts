import { User, UserStats, Badge, Message, MessageType, QuestionType, QuestionStatus, TestQuestion, UserAnswerRecord, MatchingItem, DiagramLabel } from '../types';
import { BADGE_DEFINITIONS } from '../gamification';

// --- MOCK DATA ---
export const initialUserStats: UserStats = {
    testsCompleted: 0,
    questionsCreated: 0,
    groupsCreated: 0,
    highScoreTests: 0,
    perfectScoreTests: 0,
    gamesWon: 0,
    listingsCreated: 0,
    listingsSold: 0,
    fiveStarReviews: 0,
    offersMade: 0,
};

export const MOCK_USERS: User[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Alice Johnson',
    avatarUrl: `https://ui-avatars.com/api/?name=Alice+Johnson&background=random&color=fff&size=100`,
    email: 'alice@example.com',
    password: 'password123',
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
    password: 'password123',
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
    password: 'password123',
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
    password: 'password123',
    phoneNumber: '456-789-0123',
    points: 2500,
    badges: [],
    stats: { testsCompleted: 10, questionsCreated: 15, groupsCreated: 3, highScoreTests: 8, perfectScoreTests: 2, gamesWon: 5 },
  }
];

// FIX: Added a trailing comma to the generic type parameter to avoid being parsed as a JSX tag.
export const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

// --- Gamification Helper ---
const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export const checkAndAwardBadges = (user: User): { updatedUser: User, awardedBadges: Badge[] } => {
    const awardedBadges: Badge[] = [];
    const userBadges = user.badges ? JSON.parse(JSON.stringify(user.badges)) : [];
    let updatedUser = { ...user, badges: userBadges, points: user.points };

    for (const def of Object.values(BADGE_DEFINITIONS)) {
        if (def.metric === 'question_upvotes') continue;

        const currentStatValue = updatedUser.stats[def.metric as keyof UserStats] || 0;
        const currentBadge = updatedUser.badges.find((b: Badge) => b.id === def.id);
        const currentLevel = currentBadge?.level || 0;

        const nextLevel = def.levels.find(l => l.level === currentLevel + 1);

        if (nextLevel && currentStatValue >= nextLevel.threshold) {
            const newBadge: Badge = {
                id: def.id,
                level: nextLevel.level,
                name: `${def.baseName} ${ROMAN_NUMERALS[nextLevel.level - 1] || nextLevel.level}`,
                description: def.baseDescription(nextLevel.threshold),
                icon: def.icon,
                dateAwarded: new Date().toISOString(),
            };
            
            const badgeIndex = updatedUser.badges.findIndex((b: Badge) => b.id === def.id);
            if (badgeIndex > -1) {
                updatedUser.badges[badgeIndex] = newBadge;
            } else {
                updatedUser.badges.push(newBadge);
            }

            updatedUser.points += nextLevel.points;
            awardedBadges.push(newBadge);
        }
    }

    return { updatedUser, awardedBadges };
};

// --- Question Helpers ---
export const isQuestionTestable = (msg: Message): boolean => {
    if (msg.type !== MessageType.QUESTION || !msg.questionType) return false;
    
    if (msg.questionStatus === QuestionStatus.PENDING || msg.isArchived) return false; 

    switch (msg.questionType) {
        case QuestionType.MULTIPLE_CHOICE_SINGLE:
        case QuestionType.MULTIPLE_CHOICE_MULTIPLE:
        case QuestionType.TRUE_FALSE:
            return !!(msg.questionStem && msg.options && msg.options.length > 0 && msg.correctAnswerIds && msg.correctAnswerIds.length > 0);
        case QuestionType.FILL_IN_THE_BLANK:
            return !!(msg.questionStem && msg.acceptableAnswers && msg.acceptableAnswers.length > 0);
        case QuestionType.MATCHING:
            return !!(msg.matchingPromptItems && msg.matchingPromptItems.length > 0 &&
                msg.matchingAnswerItems && msg.matchingAnswerItems.length > 0 &&
                msg.correctMatches && msg.correctMatches.length > 0 &&
                msg.correctMatches.length === msg.matchingPromptItems.length);
        case QuestionType.DIAGRAM_LABELING:
            return !!(msg.imageUrl && msg.diagramLabels && msg.diagramLabels.length > 0);
        default:
            return false;
    }
};

export const checkAnswerIsCorrect = (question: TestQuestion, answer: UserAnswerRecord): boolean => {
    switch (question.questionType) {
        case QuestionType.MULTIPLE_CHOICE_SINGLE:
        case QuestionType.TRUE_FALSE:
            return !!(answer.selectedOptionIds && answer.selectedOptionIds.length === 1 && question.correctAnswerIds?.includes(answer.selectedOptionIds[0]));
        case QuestionType.MULTIPLE_CHOICE_MULTIPLE:
            const correctIds = new Set(question.correctAnswerIds);
            const selectedIds = new Set(answer.selectedOptionIds);
            return correctIds.size === selectedIds.size && [...correctIds].every(id => selectedIds.has(id));
        case QuestionType.FILL_IN_THE_BLANK:
            return !!(answer.fillText && question.acceptableAnswers?.some(ans => ans.toLowerCase() === answer.fillText!.toLowerCase().trim()));
        case QuestionType.MATCHING:
            if (!question.correctMatches || !answer.matchingAnswers) return false;
            const correctMatches = new Set(question.correctMatches.map(m => `${m.promptItemId}-${m.answerItemId}`));
            const userMatches = new Set(answer.matchingAnswers.map(m => `${m.promptItemId}-${m.answerItemId}`));
            return correctMatches.size > 0 && correctMatches.size === userMatches.size && [...correctMatches].every(match => userMatches.has(match));
        case QuestionType.DIAGRAM_LABELING:
            const correctDiagramAnswers = question.diagramLabels?.length || 0;
            if (correctDiagramAnswers === 0) return false;
            const userCorrectCount = answer.diagramAnswers?.filter(a => a.labelId === a.selectedLabelId).length || 0;
            return userCorrectCount === correctDiagramAnswers;
        default:
            return false;
    }
};

export const createShuffledQuestionSet = (questions: Message[]): TestQuestion[] => {
    return shuffleArray(questions).map((q, i) => {
        let questionWithOptions = { ...q };

        // Shuffle options for applicable question types
        if (
            (q.questionType === QuestionType.MULTIPLE_CHOICE_SINGLE ||
             q.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE ||
             q.questionType === QuestionType.TRUE_FALSE) &&
            q.options
        ) {
            questionWithOptions.options = shuffleArray(q.options);
        }

        return {
            ...questionWithOptions,
            questionNumber: i + 1,
        };
    });
};

export const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

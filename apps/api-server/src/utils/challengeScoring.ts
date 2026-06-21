export function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j]!, newArray[i]!];
  }
  return newArray;
}

export function checkAnswerIsCorrect(question: any, answer: any): boolean {
  const qType = String(question.questionType || '').toUpperCase();
  switch (qType) {
    case 'MULTIPLE_CHOICE_SINGLE':
    case 'TRUE_FALSE':
      return !!(
        answer.selectedOptionIds?.length === 1 &&
        answer.selectedOptionIds[0] !== undefined &&
        question.correctAnswerIds?.includes(answer.selectedOptionIds[0])
      );
    case 'MULTIPLE_CHOICE_MULTIPLE': {
      const correctIds = new Set(question.correctAnswerIds || []);
      const selectedIds = new Set(answer.selectedOptionIds || []);
      return correctIds.size === selectedIds.size && [...correctIds].every(id => selectedIds.has(id));
    }
    case 'FILL_IN_THE_BLANK':
      return !!(
        answer.fillText &&
        question.acceptableAnswers?.some((ans: string) => ans.toLowerCase() === answer.fillText!.toLowerCase().trim())
      );
    case 'MATCHING': {
      if (!question.correctMatches || !answer.matchingAnswers) return false;
      const correctMatches = new Set(question.correctMatches.map((m: { promptItemId: string; answerItemId: string }) => `${m.promptItemId}-${m.answerItemId}`));
      const userMatches = new Set(answer.matchingAnswers.map((m: { promptItemId: string; answerItemId: string }) => `${m.promptItemId}-${m.answerItemId}`));
      return correctMatches.size > 0 && correctMatches.size === userMatches.size && [...correctMatches].every(m => userMatches.has(m));
    }
    case 'DIAGRAM_LABELING': {
      const total = question.diagramLabels?.length || 0;
      if (total === 0) return false;
      const userCorrect = answer.diagramAnswers?.filter((a: { labelId: string; selectedLabelId: string }) => a.labelId === a.selectedLabelId).length || 0;
      return userCorrect === total;
    }
    default:
      return false;
  }
}

export function computeDuelQuestionPoints(isCorrect: boolean, timeTaken: number, currentStreak: number) {
  if (!isCorrect) return { points: 0, newStreak: 0 };
  const newStreak = currentStreak + 1;
  const basePoints = 500;
  const speedBonus = Math.max(0, Math.round(500 * (1 - Math.min(timeTaken, 20) / 20)));
  const multiplier = newStreak >= 5 ? 1.5 : newStreak >= 3 ? 1.2 : 1.0;
  return { points: Math.round((basePoints + speedBonus) * multiplier), newStreak };
}

export function scoreDuelAnswers(
  questions: any[],
  answers: Record<string, any>
) {
  let score = 0;
  let totalTime = 0;
  let correctCount = 0;
  let streak = 0;
  let maxStreak = 0;

  for (const q of questions) {
    const ans = answers[q.id];
    if (!ans) continue;
    const timeTaken = ans.timeSpentSeconds ?? 0;
    totalTime += timeTaken;
    const isCorrect = checkAnswerIsCorrect(q, ans);
    if (isCorrect) {
      correctCount += 1;
      const r = computeDuelQuestionPoints(true, timeTaken, streak);
      score += r.points;
      streak = r.newStreak;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  }

  return { score, totalTime, correctCount, maxStreak };
}

export function isQuestionTestable(msg: any): boolean {
  if (msg.type !== 'QUESTION' && msg.type !== 'question') return false;
  if (msg.questionStatus === 'PENDING' || msg.isArchived) return false;
  const qType = String(msg.questionType || '').toUpperCase();
  switch (qType) {
    case 'MULTIPLE_CHOICE_SINGLE':
    case 'MULTIPLE_CHOICE_MULTIPLE':
    case 'TRUE_FALSE':
      return !!(msg.questionStem && msg.options?.length && msg.correctAnswerIds?.length);
    case 'FILL_IN_THE_BLANK':
      return !!(msg.questionStem && msg.acceptableAnswers?.length);
    case 'MATCHING':
      return !!(
        msg.matchingPromptItems?.length &&
        msg.matchingAnswerItems?.length &&
        msg.correctMatches?.length === msg.matchingPromptItems.length
      );
    case 'DIAGRAM_LABELING':
      return !!(msg.imageUrl && msg.diagramLabels?.length);
    default:
      return false;
  }
}

const DUELIST_LEVELS = [
  { level: 1, threshold: 3, points: 75 },
  { level: 2, threshold: 10, points: 250 },
  { level: 3, threshold: 20, points: 500 },
  { level: 4, threshold: 35, points: 875 },
  { level: 5, threshold: 50, points: 1250 },
  { level: 6, threshold: 75, points: 1875 },
  { level: 7, threshold: 100, points: 2500 },
  { level: 8, threshold: 150, points: 3750 },
  { level: 9, threshold: 200, points: 5000 },
  { level: 10, threshold: 300, points: 7500 },
];

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Award DUELIST badge levels when gamesWon crosses thresholds (mirrors shared gamification). */
export function checkAndAwardBadges(user: any): { updatedUser: any; awardedBadges: any[] } {
  const awardedBadges: any[] = [];
  const userBadges = user.badges ? JSON.parse(JSON.stringify(user.badges)) : [];
  let updatedUser = { ...user, badges: userBadges, points: user.points || 0 };

  const gamesWon = updatedUser.stats?.gamesWon || 0;
  const currentBadge = updatedUser.badges.find((b: { id: string }) => b.id === 'DUELIST');
  const currentLevel = currentBadge?.level || 0;
  const nextLevel = DUELIST_LEVELS.find(l => l.level === currentLevel + 1);

  if (nextLevel && gamesWon >= nextLevel.threshold) {
    const newBadge = {
      id: 'DUELIST',
      level: nextLevel.level,
      name: `Duelist ${ROMAN_NUMERALS[nextLevel.level - 1] || nextLevel.level}`,
      description: `Win ${nextLevel.threshold} head-to-head game(s).`,
      icon: '⚔️',
      dateAwarded: new Date().toISOString(),
    };

    const badgeIndex = updatedUser.badges.findIndex((b: { id: string }) => b.id === 'DUELIST');
    if (badgeIndex > -1) {
      updatedUser.badges[badgeIndex] = newBadge;
    } else {
      updatedUser.badges.push(newBadge);
    }

    updatedUser.points += nextLevel.points;
    awardedBadges.push(newBadge);
  }

  return { updatedUser, awardedBadges };
}

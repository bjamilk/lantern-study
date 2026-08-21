import type {
    User,
    UserStats,
    Badge,
    TestQuestion,
    UserAnswerRecord,
    Message,
    MatchingItem,
    DiagramLabel,
    QuestionOption,
} from '../types';
import { QuestionType, MessageType, QuestionStatus } from '../types';
import {
  type QuestionVisibilityMode,
  isUnverifiedQuestion,
} from './questionVisibility';
import { BADGE_DEFINITIONS } from './gamification';

export const initialUserStats: UserStats = {
    testsCompleted: 0,
    questionsCreated: 0,
    groupsCreated: 0,
    highScoreTests: 0,
    perfectScoreTests: 0,
    gamesWon: 0,
    questionUpvotesMax: 0,
    listingsCreated: 0,
    listingsSold: 0,
    fiveStarReviews: 0,
    offersMade: 0,
};

// FIX: Added a trailing comma to the generic type parameter to avoid being parsed as a JSX tag.
export const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = newArray[i]!;
    newArray[i] = newArray[j]!;
    newArray[j] = temp;
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

/**
 * The subset of a question that answer grading actually reads. Narrower than
 * TestQuestion so lighter game/practice question shapes can be graded too.
 */
export type AnswerCheckQuestion = Pick<
    TestQuestion,
    'questionType' | 'correctAnswerIds' | 'acceptableAnswers' | 'correctMatches' | 'diagramLabels'
>;

export const checkAnswerIsCorrect = (question: AnswerCheckQuestion, answer: UserAnswerRecord): boolean => {
    switch (question.questionType) {
        case QuestionType.MULTIPLE_CHOICE_SINGLE:
        case QuestionType.TRUE_FALSE:
            return !!(answer.selectedOptionIds?.length === 1 && answer.selectedOptionIds[0] !== undefined && question.correctAnswerIds?.includes(answer.selectedOptionIds[0]));
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

/** 20% of group members required to verify a question. */
export function getQuestionVerificationThreshold(memberCount: number): number {
    return Math.max(1, Math.ceil(memberCount * 0.2));
}

export function resolveQuestionStatusAfterVote(params: {
    upvotes: number;
    downvotes: number;
    memberCount: number;
}): QuestionStatus {
    const { upvotes, downvotes, memberCount } = params;
    if (downvotes > upvotes) {
        return QuestionStatus.REJECTED;
    }
    const threshold = getQuestionVerificationThreshold(memberCount);
    if (upvotes >= threshold && threshold > 0) {
        return QuestionStatus.VERIFIED;
    }
    return QuestionStatus.PENDING;
}

export function isQuestionVoteBalanceAcceptable(msg: Pick<Message, 'upvotes' | 'downvotes'>): boolean {
    return (msg.downvotes ?? 0) <= (msg.upvotes ?? 0);
}

export function isQuestionStructurallyValid(msg: Message): boolean {
    if (msg.type !== MessageType.QUESTION || !msg.questionType) return false;

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
}

export const isQuestionTestable = (msg: Message): boolean => {
    if (msg.isArchived) return false;
    if (msg.questionStatus !== QuestionStatus.VERIFIED) return false;
    if (!isQuestionVoteBalanceAcceptable(msg)) return false;
    return isQuestionStructurallyValid(msg);
};

/**
 * Study / practice pool filter by visibility mode.
 * Graded tests should keep using `isQuestionTestable` only.
 */
export function messagePassesStudyQuestionPool(
    msg: Message,
    mode: QuestionVisibilityMode
): boolean {
    if (msg.isArchived) return false;
    if (!isQuestionStructurallyValid(msg)) return false;
    if (mode === 'none') return false;
    if (mode === 'verified') return isQuestionTestable(msg);
    if (mode === 'unverified') return isUnverifiedQuestion(msg.questionStatus);
    // all: verified bank + unverified practice items
    return isQuestionTestable(msg) || isUnverifiedQuestion(msg.questionStatus);
}

/** True for question types whose answer options can be safely reordered. */
const questionOptionsAreShuffleable = (q: Message): boolean =>
    (q.questionType === QuestionType.MULTIPLE_CHOICE_SINGLE ||
        q.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE ||
        q.questionType === QuestionType.TRUE_FALSE) &&
    !!q.options;

/**
 * Shuffle question order (and, unless `shuffleOptions` is false, each MCQ's options).
 * Options carry their own ids, so reordering never changes which answer is correct.
 */
export const createShuffledQuestionSet = (
    questions: Message[],
    opts: { shuffleOptions?: boolean } = {}
): TestQuestion[] => {
    const { shuffleOptions = true } = opts;
    return shuffleArray(questions).map((q, i) => {
        const questionWithOptions = { ...q };

        if (shuffleOptions && questionOptionsAreShuffleable(q)) {
            questionWithOptions.options = shuffleArray(q.options!);
        }

        return {
            ...questionWithOptions,
            questionNumber: i + 1,
        } as TestQuestion;
    });
};

/**
 * Keep question order but shuffle each MCQ's answer options.
 * Used when the "Shuffle options" study setting is on but "Shuffle questions" is off.
 */
export const shuffleQuestionOptionsOnly = (questions: Message[]): TestQuestion[] => {
    return questions.map((q, i) => {
        const questionWithOptions = { ...q };
        if (questionOptionsAreShuffleable(q)) {
            questionWithOptions.options = shuffleArray(q.options!);
        }
        return {
            ...questionWithOptions,
            questionNumber: i + 1,
        } as TestQuestion;
    });
};

/** Compute duel score for one question answer (matches web/mobile game scoring) */
export const computeDuelQuestionPoints = (
    isCorrect: boolean,
    timeTaken: number,
    currentStreak: number
): { points: number; newStreak: number } => {
    if (!isCorrect) return { points: 0, newStreak: 0 };
    const newStreak = currentStreak + 1;
    const basePoints = 500;
    const speedBonus = Math.max(0, Math.round(500 * (1 - Math.min(timeTaken, 20) / 20)));
    const multiplier = newStreak >= 5 ? 1.5 : newStreak >= 3 ? 1.2 : 1.0;
    return { points: Math.round((basePoints + speedBonus) * multiplier), newStreak };
};

const MOBILE_TYPE_TO_CANONICAL: Record<string, QuestionType> = {
    multiple_choice_single: QuestionType.MULTIPLE_CHOICE_SINGLE,
    multiple_choice_multiple: QuestionType.MULTIPLE_CHOICE_MULTIPLE,
    true_false: QuestionType.TRUE_FALSE,
    fill_in_blank: QuestionType.FILL_IN_THE_BLANK,
    fill_in_the_blank: QuestionType.FILL_IN_THE_BLANK,
    matching: QuestionType.MATCHING,
    diagram_labeling: QuestionType.DIAGRAM_LABELING,
    open_ended: QuestionType.OPEN_ENDED,
};

export function normalizeQuestionType(raw?: string): QuestionType | undefined {
    if (!raw) return undefined;
    if (Object.values(QuestionType).includes(raw as QuestionType)) {
        return raw as QuestionType;
    }
    return MOBILE_TYPE_TO_CANONICAL[raw];
}

function resolveOptionId(question: Record<string, unknown>, answerText: string): string {
    const optionItems = question.optionItems as Array<{ id: string; text: string }> | undefined;
    if (Array.isArray(optionItems) && optionItems.length) {
        const match = optionItems.find(o => o.text === answerText || String(o.id) === answerText);
        if (match) return String(match.id);
    }
    const options = question.options as unknown[] | undefined;
    if (Array.isArray(options)) {
        const idx = options.findIndex(o =>
            (typeof o === 'string' ? o : (o as { text?: string; id?: string }).text) === answerText
        );
        if (idx >= 0) {
            const opt = options[idx];
            if (typeof opt === 'string') return String(idx + 1);
            return String((opt as { id?: string }).id || idx + 1);
        }
    }
    return answerText;
}

function buildMatchingFields(question: Record<string, unknown>): {
    matchingPromptItems?: MatchingItem[];
    matchingAnswerItems?: MatchingItem[];
    correctMatches?: { promptItemId: string; answerItemId: string }[];
} {
    const pairs = question.matchingPairs as Array<{ id?: string; left: string; right: string }> | undefined;
    if (!pairs?.length) {
        return {
            matchingPromptItems: question.matchingPromptItems as MatchingItem[] | undefined,
            matchingAnswerItems: question.matchingAnswerItems as MatchingItem[] | undefined,
            correctMatches: question.correctMatches as { promptItemId: string; answerItemId: string }[] | undefined,
        };
    }

    const matchingPromptItems: MatchingItem[] = pairs.map((pair, i) => ({
        id: pair.id || `prompt-${i}`,
        text: pair.left,
    }));
    const matchingAnswerItems: MatchingItem[] = pairs.map((pair, i) => ({
        id: pair.id || `answer-${i}`,
        text: pair.right,
    }));
    const correctMatches = pairs.map((pair, i) => ({
        promptItemId: pair.id || `prompt-${i}`,
        answerItemId: pair.id || `answer-${i}`,
    }));

    return { matchingPromptItems, matchingAnswerItems, correctMatches };
}

function buildCorrectAnswerIds(question: Record<string, unknown>, questionType: QuestionType): string[] | undefined {
    const existing = (question.correctAnswerIds || question.correct_answer_ids) as string[] | undefined;
    if (existing?.length) return existing;

    const optionItems = question.optionItems as Array<{ id: string; text: string }> | undefined;
    const correctAnswers = question.correctAnswers as string[] | undefined;
    const correctAnswer = question.correctAnswer as string | undefined;

    if (questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE && correctAnswers?.length) {
        return correctAnswers.map(text => resolveOptionId(question, text));
    }
    if (correctAnswer) {
        return [resolveOptionId(question, correctAnswer)];
    }
    if (correctAnswers?.length === 1) {
        return [resolveOptionId(question, correctAnswers[0]!)];
    }
    if (optionItems?.length && correctAnswer) {
        const match = optionItems.find(o => o.text === correctAnswer);
        if (match) return [String(match.id)];
    }
    return undefined;
}

function buildQuestionOptions(question: Record<string, unknown>): QuestionOption[] | undefined {
    if (Array.isArray(question.optionItems) && question.optionItems.length) {
        return (question.optionItems as Array<{ id: string; text: string }>).map(o => ({
            id: String(o.id),
            text: String(o.text),
        }));
    }
    if (Array.isArray(question.options)) {
        return question.options.map((opt: unknown, i: number) => {
            if (typeof opt === 'string') return { id: String(i + 1), text: opt };
            const item = opt as { id?: string; text?: string };
            return { id: String(item.id || i + 1), text: String(item.text || '') };
        });
    }
    return undefined;
}

/** Map mobile/web question variants to canonical TestQuestion for session storage. */
export function normalizeTestQuestionForSession(q: Record<string, unknown>, index: number): TestQuestion {
    const questionType =
        normalizeQuestionType((q.questionType || q.type) as string | undefined) ||
        QuestionType.MULTIPLE_CHOICE_SINGLE;
    const questionStem = String(q.questionStem || q.question || q.text || '');
    const questionNumber = (q.questionNumber as number | undefined) ?? index + 1;
    const options = buildQuestionOptions(q);
    const { matchingPromptItems, matchingAnswerItems, correctMatches } = buildMatchingFields(q);
    const diagramLabels = (q.diagramLabels as DiagramLabel[] | undefined)?.map(label => ({
        id: String(label.id),
        text: String(label.text || (label as { label?: string }).label || ''),
        x: label.x ?? 50,
        y: label.y ?? 50,
    }));
    const acceptableAnswers =
        (q.acceptableAnswers as string[] | undefined) ||
        (q.keywords as string[] | undefined) ||
        (q.blanks as Array<{ correctAnswer: string }> | undefined)?.map(b => b.correctAnswer);

    return {
        id: String(q.id || `q-${index}`),
        groupId: String(q.groupId || ''),
        sender: (q.sender as User) || {
            id: '',
            name: 'Unknown',
            points: 0,
            badges: [],
            stats: initialUserStats,
        },
        timestamp: q.timestamp ? new Date(q.timestamp as string | Date) : new Date(),
        type: MessageType.QUESTION,
        text: questionStem,
        questionStem,
        questionType,
        questionNumber,
        options,
        correctAnswerIds: buildCorrectAnswerIds(q, questionType),
        acceptableAnswers,
        matchingPromptItems,
        matchingAnswerItems,
        correctMatches,
        diagramLabels,
        imageUrl: (q.imageUrl || q.diagramUrl) as string | undefined,
        tags: q.tags as string[] | undefined,
        explanation: q.explanation as string | undefined,
        upvotes: (q.upvotes as number | undefined) ?? 0,
        downvotes: (q.downvotes as number | undefined) ?? 0,
    };
}

export type RawMobileAnswer = string | string[] | Record<string, string> | undefined;

export interface ToUserAnswerRecordOptions {
    isCorrect?: boolean;
    timeSpentSeconds?: number;
}

/** Convert raw mobile/web answer shapes to canonical UserAnswerRecord. */
export function toUserAnswerRecord(
    question: Record<string, unknown>,
    rawAnswer: RawMobileAnswer,
    opts: ToUserAnswerRecordOptions = {}
): UserAnswerRecord {
    const questionId = String(question.id || '');
    const base: UserAnswerRecord = {
        questionId,
        isCorrect: opts.isCorrect,
        timeSpentSeconds: opts.timeSpentSeconds,
    };

    if (rawAnswer === undefined || rawAnswer === '') return base;

    const qType = normalizeQuestionType((question.questionType || question.type) as string | undefined);

    switch (qType) {
        case QuestionType.MULTIPLE_CHOICE_SINGLE:
        case QuestionType.TRUE_FALSE: {
            const text = typeof rawAnswer === 'string' ? rawAnswer : String(rawAnswer);
            return { ...base, selectedOptionIds: [resolveOptionId(question, text)] };
        }
        case QuestionType.MULTIPLE_CHOICE_MULTIPLE: {
            const values = Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer];
            return {
                ...base,
                selectedOptionIds: values.map(v => resolveOptionId(question, String(v))),
            };
        }
        case QuestionType.FILL_IN_THE_BLANK:
            return { ...base, fillText: String(rawAnswer) };
        case QuestionType.MATCHING: {
            if (Array.isArray(rawAnswer)) {
                return {
                    ...base,
                    matchingAnswers: rawAnswer as unknown as { promptItemId: string; answerItemId: string }[],
                };
            }
            if (typeof rawAnswer === 'object') {
                const pairs = question.matchingPairs as Array<{ id?: string; left: string; right: string }> | undefined;
                const promptItems = question.matchingPromptItems as MatchingItem[] | undefined;
                const answerItems = question.matchingAnswerItems as MatchingItem[] | undefined;
                const matchingAnswers = Object.entries(rawAnswer).map(([leftKey, rightVal]) => {
                    const pair = pairs?.find(p => p.left === leftKey || p.id === leftKey);
                    const promptItemId =
                        pair?.id ||
                        promptItems?.find(p => p.text === leftKey || p.id === leftKey)?.id ||
                        leftKey;
                    const answerItemId =
                        answerItems?.find(a => a.text === rightVal)?.id ||
                        pairs?.find(p => p.right === rightVal)?.id ||
                        String(rightVal);
                    return { promptItemId: String(promptItemId), answerItemId: String(answerItemId) };
                });
                return { ...base, matchingAnswers };
            }
            return base;
        }
        case QuestionType.DIAGRAM_LABELING: {
            if (Array.isArray(rawAnswer)) {
                return {
                    ...base,
                    diagramAnswers: rawAnswer as unknown as { labelId: string; selectedLabelId: string }[],
                };
            }
            if (typeof rawAnswer === 'object') {
                const diagramAnswers = Object.entries(rawAnswer).map(([labelId, selectedLabelId]) => ({
                    labelId: String(labelId),
                    selectedLabelId: String(selectedLabelId),
                }));
                return { ...base, diagramAnswers };
            }
            return base;
        }
        case QuestionType.OPEN_ENDED:
            return { ...base, fillText: String(rawAnswer) };
        default:
            if (typeof rawAnswer === 'string') return { ...base, fillText: rawAnswer };
            return base;
    }
}

/** Normalize a single stored answer record (legacy mobile shapes included). */
export function normalizeStoredUserAnswer(raw: unknown, questionId?: string): UserAnswerRecord {
    if (!raw || typeof raw !== 'object') {
        return { questionId: questionId || '' };
    }

    const record = raw as Record<string, unknown>;
    const qid = String(record.questionId || questionId || '');
    const normalized: UserAnswerRecord = {
        questionId: qid,
        isCorrect: (record.isCorrect ?? record.is_correct) as boolean | undefined,
        timeSpentSeconds: (record.timeSpentSeconds ?? record.time_spent_seconds) as number | undefined,
        isBookmarked: record.isBookmarked as boolean | undefined,
    };

    if (record.selectedOptionIds !== undefined) {
        normalized.selectedOptionIds = Array.isArray(record.selectedOptionIds)
            ? record.selectedOptionIds.map(String)
            : [String(record.selectedOptionIds)];
    }

    if (record.fillText !== undefined) {
        normalized.fillText = String(record.fillText);
    } else if (
        typeof record.userAnswer === 'string' &&
        !normalized.selectedOptionIds &&
        record.matchingAnswers === undefined &&
        record.diagramAnswers === undefined
    ) {
        const qType = normalizeQuestionType(record.questionType as string | undefined);
        if (qType === QuestionType.FILL_IN_THE_BLANK || qType === QuestionType.OPEN_ENDED) {
            normalized.fillText = record.userAnswer;
        } else if (!normalized.selectedOptionIds) {
            normalized.selectedOptionIds = [String(record.userAnswer)];
        }
    }

    if (record.matchingAnswers !== undefined) {
        if (Array.isArray(record.matchingAnswers)) {
            normalized.matchingAnswers = record.matchingAnswers as UserAnswerRecord['matchingAnswers'];
        } else if (typeof record.matchingAnswers === 'object') {
            normalized.matchingAnswers = Object.entries(record.matchingAnswers as Record<string, string>).map(
                ([promptItemId, answerItemId]) => ({
                    promptItemId: String(promptItemId),
                    answerItemId: String(answerItemId),
                })
            );
        }
    }

    if (record.diagramAnswers !== undefined) {
        if (Array.isArray(record.diagramAnswers)) {
            normalized.diagramAnswers = record.diagramAnswers as UserAnswerRecord['diagramAnswers'];
        } else if (typeof record.diagramAnswers === 'object') {
            normalized.diagramAnswers = Object.entries(record.diagramAnswers as Record<string, string>).map(
                ([labelId, selectedLabelId]) => ({
                    labelId: String(labelId),
                    selectedLabelId: String(selectedLabelId),
                })
            );
        }
    }

    return normalized;
}

/**
 * Coerce stored user_answers into a questionId-keyed map.
 * Legacy `/submit` persisted Object.values(...) as a JSON array; draft complete
 * stores a Record. Both shapes must work for history hydrate / review.
 */
export function coerceRawUserAnswers(
    raw: unknown,
    questions: Array<{ id?: string } | null | undefined> = []
): Record<string, unknown> {
    if (!raw) return {};
    if (Array.isArray(raw)) {
        const out: Record<string, unknown> = {};
        raw.forEach((answer, index) => {
            if (!answer || typeof answer !== 'object') return;
            const rec = answer as Record<string, unknown>;
            const qid = String(
                rec.questionId ||
                    rec.question_id ||
                    questions[index]?.id ||
                    ''
            );
            if (!qid) return;
            out[qid] = { ...rec, questionId: qid };
        });
        return out;
    }
    if (typeof raw === 'object') return raw as Record<string, unknown>;
    return {};
}

export function normalizeStoredUserAnswers(
    raw: Record<string, unknown> | unknown[] | undefined | null,
    questions: Array<{ id?: string } | null | undefined> = []
): Record<string, UserAnswerRecord> {
    const coerced = coerceRawUserAnswers(raw, questions);
    const result: Record<string, UserAnswerRecord> = {};
    for (const [key, value] of Object.entries(coerced)) {
        result[key] = normalizeStoredUserAnswer(value, key);
    }
    return result;
}

export function isUserAnswerAttempted(answer: UserAnswerRecord | undefined): boolean {
    if (!answer) return false;
    const normalized = normalizeStoredUserAnswer(answer, answer.questionId);
    return !!(
        (normalized.selectedOptionIds && normalized.selectedOptionIds.length > 0) ||
        (normalized.fillText && normalized.fillText.trim() !== '') ||
        (normalized.matchingAnswers && normalized.matchingAnswers.length > 0) ||
        (normalized.diagramAnswers && normalized.diagramAnswers.length > 0)
    );
}

export type QuestionResultStatus = 'correct' | 'incorrect' | 'unattempted';

export const QUESTION_RESULT_CHART_COLORS: Record<
    QuestionResultStatus,
    { bg: string; border: string }
> = {
    correct: { bg: 'rgba(34, 197, 94, 0.75)', border: 'rgb(22, 163, 74)' },
    incorrect: { bg: 'rgba(239, 68, 68, 0.75)', border: 'rgb(220, 38, 38)' },
    unattempted: { bg: 'rgba(245, 158, 11, 0.75)', border: 'rgb(217, 119, 6)' },
};

export function resolveQuestionResultStatus(
    question: TestQuestion,
    answer: UserAnswerRecord | undefined
): QuestionResultStatus {
    if (!isUserAnswerAttempted(answer)) return 'unattempted';
    const q = normalizeTestQuestionForSession(question as unknown as Record<string, unknown>, 0);
    const a = normalizeStoredUserAnswer(answer!, question.id);
    return checkAnswerIsCorrect(q, a) ? 'correct' : 'incorrect';
}

export function normalizeTestSessionQuestions(questions: unknown[]): TestQuestion[] {
    if (!Array.isArray(questions)) return [];
    return questions.map((q, index) =>
        normalizeTestQuestionForSession((q || {}) as Record<string, unknown>, index)
    );
}

export function normalizeTestResultSession(session: {
    questions?: unknown[];
    userAnswers?: Record<string, unknown> | unknown[];
    user_answers?: Record<string, unknown> | unknown[];
    [key: string]: unknown;
}): {
    questions: TestQuestion[];
    userAnswers: Record<string, UserAnswerRecord>;
} {
    const questions = normalizeTestSessionQuestions(session.questions || []);
    const rawAnswers = session.userAnswers ?? session.user_answers ?? {};
    const userAnswers = normalizeStoredUserAnswers(rawAnswers, questions);

    for (const q of questions) {
        const existing = userAnswers[q.id];
        if (existing) {
            userAnswers[q.id] = {
                ...existing,
                isCorrect: checkAnswerIsCorrect(q, existing),
            };
        }
    }

    return { questions, userAnswers };
}

export const scoreDuelAnswers = (
    questions: TestQuestion[],
    answers: Record<string, UserAnswerRecord>
): { score: number; totalTime: number; correctCount: number; maxStreak: number } => {
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
            const result = computeDuelQuestionPoints(true, timeTaken, streak);
            score += result.points;
            streak = result.newStreak;
            maxStreak = Math.max(maxStreak, streak);
        } else {
            streak = 0;
        }
    }

    return { score, totalTime, correctCount, maxStreak };
};

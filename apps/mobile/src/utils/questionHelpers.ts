import { shuffleArray, isQuestionVoteBalanceAcceptable } from '@lantern/shared/utils';
import { QuestionStatus } from '@lantern/shared/types';
import type { Message } from '../stores/groupStore';
import type { TestQuestion, QuestionType } from '../stores/testStore';
import type { Flashcard } from '../services/api';

export interface GroupQuestionMessage extends Message {
  correctAnswerIds?: string[];
  acceptableAnswers?: string[];
  optionItems?: Array<{ id: string; text: string }>;
  matchingPromptItems?: Array<{ id: string; text: string }>;
  matchingAnswerItems?: Array<{ id: string; text: string }>;
  correctMatches?: Array<{ promptItemId: string; answerItemId: string }>;
  diagramLabels?: Array<{ id: string; text: string; x?: number; y?: number; label?: string }>;
  imageUrl?: string;
  explanation?: string;
}

const VERIFIED_STATUSES = new Set([QuestionStatus.VERIFIED, 'VERIFIED']);

function normalizeQuestionType(raw?: string): QuestionType | null {
  if (!raw) return null;
  const map: Record<string, QuestionType> = {
    MULTIPLE_CHOICE_SINGLE: 'multiple_choice_single',
    multiple_choice_single: 'multiple_choice_single',
    MULTIPLE_CHOICE_MULTIPLE: 'multiple_choice_multiple',
    multiple_choice_multiple: 'multiple_choice_multiple',
    TRUE_FALSE: 'true_false',
    true_false: 'true_false',
    FILL_IN_THE_BLANK: 'fill_in_blank',
    fill_in_blank: 'fill_in_blank',
    fill_in_the_blank: 'fill_in_blank',
    MATCHING: 'matching',
    matching: 'matching',
    DIAGRAM_LABELING: 'diagram_labeling',
    diagram_labeling: 'diagram_labeling',
    OPEN_ENDED: 'open_ended',
    open_ended: 'open_ended',
  };
  return map[raw] || null;
}

export function isQuestionTestable(msg: GroupQuestionMessage): boolean {
  if (msg.type !== 'question' || msg.isArchived) return false;
  if (!msg.questionStatus || !VERIFIED_STATUSES.has(msg.questionStatus)) return false;
  if (
    !isQuestionVoteBalanceAcceptable({
      upvotes: msg.upvotes ?? 0,
      downvotes: msg.downvotes ?? 0,
    })
  ) {
    return false;
  }

  const qType = normalizeQuestionType(msg.questionType);
  if (!qType) return false;

  switch (qType) {
    case 'multiple_choice_single':
    case 'multiple_choice_multiple':
    case 'true_false':
      return !!(
        msg.questionStem &&
        msg.options &&
        msg.options.length > 0 &&
        msg.correctAnswerIds &&
        msg.correctAnswerIds.length > 0
      );
    case 'fill_in_blank':
      return !!(msg.questionStem && msg.acceptableAnswers && msg.acceptableAnswers.length > 0);
    case 'matching':
      return !!(
        msg.matchingPromptItems &&
        msg.matchingPromptItems.length > 0 &&
        msg.matchingAnswerItems &&
        msg.matchingAnswerItems.length > 0 &&
        msg.correctMatches &&
        msg.correctMatches.length === msg.matchingPromptItems.length
      );
    case 'diagram_labeling':
      return !!(msg.imageUrl && msg.diagramLabels && msg.diagramLabels.length > 0);
    default:
      return false;
  }
}

function normalizeTrueFalseLabel(text: string): string {
  const lower = text.trim().toLowerCase();
  if (lower === 'true') return 'True';
  if (lower === 'false') return 'False';
  return text;
}

export function resolveOptionText(
  options: string[] | undefined,
  optionItems: Array<{ id: string; text: string }> | undefined,
  id: string
): string {
  if (!id) return '';

  const idLower = id.toLowerCase();
  if (idLower === 'true') return 'True';
  if (idLower === 'false') return 'False';

  if (optionItems?.length) {
    const byId = optionItems.find(o => o.id === id);
    if (byId?.text) return normalizeTrueFalseLabel(byId.text);
  }

  if (!options?.length) return id;

  const byText = options.find(o => o === id);
  if (byText) return normalizeTrueFalseLabel(byText);

  const idx = options.findIndex((_, i) => `opt-${i}` === id);
  if (idx >= 0) return normalizeTrueFalseLabel(options[idx]);

  return id;
}

export function resolveCorrectAnswerLabel(question: TestQuestion): string {
  if (question.type === 'multiple_choice_multiple') {
    return (
      question.correctAnswers
        ?.map(answer =>
          resolveCorrectAnswerLabel({
            ...question,
            type: 'multiple_choice_single',
            correctAnswer: answer,
          })
        )
        .join(', ') || ''
    );
  }

  const raw = question.correctAnswer || '';
  if (!raw) return '';

  if (question.options?.some(opt => opt === raw)) {
    return normalizeTrueFalseLabel(raw);
  }

  if (raw === 'True' || raw === 'False') return raw;

  const resolved = resolveOptionText(question.options, question.optionItems, raw);
  return resolved !== raw ? normalizeTrueFalseLabel(resolved) : raw;
}

export function formatCorrectAnswerDisplay(question: TestQuestion): string {
  switch (question.type) {
    case 'multiple_choice_single':
    case 'true_false':
    case 'fill_in_blank':
      return resolveCorrectAnswerLabel(question) || question.correctAnswer || '';
    case 'multiple_choice_multiple':
      return question.correctAnswers?.length
        ? resolveCorrectAnswerLabel({ ...question, type: 'multiple_choice_multiple' })
        : '';
    case 'matching':
      return question.matchingPairs?.map(pair => `${pair.left} → ${pair.right}`).join('; ') || '';
    case 'diagram_labeling':
      return question.diagramLabels?.map(label => label.label).filter(Boolean).join(', ') || '';
    case 'open_ended':
      return question.sampleAnswer || question.keywords?.join(', ') || '';
    default:
      return '';
  }
}

export function groupMessageToTestQuestion(msg: GroupQuestionMessage): TestQuestion {
  const qType = normalizeQuestionType(msg.questionType) || 'multiple_choice_single';

  const base: TestQuestion = {
    id: msg.id,
    type: qType,
    question: msg.questionStem || msg.text,
    explanation: msg.explanation,
    points: 10,
    tags: msg.tags,
  };

  switch (qType) {
    case 'multiple_choice_single': {
      const correctId = msg.correctAnswerIds?.[0] || '';
      return {
        ...base,
        options: msg.options,
        optionItems: msg.optionItems,
        correctAnswer: resolveOptionText(msg.options, msg.optionItems, correctId),
      };
    }
    case 'true_false': {
      const correctId = msg.correctAnswerIds?.[0] || '';
      const tfOptions =
        msg.options && msg.options.length >= 2 ? msg.options : (['True', 'False'] as string[]);
      const optionItems = msg.optionItems?.length
        ? msg.optionItems
        : tfOptions.map((text: string, i: number) => ({ id: String(i + 1), text }));
      return {
        ...base,
        options: tfOptions,
        optionItems,
        correctAnswer: resolveOptionText(tfOptions, optionItems, correctId),
      };
    }
    case 'multiple_choice_multiple':
      return {
        ...base,
        options: msg.options,
        optionItems: msg.optionItems,
        correctAnswers: (msg.correctAnswerIds || []).map(id =>
          resolveOptionText(msg.options, msg.optionItems, id)
        ),
      };
    case 'fill_in_blank':
      return {
        ...base,
        correctAnswer: msg.acceptableAnswers?.[0],
        keywords: msg.acceptableAnswers,
      };
    case 'matching':
      return {
        ...base,
        matchingPairs: (msg.correctMatches || []).map((m, i) => {
          const left = msg.matchingPromptItems?.find(p => p.id === m.promptItemId);
          const right = msg.matchingAnswerItems?.find(a => a.id === m.answerItemId);
          return {
            id: m.promptItemId || `pair-${i}`,
            left: left?.text || m.promptItemId,
            right: right?.text || m.answerItemId,
          };
        }),
      };
    case 'diagram_labeling':
      return {
        ...base,
        diagramUrl: msg.imageUrl,
        imageUrl: msg.imageUrl,
        diagramLabels: (msg.diagramLabels || []).map((l, i) => ({
          id: l.id || `label-${i}`,
          label: l.label || l.text,
          x: l.x ?? 50,
          y: l.y ?? 50,
        })),
      };
    default:
      return base;
  }
}

export function createShuffledQuestionSet(messages: GroupQuestionMessage[]): TestQuestion[] {
  return shuffleArray(messages).map(groupMessageToTestQuestion);
}

export interface TestConfigFilter {
  numberOfQuestions: number;
  selectedQuestionTypes?: QuestionType[];
  selectedTags?: string[];
  useSpacedRepetition?: boolean;
  focusOnNew?: boolean;
}

export interface CountFilterOptions {
  selectedQuestionTypes?: QuestionType[];
  selectedTags?: string[];
  useSpacedRepetition?: boolean;
  focusOnNew?: boolean;
}

export const MOBILE_TO_WEB_QUESTION_TYPE: Record<QuestionType, string> = {
  multiple_choice_single: 'MULTIPLE_CHOICE_SINGLE',
  multiple_choice_multiple: 'MULTIPLE_CHOICE_MULTIPLE',
  true_false: 'TRUE_FALSE',
  fill_in_blank: 'FILL_IN_THE_BLANK',
  matching: 'MATCHING',
  diagram_labeling: 'DIAGRAM_LABELING',
  open_ended: 'OPEN_ENDED',
};

export function mobileQuestionTypesToWeb(types: QuestionType[]): string[] {
  return types.map(t => MOBILE_TO_WEB_QUESTION_TYPE[t]).filter(Boolean);
}

export function webQuestionTypesToMobile(types: string[]): QuestionType[] {
  return types.map(t => normalizeQuestionType(t)).filter((t): t is QuestionType => t !== null);
}

export function countMatchingQuestions(
  messages: GroupQuestionMessage[],
  filter: CountFilterOptions,
  userQuestionStats: Record<string, { correctAttempts: number; incorrectAttempts: number }> = {}
): number {
  const allTestable = messages.filter(isQuestionTestable);

  const typeFilter = (msg: GroupQuestionMessage) => {
    if (!filter.selectedQuestionTypes?.length) return true;
    const qType = normalizeQuestionType(msg.questionType);
    return qType ? filter.selectedQuestionTypes.includes(qType) : false;
  };

  const tagFilter = (msg: GroupQuestionMessage) => {
    if (!filter.selectedTags?.length) return true;
    return msg.tags?.some(tag => filter.selectedTags!.includes(tag)) ?? false;
  };

  if (filter.useSpacedRepetition) {
    return allTestable.filter(q => {
      const stats = userQuestionStats[q.id];
      if (!stats) return true;
      return stats.incorrectAttempts > 0 && stats.incorrectAttempts >= stats.correctAttempts;
    }).length;
  }

  if (filter.focusOnNew) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const baseFiltered = allTestable.filter(q => typeFilter(q) && tagFilter(q));
    const focusIds = new Set<string>();
    baseFiltered.forEach(q => {
      if (!userQuestionStats[q.id]) {
        focusIds.add(q.id);
      }
    });
    baseFiltered.forEach(q => {
      if (new Date(q.createdAt) >= sevenDaysAgo && !userQuestionStats[q.id]) {
        focusIds.add(q.id);
      }
    });
    return focusIds.size;
  }

  return allTestable.filter(q => typeFilter(q) && tagFilter(q)).length;
}

export function selectGroupQuestions(
  messages: GroupQuestionMessage[],
  config: TestConfigFilter,
  userQuestionStats: Record<string, { correctAttempts: number; incorrectAttempts: number }> = {}
): TestQuestion[] {
  const allTestable = messages.filter(isQuestionTestable);

  const typeFilter = (msg: GroupQuestionMessage) => {
    if (!config.selectedQuestionTypes?.length) return true;
    const qType = normalizeQuestionType(msg.questionType);
    return qType ? config.selectedQuestionTypes.includes(qType) : false;
  };

  const tagFilter = (msg: GroupQuestionMessage) => {
    if (!config.selectedTags?.length) return true;
    return msg.tags?.some(tag => config.selectedTags!.includes(tag)) ?? false;
  };

  let candidateQuestions: GroupQuestionMessage[] = [];
  let finalSelected: GroupQuestionMessage[] = [];

  if (config.useSpacedRepetition) {
    candidateQuestions = allTestable.filter(q => {
      const stats = userQuestionStats[q.id];
      if (!stats) return true;
      return stats.incorrectAttempts > 0 && stats.incorrectAttempts >= stats.correctAttempts;
    });
  } else if (config.focusOnNew) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const baseFiltered = shuffleArray(allTestable.filter(q => typeFilter(q) && tagFilter(q)));
    const addedIds = new Set<string>();

    baseFiltered
      .filter(q => new Date(q.createdAt) >= sevenDaysAgo && !userQuestionStats[q.id])
      .forEach(q => {
        if (finalSelected.length < config.numberOfQuestions) {
          finalSelected.push(q);
          addedIds.add(q.id);
        }
      });

    if (finalSelected.length < config.numberOfQuestions) {
      baseFiltered
        .filter(q => !userQuestionStats[q.id] && !addedIds.has(q.id))
        .forEach(q => {
          if (finalSelected.length < config.numberOfQuestions) {
            finalSelected.push(q);
          }
        });
    }
  } else {
    candidateQuestions = allTestable.filter(q => typeFilter(q) && tagFilter(q));
  }

  const selected =
    config.focusOnNew
      ? finalSelected
      : shuffleArray(candidateQuestions).slice(0, config.numberOfQuestions);

  return createShuffledQuestionSet(selected.slice(0, config.numberOfQuestions));
}

export function extractTagsFromQuestions(messages: GroupQuestionMessage[]): string[] {
  const tags = new Set<string>();
  messages.filter(isQuestionTestable).forEach(m => m.tags?.forEach(t => tags.add(t)));
  return Array.from(tags).sort();
}

export function normalizeApiQuestions(rawQuestions: unknown[]): TestQuestion[] {
  if (!Array.isArray(rawQuestions)) return [];
  return rawQuestions.map((q: any, index) => {
    const type = normalizeQuestionType(q.type || q.questionType) || 'multiple_choice_single';
    const rawOptions = q.options || q.optionItems || [];
    const optionItemsFromField = Array.isArray(q.optionItems)
      ? (q.optionItems as Array<{ id: string; text: string }>)
      : undefined;
    const optionItems = optionItemsFromField?.length
      ? optionItemsFromField
      : (rawOptions
          .map((opt: any) => {
            if (typeof opt === 'string') return { id: opt, text: opt };
            if (opt?.id && opt?.text) return { id: String(opt.id), text: String(opt.text) };
            if (opt?.text) return { id: String(opt.id || opt.text), text: String(opt.text) };
            return null;
          })
          .filter(Boolean) as Array<{ id: string; text: string }>);
    const options = optionItems.length
      ? optionItems.map(o => o.text)
      : rawOptions.map((o: any) => (typeof o === 'string' ? o : o?.text || '')).filter(Boolean);
    const correctIds: string[] =
      q.correctAnswerIds ||
      q.correct_answer_ids ||
      q.correctOptionIds ||
      q.correctAnswers ||
      [];

    let correctAnswer = q.correctAnswer || q.correctFillText;
    let correctAnswers = q.correctAnswers;

    if (!correctAnswer && correctIds.length === 1 && type !== 'multiple_choice_multiple') {
      correctAnswer = resolveOptionText(options, optionItems, String(correctIds[0]));
    }
    if (!correctAnswers && correctIds.length > 0 && type === 'multiple_choice_multiple') {
      correctAnswers = correctIds.map((id: string) => resolveOptionText(options, optionItems, id));
    }
    if (type === 'true_false' && correctIds.length === 1) {
      const tfOptions: string[] = options.length >= 2 ? options : ['True', 'False'];
      const tfItems =
        optionItems.length >= 2
          ? optionItems
          : tfOptions.map((text: string, i: number) => ({ id: String(i + 1), text }));
      correctAnswer = resolveOptionText(tfOptions, tfItems, String(correctIds[0]));
    }

    return {
      id: q.id || `q-${index}`,
      type,
      question: q.question || q.questionStem || q.text || '',
      options: options.length ? options : undefined,
      optionItems: optionItems.length ? optionItems : undefined,
      correctAnswer,
      correctAnswers,
      matchingPairs: q.matchingPairs,
      diagramUrl: q.diagramUrl || q.imageUrl || q.image_url,
      imageUrl: q.imageUrl || q.image_url || q.diagramUrl,
      diagramLabels: Array.isArray(q.diagramLabels)
        ? q.diagramLabels.map((l: any, i: number) => ({
            id: String(l.id || `label-${i}`),
            label: String(l.label || l.text || ''),
            x: typeof l.x === 'number' ? l.x : 50,
            y: typeof l.y === 'number' ? l.y : 50,
          }))
        : undefined,
      blanks: q.blanks,
      sampleAnswer: q.sampleAnswer,
      keywords: q.keywords || q.acceptableAnswers,
      explanation: q.explanation,
      points: q.points ?? 10,
      tags: q.tags,
    };
  });
}

export function flashcardsToQuestions(flashcards: Flashcard[], count: number): TestQuestion[] {
  const shuffled = shuffleArray(flashcards).slice(0, count);
  return shuffled.map((card, i) => {
    const front = card.front || (card as any).question || 'Question';
    const back = card.back || (card as any).answer || 'Answer';
    const distractors = shuffleArray(
      flashcards
        .filter(c => c.id !== card.id)
        .map(c => c.back || (c as any).answer)
        .filter(Boolean)
    ).slice(0, 3) as string[];

    const options = shuffleArray([back, ...distractors]);
    return {
      id: card.id || `fc-q-${i}`,
      type: 'multiple_choice_single',
      question: front,
      options,
      correctAnswer: back,
      points: 10,
      tags: card.tags || (card as any).tags,
    };
  });
}

export function filterTestQuestions(
  questions: TestQuestion[],
  config: TestConfigFilter,
  userQuestionStats: Record<string, { correctAttempts: number; incorrectAttempts: number }> = {}
): TestQuestion[] {
  const typeFilter = (q: TestQuestion) => {
    if (!config.selectedQuestionTypes?.length) return true;
    return config.selectedQuestionTypes.includes(q.type);
  };

  const tagFilter = (q: TestQuestion) => {
    if (!config.selectedTags?.length) return true;
    return q.tags?.some(tag => config.selectedTags!.includes(tag)) ?? false;
  };

  const allFiltered = questions.filter(q => typeFilter(q) && tagFilter(q));
  let candidateQuestions: TestQuestion[] = [];
  let finalSelected: TestQuestion[] = [];

  if (config.useSpacedRepetition) {
    candidateQuestions = allFiltered.filter(q => {
      const stats = userQuestionStats[q.id];
      if (!stats) return true;
      return stats.incorrectAttempts > 0 && stats.incorrectAttempts >= stats.correctAttempts;
    });
  } else if (config.focusOnNew) {
    const baseFiltered = shuffleArray(allFiltered);
    const addedIds = new Set<string>();

    baseFiltered
      .filter(q => !userQuestionStats[q.id])
      .forEach(q => {
        if (finalSelected.length < config.numberOfQuestions) {
          finalSelected.push(q);
          addedIds.add(q.id);
        }
      });

    if (finalSelected.length < config.numberOfQuestions) {
      baseFiltered
        .filter(q => !addedIds.has(q.id))
        .forEach(q => {
          if (finalSelected.length < config.numberOfQuestions) {
            finalSelected.push(q);
          }
        });
    }
  } else {
    candidateQuestions = allFiltered;
  }

  const selected = config.focusOnNew
    ? finalSelected
    : shuffleArray(candidateQuestions).slice(0, config.numberOfQuestions);

  return shuffleArray(selected.slice(0, config.numberOfQuestions));
}

export interface OfflineQuestionInput {
  id: string;
  stem: string;
  type: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  correctAnswer?: string;
  explanation?: string;
  tags: string[];
  imageUrl?: string;
}

export function offlineQuestionsToTestQuestions(questions: OfflineQuestionInput[]): TestQuestion[] {
  const offlineTypeMap: Record<string, QuestionType> = {
    'mcq-single': 'multiple_choice_single',
    'mcq-multiple': 'multiple_choice_multiple',
    'true-false': 'true_false',
    'fill-blank': 'fill_in_blank',
  };

  return questions.map(q => {
    const type = normalizeQuestionType(q.type) || offlineTypeMap[q.type] || 'multiple_choice_single';
    const options = q.options?.map(o => o.text) || [];
    const correctFromOptions = q.options?.filter(o => o.isCorrect).map(o => o.text);

    return {
      id: q.id,
      type,
      question: q.stem,
      options: options.length ? options : undefined,
      correctAnswer: q.correctAnswer || correctFromOptions?.[0],
      correctAnswers: correctFromOptions && correctFromOptions.length > 1 ? correctFromOptions : undefined,
      explanation: q.explanation,
      diagramUrl: q.imageUrl,
      imageUrl: q.imageUrl,
      points: 10,
      tags: q.tags,
    };
  });
}

export function groupMessagesToGameQuestions(messages: GroupQuestionMessage[], count: number) {
  const testQuestions = selectGroupQuestions(messages, { numberOfQuestions: count });
  return testQuestions.map(q => ({
    id: q.id,
    text: q.question,
    questionType: q.type.replace('fill_in_blank', 'fill_in_the_blank') as any,
    options: q.options?.map((text, i) => ({ id: `opt-${i}`, text })),
    correctOptionIds: q.correctAnswer
      ? [`opt-${q.options?.indexOf(q.correctAnswer) ?? 0}`]
      : undefined,
    correctFillText: q.correctAnswer,
  }));
}

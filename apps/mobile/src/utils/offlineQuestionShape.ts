/**
 * ONE shape for the questions inside an offline bundle.
 *
 * A downloaded test is assembled from whatever the source happened to store,
 * and four different writers have put four different things in `options`:
 *
 *   - the canonical chat/question shape: `[{ id, text }]` with
 *     `correctAnswerIds`;
 *   - the generator's shape: plain strings, `["Status asthmaticus", …]`, with
 *     `correctAnswer` as the answer's TEXT, its INDEX, or its LETTER ("B");
 *   - an imported bank's shape, where the option object names its text
 *     `optionText` / `label` / `value` / `content`, or the list itself is
 *     called `choices`;
 *   - a legacy bundle whose options are the option IDS only ("A", "B", "C"),
 *     the text having lived somewhere the writer dropped.
 *
 * The mapper this file replaces read `opt.text` and nothing else, so every
 * shape but the first produced options with no text at all — which is what a
 * student saw on device: a downloaded 15-question test whose four answers
 * rendered as bare letters with nothing to read, and no way to answer it
 * honestly (build 172, "Tori I Practice Test").
 *
 * Everything here is pure and import-free so mobile jest (node env,
 * `*.test.ts`) can hold the real mapper — the previous test mirrored a copy
 * of it, which is why it stayed green while the shipped one was wrong.
 */

/** One answer option, as the offline bundle and the test runner store it. */
export interface OfflineQuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

/** A question in an offline bundle. Mirrors `OfflineQuestion` in offlineStore. */
export interface NormalizedOfflineQuestion {
  id: string;
  stem: string;
  type: string;
  options: OfflineQuestionOption[];
  correctAnswer?: string;
  acceptableAnswers?: string[];
  matchingPromptItems?: Array<{ id: string; text: string }>;
  matchingAnswerItems?: Array<{ id: string; text: string }>;
  correctMatches?: Array<{ promptItemId: string; answerItemId: string }>;
  diagramLabels?: Array<{ id?: string; label?: string; text?: string; x?: number; y?: number }>;
  explanation?: string;
  tags: string[];
  imageUrl?: string;
  createdAt?: string;
}

type Dict = Record<string, any>;

const str = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/** The keys every known writer has used for an option's readable text. */
const OPTION_TEXT_KEYS = [
  'text',
  'optionText',
  'option_text',
  'label',
  'value',
  'content',
  'body',
  'title',
  'answer',
];

/** The keys every known writer has used for the option LIST. */
const OPTION_LIST_KEYS = ['options', 'choices', 'answerOptions', 'answer_options', 'optionItems', 'option_items'];

function firstArray(payload: Dict, keys: readonly string[]): unknown[] {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

/**
 * True when the option TEXTS are the letters of their own positions —
 * "A", "B", "C", "D" in order. That is a set of labels with the answers
 * missing, not a set of answers: the player prints option text verbatim with
 * no letter beside it, so this is exactly what the student saw on device
 * (build 172, "Tori I Practice Test" — four rows reading A/B/C/D). A single
 * letter that is a genuine answer ("Which blood group…": A, B, AB, O) does
 * not fit the pattern, and is kept.
 */
export function isOptionLabelSet(texts: readonly string[]): boolean {
  const readable = texts.map((text) => (text ?? '').trim()).filter(Boolean);
  if (readable.length < 2) return false;
  return readable.every((text, index) => text.length === 1 && letterIndex(text) === index);
}

/** "B" → 1, "b" → 1; anything else → null. Single letters only. */
function letterIndex(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length !== 1) return null;
  const code = trimmed.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) return null;
  return code - 65;
}

/**
 * The options a question can actually be answered with.
 *
 * An entry whose text cannot be recovered is DROPPED rather than kept as a
 * blank (or as its own id, which is how "A / B / C / D" reached the screen):
 * a row a student cannot read is not an answer they can give, and leaving it
 * in makes an unanswerable question look answerable.
 */
export function normalizeQuestionOptions(payload: Dict): OfflineQuestionOption[] {
  const raw = firstArray(payload, OPTION_LIST_KEYS);
  if (raw.length === 0) return [];

  const correctIds: unknown[] = [
    ...(Array.isArray(payload.correctAnswerIds) ? payload.correctAnswerIds : []),
    ...(Array.isArray(payload.correct_answer_ids) ? payload.correct_answer_ids : []),
    ...(Array.isArray(payload.correctOptionIds) ? payload.correctOptionIds : []),
  ];
  const correctIdSet = new Set(correctIds.map(str).filter(Boolean));

  const rawCorrectAnswer = payload.correctAnswer ?? payload.correct_answer;
  const correctAnswerText = str(rawCorrectAnswer).trim();
  const correctIndex =
    typeof rawCorrectAnswer === 'number' && Number.isInteger(rawCorrectAnswer)
      ? rawCorrectAnswer
      : null;

  const mapped = raw.map((entry, index) => {
    const isObject = !!entry && typeof entry === 'object';
    const option: Dict = isObject ? (entry as Dict) : {};

    let text = '';
    if (!isObject) {
      // The generator's shape: the entry IS the answer's text.
      text = str(entry).trim();
    } else {
      for (const key of OPTION_TEXT_KEYS) {
        const candidate = str(option[key]).trim();
        if (candidate) {
          text = candidate;
          break;
        }
      }
    }

    const id = str(option.id ?? option.optionId ?? option.option_id).trim() || `opt-${index}`;

    const flagged =
      option.isCorrect === true || option.correct === true || option.is_correct === true;
    const byId = correctIdSet.has(id);
    const byText = !!text && !!correctAnswerText && text === correctAnswerText;
    const byIndex = correctIndex !== null && correctIndex === index;
    // "correctAnswer: 'B'" is a POSITION, not text — but only when no option
    // actually reads "B" (a True/False style single-letter answer would).
    const byLetter =
      !!correctAnswerText &&
      letterIndex(correctAnswerText) === index &&
      !raw.some((other) => str((other as Dict)?.text ?? other).trim() === correctAnswerText);

    return { id, text, isCorrect: flagged || byId || byText || byIndex || byLetter };
  });

  const readable = mapped.filter((option) => option.text.length > 0);
  // Letters standing in for answers are as unanswerable as blank rows.
  if (isOptionLabelSet(readable.map((option) => option.text))) return [];
  return readable;
}

/**
 * One raw question — a chat message, a bundle row, a cloud bundle entry —
 * normalised into the shape the offline runner reads. `null` when there is no
 * stem: a question with nothing to ask is not a question.
 */
export function normalizeOfflineBundleQuestion(
  message: any,
  index: number
): NormalizedOfflineQuestion | null {
  const source: Dict = message && typeof message === 'object' ? message : {};
  const payload: Dict = source.question || source.questionData || source.question_data || source;
  const stem = str(
    payload.questionStem ?? payload.question_stem ?? payload.stem ?? source.text ?? source.content
  ).trim();
  if (!stem) return null;

  const options = normalizeQuestionOptions(payload);
  const acceptableAnswers = Array.isArray(payload.acceptableAnswers)
    ? payload.acceptableAnswers
    : Array.isArray(payload.acceptable_answers)
      ? payload.acceptable_answers
      : undefined;

  // The stored correct answer, resolved to the option TEXT the runner
  // compares against — a letter or an index would never match an answer.
  const flaggedCorrect = options.find((option) => option.isCorrect)?.text;
  const rawCorrect = payload.correctAnswer ?? payload.correct_answer;
  const correctAnswer =
    flaggedCorrect ??
    (typeof rawCorrect === 'string' && rawCorrect.trim() ? rawCorrect : undefined) ??
    acceptableAnswers?.[0];

  return {
    id: str(source.id ?? payload.id) || `q-${index}`,
    stem,
    type: str(payload.questionType ?? payload.question_type ?? payload.type ?? source.questionType) || 'mcq-single',
    options,
    correctAnswer,
    acceptableAnswers,
    matchingPromptItems: Array.isArray(payload.matchingPromptItems)
      ? payload.matchingPromptItems
      : undefined,
    matchingAnswerItems: Array.isArray(payload.matchingAnswerItems)
      ? payload.matchingAnswerItems
      : undefined,
    correctMatches: Array.isArray(payload.correctMatches) ? payload.correctMatches : undefined,
    diagramLabels: Array.isArray(payload.diagramLabels) ? payload.diagramLabels : undefined,
    explanation: payload.explanation || source.explanation,
    tags: Array.isArray(payload.tags) ? payload.tags : Array.isArray(source.tags) ? source.tags : [],
    imageUrl: payload.imageUrl || source.imageUrl,
    createdAt: source.created_at || source.createdAt || source.timestamp || new Date().toISOString(),
  };
}

/** Question types whose whole answer is the option list. */
const CHOICE_TYPES = [
  'mcq-single',
  'mcq-multiple',
  'multiple_choice_single',
  'multiple_choice_multiple',
  'MULTIPLE_CHOICE_SINGLE',
  'MULTIPLE_CHOICE_MULTIPLE',
  'true-false',
  'true_false',
  'TRUE_FALSE',
];

/**
 * Can this question be answered as stored?
 *
 * A multiple-choice question with fewer than two readable options cannot: it
 * is either blank rows or a single row that is also the answer. Every other
 * type is judged by whether it kept the structure it is graded on.
 */
export function isPlayableOfflineQuestion(question: {
  type?: string;
  options?: Array<{ text?: string }>;
  acceptableAnswers?: string[];
  correctAnswer?: string;
  correctMatches?: unknown[];
  diagramLabels?: unknown[];
}): boolean {
  const type = str(question.type);
  const readable = (question.options || []).filter((option) => str(option?.text).trim().length > 0);
  if (!type || CHOICE_TYPES.includes(type)) {
    // A bundle already on the handset may still hold "A/B/C/D" as its texts.
    if (isOptionLabelSet(readable.map((option) => str(option?.text)))) return false;
    return readable.length >= 2;
  }
  if (type.toLowerCase().includes('matching')) return (question.correctMatches?.length ?? 0) > 0;
  if (type.toLowerCase().includes('diagram')) return (question.diagramLabels?.length ?? 0) > 0;
  if (type.toLowerCase().includes('fill') || type.toLowerCase().includes('blank')) {
    return !!(question.acceptableAnswers?.length || question.correctAnswer);
  }
  return true;
}

export interface BundlePlayabilityPlan<Q> {
  /** The questions a student can actually answer, in bundle order. */
  playable: Q[];
  /** How many were dropped because they carry no answerable content. */
  droppedCount: number;
  /**
   * What to tell the student before the session starts — `null` when the
   * bundle is whole. Never mentions a shape, a key or a file: it says how
   * many questions are usable, which is the only part they can act on.
   */
  notice: string | null;
  /** False when nothing in the bundle can be answered. */
  canStart: boolean;
}

/**
 * Decide what a downloaded bundle can actually run, and what to say about it.
 *
 * Starting a session on questions with no readable options is the defect this
 * exists to stop: the student gets a test they cannot answer and a score they
 * did not earn. Dropping them silently would be its own lie, so the count
 * comes back with them.
 */
export function planBundlePlayability<Q extends Parameters<typeof isPlayableOfflineQuestion>[0]>(
  questions: readonly Q[]
): BundlePlayabilityPlan<Q> {
  const playable = questions.filter((question) => isPlayableOfflineQuestion(question));
  const droppedCount = questions.length - playable.length;

  if (droppedCount === 0) {
    return { playable: [...playable], droppedCount, notice: null, canStart: playable.length > 0 };
  }

  if (playable.length === 0) {
    return {
      playable: [],
      droppedCount,
      notice:
        'This download is missing its answer options, so none of its questions can be answered. Delete it and download the test again.',
      canStart: false,
    };
  }

  return {
    playable: [...playable],
    droppedCount,
    notice:
      droppedCount === 1
        ? `1 question in this download is missing its answer options and has been left out. You can answer the other ${playable.length}.`
        : `${droppedCount} questions in this download are missing their answer options and have been left out. You can answer the other ${playable.length}.`,
    canStart: true,
  };
}

import type { TestQuestion, TestResult, UserAnswerRecord } from '../types';

type NoteLike = { title?: string; body?: string; summary?: string };

function isAnswerAttempted(answer: UserAnswerRecord | undefined): boolean {
  if (!answer) return false;
  return (
    (answer.selectedOptionIds && answer.selectedOptionIds.length > 0) ||
    (answer.fillText && answer.fillText.trim() !== '') ||
    (answer.matchingAnswers && answer.matchingAnswers.length > 0) ||
    (answer.diagramAnswers && answer.diagramAnswers.length > 0)
  );
}

function formatCorrectAnswer(q: TestQuestion): string {
  if (q.acceptableAnswers?.length) {
    return q.acceptableAnswers.join(' / ');
  }
  if (q.correctAnswerIds?.length && q.options?.length) {
    const texts = q.correctAnswerIds
      .map((id) => q.options!.find((o) => o.id === id)?.text)
      .filter(Boolean);
    if (texts.length) return texts.join(', ');
  }
  if (q.explanation?.trim()) return q.explanation.trim();
  return 'Review the explanation for this concept.';
}

function formatUserAnswer(q: TestQuestion, answer: UserAnswerRecord): string {
  if (answer.fillText?.trim()) return answer.fillText.trim();
  if (answer.selectedOptionIds?.length && q.options?.length) {
    const texts = answer.selectedOptionIds
      .map((id) => q.options!.find((o) => o.id === id)?.text)
      .filter(Boolean);
    if (texts.length) return texts.join(', ');
  }
  return 'No answer provided';
}

/** Tags with under 60% correct rate on a completed test. */
export function computeWeakTopicsFromTestResult(results: TestResult): string[] {
  const weakTagSet = new Map<string, { correct: number; total: number }>();
  results.session.questions.forEach((q) => {
    const isCorrect = results.session.userAnswers[q.id]?.isCorrect ?? false;
    (q.tags || []).forEach((tag) => {
      const cur = weakTagSet.get(tag) || { correct: 0, total: 0 };
      cur.total++;
      if (isCorrect) cur.correct++;
      weakTagSet.set(tag, cur);
    });
  });
  return Array.from(weakTagSet.entries())
    .filter(([, s]) => s.total > 0 && s.correct / s.total < 0.6)
    .map(([tag]) => tag);
}

/** Build study material from missed test questions for AI flashcard generation. */
export function buildFlashcardSourceFromTestResult(
  results: TestResult,
  weakTopics?: string[]
): string {
  const topics = weakTopics ?? computeWeakTopicsFromTestResult(results);
  const { session } = results;
  const lines: string[] = [];

  lines.push(
    `Test review — score ${Math.round(results.score)}% (${results.correctAnswersCount}/${results.totalQuestions} correct).`
  );
  if (topics.length) {
    lines.push(`Weak topics to focus on: ${topics.join(', ')}.`);
  }
  lines.push('');
  lines.push('Questions I missed or got wrong:');

  const missedQuestions = session.questions.filter((q) => {
    const answer = session.userAnswers[q.id];
    const attempted = isAnswerAttempted(answer);
    const isCorrect = answer?.isCorrect ?? false;
    if (attempted && isCorrect) return false;

    if (topics.length === 0) return true;
    const tags = q.tags || [];
    if (tags.length === 0) return true;
    return tags.some((tag) => topics.includes(tag));
  });

  missedQuestions.forEach((q) => {
    const answer = session.userAnswers[q.id];
    const stem = q.questionStem || q.text || `Question ${q.questionNumber}`;
    const tags = q.tags?.length ? ` [Tags: ${q.tags.join(', ')}]` : '';
    lines.push('');
    lines.push(`Q${q.questionNumber}: ${stem}${tags}`);
    lines.push(`Correct answer: ${formatCorrectAnswer(q)}`);
    if (answer && isAnswerAttempted(answer) && !answer.isCorrect) {
      lines.push(`My answer: ${formatUserAnswer(q, answer)}`);
    } else if (!isAnswerAttempted(answer)) {
      lines.push('Status: unattempted');
    }
    if (q.explanation?.trim()) {
      lines.push(`Explanation: ${q.explanation.trim()}`);
    }
  });

  if (lines.join('\n').length < 50) {
    return buildFlashcardSourceContent({
      topics: topics.join(', '),
      weakTopics: topics,
    });
  }

  return lines.join('\n').slice(0, 8000);
}

/** Build >=50 chars of study material for AI flashcard generation. */
export function buildFlashcardSourceContent(options: {
  topics: string;
  weakTopics?: string[];
  selectedNote?: NoteLike | null;
  notes?: NoteLike[];
}): string {
  const fromSelected = [options.selectedNote?.summary, options.selectedNote?.body]
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (fromSelected.length >= 50) {
    return fromSelected.slice(0, 8000);
  }

  const fromLibrary = (options.notes || [])
    .map((n) => [n.summary, n.body].filter(Boolean).join('\n\n').trim())
    .filter((text) => text.length >= 50)
    .sort((a, b) => b.length - a.length)[0];
  if (fromLibrary) {
    return fromLibrary.slice(0, 8000);
  }

  const topicList = options.topics
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const weakList =
    topicList.length > 0
      ? topicList
      : (options.weakTopics || []).filter(Boolean);

  if (weakList.length > 0) {
    return weakList
      .map(
        (topic) =>
          `Study topic: ${topic}. Create flashcards covering essential definitions, key facts, common misconceptions, and exam-style questions about ${topic}. Focus on material a student needs to memorize and understand for tests.`
      )
      .join('\n\n')
      .slice(0, 8000);
  }

  return [
    'General study review for a university student.',
    'Generate flashcards covering core definitions, key concepts, formulas, and factual knowledge',
    'that commonly appear on exams across science, humanities, and professional courses.',
  ].join(' ');
}

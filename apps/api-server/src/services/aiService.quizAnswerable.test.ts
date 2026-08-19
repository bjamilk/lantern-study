/**
 * A quiz whose questions have no options renders as prompts with nothing to
 * click, and every layer above treats it as a success — including the response
 * cache, which pins it for a week. These pin the two behaviours that prevent
 * that: unanswerable questions are rejected, and a wholly unusable batch fails
 * loudly rather than being returned and cached.
 */
import {
  generateDailyQuiz,
  generateQuestionsFromNotes,
  generateFlashcardsFromNotes,
} from './aiService';
import { clearAiResponseCacheForTests } from './aiResponseCache';

const realFetch = global.fetch;
const realGroqKey = process.env.GROQ_API_KEY;

function groqReply(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

const GOOD = {
  text: 'What converts light to chemical energy?',
  type: 'multiple_choice',
  options: ['Digestion', 'Respiration', 'Photosynthesis', 'Mitosis'],
  correctAnswer: 'Photosynthesis',
  explanation: 'Photosynthesis converts light.',
  difficulty: 'medium',
  topic: 'Biology',
};

beforeEach(() => {
  clearAiResponseCacheForTests();
  process.env.GROQ_API_KEY = 'test-key';
  process.env.AI_RESPONSE_CACHE = 'off';
});

afterEach(() => {
  global.fetch = realFetch;
  if (realGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realGroqKey;
  delete process.env.AI_RESPONSE_CACHE;
  jest.restoreAllMocks();
});

const material = 'Photosynthesis is the process by which plants convert light energy into chemical energy stored as sugar.';

describe('daily quiz answerability', () => {
  it('drops a multiple-choice question that arrived with no options', async () => {
    global.fetch = jest.fn(async () =>
      groqReply({
        questions: [
          GOOD,
          { ...GOOD, text: 'Unanswerable one', options: [] },
          { ...GOOD, text: 'Missing options entirely', options: undefined },
        ],
      })
    ) as unknown as typeof fetch;

    const result = await generateDailyQuiz(material, { count: 5 });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].text).toBe(GOOD.text);
    expect(result.questions[0].options?.length).toBe(4);
  });

  it('drops a question whose correct answer is not among its options', async () => {
    global.fetch = jest.fn(async () =>
      groqReply({
        questions: [{ ...GOOD, correctAnswer: 'Something else entirely' }],
      })
    ) as unknown as typeof fetch;

    await expect(generateDailyQuiz(material, { count: 5 })).rejects.toThrow(
      /no answerable questions/i
    );
  });

  it('fails loudly when nothing is answerable, so the result is never cached', async () => {
    global.fetch = jest.fn(async () =>
      groqReply({ questions: [{ ...GOOD, options: [] }, { ...GOOD, options: ['Only one'] }] })
    ) as unknown as typeof fetch;

    await expect(generateDailyQuiz(material, { count: 5 })).rejects.toThrow(
      /no answerable questions/i
    );
  });

  it('keeps fill-in-blank questions, which carry no options by design', async () => {
    global.fetch = jest.fn(async () =>
      groqReply({
        questions: [
          {
            text: 'Photosynthesis converts light into ____ energy.',
            type: 'fill_in_blank',
            correctAnswer: 'chemical',
            explanation: 'Stored as sugar.',
            difficulty: 'easy',
            topic: 'Biology',
          },
        ],
      })
    ) as unknown as typeof fetch;

    const { questions } = await generateQuestionsFromNotes(material, { count: 5 });

    // Requiring options here would have discarded a perfectly valid question.
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe('fill_in_blank');
  });

  it('drops practice-test questions that arrived with no options', async () => {
    global.fetch = jest.fn(async () =>
      groqReply({ questions: [GOOD, { ...GOOD, text: 'No options here', options: [] }] })
    ) as unknown as typeof fetch;

    const { questions } = await generateQuestionsFromNotes(material, { count: 5 });

    expect(questions).toHaveLength(1);
    expect(questions[0].text).toBe(GOOD.text);
  });

  it('rejects a flashcard batch where every card has a blank side', async () => {
    global.fetch = jest.fn(async () =>
      groqReply({ flashcards: [{ front: 'Q', back: '' }, { front: '', back: 'A' }] })
    ) as unknown as typeof fetch;

    await expect(generateFlashcardsFromNotes(material, { count: 5 })).rejects.toThrow(
      /no usable cards/i
    );
  });

  it('keeps the good flashcards and drops the blank ones', async () => {
    global.fetch = jest.fn(async () =>
      groqReply({ flashcards: [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: '   ' }] })
    ) as unknown as typeof fetch;

    const { flashcards } = await generateFlashcardsFromNotes(material, { count: 5 });

    expect(flashcards).toHaveLength(1);
    expect(flashcards[0].front).toBe('Q1');
  });

  it('gives the model room to think on top of the caller\'s answer budget', async () => {
    const fetchMock = jest.fn(async () => groqReply({ flashcards: [{ front: 'Q', back: 'A' }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await generateFlashcardsFromNotes(material, { count: 1 });

    const sent = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    // A reasoning trace is billed against the same budget as the answer, so the
    // request must ask for more than the caller's own figure.
    expect(sent.max_tokens).toBeGreaterThan(2048);
  });

  it('keeps true/false questions, which carry their own options', async () => {
    global.fetch = jest.fn(async () =>
      groqReply({
        questions: [
          {
            text: 'Plants need light to grow.',
            type: 'true_false',
            options: ['True', 'False'],
            correctAnswer: 'True',
            explanation: 'They do.',
            difficulty: 'easy',
            topic: 'Biology',
          },
        ],
      })
    ) as unknown as typeof fetch;

    const result = await generateDailyQuiz(material, { count: 5 });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].options).toEqual(['True', 'False']);
  });
});

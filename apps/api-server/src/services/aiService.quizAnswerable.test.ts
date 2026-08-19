/**
 * A quiz whose questions have no options renders as prompts with nothing to
 * click, and every layer above treats it as a success — including the response
 * cache, which pins it for a week. These pin the two behaviours that prevent
 * that: unanswerable questions are rejected, and a wholly unusable batch fails
 * loudly rather than being returned and cached.
 */
import { generateDailyQuiz } from './aiService';
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

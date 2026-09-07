/**
 * How many questions a daily quiz asks the model for.
 *
 * The clamp used to be `Math.min(count ?? 5, 5)`, applied silently: the mobile
 * test builder asked for 10, said "10-question test · Writing 10 questions"
 * throughout, and saved 5. Nothing in the request, the note or the credit
 * ledger explained the difference — the ceiling did, and no surface knew about
 * it. These pin the ceiling and the prompt that carries it.
 */
import {
  DAILY_QUIZ_DEFAULT_QUESTIONS,
  DAILY_QUIZ_MAX_QUESTIONS,
  clampDailyQuizCount,
  generateDailyQuiz,
} from './aiService';
import { clearAiResponseCacheForTests } from './aiResponseCache';

const realFetch = global.fetch;
const realGroqKey = process.env.GROQ_API_KEY;

const question = (text: string) => ({
  text,
  type: 'multiple_choice',
  options: ['Digestion', 'Respiration', 'Photosynthesis', 'Mitosis'],
  correctAnswer: 'Photosynthesis',
  explanation: 'Photosynthesis converts light.',
  difficulty: 'medium',
  topic: 'Biology',
});

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

describe('clampDailyQuizCount', () => {
  it('lets a client ask for ten, which is what the test builder asks for', () => {
    expect(clampDailyQuizCount(10)).toBe(10);
    expect(DAILY_QUIZ_MAX_QUESTIONS).toBe(10);
  });

  it('still has a ceiling, so one request cannot ask for fifty', () => {
    expect(clampDailyQuizCount(50)).toBe(DAILY_QUIZ_MAX_QUESTIONS);
  });

  it('falls back to five when nothing sensible was asked for', () => {
    expect(clampDailyQuizCount(undefined)).toBe(DAILY_QUIZ_DEFAULT_QUESTIONS);
    expect(clampDailyQuizCount(0)).toBe(DAILY_QUIZ_DEFAULT_QUESTIONS);
    expect(clampDailyQuizCount(-3)).toBe(DAILY_QUIZ_DEFAULT_QUESTIONS);
    expect(clampDailyQuizCount(Number.NaN)).toBe(DAILY_QUIZ_DEFAULT_QUESTIONS);
  });
});

describe('generateDailyQuiz', () => {
  it('asks the model for the ten it was given, not for five', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                questions: Array.from({ length: 10 }, (_, i) => question(`Q${i + 1}?`)),
              }),
            },
          },
        ],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const result = await generateDailyQuiz('Photosynthesis converts light energy into sugar.', {
      count: 10,
    });

    expect(result.questions).toHaveLength(10);
    const body = JSON.parse(String((fetchMock as jest.Mock).mock.calls[0][1].body));
    expect(JSON.stringify(body)).toContain('exactly 10 questions');
  });
});

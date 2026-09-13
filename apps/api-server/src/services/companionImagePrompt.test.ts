/**
 * What an attached photo actually puts in front of the model.
 *
 * There is no vision path in the companion's chat providers, so "the companion
 * read my photo" is really "the transcript taken at upload time is in the
 * prompt". If that block is missing the student is still charged two AI uses
 * for the read and then told "I'm not seeing an image here" — which is exactly
 * what shipped. These pin the block's presence, its fence, and its silence
 * when there is nothing to say.
 */
import { companionChat } from './aiService';

const realFetch = global.fetch;
const realGroqKey = process.env.GROQ_API_KEY;

let systemPrompts: string[] = [];

function mockGroq(reply: string) {
  systemPrompts = [];
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    systemPrompts.push(String(body.messages?.[0]?.content || ''));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: reply } }] }),
      text: async () => reply,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.GROQ_API_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = realFetch;
  if (realGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realGroqKey;
  jest.restoreAllMocks();
});

const IMAGE = {
  id: 'att-1',
  title: 'testcard.png',
  text: 'THE MITOCHONDRION is the powerhouse of the cell. Code: LANTERN-2C99',
  wordCount: 10,
};

describe('an attached photo in the companion prompt', () => {
  it('puts the extracted text in the prompt', async () => {
    mockGroq('It says the mitochondrion is the powerhouse of the cell.');

    await companionChat('What does the image say?', [], { imageAttachments: [IMAGE] });

    const prompt = systemPrompts[0];
    expect(prompt).toContain('LANTERN-2C99');
    expect(prompt).toContain('powerhouse of the cell');
  });

  it('fences it as untrusted and names the file it came from', async () => {
    mockGroq('Answer.');

    await companionChat('What does the image say?', [], { imageAttachments: [IMAGE] });

    const prompt = systemPrompts[0];
    expect(prompt).toContain('BEGIN UNTRUSTED IMAGE TEXT');
    expect(prompt).toContain('END UNTRUSTED IMAGE TEXT');
    expect(prompt).toContain('testcard.png');
    // The model is told it is reading a transcript, not looking at a picture.
    expect(prompt).toContain('You cannot see the picture');
  });

  it('says nothing about photos when none were attached', async () => {
    mockGroq('Answer.');

    await companionChat('What does the image say?', [], {});

    expect(systemPrompts[0]).not.toContain('UNTRUSTED IMAGE TEXT');
  });

  it('ignores an attachment the reader found no text in', async () => {
    mockGroq('Answer.');

    await companionChat('What does the image say?', [], {
      imageAttachments: [{ id: 'att-2', title: 'blank.png', text: '   ', wordCount: 0 }],
    });

    expect(systemPrompts[0]).not.toContain('UNTRUSTED IMAGE TEXT');
  });
});

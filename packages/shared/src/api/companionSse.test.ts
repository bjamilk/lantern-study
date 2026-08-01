import { consumeCompanionSseBuffer, readCompanionStreamError } from './companionSse';

describe('consumeCompanionSseBuffer', () => {
  it('emits tokens and done from SSE frames', () => {
    const tokens: string[] = [];
    let donePayload: unknown = null;
    const { rest, stopped } = consumeCompanionSseBuffer(
      'data: {"token":"Hello"}\n\ndata: {"token":" world"}\n\ndata: {"done":true,"actions":[],"messageId":"m1","conversationId":"c1"}\n\n',
      {
        onToken: (t) => tokens.push(t),
        onDone: (r) => {
          donePayload = r;
        },
        onError: () => {
          throw new Error('should not error');
        },
      }
    );
    expect(stopped).toBe(true);
    expect(rest).toBe('');
    expect(tokens.join('')).toBe('Hello world');
    expect(donePayload).toEqual({
      actions: [],
      messageId: 'm1',
      userMessageId: undefined,
      conversationId: 'c1',
    });
  });

  it('surfaces SSE error events', () => {
    let errMessage = '';
    const { stopped } = consumeCompanionSseBuffer(
      'data: {"error":"AI companion is temporarily unavailable"}\n\n',
      {
        onToken: () => undefined,
        onDone: () => undefined,
        onError: (e) => {
          errMessage = e.message;
        },
      }
    );
    expect(stopped).toBe(true);
    expect(errMessage).toBe('AI companion is temporarily unavailable');
  });
});

describe('readCompanionStreamError', () => {
  it('prefers JSON error bodies over status-only messages', async () => {
    const response = new Response(
      JSON.stringify({ error: 'Daily limit reached for this feature (companion)' }),
      { status: 429 }
    );
    const err = await readCompanionStreamError(response);
    expect(err.message).toBe('Daily limit reached for this feature (companion)');
  });

  it('falls back to status when body is empty', async () => {
    const response = new Response('', { status: 503 });
    const err = await readCompanionStreamError(response);
    expect(err.message).toBe('Stream request failed (503)');
  });
});

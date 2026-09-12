/**
 * The phone's only send path is the RN fallback inside
 * `companionSendMessageStream`: React Native cannot read a streamed body, so
 * `supportsResponseStreaming: false` sends the JSON `POST /message` and hands
 * the whole reply to the same callbacks the SSE path uses.
 *
 * Android 1.0.48 showed answers with inline "(Excerpt N)" text and no source
 * chips. These tests pin the client half of that: given a recorded JSON body
 * that DOES carry `citations`, the fallback must deliver them to `onDone` in
 * the same normalised shape the SSE `done` frame delivers — and given a
 * malformed one, it must deliver null rather than a chip pointing nowhere.
 */
import { createCompanionClient, normalizeCompanionCitation } from './companion';

/** A real `POST /api/v1/ai/companion/message` 200 body with citations. */
const RECORDED_JSON_BODY = {
  reply:
    'Pancreatitis results from premature activation of pancreatic enzymes. (Excerpt 1)\n' +
    'Gallstones and alcohol are the two leading causes. (Excerpt 2)',
  actions: [],
  provider: 'anthropic',
  citations: {
    noteId: '7c1f0b3e-2a44-4c9d-9f10-8b2e5d6a7c31',
    noteTitle: 'Pancreatitis PPT Student',
    excerpts: [1, 2],
  },
  conversationId: '0b8a2f61-9d3c-4e77-a2b1-5c9f4e8d1a02',
};

function clientWithBody(body: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  const client = createCompanionClient({
    getBaseUrl: () => 'https://api.test',
    getAuthHeaders: async () => ({ 'Content-Type': 'application/json' }),
    // This is the mobile config: no streamed bodies, so the JSON path runs.
    supportsResponseStreaming: false,
  });
  return { client, fetchMock };
}

describe('companionSendMessageStream — mobile JSON fallback', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('delivers citations from the JSON body to onDone', async () => {
    const { client, fetchMock } = clientWithBody(RECORDED_JSON_BODY);
    const onDone = jest.fn();
    const onError = jest.fn();
    const tokens: string[] = [];

    await client.companionSendMessageStream(
      'Summarise this note in 3 bullets',
      { noteId: RECORDED_JSON_BODY.citations.noteId },
      (t) => tokens.push(t),
      onDone,
      onError
    );

    expect(onError).not.toHaveBeenCalled();
    // The JSON path, not the SSE path.
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/ai/companion/message');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/stream');
    expect(tokens.join('')).toContain('(Excerpt 1)');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0].citations).toEqual({
      noteId: '7c1f0b3e-2a44-4c9d-9f10-8b2e5d6a7c31',
      noteTitle: 'Pancreatitis PPT Student',
      excerpts: [1, 2],
    });
    expect(onDone.mock.calls[0][0].conversationId).toBe(RECORDED_JSON_BODY.conversationId);
  });

  it('delivers null when the body omits citations (the shipped server bug)', async () => {
    // What the deployed queue worker actually returns: citations dropped.
    const { reply, actions, provider, conversationId } = RECORDED_JSON_BODY;
    const { client } = clientWithBody({ reply, actions, provider, conversationId });
    const onDone = jest.fn();

    await client.companionSendMessageStream('Summarise', undefined, () => {}, onDone, () => {});

    expect(onDone.mock.calls[0][0].citations).toBeNull();
  });

  it('drops a malformed citation rather than rendering a chip that goes nowhere', async () => {
    const { client } = clientWithBody({
      ...RECORDED_JSON_BODY,
      citations: { noteId: '', noteTitle: 'Pancreatitis', excerpts: [1] },
    });
    const onDone = jest.fn();

    await client.companionSendMessageStream('Summarise', undefined, () => {}, onDone, () => {});

    expect(onDone.mock.calls[0][0].citations).toBeNull();
  });
});

describe('normalizeCompanionCitation', () => {
  it('keeps a well-formed citation and defaults a missing title', () => {
    expect(normalizeCompanionCitation({ noteId: 'n1', excerpts: [2, 1] })).toEqual({
      noteId: 'n1',
      noteTitle: 'Untitled note',
      excerpts: [2, 1],
    });
  });

  it('rejects an empty excerpt list — nothing to point at', () => {
    expect(normalizeCompanionCitation({ noteId: 'n1', excerpts: [] })).toBeNull();
    expect(normalizeCompanionCitation({ noteId: 'n1', excerpts: [0, -3] })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(normalizeCompanionCitation(null)).toBeNull();
    expect(normalizeCompanionCitation('Excerpt 1')).toBeNull();
  });
});

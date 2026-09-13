/**
 * The wire, not the mock.
 *
 * A phone can hold a read photo, show its chip, and still answer "I can't view
 * the image" — because what matters is the JSON that actually leaves the
 * device. This test drives the store's real send path through the real shared
 * companion client and reads the request body off a fetch spy, so an id that
 * is dropped anywhere between the store and `fetch` fails here.
 */
import { createCompanionClient } from '@lantern/shared/api/companion';

const fetchMock = jest.fn();
(globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

// The real client, configured exactly like services/ai does on the phone
// (React Native cannot read a streamed body, so every send is JSON /message).
const client = createCompanionClient({
  getBaseUrl: () => 'https://api.test',
  getAuthHeaders: async () => ({ 'Content-Type': 'application/json' }),
  supportsResponseStreaming: false,
});

const uploadCompanionImage = jest.fn();

jest.mock('../services/ai', () => ({
  companionSendMessage: (...args: unknown[]) =>
    (client as any).companionSendMessage(...(args as [])),
  companionSendMessageStream: (...args: unknown[]) =>
    (client as any).companionSendMessageStream(...(args as [])),
  fetchCompanionHistory: jest.fn(async () => ({
    messages: [],
    conversationId: null,
    noteContextId: null,
  })),
  clearCompanionHistory: jest.fn(),
  fetchCompanionConversations: jest.fn(async () => ({ conversations: [] })),
  uploadCompanionImage: (...args: unknown[]) => uploadCompanionImage(...(args as [])),
}));

const asyncStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => asyncStore[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    asyncStore[k] = v;
  }),
  removeItem: jest.fn(async (k: string) => {
    delete asyncStore[k];
  }),
}));

import { useCompanionStore } from './companionStore';

const ATTACHMENT = {
  attachmentId: 'c0ffee00-1111-4222-8333-444444444444',
  url: 'https://signed.test/page.webp',
  fileName: 'page.webp',
  extractedText: 'Krebs cycle produces two ATP per turn',
  wordCount: 7,
  creditsCharged: 2,
};

function replyOnce(imagesAtRequest: Array<unknown[]>) {
  fetchMock.mockImplementation(async (_url: string, options: any) => {
    // Snapshot what the store still held at the moment the request went out:
    // clearing the chips before the body is built loses the ids silently.
    imagesAtRequest.push([...useCompanionStore.getState().pendingImages]);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        reply: 'That page is about the Krebs cycle.',
        actions: [],
        citations: null,
        conversationId: 'conv-1',
      }),
    };
  });
}

describe('mobile companion send carries the attachment ids on the wire', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    uploadCompanionImage.mockReset();
    uploadCompanionImage.mockResolvedValue(ATTACHMENT);
    useCompanionStore.setState({
      messages: [],
      activeNoteContext: null,
      activeConversationId: null,
      pendingNewConversation: true,
      error: null,
      isLoading: false,
      isStreaming: false,
      pendingImages: [],
      isUploadingImage: false,
      imageError: null,
    });
  });

  it('sends context.imageAttachments[0].attachmentId from the streaming path', async () => {
    const held: Array<unknown[]> = [];
    replyOnce(held);
    await useCompanionStore.getState().attachImage({ base64Data: 'AAAA', previewUri: 'file:///a' });

    await useCompanionStore.getState().sendMessageStreaming('What is on this page?');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/v1/ai/companion/message');
    const body = JSON.parse(options.body);
    expect(body.context?.imageAttachments?.[0]?.attachmentId).toBe(ATTACHMENT.attachmentId);
    // The local file:// preview is this phone's business only.
    expect(options.body).not.toContain('previewUri');
    // Cleared only AFTER the request was issued.
    expect(held[0]).toHaveLength(1);
    expect(useCompanionStore.getState().pendingImages).toHaveLength(0);
  });

  it('waits for a photo still being read rather than asking blind', async () => {
    const held: Array<unknown[]> = [];
    replyOnce(held);
    // The read is the slow, billable half: the picker has already returned and
    // the student is typing while the upload is still in the air.
    let finishUpload: (value: typeof ATTACHMENT) => void = () => {};
    uploadCompanionImage.mockReturnValue(
      new Promise<typeof ATTACHMENT>((resolve) => {
        finishUpload = resolve;
      })
    );
    const attaching = useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });
    expect(useCompanionStore.getState().pendingImages).toHaveLength(0);

    const sending = useCompanionStore.getState().sendMessageStreaming('What is on this page?');
    finishUpload(ATTACHMENT);
    await attaching;
    await sending;

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.context?.imageAttachments?.[0]?.attachmentId).toBe(ATTACHMENT.attachmentId);
  });

  it('sends context.imageAttachments[0].attachmentId from the JSON path', async () => {
    const held: Array<unknown[]> = [];
    replyOnce(held);
    await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });

    await useCompanionStore.getState().sendMessage('What is on this page?');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.context?.imageAttachments?.[0]?.attachmentId).toBe(ATTACHMENT.attachmentId);
    expect(held[0]).toHaveLength(1);
    expect(useCompanionStore.getState().pendingImages).toHaveLength(0);
  });
});

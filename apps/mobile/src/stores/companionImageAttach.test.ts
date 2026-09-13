/**
 * The phone's half of "Add image".
 *
 * Mobile sends through `sendMessage` (React Native cannot read a streamed
 * body), so that is the path a photo has to survive: attached ids reach the
 * send context, and are gone by the next question — a photo left attached
 * would ground every later answer in a page the student had moved on from.
 */
const uploadCompanionImage = jest.fn();
const companionSendMessage = jest.fn(async () => ({
  reply: 'That page is about the Krebs cycle.',
  actions: [],
  provider: 'groq',
  citations: null,
  conversationId: 'conv-1',
}));

jest.mock('../services/ai', () => ({
  companionSendMessage: (...args: unknown[]) => companionSendMessage(...(args as [])),
  companionSendMessageStream: jest.fn(),
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

describe('companion image attachments (mobile)', () => {
  beforeEach(() => {
    companionSendMessage.mockClear();
    uploadCompanionImage.mockReset();
    uploadCompanionImage.mockResolvedValue(ATTACHMENT);
    useCompanionStore.setState({
      messages: [],
      activeNoteContext: null,
      activeConversationId: null,
      pendingNewConversation: false,
      error: null,
      pendingImages: [],
      isUploadingImage: false,
      imageError: null,
    });
  });

  it('keeps the read photo, with its word count, for the next question', async () => {
    const attached = await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });

    expect(attached).toEqual(ATTACHMENT);
    expect(useCompanionStore.getState().pendingImages).toHaveLength(1);
    expect(useCompanionStore.getState().pendingImages[0].wordCount).toBe(7);
  });

  it('carries the attachment into the send context, then drops it', async () => {
    await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });
    await useCompanionStore.getState().sendMessage('What is on this page?');

    const [, context] = companionSendMessage.mock.calls[0] as unknown as [string, any];
    expect(context.imageAttachments).toHaveLength(1);
    expect(context.imageAttachments[0].attachmentId).toBe(ATTACHMENT.attachmentId);
    expect(useCompanionStore.getState().pendingImages).toHaveLength(0);

    await useCompanionStore.getState().sendMessage('And the one before it?');
    const [, second] = companionSendMessage.mock.calls[1] as unknown as [string, any];
    expect(second.imageAttachments).toBeUndefined();
  });

  it('removes one attachment and clears the rest on demand', async () => {
    await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });
    uploadCompanionImage.mockResolvedValue({ ...ATTACHMENT, attachmentId: 'second-id' });
    await useCompanionStore.getState().attachImage({ base64Data: 'BBBB' });

    useCompanionStore.getState().removeImage(ATTACHMENT.attachmentId);
    expect(useCompanionStore.getState().pendingImages.map((i) => i.attachmentId)).toEqual([
      'second-id',
    ]);

    useCompanionStore.getState().clearPendingImages();
    expect(useCompanionStore.getState().pendingImages).toHaveLength(0);
  });

  it('reports a failed read instead of attaching nothing silently', async () => {
    uploadCompanionImage.mockRejectedValue(new Error('That image is over 10 MB.'));

    const attached = await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });

    expect(attached).toBeNull();
    expect(useCompanionStore.getState().pendingImages).toHaveLength(0);
    expect(useCompanionStore.getState().imageError).toContain('over 10 MB');
  });

  it('keeps the sheet open on a failed read and never shows a bare class name', async () => {
    // What the API's error handler actually answers an unhandled throw with.
    const generic = Object.assign(new Error('Error'), { status: 500 });
    uploadCompanionImage.mockRejectedValue(generic);
    useCompanionStore.setState({ isOpen: true });

    const attached = await useCompanionStore
      .getState()
      .attachImage({ base64Data: 'AAAA', fileName: 'testcard.png' });

    const state = useCompanionStore.getState();
    expect(attached).toBeNull();
    expect(state.isOpen).toBe(true);
    expect(state.isUploadingImage).toBe(false);
    expect(state.imageError).not.toBe('Error');
    expect(state.imageError).toContain('500');
    expect(state.imageErrorDetail).toContain('testcard.png');
  });

  it('translates the pending-migration 503 into copy a student can read', async () => {
    uploadCompanionImage.mockRejectedValue(
      Object.assign(
        new Error(
          'Image attachments are not enabled yet (apply 20260912100000_companion_image_attachments.sql).'
        ),
        { status: 503 }
      )
    );
    useCompanionStore.setState({ isOpen: true });

    await useCompanionStore
      .getState()
      .attachImage({ base64Data: 'AAAA', fileName: 'testcard.png' });

    const state = useCompanionStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.imageError).toBe('Photos need a server update — try again later.');
    // The migration name is small print, not the headline.
    expect(state.imageError).not.toContain('.sql');
    expect(state.imageErrorDetail).toContain('20260912100000_companion_image_attachments.sql');
    expect(state.imageErrorDetail).toContain('testcard.png');
  });

  it('clears the failure when the next photo is attached', async () => {
    uploadCompanionImage.mockRejectedValue(new Error('That image is over 10 MB.'));
    await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });
    expect(useCompanionStore.getState().imageError).not.toBeNull();

    uploadCompanionImage.mockResolvedValue(ATTACHMENT);
    await useCompanionStore.getState().attachImage({ base64Data: 'BBBB' });

    expect(useCompanionStore.getState().imageError).toBeNull();
    expect(useCompanionStore.getState().imageErrorDetail).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * A photo attached in the composer has to reach the question it was attached
 * to — and only that question.
 *
 * The companion cannot see pictures: the server reads each one once, at
 * upload, and grounds the answer in the transcript. So the store's job is to
 * carry the attachment ids into the send context, and to drop them afterwards
 * — a photo left attached would silently ground every later question in the
 * thread in a page the student had moved on from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const companionSendMessage = vi.fn(async () => ({
  reply: 'That page is about the Krebs cycle.',
  actions: [],
  provider: 'groq',
  citations: null,
  conversationId: 'conv-1',
}));
const uploadCompanionImage = vi.fn();

vi.mock('../services/ai', () => ({
  companionSendMessage: (...args: unknown[]) => companionSendMessage(...(args as [])),
  companionSendMessageStream: vi.fn(),
  fetchCompanionHistory: vi.fn(async () => ({
    messages: [],
    conversationId: null,
    noteContextId: null,
  })),
  clearCompanionHistory: vi.fn(async () => ({})),
  fetchCompanionConversations: vi.fn(async () => ({ conversations: [] })),
  uploadCompanionImage: (...args: unknown[]) => uploadCompanionImage(...(args as [])),
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

beforeEach(() => {
  localStorage.clear();
  companionSendMessage.mockClear();
  uploadCompanionImage.mockReset();
  uploadCompanionImage.mockResolvedValue(ATTACHMENT);
  useCompanionStore.setState({
    activeNoteContext: null,
    activeConversationId: null,
    pendingNewConversation: false,
    messages: [],
    historyLoaded: false,
    error: null,
    pendingImages: [],
    isUploadingImage: false,
    imageError: null,
  });
});

describe('companion image attachments', () => {
  it('keeps the read photo, with its word count, for the next question', async () => {
    const attached = await useCompanionStore.getState().attachImage({
      base64Data: 'AAAA',
      fileName: 'page.png',
      contentType: 'image/png',
    });

    expect(attached).toEqual(ATTACHMENT);
    const state = useCompanionStore.getState();
    expect(state.pendingImages).toHaveLength(1);
    expect(state.pendingImages[0].wordCount).toBe(7);
    expect(state.isUploadingImage).toBe(false);
    expect(state.imageError).toBeNull();
  });

  it('carries the attachment into the send context', async () => {
    await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });
    await useCompanionStore.getState().sendMessage('What is on this page?');

    const [, context] = companionSendMessage.mock.calls[0] as [string, any];
    expect(context.imageAttachments).toHaveLength(1);
    expect(context.imageAttachments[0].attachmentId).toBe(ATTACHMENT.attachmentId);
  });

  it('drops the attachment once the question it belonged to is answered', async () => {
    await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });
    await useCompanionStore.getState().sendMessage('What is on this page?');

    expect(useCompanionStore.getState().pendingImages).toHaveLength(0);

    await useCompanionStore.getState().sendMessage('And the one before it?');
    const [, secondContext] = companionSendMessage.mock.calls[1] as [string, any];
    expect(secondContext.imageAttachments).toBeUndefined();
  });

  it('sends no imageAttachments key at all when nothing is attached', async () => {
    await useCompanionStore.getState().sendMessage('Plain question');
    const [, context] = companionSendMessage.mock.calls[0] as [string, any];
    expect(context.imageAttachments).toBeUndefined();
  });

  it('removes one attachment without touching the others', async () => {
    await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });
    uploadCompanionImage.mockResolvedValue({ ...ATTACHMENT, attachmentId: 'second-id' });
    await useCompanionStore.getState().attachImage({ base64Data: 'BBBB' });

    useCompanionStore.getState().removeImage(ATTACHMENT.attachmentId);

    const remaining = useCompanionStore.getState().pendingImages;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].attachmentId).toBe('second-id');
  });

  it('clears every attachment on clearPendingImages', async () => {
    await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });
    useCompanionStore.getState().clearPendingImages();
    expect(useCompanionStore.getState().pendingImages).toHaveLength(0);
  });

  it('reports a failed read instead of attaching nothing silently', async () => {
    uploadCompanionImage.mockRejectedValue(new Error('That image is over 10 MB.'));

    const attached = await useCompanionStore.getState().attachImage({ base64Data: 'AAAA' });

    expect(attached).toBeNull();
    const state = useCompanionStore.getState();
    expect(state.pendingImages).toHaveLength(0);
    expect(state.isUploadingImage).toBe(false);
    expect(state.imageError).toContain('over 10 MB');
  });
});

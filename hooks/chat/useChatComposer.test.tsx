// @vitest-environment jsdom
/**
 * Contract test for the two composers extracted out of ChatWindow (lane M8,
 * step 6).
 *
 * The rule worth a test above all others is the one the hook's banner calls
 * out: a reply typed into the THREAD composer must never escape into the main
 * conversation. It is guaranteed by a single `|| threadRootId` fallback, which
 * is exactly the kind of clause a later edit deletes as redundant.
 *
 * After that: one composer cannot be replying and editing at once, the main and
 * thread composers keep separate state, and a removal that the reader cancels
 * changes nothing at all.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatComposer, type ChatComposer } from './useChatComposer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const confirmDialog = vi.fn();
const showToast = vi.fn();

vi.mock('../../stores/confirmStore', () => ({
  confirmDialog: (...args: unknown[]) => confirmDialog(...args),
}));
vi.mock('../../stores/toastStore', () => ({
  useToastStore: { getState: () => ({ showToast: (...a: unknown[]) => showToast(...a) }) },
}));

let container: HTMLDivElement;
let root: Root;
let composer: ChatComposer;
let onSendMessage: ReturnType<typeof vi.fn>;
let onEditMessage: ReturnType<typeof vi.fn>;
let onRemoveMessage: ReturnType<typeof vi.fn>;
let loadThread: ReturnType<typeof vi.fn>;

const Probe: React.FC<{ threadRootId: string | null }> = ({ threadRootId }) => {
  composer = useChatComposer({
    onSendMessage,
    onEditMessage,
    onRemoveMessage,
    threadRootId,
    loadThread,
  });
  return null;
};

const mount = async (threadRootId: string | null = null) => {
  await act(async () => {
    root.render(<Probe threadRootId={threadRootId} />);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  onSendMessage = vi.fn().mockResolvedValue(undefined);
  onEditMessage = vi.fn().mockResolvedValue(undefined);
  onRemoveMessage = vi.fn().mockResolvedValue(undefined);
  loadThread = vi.fn().mockResolvedValue(undefined);
  confirmDialog.mockResolvedValue(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe('useChatComposer contract', () => {
  it('returns the six pieces of state, their setters and the four handlers', async () => {
    await mount();
    expect(Object.keys(composer).sort()).toEqual([
      'beginEditingMessage',
      'editingMessage',
      'handleComposerSend',
      'handleRemoveMessage',
      'handleThreadSend',
      'replyTo',
      'seedMentionUsername',
      'setEditingMessage',
      'setReplyTo',
      'setSeedMentionUsername',
      'setThreadEditingMessage',
      'setThreadReplyTo',
      'setThreadSeedMentionUsername',
      'threadEditingMessage',
      'threadReplyTo',
      'threadSeedMentionUsername',
    ]);
  });

  it('starts with every composer empty', async () => {
    await mount();
    expect(composer.replyTo).toBeNull();
    expect(composer.editingMessage).toBeNull();
    expect(composer.seedMentionUsername).toBeNull();
    expect(composer.threadReplyTo).toBeNull();
    expect(composer.threadEditingMessage).toBeNull();
    expect(composer.threadSeedMentionUsername).toBeNull();
  });
});

describe('the main composer', () => {
  it('sends when nothing is being edited', async () => {
    await mount();
    await act(async () => {
      await composer.handleComposerSend('Hello', { replyToMessageId: 'm1' });
    });
    expect(onSendMessage).toHaveBeenCalledWith('Hello', { replyToMessageId: 'm1' });
    expect(onEditMessage).not.toHaveBeenCalled();
  });

  it('edits instead, once an edit is in progress', async () => {
    await mount();
    await act(async () => {
      composer.beginEditingMessage({ id: 'm1', text: 'Old' } as never);
    });
    expect(composer.editingMessage).toEqual({ id: 'm1', text: 'Old' });
    await act(async () => {
      await composer.handleComposerSend('New');
    });
    expect(onEditMessage).toHaveBeenCalledWith('m1', 'New');
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Message updated', 'success');
  });

  it('refuses to edit a message that has no text to edit', async () => {
    await mount();
    await act(async () => {
      composer.beginEditingMessage({ id: 'm1' } as never);
    });
    expect(composer.editingMessage).toBeNull();
  });

  it('clears the reply when an edit begins', async () => {
    await mount();
    await act(async () => {
      composer.setReplyTo({ id: 'm0', text: 'quoted' } as never);
    });
    await act(async () => {
      composer.beginEditingMessage({ id: 'm1', text: 'Old' } as never);
    });
    expect(composer.replyTo).toBeNull();
    expect(composer.editingMessage).not.toBeNull();
  });
});

describe('the thread composer', () => {
  it('never lets a reply escape into the main conversation', async () => {
    await mount('root-1');
    await act(async () => {
      await composer.handleThreadSend('A reply');
    });
    // No explicit target, no thread reply set: it still lands on the root.
    expect(onSendMessage).toHaveBeenCalledWith('A reply', { replyToMessageId: 'root-1' });
  });

  it('prefers an explicit target, then the thread reply, then the root', async () => {
    await mount('root-1');
    await act(async () => {
      composer.setThreadReplyTo({ id: 'reply-2' } as never);
    });
    await act(async () => {
      await composer.handleThreadSend('B');
    });
    expect(onSendMessage).toHaveBeenLastCalledWith('B', { replyToMessageId: 'reply-2' });

    await act(async () => {
      await composer.handleThreadSend('C', { replyToMessageId: 'explicit-3' });
    });
    expect(onSendMessage).toHaveBeenLastCalledWith('C', { replyToMessageId: 'explicit-3' });
  });

  it('refreshes the panel shortly after a send, so the new reply appears', async () => {
    await mount('root-1');
    await act(async () => {
      await composer.handleThreadSend('A reply');
    });
    expect(loadThread).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(loadThread).toHaveBeenCalledWith('root-1');
  });

  it('edits in the thread and refreshes immediately', async () => {
    await mount('root-1');
    await act(async () => {
      composer.beginEditingMessage({ id: 'm9', text: 'Old' } as never, true);
    });
    expect(composer.threadEditingMessage).toEqual({ id: 'm9', text: 'Old' });
    // The main composer is untouched: the reader only sees the thread one.
    expect(composer.editingMessage).toBeNull();
    await act(async () => {
      await composer.handleThreadSend('New');
    });
    expect(onEditMessage).toHaveBeenCalledWith('m9', 'New');
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(loadThread).toHaveBeenCalledWith('root-1');
  });
});

describe('removing a message', () => {
  it('asks first, and does nothing at all when the reader says no', async () => {
    confirmDialog.mockResolvedValue(false);
    await mount();
    await act(async () => {
      await composer.handleRemoveMessage({ id: 'm1', text: 'Hi' } as never);
    });
    expect(confirmDialog).toHaveBeenCalled();
    expect(onRemoveMessage).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('removes on a yes and says so', async () => {
    await mount();
    await act(async () => {
      await composer.handleRemoveMessage({ id: 'm1', text: 'Hi' } as never);
    });
    expect(onRemoveMessage).toHaveBeenCalledWith('m1');
    expect(showToast).toHaveBeenCalledWith('Message removed', 'success');
  });

  it('abandons an edit of the message it just removed', async () => {
    await mount();
    await act(async () => {
      composer.beginEditingMessage({ id: 'm1', text: 'Hi' } as never);
    });
    await act(async () => {
      await composer.handleRemoveMessage({ id: 'm1', text: 'Hi' } as never);
    });
    expect(composer.editingMessage).toBeNull();
  });

  it('surfaces a failure instead of pretending it worked', async () => {
    onRemoveMessage.mockRejectedValue(new Error('Not allowed'));
    await mount();
    await act(async () => {
      await composer.handleRemoveMessage({ id: 'm1', text: 'Hi' } as never);
    });
    expect(showToast).toHaveBeenCalledWith('Not allowed', 'error');
  });
});

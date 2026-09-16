// @vitest-environment jsdom
/**
 * Contract test for the message actions extracted out of ChatWindow (lane M8,
 * step 5).
 *
 * These four actions are the ones a student notices when they break, and two of
 * them are optimistic — they change what is on screen before the server has
 * agreed. So the tests are about the two halves of each optimistic write and,
 * above all, about the ROLLBACK: a failed reaction must restore both the
 * viewer's own chip and the visible count, or the conversation quietly starts
 * lying about who reacted.
 *
 * The hook is mounted for real (jsdom + react-dom/client) rather than stubbed,
 * because its effects are half of what it does; only `services/supabase` and
 * `navigator.clipboard` are replaced.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessageActions, type MessageActions } from './useMessageActions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const addMessageReaction = vi.fn();
const removeMessageReaction = vi.fn();
const fetchUserReactionsForGroup = vi.fn();
const fetchUserReactionsForThread = vi.fn();

vi.mock('../../services/supabase', () => ({
  addMessageReaction: (...args: unknown[]) => addMessageReaction(...args),
  removeMessageReaction: (...args: unknown[]) => removeMessageReaction(...args),
  fetchUserReactionsForGroup: (...args: unknown[]) => fetchUserReactionsForGroup(...args),
  fetchUserReactionsForThread: (...args: unknown[]) => fetchUserReactionsForThread(...args),
}));

const chat = { id: 'g1', chatType: 'group' } as never;
const currentUser = { id: 'u1', name: 'Ada' } as never;
const messages = [{ id: 'm1', text: 'Hi', reactions: { '👍': 2 } }] as never[];

let container: HTMLDivElement;
let root: Root;
let actions: MessageActions;
let updateMessageInState: ReturnType<typeof vi.fn>;
let showToast: ReturnType<typeof vi.fn>;

const Probe: React.FC<{ params?: Record<string, unknown> }> = ({ params }) => {
  actions = useMessageActions({
    chat,
    currentUser,
    isGroup: true,
    messagesProp: messages,
    updateMessageInState,
    showToast,
    setStarredOnly: () => {},
    setThreadSearch: () => {},
    setThreadSearchOpen: () => {},
    ...(params as object),
  } as never);
  return null;
};

const mount = async (params?: Record<string, unknown>) => {
  await act(async () => {
    root.render(<Probe params={params} />);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fetchUserReactionsForGroup.mockResolvedValue({});
  fetchUserReactionsForThread.mockResolvedValue({});
  updateMessageInState = vi.fn();
  showToast = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('useMessageActions contract', () => {
  it('returns exactly the seven things ChatWindow destructures', async () => {
    await mount();
    expect(Object.keys(actions).sort()).toEqual([
      'handleCopyMessage',
      'handleTogglePin',
      'handleToggleReaction',
      'handleToggleStar',
      'myReactions',
      'pinnedMessageId',
      'starredIds',
    ]);
  });
});

describe('reactions', () => {
  it('hydrates the viewer’s own reactions from the group endpoint', async () => {
    fetchUserReactionsForGroup.mockResolvedValue({ m1: ['👍'] });
    await mount();
    expect(fetchUserReactionsForGroup).toHaveBeenCalledWith('g1');
    expect(fetchUserReactionsForThread).not.toHaveBeenCalled();
    expect(actions.myReactions).toEqual({ m1: ['👍'] });
  });

  it('uses the thread endpoint for a DM', async () => {
    await mount({ chat: { id: 't1', chatType: 'dm' }, isGroup: false });
    expect(fetchUserReactionsForThread).toHaveBeenCalledWith('t1');
    expect(fetchUserReactionsForGroup).not.toHaveBeenCalled();
  });

  it('renders unselected chips rather than failing when hydration does', async () => {
    fetchUserReactionsForGroup.mockRejectedValue(new Error('offline'));
    await mount();
    expect(actions.myReactions).toEqual({});
    expect(showToast).not.toHaveBeenCalled();
  });

  it('adds optimistically on both halves, then takes the server’s counts', async () => {
    addMessageReaction.mockResolvedValue({ '👍': 3 });
    await mount();
    await act(async () => {
      await actions.handleToggleReaction('m1', '👍', true);
    });
    expect(actions.myReactions.m1).toEqual(['👍']);
    // Optimistic count first, then the authoritative one.
    expect(updateMessageInState.mock.calls[0]?.[0]).toBe('m1');
    expect(updateMessageInState).toHaveBeenLastCalledWith('m1', { reactions: { '👍': 3 } });
    expect(addMessageReaction).toHaveBeenCalledWith('m1', '👍');
  });

  it('removes through the remove endpoint', async () => {
    removeMessageReaction.mockResolvedValue({ '👍': 1 });
    fetchUserReactionsForGroup.mockResolvedValue({ m1: ['👍'] });
    await mount();
    await act(async () => {
      await actions.handleToggleReaction('m1', '👍', false);
    });
    expect(removeMessageReaction).toHaveBeenCalledWith('m1', '👍');
    expect(actions.myReactions.m1).toEqual([]);
  });

  it('rolls BOTH halves back and says so when the write fails', async () => {
    fetchUserReactionsForGroup.mockResolvedValue({ m1: ['🎉'] });
    addMessageReaction.mockRejectedValue(new Error('Network down'));
    await mount();
    await act(async () => {
      await actions.handleToggleReaction('m1', '👍', true);
    });
    // The viewer's own chips are back to what they were before the click...
    expect(actions.myReactions.m1).toEqual(['🎉']);
    // ...and so is the count.
    expect(updateMessageInState).toHaveBeenLastCalledWith('m1', { reactions: { '👍': 2 } });
    expect(showToast).toHaveBeenCalledWith('Network down', 'error');
  });
});

describe('device-local stars and pins', () => {
  it('starts empty and stores a star under the user + scope + chat', async () => {
    await mount();
    expect([...actions.starredIds]).toEqual([]);
    await act(async () => {
      actions.handleToggleStar({ id: 'm1' } as never);
    });
    expect([...actions.starredIds]).toEqual(['m1']);
    // Written somewhere keyed by all three, whatever the exact key shape is.
    const stored = Object.entries(localStorage).find(([key]) => key.includes('g1'));
    expect(stored?.[0]).toContain('u1');
    expect(stored?.[1]).toContain('m1');
  });

  it('unstars on a second toggle', async () => {
    await mount();
    await act(async () => {
      actions.handleToggleStar({ id: 'm1' } as never);
    });
    await act(async () => {
      actions.handleToggleStar({ id: 'm1' } as never);
    });
    expect([...actions.starredIds]).toEqual([]);
  });

  it('keeps one pinned message at a time, and unpins by re-pinning it', async () => {
    await mount();
    await act(async () => {
      actions.handleTogglePin({ id: 'm1' } as never);
    });
    expect(actions.pinnedMessageId).toBe('m1');
    await act(async () => {
      actions.handleTogglePin({ id: 'm2' } as never);
    });
    expect(actions.pinnedMessageId).toBe('m2');
    await act(async () => {
      actions.handleTogglePin({ id: 'm2' } as never);
    });
    expect(actions.pinnedMessageId).toBeNull();
  });

  it('re-reads the marks when the conversation changes', async () => {
    await mount();
    await act(async () => {
      actions.handleToggleStar({ id: 'm1' } as never);
    });
    expect([...actions.starredIds]).toEqual(['m1']);
    // A different conversation shows its own (empty) marks.
    await mount({ chat: { id: 'g2', chatType: 'group' } });
    expect([...actions.starredIds]).toEqual([]);
    // And coming back finds the first one's marks again.
    await mount({ chat });
    expect([...actions.starredIds]).toEqual(['m1']);
  });
});

describe('copy', () => {
  const clipboard = { writeText: vi.fn() };

  beforeEach(() => {
    clipboard.writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  });

  it('copies the question stem in preference to the text', async () => {
    await mount();
    await act(async () => {
      await actions.handleCopyMessage({ questionStem: 'Which enzyme?', text: 'body' } as never);
    });
    expect(clipboard.writeText).toHaveBeenCalledWith('Which enzyme?');
    expect(showToast).toHaveBeenCalledWith('Copied', 'success');
  });

  it('does nothing at all for a message with no text', async () => {
    await mount();
    await act(async () => {
      await actions.handleCopyMessage({ text: '   ' } as never);
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('says so when the clipboard refuses', async () => {
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    await mount();
    await act(async () => {
      await actions.handleCopyMessage({ text: 'Hi' } as never);
    });
    expect(showToast).toHaveBeenCalledWith('Could not copy', 'error');
  });
});

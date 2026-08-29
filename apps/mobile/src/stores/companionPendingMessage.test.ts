/**
 * A message queued with `openWithMessage` belongs to the open that queued it.
 *
 * It used to survive `close()`, so the next time the panel opened — with
 * `historyLoaded` already true from the earlier visit — the panel's auto-send
 * effect fired it immediately and spent an AI credit while the chat was still
 * loading, without the user typing anything.
 */
jest.mock('../services/ai', () => ({
  companionSendMessage: jest.fn(),
  companionSendMessageStream: jest.fn(),
  fetchCompanionHistory: jest.fn(),
  clearCompanionHistory: jest.fn(),
  fetchCompanionConversations: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { useCompanionStore } from './companionStore';

describe('companion pendingMessage lifecycle', () => {
  beforeEach(() => {
    useCompanionStore.setState({ isOpen: false, pendingMessage: null });
  });

  it('clears a queued message when the panel is closed', () => {
    useCompanionStore.getState().openWithMessage('Summarise this note');
    expect(useCompanionStore.getState().pendingMessage).toBe('Summarise this note');

    useCompanionStore.getState().close();
    expect(useCompanionStore.getState().pendingMessage).toBeNull();

    // Reopening must not re-fire the abandoned send.
    useCompanionStore.getState().open();
    expect(useCompanionStore.getState().pendingMessage).toBeNull();
  });

  it('clears a queued message when toggled shut, but not when toggled open', () => {
    useCompanionStore.getState().openWithMessage('Explain this');
    useCompanionStore.getState().toggle();
    expect(useCompanionStore.getState().isOpen).toBe(false);
    expect(useCompanionStore.getState().pendingMessage).toBeNull();

    useCompanionStore.setState({ pendingMessage: 'queued while shut' });
    useCompanionStore.getState().toggle();
    expect(useCompanionStore.getState().isOpen).toBe(true);
    expect(useCompanionStore.getState().pendingMessage).toBe('queued while shut');
  });
});

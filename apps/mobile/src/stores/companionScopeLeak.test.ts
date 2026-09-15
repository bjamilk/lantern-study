/**
 * Three defects seen on Android 1.0.48, pinned here.
 *
 * 1. Opening Ask in a different, EMPTY study set showed the previous note's
 *    whole conversation. The attachment was already scoped, but the persisted
 *    conversation id was not — and `resetForScope` returned early whenever
 *    nothing was attached, so the empty-set path cleared nothing at all.
 * 2. Opening the companion from a note attached the wrong note (whatever was
 *    attached last), because hydration ran before the note was applied.
 * 3. One Send tap billed two credits: `isStreaming` reaches the composer as a
 *    render snapshot, so two sends could start before either was visible.
 */
const sendStreamMock = jest.fn();
jest.mock('../services/ai', () => ({
  companionSendMessage: jest.fn(async () => ({
    reply: 'ok',
    actions: [],
    citations: null,
    conversationId: 'conv-x',
  })),
  companionSendMessageStream: (...args: unknown[]) => sendStreamMock(...args),
  fetchCompanionHistory: jest.fn(async () => ({
    messages: [],
    conversationId: null,
    noteContextId: null,
  })),
  clearCompanionHistory: jest.fn(),
  fetchCompanionConversations: jest.fn(async () => ({ conversations: [] })),
}));

const storage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => storage[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    storage[k] = v;
  }),
  removeItem: jest.fn(async (k: string) => {
    delete storage[k];
  }),
}));

import { useCompanionStore } from './companionStore';
import { scopeLabel } from '../components/companion/companionScope';
import { setUserScopeId } from './userScopedState';

// Companion persistence is keyed per account (F8), so a test has to say who is
// signed in before anything is written or read.
const USER_ID = 'user-a';
void setUserScopeId(USER_ID);
const CONV_KEY = `lantern_companion_conversation_id:${USER_ID}`;
const NOTE_KEY = `lantern_companion_note_context:${USER_ID}`;

const reset = () => {
  for (const k of Object.keys(storage)) delete storage[k];
  sendStreamMock.mockReset();
  useCompanionStore.setState({
    activeNoteContext: null,
    activeConversationId: null,
    activeScopeId: null,
    requestedScope: null,
    isOpen: false,
    pendingNewConversation: false,
    messages: [],
    isLoading: false,
    isStreaming: false,
    historyLoaded: false,
    error: null,
  });
};

describe('conversation is keyed per scope', () => {
  beforeEach(reset);

  it('persists the thread WITH the room it belongs to', async () => {
    useCompanionStore.setState({ activeScopeId: 'set-a' });
    await useCompanionStore.getState().openConversation('conv-a');

    expect(JSON.parse(storage[CONV_KEY])).toEqual({
      scopeId: 'set-a',
      conversationId: 'conv-a',
    });
  });

  it('does not restore another room\'s thread — the empty-set leak', async () => {
    storage[CONV_KEY] = JSON.stringify({ scopeId: 'set-a', conversationId: 'conv-a' });

    await useCompanionStore.getState().hydrateNoteContext('set-b');

    expect(useCompanionStore.getState().activeConversationId).toBeNull();
    expect(useCompanionStore.getState().pendingNewConversation).toBe(true);
    expect(storage[CONV_KEY]).toBeUndefined();
  });

  it('restores the thread when the room is the same one', async () => {
    storage[CONV_KEY] = JSON.stringify({ scopeId: 'set-a', conversationId: 'conv-a' });

    await useCompanionStore.getState().hydrateNoteContext('set-a');

    expect(useCompanionStore.getState().activeConversationId).toBe('conv-a');
  });

  it('honours a pre-scope bare-string record once rather than discarding it', async () => {
    storage[CONV_KEY] = 'conv-legacy';

    await useCompanionStore.getState().hydrateNoteContext('set-a');

    expect(useCompanionStore.getState().activeConversationId).toBe('conv-legacy');
  });

  it('clears the thread on a scope change even with nothing attached', () => {
    // Exactly the walked path: a live thread in set A, then Ask in empty set B.
    useCompanionStore.setState({
      activeScopeId: 'set-a',
      activeConversationId: 'conv-a',
      activeNoteContext: null,
      messages: [
        { id: 'm1', role: 'user', content: 'hi', created_at: new Date().toISOString() },
      ],
    });

    useCompanionStore.getState().resetForScope('set-b');

    const s = useCompanionStore.getState();
    expect(s.activeConversationId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.activeScopeId).toBe('set-b');
    expect(s.pendingNewConversation).toBe(true);
  });

  it('leaves a thread alone when the room has not changed', () => {
    useCompanionStore.setState({
      activeScopeId: 'set-a',
      activeConversationId: 'conv-a',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', created_at: new Date().toISOString() },
      ],
    });

    useCompanionStore.getState().resetForScope('set-a');

    expect(useCompanionStore.getState().activeConversationId).toBe('conv-a');
    expect(useCompanionStore.getState().messages).toHaveLength(1);
  });
});

describe('openForNote attaches THAT note synchronously', () => {
  beforeEach(reset);

  it('applies the note before any await, over a stale attachment', () => {
    useCompanionStore.setState({
      activeNoteContext: { id: 'note-imported', title: 'Imported Notes', scopeId: 'set-a' },
      activeConversationId: 'conv-a',
      activeScopeId: 'set-a',
    });

    useCompanionStore.getState().openForNote({
      id: 'note-pancreatitis',
      title: 'Pancreatitis PPT Student',
      scopeId: 'set-b',
    });

    // Read immediately: no await, so a send in the same tick sees this note.
    const s = useCompanionStore.getState();
    expect(s.activeNoteContext).toEqual({
      id: 'note-pancreatitis',
      title: 'Pancreatitis PPT Student',
      scopeId: 'set-b',
    });
    expect(s.isOpen).toBe(true);
    expect(s.activeConversationId).toBeNull();
    expect(s.messages).toEqual([]);
  });

  it('keeps the running thread when reopening the SAME note', () => {
    useCompanionStore.setState({
      activeNoteContext: { id: 'note-1', title: 'Cells', scopeId: 'set-a' },
      activeConversationId: 'conv-a',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', created_at: new Date().toISOString() },
      ],
    });

    useCompanionStore.getState().openForNote({ id: 'note-1', title: 'Cells', scopeId: 'set-a' });

    expect(useCompanionStore.getState().activeConversationId).toBe('conv-a');
    expect(useCompanionStore.getState().messages).toHaveLength(1);
  });

  it('persists the note it opened on', async () => {
    useCompanionStore.getState().openForNote({ id: 'note-9', title: 'Renal', scopeId: 'set-c' });
    await Promise.resolve();

    expect(JSON.parse(storage[NOTE_KEY]).id).toBe('note-9');
  });
});

describe('one tap, one credit', () => {
  beforeEach(reset);

  it('refuses a second streaming send while one is in flight', async () => {
    let release: () => void = () => {};
    sendStreamMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    const first = useCompanionStore.getState().sendMessageStreaming('Summarise this note');
    // The store flips isStreaming synchronously, so the second tap is refused
    // even though React has not re-rendered the button yet.
    expect(useCompanionStore.getState().isStreaming).toBe(true);
    await useCompanionStore.getState().sendMessageStreaming('Summarise this note');

    expect(sendStreamMock).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('refuses a JSON send while a stream is in flight', async () => {
    useCompanionStore.setState({ isStreaming: true });

    await useCompanionStore.getState().sendMessage('Summarise this note');

    const { companionSendMessage } = jest.requireMock('../services/ai');
    expect(companionSendMessage).not.toHaveBeenCalled();
  });

  it('surfaces a failure instead of auto-resending a charged request', async () => {
    sendStreamMock.mockImplementation(
      async (
        _text: string,
        _ctx: unknown,
        _onToken: (t: string) => void,
        _onDone: unknown,
        onError: (e: Error) => void
      ) => {
        onError(new Error('Network request timed out'));
      }
    );

    await useCompanionStore.getState().sendMessageStreaming('Summarise this note');

    const s = useCompanionStore.getState();
    expect(sendStreamMock).toHaveBeenCalledTimes(1);
    expect(s.error).toBe('Network request timed out');
    // The text comes back to the composer; nothing is re-sent on its own.
    expect(s.failedMessage).toBe('Summarise this note');
    expect(s.isStreaming).toBe(false);
  });
});

describe('citations reach the store from the JSON send path', () => {
  beforeEach(reset);

  it('stores a well-formed citation and drops a malformed one', async () => {
    const onDoneWith = (citations: unknown) =>
      sendStreamMock.mockImplementation(
        async (
          _text: string,
          _ctx: unknown,
          onToken: (t: string) => void,
          onDone: (r: Record<string, unknown>) => void
        ) => {
          onToken('Pancreatitis results from premature enzyme activation. (Excerpt 1)');
          onDone({ actions: [], citations, conversationId: 'conv-a' });
        }
      );

    onDoneWith({ noteId: 'note-1', noteTitle: 'Pancreatitis PPT Student', excerpts: [1, 2] });
    await useCompanionStore.getState().sendMessageStreaming('Summarise this note');
    expect(useCompanionStore.getState().messages.at(-1)?.citations).toEqual({
      noteId: 'note-1',
      noteTitle: 'Pancreatitis PPT Student',
      excerpts: [1, 2],
    });

    reset();
    onDoneWith({ noteTitle: 'Pancreatitis PPT Student', excerpts: [1] });
    await useCompanionStore.getState().sendMessageStreaming('Summarise this note');
    expect(useCompanionStore.getState().messages.at(-1)?.citations).toBeNull();
  });
});


/**
 * The walked path from the 1.0.48 device pass, check 6.
 *
 * Ask from note "Imported Notes" in set A, then Study -> empty set B -> its
 * Ask. It arrived reading "On: Imported Notes" with that note attached, so the
 * next question would have been answered against another set's material.
 *
 * The cause is the attachment losing its room, not the route: the note editor
 * attaches with no scope and its `await` lands AFTER the panel's scoped
 * `openForNote`, and the old `resetForScope` ADOPTED a scope-less attachment
 * into whichever room read it next.
 */
describe('Ask in a different, empty set — the walked sequence', () => {
  beforeEach(reset);

  const openFromNoteInSetA = async () => {
    // The panel, on open: the room first, then THAT note.
    useCompanionStore.getState().resetForScope('note-imported');
    useCompanionStore.getState().openForNote({
      id: 'note-imported',
      // The panel names the note from the notes store, which on this path has
      // not loaded it yet — so the two attaches disagree on the title and the
      // editor's call is NOT the no-op an identical title would make it.
      title: 'Untitled note',
      scopeId: 'note-imported',
    });
    // The note editor's own attach, unscoped, landing late.
    await useCompanionStore.getState().setActiveNoteContext({
      id: 'note-imported',
      title: 'Imported Notes',
    });
    // A thread exists in that room by the time the student leaves.
    useCompanionStore.setState({ activeConversationId: 'conv-a' });
    await persistedSettle();
  };

  const persistedSettle = () => Promise.resolve();

  it('the editor\'s late unscoped attach cannot strip the note\'s room', async () => {
    await openFromNoteInSetA();

    expect(useCompanionStore.getState().activeNoteContext).toEqual({
      id: 'note-imported',
      title: 'Imported Notes',
      scopeId: 'note-imported',
    });
    expect(JSON.parse(storage[NOTE_KEY]).scopeId).toBe('note-imported');
  });

  it('opening Ask in empty set B has no attachment, a new thread, and set B\'s label', async () => {
    await openFromNoteInSetA();
    useCompanionStore.getState().close();

    // Set B's room: the panel resets for the new scope BEFORE it hydrates.
    useCompanionStore.getState().openForScope({
      scopeId: 'set-b',
      label: 'WaveP pass set',
    });
    await useCompanionStore.getState().hydrateNoteContext('set-b');
    await persistedSettle();

    const s = useCompanionStore.getState();
    expect(s.activeNoteContext).toBeNull();
    expect(storage[NOTE_KEY]).toBeUndefined();
    expect(s.activeConversationId).toBeNull();
    expect(s.activeConversationId).not.toBe('conv-a');
    expect(s.pendingNewConversation).toBe(true);
    expect(s.messages).toEqual([]);
    expect(s.activeScopeId).toBe('set-b');
    expect(s.requestedScope).toEqual({ scopeId: 'set-b', label: 'WaveP pass set' });
    // What the header draws with no attachment: the room the caller named.
    expect(scopeLabel({ noteTitle: null, scopeName: s.requestedScope?.label ?? null })).toBe(
      'On: WaveP pass set'
    );
  });

  it('a scope-less attachment does not survive a move between rooms', () => {
    useCompanionStore.setState({
      activeScopeId: 'set-a',
      activeNoteContext: { id: 'note-legacy', title: 'Old note' },
    });

    useCompanionStore.getState().resetForScope('set-b');

    expect(useCompanionStore.getState().activeNoteContext).toBeNull();
  });

  it('a persisted attachment with no room is not adopted on hydrate', async () => {
    storage[NOTE_KEY] = JSON.stringify({ id: 'note-imported', title: 'Imported Notes' });

    await useCompanionStore.getState().hydrateNoteContext('set-b');

    expect(useCompanionStore.getState().activeNoteContext).toBeNull();
  });
});

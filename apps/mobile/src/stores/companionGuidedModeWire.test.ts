/**
 * The wire, not the mock.
 *
 * Guided is only real if `mode` is in the JSON that leaves the phone. The store
 * merges the caller's context with the thread's own state on every send, which
 * is exactly where a mode is easiest to lose — and a lesson that silently
 * dropped back to `explain` halfway through looks identical on screen. So this
 * drives the store's real send path through the real shared companion client
 * and reads the body off a fetch spy.
 */
import { createCompanionClient } from '@lantern/shared/api/companion';

const fetchMock = jest.fn();
(globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

const client = createCompanionClient({
  getBaseUrl: () => 'https://api.test',
  getAuthHeaders: async () => ({ 'Content-Type': 'application/json' }),
  supportsResponseStreaming: false,
});

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
  uploadCompanionImage: jest.fn(),
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

/**
 * The store now reads the scoped set's SAVED PLAN when no host states a topic,
 * so the set store comes along for the ride. Its network layer is stubbed —
 * `fetchStudySetPlan` is the only call this file exercises.
 */
const fetchStudySetPlan = jest.fn();
jest.mock('../services/academic', () => ({
  fetchMyStudySets: jest.fn(),
  createStudySet: jest.fn(),
  updateStudySet: jest.fn(),
  deleteStudySet: jest.fn(),
  touchStudySet: jest.fn(),
  fetchStudySetPlan: (...a: unknown[]) => fetchStudySetPlan(...a),
  replaceStudySetPlan: jest.fn(),
  updateStudySetTopicStatus: jest.fn(),
  fetchStudySetFolders: jest.fn(),
}));
jest.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));

import { useStudySetStore } from './studySetStore';
import { useCompanionStore } from './companionStore';

function replyOnce() {
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      reply: 'Step one: osmosis moves water, not solute.',
      actions: [],
      citations: null,
      conversationId: 'conv-1',
    }),
  }));
}

describe('mobile companion send carries the mode on the wire', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    replyOnce();
    useCompanionStore.setState({
      messages: [],
      activeNoteContext: null,
      activeConversationId: null,
      pendingNewConversation: true,
      pendingMessageContext: null,
      error: null,
      isLoading: false,
      isStreaming: false,
      pendingImages: [],
      isUploadingImage: false,
      imageError: null,
    });
  });

  it('sends context.mode = guided from the streaming path', async () => {
    await useCompanionStore
      .getState()
      .sendMessageStreaming('Guide me through osmosis', { mode: 'guided' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.context?.mode).toBe('guided');
  });

  it('sends context.mode = guided from the JSON path', async () => {
    await useCompanionStore
      .getState()
      .sendMessage('Guide me through osmosis', { mode: 'guided' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.context?.mode).toBe('guided');
  });

  it('keeps the mode when the thread merges its own note scope in', async () => {
    useCompanionStore.setState({
      activeNoteContext: { id: 'note-1', title: 'Cell transport' },
      activeConversationId: 'conv-9',
      pendingNewConversation: false,
    });

    await useCompanionStore
      .getState()
      .sendMessageStreaming('Next step please', { mode: 'guided' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.context?.mode).toBe('guided');
    expect(body.context?.noteId).toBe('note-1');
  });

  it('sends no mode when Guided is off, so the server default stands', async () => {
    await useCompanionStore.getState().sendMessageStreaming('What is osmosis?');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.context?.mode).toBeUndefined();
  });
});

/**
 * The picker's `Continue learning:` row is only as real as what the room hands
 * the store.
 *
 * The phone mounts ONE companion panel at the root with no props, so a set room
 * can reach the picker by exactly one route: the scope it states when it opens
 * the sheet. Lane G1 shipped the row behind an optional prop no host supplied,
 * which is why the picker only ever drew `Start learning:` — so what is pinned
 * here is the carriage, not the rendering.
 */
describe('openForScope carries the plan\'s next topic', () => {
  beforeEach(() => {
    useCompanionStore.setState({
      isOpen: false,
      requestedScope: null,
      activeScopeId: null,
      activeNoteContext: null,
      activeConversationId: null,
      messages: [],
    });
  });

  it('hands the room\'s next topic, with its unit, to the panel', () => {
    useCompanionStore.getState().openForScope({
      scopeId: 'set-a',
      label: 'Intro to AI',
      guidedNextTopic: { title: 'Narrow vs. General AI', unit: '01 AI Foundations' },
    });

    const requested = useCompanionStore.getState().requestedScope;
    expect(useCompanionStore.getState().isOpen).toBe(true);
    expect(requested?.guidedNextTopic).toEqual({
      title: 'Narrow vs. General AI',
      unit: '01 AI Foundations',
    });
  });

  it('leaves it absent when the caller has no next topic to state', () => {
    useCompanionStore.getState().openForScope({ scopeId: 'set-a', label: 'Intro to AI' });

    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic).toBeUndefined();
  });

  it('does not let one room\'s next topic survive into the next open', () => {
    useCompanionStore.getState().openForScope({
      scopeId: 'set-a',
      label: 'Intro to AI',
      guidedNextTopic: { title: 'Narrow vs. General AI', unit: null },
    });
    useCompanionStore.getState().close();
    // A door that names no room (the header's Ask) must not inherit set A's
    // topic — that would be a Continue row for a set the student has left.
    useCompanionStore.getState().open();

    expect(useCompanionStore.getState().requestedScope).toBeNull();
  });
});

/**
 * The `Continue learning:` row through EVERY door.
 *
 * Lane G1 put the topic behind an optional prop only `CourseRoomScreen` passed,
 * and the tester opened the companion from the set bar's `Ask` — which states a
 * scope and no topic — so the row was absent on a set whose plan had an
 * uncovered topic waiting (SF5a, check 1). The derivation therefore belongs to
 * the one call every door already makes.
 */
describe('openForScope derives the next topic from the set\'s saved plan', () => {
  beforeEach(() => {
    fetchStudySetPlan.mockReset();
    useStudySetStore.setState({ plans: {}, sets: [] } as never);
    useCompanionStore.setState({
      isOpen: false,
      requestedScope: null,
      activeScopeId: null,
      activeNoteContext: null,
      activeConversationId: null,
      messages: [],
    });
  });

  it('fills the row for a bar-door open that states no topic', async () => {
    useStudySetStore.setState({
      plans: {
        'set-a': {
          loaded: true,
          units: [{ id: 'u1', studySetId: 'set-a', title: 'Imported Notes', position: 1 }],
          topics: [
            {
              id: 't1',
              studySetId: 'set-a',
              unitId: 'u1',
              title: 'Gas exchange',
              position: 1,
              status: 'covered',
              sourceNoteIds: [],
            },
          ],
        },
      },
    } as never);

    // Exactly what ContextualBar's `Ask` door sends: a scope, a label, no topic.
    useCompanionStore.getState().openForScope({ scopeId: 'set-a', label: 'Wave1 pass set' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic).toEqual({
      title: 'Gas exchange',
      unit: 'Imported Notes',
      // This fixture's topic names no source note, and an invented one would
      // attach the wrong document to the first taught step.
      sourceNoteId: null,
      sourceTitle: null,
    });
  });

  /**
   * The seed sentence can only name the material if the derivation carries it.
   * Seeding with the UNIT alone made the first guided reply a menu of the notes
   * filed under it — a credit spent asking (AH release smoke 1.0.57).
   */
  it('carries the topic\'s source note so the first turn can be grounded', async () => {
    useStudySetStore.setState({
      plans: {
        'set-a': {
          loaded: true,
          units: [{ id: 'u1', studySetId: 'set-a', title: 'Imported Notes', position: 1 }],
          topics: [
            {
              id: 't1',
              studySetId: 'set-a',
              unitId: 'u1',
              title: 'Gas exchange',
              position: 1,
              status: 'covered',
              sourceNoteIds: ['note-7'],
            },
          ],
        },
      },
    } as never);

    useCompanionStore.getState().openForScope({ scopeId: 'set-a', label: 'Wave1 pass set' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic).toEqual({
      title: 'Gas exchange',
      unit: 'Imported Notes',
      sourceNoteId: 'note-7',
      // The store holds no note list, so the TITLE stays null here — the room,
      // which does, passes its own topic and wins.
      sourceTitle: null,
    });
  });

  it('loads the plan when the room has not been opened yet', async () => {
    fetchStudySetPlan.mockResolvedValue({
      units: [{ id: 'u1', studySetId: 'set-a', title: 'Imported Notes', position: 1 }],
      topics: [
        {
          id: 't1',
          studySetId: 'set-a',
          unitId: 'u1',
          title: 'Gas exchange',
          position: 1,
          status: 'unseen',
          sourceNoteIds: [],
        },
      ],
    });

    useCompanionStore.getState().openForScope({ scopeId: 'set-a', label: 'Wave1 pass set' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchStudySetPlan).toHaveBeenCalledWith('set-a');
    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic?.title).toBe(
      'Gas exchange'
    );
  });

  it('states nothing for a set with no plan, so the picker offers cold starts only', async () => {
    fetchStudySetPlan.mockResolvedValue({ units: [], topics: [] });

    useCompanionStore.getState().openForScope({ scopeId: 'set-a', label: 'Wave1 pass set' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic).toBeUndefined();
  });

  it('never overwrites a topic the host stated itself', async () => {
    useStudySetStore.setState({
      plans: {
        'set-a': {
          loaded: true,
          units: [{ id: 'u1', studySetId: 'set-a', title: 'Imported Notes', position: 1 }],
          topics: [
            {
              id: 't1',
              studySetId: 'set-a',
              unitId: 'u1',
              title: 'Gas exchange',
              position: 1,
              status: 'unseen',
              sourceNoteIds: [],
            },
          ],
        },
      },
    } as never);

    useCompanionStore.getState().openForScope({
      scopeId: 'set-a',
      label: 'Wave1 pass set',
      guidedNextTopic: { title: 'Narrow vs. General AI', unit: null },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic).toEqual({
      title: 'Narrow vs. General AI',
      unit: null,
    });
  });
});

/**
 * The doors that state NO scope.
 *
 * The top bar's credits chip opens the sheet with `open()`/`toggle()` — no
 * scope, no topic — while the student is standing in a set room. On device
 * (SF5b, check 1) that door drew a picker with no `Continue learning:` row on
 * the very set where the bar's `Ask` drew one. The room the panel is standing
 * in is `activeScopeId`, so that is what the derivation keys on.
 */
describe('the scope-less doors still derive the room\'s next topic', () => {
  const planForSetA = {
    plans: {
      'set-a': {
        loaded: true,
        units: [{ id: 'u1', studySetId: 'set-a', title: 'Imported Notes', position: 1 }],
        topics: [
          {
            id: 't1',
            studySetId: 'set-a',
            unitId: 'u1',
            title: 'Gas exchange',
            position: 1,
            status: 'unseen',
            sourceNoteIds: [],
          },
        ],
      },
      'set-b': {
        loaded: true,
        units: [{ id: 'u2', studySetId: 'set-b', title: 'Kinetics', position: 1 }],
        topics: [
          {
            id: 't2',
            studySetId: 'set-b',
            unitId: 'u2',
            title: 'Rate laws',
            position: 1,
            status: 'unseen',
            sourceNoteIds: [],
          },
        ],
      },
    },
  };

  beforeEach(() => {
    fetchStudySetPlan.mockReset();
    useStudySetStore.setState({ ...planForSetA, sets: [] } as never);
    useCompanionStore.setState({
      isOpen: false,
      requestedScope: null,
      activeScopeId: null,
      activeNoteContext: null,
      activeConversationId: null,
      messages: [],
    });
  });

  it('fills the row for a credits-chip open inside a set room', async () => {
    // The room the panel is standing in, exactly as the panel's own reset left it.
    useCompanionStore.setState({ activeScopeId: 'set-a' });

    useCompanionStore.getState().open();
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic).toEqual({
      title: 'Gas exchange',
      unit: 'Imported Notes',
      // This fixture's topic names no source note, and an invented one would
      // attach the wrong document to the first taught step.
      sourceNoteId: null,
      sourceTitle: null,
    });
  });

  it('fills the row for the toggle door too', async () => {
    useCompanionStore.setState({ activeScopeId: 'set-a' });

    useCompanionStore.getState().toggle();
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().isOpen).toBe(true);
    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic?.title).toBe(
      'Gas exchange'
    );
  });

  it('states no topic when the door opens over no room at all', async () => {
    useCompanionStore.getState().open();
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope).toBeNull();
  });

  it('re-derives when the panel moves to another room', async () => {
    useCompanionStore.setState({ activeScopeId: 'set-a' });
    useCompanionStore.getState().open();
    await new Promise((resolve) => setImmediate(resolve));
    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic?.title).toBe(
      'Gas exchange'
    );

    // Walking into set B is `resetForScope`, which is what every door's open
    // effect calls once the live route is read.
    useCompanionStore.getState().resetForScope('set-b');
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope?.scopeId).toBe('set-b');
    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic?.title).toBe('Rate laws');
  });

  it('still lets a host that stated its own topic win', async () => {
    useCompanionStore.getState().openForScope({
      scopeId: 'set-a',
      label: 'Wave1 pass set',
      guidedNextTopic: { title: 'Narrow vs. General AI', unit: null },
    });
    // A second, scope-less door on the same room must not overwrite it.
    useCompanionStore.getState().ensureGuidedNextTopic();
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic).toEqual({
      title: 'Narrow vs. General AI',
      unit: null,
    });
  });

  it('obeys a host that says there is no topic', async () => {
    useCompanionStore.getState().openForScope({
      scopeId: 'set-a',
      label: 'Wave1 pass set',
      guidedNextTopic: null,
    });
    useCompanionStore.getState().ensureGuidedNextTopic();
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic).toBeNull();
  });

  it('drops a topic derived for a room the student has left', async () => {
    useCompanionStore.setState({ activeScopeId: 'set-a' });
    useCompanionStore.getState().open();
    await new Promise((resolve) => setImmediate(resolve));

    // No plan for set-c: the picker must fall back to its cold starts rather
    // than keep set A's Continue row.
    useStudySetStore.setState({ plans: {}, sets: [] } as never);
    fetchStudySetPlan.mockResolvedValue({ units: [], topics: [] });
    useCompanionStore.getState().resetForScope('set-c');
    await new Promise((resolve) => setImmediate(resolve));

    expect(useCompanionStore.getState().requestedScope?.guidedNextTopic).toBeUndefined();
  });
});

/**
 * The Guided lesson, on the wire.
 *
 * Guided's first turn always worked — the seed sentence named the topic and
 * the note. Every turn after it sent `mode: 'guided'` and nothing else: no
 * topic, no source, no step, no standing question. On a CORRECT answer to step
 * 1 the model re-read the thread, found the seed's words ("Imported Notes"),
 * and replied "Step 1 – Locate your Imported Notes …" — off the material,
 * about the app, and back at step 1 (production faeaf324).
 *
 * The lesson now lives in the STORE, which is what builds the context for
 * every send. What is pinned here is the body that actually leaves the phone.
 */
describe('the guided session reaches every turn', () => {
  const send = () => useCompanionStore.getState();
  const bodyOf = (n = 0) => JSON.parse(fetchMock.mock.calls[n][1].body);

  function replyWith(reply: string, guidedStep: number | null = null) {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ reply, actions: [], citations: null, conversationId: 'conv-1', guidedStep }),
    }));
  }

  beforeEach(() => {
    fetchMock.mockReset();
    replyWith('Step 1: water follows salt.\n\nCheck: which way does water move?');
    useCompanionStore.setState({
      messages: [],
      activeNoteContext: null,
      activeConversationId: null,
      pendingNewConversation: true,
      pendingMessageContext: null,
      guidedSession: null,
      error: null,
      isLoading: false,
      isStreaming: false,
      pendingImages: [],
      isUploadingImage: false,
      imageError: null,
    });
  });

  it('opens the lesson at step 1 with its topic and source', () => {
    send().startGuided({ topic: 'Osmosis', sourceNoteId: 'note-1', sourceTitle: 'Cell transport' });

    expect(useCompanionStore.getState().guidedSession).toEqual({
      topic: 'Osmosis',
      sourceNoteId: 'note-1',
      sourceTitle: 'Cell transport',
      step: 1,
      lastCheck: null,
    });
  });

  it('carries the session AND the material on the seed turn', async () => {
    send().startGuided({ topic: 'Osmosis', sourceNoteId: 'note-1', sourceTitle: 'Cell transport' });

    await send().sendMessageStreaming('Guide me through "Osmosis"');

    expect(bodyOf().context?.mode).toBe('guided');
    expect(bodyOf().context?.guided).toMatchObject({ topic: 'Osmosis', step: 1 });
    expect(bodyOf().context?.noteId).toBe('note-1');
  });

  it('carries them again on the NEXT turn — the one that used to arrive bare', async () => {
    send().startGuided({ topic: 'Osmosis', sourceNoteId: 'note-1', sourceTitle: 'Cell transport' });
    await send().sendMessageStreaming('Guide me through "Osmosis"');

    replyWith('Correct.\n\nStep 2: tonicity.\n\nCheck: what is hypertonic?');
    await send().sendMessageStreaming('water moves toward the saltier side');

    // The whole defect, in three assertions.
    expect(bodyOf(1).context?.mode).toBe('guided');
    expect(bodyOf(1).context?.guided).toMatchObject({
      topic: 'Osmosis',
      step: 1,
      lastCheck: 'which way does water move?',
    });
    expect(bodyOf(1).context?.noteId).toBe('note-1');
  });

  it('advances the step when a new check replaces the standing one', async () => {
    send().startGuided({ topic: 'Osmosis', sourceNoteId: 'note-1' });
    await send().sendMessageStreaming('Guide me through "Osmosis"');
    // The seed's own check is step 1's question, not progress past it.
    expect(useCompanionStore.getState().guidedSession?.step).toBe(1);

    replyWith('Correct.\n\nStep 2: tonicity.\n\nCheck: what is hypertonic?');
    await send().sendMessageStreaming('toward the saltier side');

    expect(useCompanionStore.getState().guidedSession).toMatchObject({
      step: 2,
      lastCheck: 'what is hypertonic?',
    });
  });

  it('stays put when the same check comes back — that is a re-teach', async () => {
    send().startGuided({ topic: 'Osmosis' });
    await send().sendMessageStreaming('Guide me through "Osmosis"');

    replyWith('Not quite. Think of it as chasing salt.\n\nCheck: which way does water move?');
    await send().sendMessageStreaming('away from the salt');

    expect(useCompanionStore.getState().guidedSession?.step).toBe(1);
  });

  it('takes the server step over its own guess', async () => {
    send().startGuided({ topic: 'Osmosis' });
    await send().sendMessageStreaming('Guide me through "Osmosis"');

    replyWith('Correct.\n\nCheck: what is hypertonic?', 4);
    await send().sendMessageStreaming('toward the saltier side');

    expect(useCompanionStore.getState().guidedSession?.step).toBe(4);
  });

  it('lets a real attachment outrank the lesson note, as it always did', async () => {
    useCompanionStore.setState({
      activeNoteContext: { id: 'attached-note', title: 'Lecture 4' },
    });
    send().startGuided({ topic: 'Osmosis', sourceNoteId: 'note-1' });

    await send().sendMessageStreaming('Guide me through "Osmosis"');

    expect(bodyOf().context?.noteId).toBe('attached-note');
  });

  it('sends no guided metadata once the lesson is cleared', async () => {
    send().startGuided({ topic: 'Osmosis', sourceNoteId: 'note-1' });
    send().clearGuided();

    await send().sendMessageStreaming('What is osmosis?');

    expect(bodyOf().context?.guided).toBeUndefined();
    expect(bodyOf().context?.mode).toBeUndefined();
    expect(bodyOf().context?.noteId).toBeUndefined();
  });

  it('does not carry one thread’s lesson into a new chat', () => {
    send().startGuided({ topic: 'Osmosis' });
    send().startNewChat();

    expect(useCompanionStore.getState().guidedSession).toBeNull();
  });
});

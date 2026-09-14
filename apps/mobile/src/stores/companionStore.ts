/**
 * AI Companion Store
 * Manages conversation state for the Lantern AI companion panel.
 * Threads are server-backed (conversation_id); note-attached chats keep
 * note_context_id so history can list general + note-linked chats.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  CompanionConversation,
  CompanionImageAttachment,
  CompanionMessage,
  CompanionUserContext,
} from '@lantern/shared';
// Subpath, not the bare package: mobile's jest maps '@lantern/shared/*' to the
// package source but has no mapping for the bare specifier, so a VALUE import
// from it (unlike the erased type imports above) fails every store test.
import {
  normalizeCompanionCitation,
  type GuidedNextTopic,
} from '@lantern/shared/api/companion';
import {
  companionSendMessage,
  companionSendMessageStream,
  fetchCompanionHistory,
  clearCompanionHistory,
  fetchCompanionConversations,
  uploadCompanionImage,
} from '../services/ai';
import { describeImageAttachFailure } from '../components/companion/imageAttach';
import { guidedNextTopicForSet } from '../components/companion/guidedNextTopicForSet';

export type CompanionNoteContext = {
  id: string;
  title: string;
  /**
   * Which room the attachment belongs to (study set id, else course id).
   * Without it the persisted note stayed stapled to every question asked in
   * the next set, since two course-less sets share a course id of none.
   */
  scopeId?: string | null;
};

const NOTE_CONTEXT_STORAGE_KEY = 'lantern_companion_note_context';
const CONVERSATION_STORAGE_KEY = 'lantern_companion_conversation_id';

async function readPersistedNoteContext(): Promise<CompanionNoteContext | null> {
  try {
    const raw = await AsyncStorage.getItem(NOTE_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; title?: unknown; scopeId?: unknown };
    if (typeof parsed.id !== 'string' || !parsed.id.trim()) return null;
    return {
      id: parsed.id.trim(),
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Untitled note',
      scopeId: typeof parsed.scopeId === 'string' && parsed.scopeId.trim() ? parsed.scopeId.trim() : null,
    };
  } catch {
    return null;
  }
}

async function persistNoteContext(ctx: CompanionNoteContext | null) {
  try {
    if (!ctx) await AsyncStorage.removeItem(NOTE_CONTEXT_STORAGE_KEY);
    else await AsyncStorage.setItem(NOTE_CONTEXT_STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    /* ignore */
  }
}

/**
 * The persisted thread, and which room it belongs to.
 *
 * This used to be a bare conversation id with no scope, so opening Ask from a
 * different, empty study set restored the previous note's whole conversation.
 * The scope is stored WITH the id; a different scope starts a fresh thread and
 * the old one stays reachable from Past chats.
 *
 * A bare-string value is a pre-scope record: it is honoured once, with a null
 * scope, so an in-progress thread is not thrown away by the upgrade.
 */
/**
 * What a caller says an open is about.
 *
 * `guidedNextTopic` is additive and optional: the phone mounts ONE panel at the
 * root with no props, so a room that knows its plan has no other way to hand
 * the Guided picker the topic the plan says comes next. Absent means the picker
 * offers `Start learning:` rows only — never an invented `Continue`.
 */
export type CompanionRequestedScope = {
  scopeId: string | null;
  label?: string | null;
  guidedNextTopic?: GuidedNextTopic | null;
};

export type PersistedConversation = { scopeId: string | null; conversationId: string };

async function readPersistedConversation(): Promise<PersistedConversation | null> {
  try {
    const raw = await AsyncStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw || !raw.trim()) return null;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return { scopeId: null, conversationId: trimmed };
    const parsed = JSON.parse(trimmed) as { scopeId?: unknown; conversationId?: unknown };
    if (typeof parsed.conversationId !== 'string' || !parsed.conversationId.trim()) return null;
    return {
      conversationId: parsed.conversationId.trim(),
      scopeId:
        typeof parsed.scopeId === 'string' && parsed.scopeId.trim() ? parsed.scopeId.trim() : null,
    };
  } catch {
    return null;
  }
}

async function persistConversationId(id: string | null, scopeId: string | null = null) {
  try {
    if (!id) await AsyncStorage.removeItem(CONVERSATION_STORAGE_KEY);
    else
      await AsyncStorage.setItem(
        CONVERSATION_STORAGE_KEY,
        JSON.stringify({ scopeId, conversationId: id })
      );
  } catch {
    /* ignore */
  }
}

/**
 * An attachment waiting on the next question.
 *
 * `previewUri` is the phone's own copy of the picked file. It never leaves the
 * device — the server reads only `attachmentId` off this object — it exists so
 * the composer chip can show the photo the student chose rather than a glyph
 * that could be any picture.
 */
export type PendingCompanionImage = CompanionImageAttachment & {
  previewUri?: string;
};

/**
 * The photo read that is still in the air, if any.
 *
 * Reading a page is the slow, billable half of an attachment: the picker hands
 * control back immediately, so a student types the question and sends while
 * the upload is still going. `pendingImages` is empty at that moment, the
 * request goes out with no ids, and the answer is "I can't view the image" —
 * with the chip appearing under the composer a second later, which is exactly
 * how the bug reads on a phone. Every send waits on this first, so the photo
 * the student is looking at is the photo the question is asked about.
 *
 * Module-level rather than store state: nothing renders it, and a promise in
 * a zustand snapshot would re-render the panel for no reason.
 */
let pendingImageRead: Promise<unknown> | null = null;

/**
 * One tap, one charge — across the photo wait too.
 *
 * `isLoading`/`isStreaming` flip synchronously and are the guard for every
 * other send, but a send that stops to let a photo finish reading has not set
 * them yet, so a second tap inside that window would have been a second
 * charge. This closes exactly that window.
 */
let awaitingImageRead = false;

/** Let an in-flight photo read finish. A failed read is not a failed send. */
async function settlePendingImageRead(): Promise<void> {
  while (pendingImageRead) {
    const current = pendingImageRead;
    try {
      await current;
    } catch {
      /* the composer already carries the reason */
    }
    if (pendingImageRead === current) pendingImageRead = null;
  }
}

interface CompanionState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  pendingMessage: string | null;
  setPendingMessage: (msg: string | null) => void;
  /**
   * Open the sheet and queue one message. `context` rides with THAT send
   * only (a walk-through's page scope, say) and is dropped afterwards, so the
   * next question the student types is not silently scoped to page 7.
   */
  openWithMessage: (msg: string, context?: Partial<CompanionUserContext>) => void;
  /** One-shot context for the queued message. Consumed by the next send. */
  pendingMessageContext: Partial<CompanionUserContext> | null;

  activeNoteContext: CompanionNoteContext | null;
  hydrateNoteContext: (scopeId?: string | null) => Promise<void>;
  setActiveNoteContext: (ctx: CompanionNoteContext | null) => Promise<void>;
  /**
   * Attach THIS note and open on it, in one synchronous state write.
   *
   * Opening the companion from a note used to race: the panel hydrated the
   * persisted attachment first, so the note you actually opened from lost to
   * whatever note was attached last — the phone showed "Imported Notes" while
   * standing inside a different note. Setting the attachment before the sheet
   * can read it is what makes the first send land on the right material.
   */
  openForNote: (note: CompanionNoteContext) => void;
  /**
   * Drop the attachment AND the thread when the student moves to a different
   * room. A null scope means "nowhere in particular" and never clears.
   */
  resetForScope: (scopeId: string | null) => void;
  /** The room the current thread belongs to. Persisted with the thread id. */
  activeScopeId: string | null;
  /**
   * Open the sheet on a room the CALLER names, rather than one the panel
   * infers from the live route.
   *
   * Route inference is a guess made after the fact; a screen that knows which
   * room it is (the set room, a deck, a course) should say so, and this is the
   * one call that does it. The reset happens here, before the sheet can read
   * anything, so a stale attachment or thread can never survive into the new
   * room.
   */
  openForScope: (scope: CompanionRequestedScope) => void;
  /**
   * Derive the `Continue learning:` topic for whatever room the panel is
   * STANDING IN, whichever door opened it.
   *
   * `openForScope` is not the only door: the top bar's credits chip opens the
   * sheet with `open()`/`toggle()`, which state no scope at all — and the panel
   * then resolves the room from the live route (`resetForScope`). Deriving only
   * inside `openForScope` is why that door drew a picker with no Continue row
   * on the very same set where the bar's `Ask` drew one. So the derivation is
   * attached to the pair that actually describes the situation — the sheet is
   * open, and a set scope is current — rather than to one caller.
   *
   * Idempotent and cheap: it is a no-op unless the sheet is open, a set scope
   * is known, and nobody (host or an earlier derivation) has already stated a
   * topic. An explicit host value, including an explicit `null`, always wins.
   */
  ensureGuidedNextTopic: () => void;
  /**
   * Fill in the `Continue learning:` topic from the scoped set's SAVED PLAN
   * when the door that opened the sheet did not state one.
   *
   * Every door goes through `openForScope`; only one of them (the set room)
   * ever knew the plan, so the row existed through one door and was missing
   * from the bar's `Ask`, the room tile, the credits chip and the header. The
   * store is the one place all of them already pass through, so the
   * derivation lives here rather than being copied into each host.
   *
   * A host that states its own topic always wins — it may know more than the
   * saved plan does — and a set with no plan is left stating nothing, which is
   * what makes the picker offer `Start learning:` only.
   */
  hydrateGuidedNextTopic: (scopeId: string) => Promise<void>;
  /** What the caller said this open is about. Consumed by the panel on open. */
  requestedScope: CompanionRequestedScope | null;

  activeConversationId: string | null;
  pendingNewConversation: boolean;
  conversations: CompanionConversation[];
  isLoadingConversations: boolean;
  loadConversations: () => Promise<void>;
  openConversation: (conversationId: string) => Promise<void>;
  /**
   * Delete ONE past chat from the history list.
   *
   * `clearHistory` only ever deleted the conversation you were looking at, so
   * a thread you never reopened could not be removed from the phone at all.
   * Deleting the active thread also has to leave the panel somewhere valid,
   * which is a fresh chat — not a thread id the server no longer answers for.
   */
  deleteConversation: (conversationId: string) => Promise<void>;
  startNewChat: () => void;

  messages: CompanionMessage[];
  isLoading: boolean;
  isLoadingHistory: boolean;
  historyLoaded: boolean;
  isStreaming: boolean;
  error: string | null;
  /** The text of a send that failed — the panel restores it into the composer
      so a network blip can't destroy what the user typed. */
  failedMessage: string | null;
  consumeFailedMessage: () => string | null;

  /**
   * Photos already read and waiting on the next question. Uploaded (and paid
   * for) at pick time — the read is what costs credits, so the chip can state
   * the word count before anything is typed.
   */
  pendingImages: PendingCompanionImage[];
  isUploadingImage: boolean;
  imageError: string | null;
  /** The small print behind the composer's "Details" toggle (file, migration). */
  imageErrorDetail: string | null;
  attachImage: (input: {
    base64Data: string;
    fileName?: string;
    contentType?: string;
    /** The picked asset's on-device uri, for the chip's thumbnail. */
    previewUri?: string;
  }) => Promise<PendingCompanionImage | null>;
  removeImage: (attachmentId: string) => void;
  clearPendingImages: () => void;
  clearImageError: () => void;

  loadHistory: () => Promise<void>;
  setMessageFeedback: (messageId: string, rating: 'up' | 'down' | null) => void;
  sendMessage: (text: string, context?: CompanionUserContext) => Promise<void>;
  sendMessageStreaming: (text: string, context?: CompanionUserContext) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearError: () => void;
}

function mergeThreadContext(
  get: () => CompanionState,
  context?: CompanionUserContext
): CompanionUserContext {
  const noteCtx = get().activeNoteContext;
  const conversationId = get().activeConversationId;
  const pendingNew = get().pendingNewConversation;
  const images = get().pendingImages;
  return {
    ...context,
    ...(noteCtx
      ? { noteId: noteCtx.id, noteTitle: noteCtx.title, noteContext: undefined }
      : { noteId: undefined, noteTitle: undefined, noteContext: undefined }),
    ...(conversationId ? { conversationId } : { conversationId: undefined }),
    ...(pendingNew && !conversationId ? { newConversation: true } : {}),
    // The server trusts only the ids in here; the text rides along for the chip.
    // `previewUri` is stripped: it is a local file:// path on this phone and
    // means nothing to the server.
    ...(images.length
      ? {
          imageAttachments: images.map(({ previewUri: _previewUri, ...image }) => image),
        }
      : { imageAttachments: undefined }),
  };
}

export const useCompanionStore = create<CompanionState>()((set, get) => ({
  isOpen: false,
  messages: [],
  isLoading: false,
  isLoadingHistory: false,
  historyLoaded: false,
  isStreaming: false,
  error: null,
  pendingMessage: null,
  pendingMessageContext: null,
  activeNoteContext: null,
  activeConversationId: null,
  activeScopeId: null,
  requestedScope: null,
  pendingNewConversation: false,
  conversations: [],
  isLoadingConversations: false,
  pendingImages: [],
  isUploadingImage: false,
  imageError: null,
  imageErrorDetail: null,

  /**
   * Upload one photo and keep the reason when it fails.
   *
   * The failure path used to store `err.message` as-is, which meant the API's
   * generic label reached the composer as the single word "Error". Every
   * failure now goes through `describeImageAttachFailure`, and the panel that
   * called this is never closed by it — a failed read leaves the sheet up with
   * the sentence under the chip row.
   */
  attachImage: (input) => {
    const read = (async (): Promise<PendingCompanionImage | null> => {
    set({ isUploadingImage: true, imageError: null, imageErrorDetail: null });
    try {
      const uploaded = await uploadCompanionImage({
        base64Data: input.base64Data,
        fileName: input.fileName,
        contentType: input.contentType,
      });
      // The stored copy's signed URL needs a fetch and an auth round trip; the
      // picked file is already on the device, so the chip can show the actual
      // photo immediately instead of a generic glyph.
      const attachment: PendingCompanionImage = input.previewUri
        ? { ...uploaded, previewUri: input.previewUri }
        : uploaded;
      set((s) => ({
        pendingImages: [...s.pendingImages, attachment],
        isUploadingImage: false,
        imageError: null,
        imageErrorDetail: null,
      }));
      return attachment;
    } catch (err: any) {
      const failure = describeImageAttachFailure(err, input.fileName);
      set({
        isUploadingImage: false,
        imageError: failure.message,
        imageErrorDetail: failure.detail,
      });
      return null;
    }
    })();
    // A send that lands mid-read waits on this instead of asking blind.
    pendingImageRead = read;
    void read.finally(() => {
      if (pendingImageRead === read) pendingImageRead = null;
    });
    return read;
  },
  removeImage: (attachmentId: string) =>
    set((s) => ({
      pendingImages: s.pendingImages.filter((img) => img.attachmentId !== attachmentId),
      imageError: null,
      imageErrorDetail: null,
    })),
  clearPendingImages: () => set({ pendingImages: [], imageError: null, imageErrorDetail: null }),
  clearImageError: () => set({ imageError: null, imageErrorDetail: null }),

  open: () => {
    set({ isOpen: true, requestedScope: null });
    // The scope-less doors (the top bar's credits chip, the header's Ask) still
    // come up over a room. Whether there is one is `activeScopeId`'s answer.
    get().ensureGuidedNextTopic();
  },
  /**
   * A queued send belongs to the open that queued it. Leaving `pendingMessage`
   * set on close meant the next open auto-fired it the moment history was
   * already loaded — spending an AI credit while the panel was still loading,
   * without the user typing anything.
   */
  close: () =>
    set({ isOpen: false, pendingMessage: null, pendingMessageContext: null, requestedScope: null }),
  toggle: () => {
    const wasOpen = get().isOpen;
    set((s) =>
      s.isOpen
        ? { isOpen: false, pendingMessage: null, pendingMessageContext: null }
        : { isOpen: true }
    );
    if (!wasOpen) get().ensureGuidedNextTopic();
  },
  clearError: () => set({ error: null }),
  failedMessage: null,
  consumeFailedMessage: () => {
    const msg = get().failedMessage;
    if (msg !== null) set({ failedMessage: null });
    return msg;
  },
  setPendingMessage: (msg) => set({ pendingMessage: msg }),
  openWithMessage: (msg, context) =>
    set({ isOpen: true, pendingMessage: msg, pendingMessageContext: context ?? null }),

  hydrateNoteContext: async (scopeId = null) => {
    const [ctx, persisted] = await Promise.all([
      readPersistedNoteContext(),
      readPersistedConversation(),
    ]);
    // A thread restores only into the room it was started in. A null recorded
    // scope predates this field and is adopted rather than discarded.
    const threadBelongs =
      !!persisted &&
      (scopeId == null || persisted.scopeId == null || persisted.scopeId === scopeId);
    if (persisted && threadBelongs && get().activeConversationId !== persisted.conversationId) {
      set({ activeConversationId: persisted.conversationId });
    }
    if (persisted && !threadBelongs) {
      void persistConversationId(null);
      set({ activeConversationId: null, pendingNewConversation: true, messages: [] });
    }
    if (scopeId != null && get().activeScopeId !== scopeId) set({ activeScopeId: scopeId });
    if (!ctx) return;
    // Same rule for the attachment, and a record with NO room is treated the
    // same as one from another room. An unattributable attachment used to be
    // adopted into whichever room read it next, which is how a note from one
    // set arrived attached to a question asked in an empty other set.
    if (scopeId != null && ctx.scopeId !== scopeId) {
      void persistNoteContext(null);
      set({ activeNoteContext: null });
      return;
    }
    if (get().activeNoteContext?.id === ctx.id) return;
    set({ activeNoteContext: ctx });
  },

  openForNote: (note) => {
    const current = get().activeNoteContext;
    const sameNote = current?.id === note.id;
    // Synchronous: the sheet must never render, or send, against the previous
    // note. Persistence and history catch up afterwards.
    set({
      isOpen: true,
      activeNoteContext: note,
      activeScopeId: note.scopeId ?? note.id,
      ...(sameNote
        ? {}
        : {
            activeConversationId: null,
            pendingNewConversation: true,
            messages: [],
            historyLoaded: true,
            error: null,
          }),
    });
    void persistNoteContext(note);
    if (!sameNote) void persistConversationId(null);
  },

  openForScope: (scope) => {
    set({ isOpen: true, requestedScope: scope });
    // `resetForScope` ends in `ensureGuidedNextTopic`, which is what derives the
    // topic when this caller stated none. `undefined` is "nobody said", which
    // is the case the store answers; an explicit `null` is a host stating there
    // is no topic, and is obeyed.
    get().resetForScope(scope.scopeId);
    if (!scope.scopeId) get().ensureGuidedNextTopic();
  },

  ensureGuidedNextTopic: () => {
    const state = get();
    if (!state.isOpen) return;
    // A stated scope beats the standing one: a door that named its room is
    // more authoritative than whichever room the panel was last reset to.
    const scopeId = state.requestedScope?.scopeId ?? state.activeScopeId;
    if (!scopeId) return;
    if (state.requestedScope && state.requestedScope.guidedNextTopic !== undefined) return;
    void get().hydrateGuidedNextTopic(scopeId);
  },

  hydrateGuidedNextTopic: async (scopeId) => {
    // Late, and only onto the open this was started for: the sheet may have
    // been closed or moved to another room while the plan was fetched, and a
    // Continue row for a set the student has left is worse than no row.
    const apply = (topic: GuidedNextTopic | null) => {
      if (!topic) return;
      const state = get();
      const current = state.requestedScope;
      // A scope-less door (credits chip, header Ask) has no `requestedScope` to
      // land on, so the topic is recorded as one — scope id only, no label, so
      // the header keeps reading the route's own name. Still guarded by the
      // room: the sheet may have been closed or walked to another set while the
      // plan was being read, and a Continue row for a set the student has left
      // is worse than no row.
      if (!current) {
        if (!state.isOpen || state.activeScopeId !== scopeId) return;
        set({ requestedScope: { scopeId, guidedNextTopic: topic } });
        return;
      }
      if (current.scopeId !== scopeId) return;
      if (current.guidedNextTopic !== undefined) return;
      set({ requestedScope: { ...current, guidedNextTopic: topic } });
    };
    try {
      // Loaded on demand, not at module scope: the set store reaches the
      // network layer, and a companion store that dragged it in at import time
      // would make every companion test mock the academic service to talk
      // about a chat. A store that cannot be loaded simply states no topic.
      const { useStudySetStore } = await import('./studySetStore');
      const study = useStudySetStore.getState();
      const mode = study.resolveSet(scopeId)?.mode as
        | 'cram'
        | 'standard'
        | 'comprehensive'
        | undefined;
      const cached = study.plans[scopeId];
      if (cached?.loaded) {
        apply(guidedNextTopicForSet(cached, mode));
        return;
      }
      apply(guidedNextTopicForSet(await study.loadPlan(scopeId), mode));
    } catch {
      // A plan that cannot be read is not a plan that says "start over": the
      // picker simply offers its cold starts.
    }
  },

  resetForScope: (scopeId) => {
    if (!scopeId) return;
    const previousScope = get().activeScopeId;
    if (previousScope !== scopeId) set({ activeScopeId: scopeId });

    // Moving rooms retires the request the previous room left behind — its
    // label and its `Continue learning:` topic both describe a set the student
    // is no longer in. The new room's topic is then derived from its own plan.
    const requested = get().requestedScope;
    if (requested && requested.scopeId !== scopeId) set({ requestedScope: null });
    get().ensureGuidedNextTopic();

    const current = get().activeNoteContext;
    /**
     * An attachment with no recorded room is adopted ONLY when no other room
     * came before it — i.e. we are learning this session's first scope, not
     * moving between rooms.
     *
     * Blind adoption is the empty-set leak. `NoteEditorScreen` attaches
     * without a scope and its `await` lands AFTER the panel's scoped
     * `openForNote`, so the attachment ends up scope-less; walking note (set
     * A) -> Study -> set B then adopted that note into set B and the header
     * read "On: Imported Notes" inside an empty set.
     */
    const unattributable = !!current && current.scopeId == null;
    if (unattributable && (previousScope == null || previousScope === scopeId)) {
      const adopted = { ...current!, scopeId };
      void persistNoteContext(adopted);
      set({ activeNoteContext: adopted });
    }

    const attachmentIsForeign =
      !!current &&
      (current.scopeId != null
        ? current.scopeId !== scopeId
        : previousScope != null && previousScope !== scopeId);
    // The thread leaks on its own: an empty set with no attachment at all
    // still restored the previous room's conversation, because the old reset
    // returned early whenever nothing was attached.
    const threadIsForeign =
      (!!get().activeConversationId || get().messages.length > 0) &&
      previousScope != null &&
      previousScope !== scopeId;

    if (!attachmentIsForeign && !threadIsForeign) return;

    if (attachmentIsForeign) void persistNoteContext(null);
    void persistConversationId(null);
    set({
      ...(attachmentIsForeign ? { activeNoteContext: null } : {}),
      activeConversationId: null,
      activeScopeId: scopeId,
      pendingNewConversation: true,
      messages: [],
      historyLoaded: true,
      error: null,
    });
  },

  setActiveNoteContext: async (raw) => {
    const prev = get().activeNoteContext;
    /**
     * Stamp the CALLER's room onto every attachment.
     *
     * Screens outside this store (the note editor, the notes studio, the
     * lecture and quiz studios) attach a note without a scope. Those calls
     * `await` storage, so their `set` lands after the panel's scoped
     * `openForNote` and quietly replaced a scoped attachment with a
     * scope-less one — which the next room then adopted. The room the student
     * is standing in when the attach happens is `activeScopeId`, so record
     * that rather than leaving the attachment unattributable. Re-attaching
     * the same note keeps the scope it already had.
     */
    const ctx: CompanionNoteContext | null = raw
      ? {
          ...raw,
          scopeId:
            raw.scopeId ??
            (prev && prev.id === raw.id ? prev.scopeId ?? null : null) ??
            get().activeScopeId ??
            null,
        }
      : null;
    const nextId = ctx?.id ?? null;
    const prevId = prev?.id ?? null;
    if (
      nextId === prevId &&
      (ctx?.title ?? null) === (prev?.title ?? null) &&
      (ctx?.scopeId ?? null) === (prev?.scopeId ?? null)
    ) {
      return;
    }
    await persistNoteContext(ctx);
    await persistConversationId(null);
    set({
      activeNoteContext: ctx,
      activeConversationId: null,
      pendingNewConversation: false,
      messages: [],
      historyLoaded: false,
      error: null,
    });
    await get().loadHistory();
  },

  loadConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      const { conversations } = await fetchCompanionConversations();
      set({ conversations, isLoadingConversations: false });
    } catch {
      set({ isLoadingConversations: false });
    }
  },

  openConversation: async (conversationId) => {
    const target = get().conversations.find((c) => c.id === conversationId);
    await persistConversationId(conversationId, get().activeScopeId);
    if (target?.noteContextId) {
      // Scoped to the room the thread is being opened in, so reopening a past
      // chat cannot leave an unattributable attachment for the next room.
      const restored: CompanionNoteContext = {
        id: target.noteContextId,
        title: target.noteTitle || 'Untitled note',
        scopeId: get().activeScopeId ?? null,
      };
      await persistNoteContext(restored);
      set({
        activeConversationId: conversationId,
        pendingNewConversation: false,
        activeNoteContext: restored,
        messages: [],
        historyLoaded: false,
        error: null,
      });
    } else {
      if (target && !target.noteContextId) {
        await persistNoteContext(null);
      }
      set({
        activeConversationId: conversationId,
        pendingNewConversation: false,
        ...(target && !target.noteContextId ? { activeNoteContext: null } : {}),
        messages: [],
        historyLoaded: false,
        error: null,
      });
    }
    await get().loadHistory();
  },

  deleteConversation: async (conversationId) => {
    const wasActive = get().activeConversationId === conversationId;
    try {
      await clearCompanionHistory({ conversationId });
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : 'Failed to delete that chat.',
      });
      return;
    }
    // Drop it locally rather than re-fetching: the list is already on screen,
    // and a refetch would make the row linger for a round trip after the
    // student confirmed the delete.
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== conversationId),
    }));
    if (!wasActive) return;
    await persistConversationId(null);
    await persistNoteContext(null);
    set({
      activeConversationId: null,
      activeNoteContext: null,
      pendingNewConversation: true,
      messages: [],
      historyLoaded: true,
      error: null,
    });
  },

  startNewChat: () => {
    void persistConversationId(null);
    // A new chat is a new chat: on the phone the attachment survived this too,
    // silently scoping the next question to a note the student had left.
    void persistNoteContext(null);
    set({
      activeNoteContext: null,
      activeConversationId: null,
      pendingNewConversation: true,
      messages: [],
      historyLoaded: true,
      error: null,
    });
  },

  setMessageFeedback: (messageId, rating) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, feedback: rating } : m
      ),
    }));
  },

  loadHistory: async () => {
    set({ isLoadingHistory: true, error: null });
    const noteContextId = get().activeNoteContext?.id ?? null;
    const conversationId = get().activeConversationId;
    const pendingNew = get().pendingNewConversation;
    if (pendingNew && !conversationId) {
      set({ isLoadingHistory: false, historyLoaded: true, messages: [] });
      return;
    }
    try {
      const result = await fetchCompanionHistory(
        conversationId ? { conversationId } : { noteContextId }
      );
      const previousFeedback = new Map(
        get()
          .messages.filter((m) => m.feedback === 'up' || m.feedback === 'down')
          .map((m) => [m.id, m.feedback as 'up' | 'down'])
      );
      if (conversationId && (get().activeConversationId ?? null) !== conversationId) {
        return;
      }
      if (!conversationId && (get().activeNoteContext?.id ?? null) !== noteContextId) {
        return;
      }
      if (result.conversationId) {
        await persistConversationId(result.conversationId, get().activeScopeId);
      }
      set({
        messages: result.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          actions: m.actions,
          feedback: m.feedback ?? previousFeedback.get(m.id) ?? null,
          created_at: m.created_at,
        })),
        activeConversationId: result.conversationId ?? get().activeConversationId,
        pendingNewConversation: false,
        isLoadingHistory: false,
        historyLoaded: true,
      });
    } catch {
      if (conversationId && (get().activeConversationId ?? null) !== conversationId) {
        return;
      }
      if (!conversationId && (get().activeNoteContext?.id ?? null) !== noteContextId) {
        return;
      }
      set({ isLoadingHistory: false, historyLoaded: true });
    }
  },

  /**
   * One tap, one charge.
   *
   * `isStreaming` reaches the composer as a React snapshot, so two taps in the
   * same frame both saw `false` and both sent — the server charged twice for
   * one question. The store is the only honest in-flight flag, so the guard
   * lives here as well as in the button.
   */
  sendMessage: async (text: string, context?: CompanionUserContext) => {
    if (get().isLoading || get().isStreaming || awaitingImageRead) return;
    // A photo half-read is still this question's photo — see pendingImageRead.
    // Only awaited when one is actually in flight: the ordinary send must stay
    // synchronous up to the in-flight flags, or the double-tap guard is gone.
    if (pendingImageRead) {
      awaitingImageRead = true;
      try {
        await settlePendingImageRead();
      } finally {
        awaitingImageRead = false;
      }
      if (get().isLoading || get().isStreaming) return;
    }
    const oneShot = get().pendingMessageContext;
    if (oneShot) set({ pendingMessageContext: null });
    const mergedContext = mergeThreadContext(get, oneShot ? { ...oneShot, ...context } : context);

    const tempUserMsg: CompanionMessage = {
      id: `tmp-user-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };

    set((s) => ({
      messages: [...s.messages, tempUserMsg],
      isLoading: true,
      error: null,
    }));

    try {
      const { reply, actions, citations, conversationId } = await companionSendMessage(text, mergedContext);
      if (conversationId) {
        await persistConversationId(conversationId, get().activeScopeId);
      }
      const assistantMsg: CompanionMessage = {
        id: `tmp-ai-${Date.now()}`,
        role: 'assistant',
        content: reply,
        actions: actions?.length ? actions : undefined,
        citations: normalizeCompanionCitation(citations),
        created_at: new Date().toISOString(),
      };
      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isLoading: false,
        activeConversationId: conversationId || s.activeConversationId,
        pendingNewConversation: false,
        // The attachment belonged to that question — keeping it would staple
        // the photo to every later question in the thread.
        pendingImages: [],
      }));
      void get().loadConversations();
    } catch (err: unknown) {
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== tempUserMsg.id),
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to reach Lantern. Please try again.',
      }));
    }
  },

  sendMessageStreaming: async (text: string, context?: CompanionUserContext) => {
    // Same one-tap-one-charge guard as sendMessage: this is the path all
    // mobile chat takes, and it is the billable one.
    if (get().isLoading || get().isStreaming || awaitingImageRead) return;
    // Same wait as sendMessage: the ids must be in hand before the context is
    // built, or the attachment never leaves the phone.
    if (pendingImageRead) {
      awaitingImageRead = true;
      try {
        await settlePendingImageRead();
      } finally {
        awaitingImageRead = false;
      }
      if (get().isLoading || get().isStreaming) return;
    }
    const oneShot = get().pendingMessageContext;
    if (oneShot) set({ pendingMessageContext: null });
    const mergedContext = mergeThreadContext(get, oneShot ? { ...oneShot, ...context } : context);

    const tempUserMsg: CompanionMessage = {
      id: `tmp-user-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    const tempAiId = `tmp-ai-${Date.now()}`;
    const tempAiMsg: CompanionMessage = {
      id: tempAiId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    };

    set((s) => ({
      messages: [...s.messages, tempUserMsg, tempAiMsg],
      isStreaming: true,
      isLoading: false,
      error: null,
    }));

    await companionSendMessageStream(
      text,
      mergedContext,
      (token) => {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === tempAiId ? { ...m, content: m.content + token } : m
          ),
        }));
      },
      ({ actions, citations, messageId, userMessageId, conversationId }) => {
        if (conversationId) {
          void persistConversationId(conversationId, get().activeScopeId);
        }
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id === tempAiId) {
              return {
                ...m,
                id: messageId || m.id,
                actions: actions.length ? actions : undefined,
                citations: normalizeCompanionCitation(citations),
              };
            }
            if (userMessageId && m.id === tempUserMsg.id) {
              return { ...m, id: userMessageId };
            }
            return m;
          }),
          isStreaming: false,
          activeConversationId: conversationId || s.activeConversationId,
          pendingNewConversation: false,
          // One question, one attachment — see sendMessage.
          pendingImages: [],
        }));
        void get().loadConversations();
      },
      (err) => {
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== tempUserMsg.id && m.id !== tempAiId),
          isStreaming: false,
          error: err.message || 'Failed to reach Lantern. Please try again.',
          // Hand the typed text back to the composer instead of destroying it.
          failedMessage: text,
        }));
      }
    );
  },

  clearHistory: async () => {
    const conversationId = get().activeConversationId;
    const noteContextId = get().activeNoteContext?.id ?? null;
    try {
      await clearCompanionHistory(
        conversationId ? { conversationId } : { noteContextId }
      );
      await persistConversationId(null);
      set({
        messages: [],
        activeConversationId: null,
        pendingNewConversation: true,
      });
      void get().loadConversations();
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : 'Failed to clear conversation.',
      });
    }
  },
}));

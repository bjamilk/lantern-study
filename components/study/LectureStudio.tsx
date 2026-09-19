/**
 * The LECTURE ROOM: a note editor, a transcript drawer beside it, and the
 * companion rail beside that.
 *
 * Exports: `LectureStudio` (named + default).
 * Touches: `notesStore` (create/save/remove), `lectureRecordingStore` (the take
 * itself — capture, segments, upload, transcription), `companionStore` (Ask),
 * `toastStore`, `authStore` (the account's language + consent memory),
 * `useLecturePreCheck` (level meter, quality, mic list), and the pure planners
 * in `@lantern/shared` (`lectureDrawerReducer`, `growLectureChunks`,
 * `lectureTabPillLabels`, `lectureNoteParts`).
 *
 * ## The shape, and why it changed (lane W7)
 *
 * This studio used to be ONE column: a toolbar, a consent bar, an enhance row,
 * a live-transcript box, a tab strip and an Ask box, stacked down a single
 * pane. Five of those six were controls, and the lecture — the notes a student
 * types during class — got whatever was left. The measured reference (doc 04
 * §9) puts the notes in the middle of the screen and everything else either in
 * a 236px drawer to their right or in a floating pill at the bottom, and that
 * is what this file now draws:
 *
 *   editor column (fluid)  |  transcript drawer 236  |  the companion rail
 *
 * The drawer lives INSIDE the set room's focus layout, so it is a sibling of
 * the editor and NOT an overlay — until the room is too narrow for both, at
 * which point `lectureDrawerPlacement` turns it into a sheet rather than
 * squeezing the editor below a width you can write in. The studio measures
 * ITSELF for that decision, exactly as `useCompanionRail` measures the room:
 * the window is not the column.
 *
 * ## Gotchas
 *
 *  - A lecture IS a note. The body is typed notes + transcript + an appended
 *    Smart Notes section, so every autosave has to re-attach `enhancedRef` or
 *    the first keystroke after enhancing deletes the enhanced notes.
 *  - The drawer's step comes from the pure reducer, but the RECORDER's status
 *    comes from the store. They are synced one way only (store → drawer) in the
 *    effect below: the store is what owns the microphone, and a drawer that
 *    thought it was recording when the store had stopped is how you get a stuck
 *    "Generating…" — the exact bug the reference has.
 *  - The Record tab does not open a panel. It opens the DRAWER, which is the
 *    fifth surface; the four panels are the four tabs before it.
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  LECTURE_ASK_JUST_SAID,
  LECTURE_ASK_KEEP_LISTENING,
  LECTURE_CONSENT_LINE,
  applyLectureSegmentToChunks,
  applyLectureNoteStamp,
  buildLectureAsk,
  composeLectureNoteBody,
  displayLectureTranscript,
  formatLectureClock,
  growLectureChunks,
  hasEnoughNoteStudyContent,
  initialLectureDrawer,
  latestLectureTranscript,
  lectureAudioAttachment,
  lectureDrawerCopy,
  lectureDrawerReducer,
  lectureNoteParts,
  lectureStudioPriceLine,
  lectureTabPillLabels,
  newLectureNoteTitle,
  preferLectureTranscript,
  sealLectureChunks,
  studySetNotePayload,
  resolveLectureStudioNote,
  shouldCreateLectureNote,
  shouldDeleteDoorNoteOnDiscard,
  type LectureAttachmentLike,
  type LectureChunk,
  type LectureTabPillId,
  type TurnIntoTargetId,
} from '@lantern/shared';
import {
  upsertSmartNotesSection,
  type SmartNotesDepth,
  type SmartNotesRequestOptions,
} from '@lantern/shared/utils/smartNotes';
import { formatCreditCost, getSmartNotesCreditCost } from '@lantern/shared/utils/aiCredits';
import type { StudyNote } from '../../types';
import { Button, Select } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/Menu';
import { NoteReadingView } from './NoteReadingView';
import { LectureAudioPlayer } from './LectureAudioPlayer';
import { LectureEnhanceModal } from './LectureEnhanceModal';
import { LectureTabPill } from './LectureTabPill';
import {
  LectureMinimisedWidget,
  LectureTranscriptDrawer,
} from './LectureTranscriptDrawer';
import { lectureDrawerPlacement } from './lectureDrawerLayout';
import { TurnIntoMenuItems } from './TurnIntoMenu';
import NoteCollaboratorsModal from '../NoteCollaboratorsModal';
import { useNotesStore } from '../../stores/notesStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useToastStore } from '../../stores/toastStore';
import {
  getSessionElapsedMs,
  useLectureRecordingStore,
} from '../../stores/lectureRecordingStore';
import { useAuthStore } from '../../stores/authStore';
import { useLecturePreCheck } from '../../hooks/useLecturePreCheck';
import {
  currentLectureLanguages,
  lectureConsentRemembered,
  rememberLectureConsent,
  setLectureLanguages,
} from '../../utils/lectureRecorderPrefs';
import { LectureRecorderSettings } from './LectureRecorderSettings';
import { LectureAudioSegments } from './LectureSegmentList';
import { resolveLectureResume, lectureSegmentRows } from '@lantern/shared/utils/lectureSegments';

interface LectureStudioProps {
  courseId: string;
  studySetId?: string;
  theme: 'light' | 'dark';
  note: (StudyNote & { attachments?: LectureAttachmentLike[] }) | null;
  lectures: Array<StudyNote & { attachments?: LectureAttachmentLike[] }>;
  turning?: boolean;
  /** Targets already made from a note, so the menu can tick them. */
  turnIntoExisting?: (noteId: string) => Partial<Record<TurnIntoTargetId, boolean>>;
  onTurnInto: (target: TurnIntoTargetId) => void;
  onSmartNote: (
    editorState: { title?: string; body?: string },
    options?: SmartNotesRequestOptions
  ) => Promise<unknown>;
  onNoteReady: (noteId: string) => Promise<void>;
}

/**
 * How fast the enhanced notes arrive in the editor.
 *
 * The enhance route answers with the WHOLE text — there is no token stream to
 * subscribe to — so the reveal is progressive rendering rather than streaming,
 * in steps no slower than this. It is the honest version of the reference's
 * effect: nothing is faked about where the words came from, and the chip above
 * the editor says "Saving enhanced notes…" because that is what is happening.
 */
const ENHANCE_REVEAL_STEP_MS = 120;
const ENHANCE_REVEAL_STEPS = 12;
/**
 * How long the reveal waits for the enhanced notes to come back from the
 * parent's refetch before it gives up. A reveal that never ends is the
 * reference's stuck spinner in a different coat.
 */
const ENHANCE_REVEAL_WAIT_MS = 15_000;

export const LectureStudio: React.FC<LectureStudioProps> = ({
  courseId,
  studySetId,
  note,
  lectures,
  turning,
  turnIntoExisting,
  onTurnInto,
  onSmartNote,
  onNoteReady,
}) => {
  const saveNote = useNotesStore((s) => s.saveNote);
  const createNote = useNotesStore((s) => s.createNote);
  const removeNote = useNotesStore((s) => s.removeNote);
  const openWithMessage = useCompanionStore((s) => s.openWithMessage);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  const showToast = useToastStore((s) => s.showToast);

  const status = useLectureRecordingStore((s) => s.status);
  const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
  const startedAt = useLectureRecordingStore((s) => s.startedAt);
  const pausedAt = useLectureRecordingStore((s) => s.pausedAt);
  const pausedTotalMs = useLectureRecordingStore((s) => s.pausedTotalMs);
  const tick = useLectureRecordingStore((s) => s.tick);
  const committedTranscript = useLectureRecordingStore((s) => s.committedTranscript);
  const interimTranscript = useLectureRecordingStore((s) => s.interimTranscript);
  const whisperTranscript = useLectureRecordingStore((s) => s.whisperTranscript);
  const startRecording = useLectureRecordingStore((s) => s.start);
  const stopRecording = useLectureRecordingStore((s) => s.stopAndTranscribe);
  const discardRecording = useLectureRecordingStore((s) => s.discard);
  const setCurrentBodyProvider = useLectureRecordingStore((s) => s.setCurrentBodyProvider);
  const segments = useLectureRecordingStore((s) => s.segments);
  const segmentsNoteId = useLectureRecordingStore((s) => s.transcriptNoteId);
  const retrySegment = useLectureRecordingStore((s) => s.retrySegment);
  const hydrateFromNote = useLectureRecordingStore((s) => s.hydrateFromNote);

  const decision = useMemo(
    () =>
      resolveLectureStudioNote({
        lectures,
        selectedNoteId: note?.id,
        recordingNoteId: lectureNoteId && status !== 'idle' ? lectureNoteId : null,
        todayTitle: newLectureNoteTitle(),
      }),
    [lectures, note?.id, lectureNoteId, status]
  );

  const activeNote =
    (lectureNoteId && (note?.id === lectureNoteId ? note : lectures.find((row) => row.id === lectureNoteId))) ||
    (decision.action === 'resume'
      ? note?.id === decision.noteId
        ? note
        : lectures.find((row) => row.id === decision.noteId) || note
      : note);

  const userSettings = useAuthStore((s) => s.currentUser?.settings);
  const currentUserId = useAuthStore((s) => s.currentUser?.id);
  const languages = useMemo(() => currentLectureLanguages(userSettings), [userSettings]);
  const consentRemembered = useMemo(
    () => lectureConsentRemembered(userSettings),
    [userSettings]
  );

  const [drawer, dispatchDrawer] = useReducer(
    lectureDrawerReducer,
    { consentRemembered, open: status !== 'idle' },
    initialLectureDrawer
  );
  /** The account's answer can land after the first render (the profile loads). */
  useEffect(() => {
    if (consentRemembered && !drawer.consentRemembered) {
      dispatchDrawer({ type: 'consent-granted' });
    }
  }, [consentRemembered, drawer.consentRemembered]);

  const [agreed, setAgreed] = useState(status !== 'idle' || consentRemembered);
  const [title, setTitle] = useState(activeNote?.title || '');
  const [notesBody, setNotesBody] = useState('');
  const [askDraft, setAskDraft] = useState('');
  const [depth, setDepth] = useState<SmartNotesDepth>('standard');
  const [writing, setWriting] = useState(false);
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  /** How much of the enhanced notes has been revealed into the editor. */
  const [revealChars, setRevealChars] = useState<number | null>(null);
  /** Re-runs the reveal effect while it waits for the note to come back. */
  const [revealWaitTick, setRevealWaitTick] = useState(0);
  const revealStartedAt = useRef<number | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [tab, setTab] = useState<LectureTabPillId>('notes');
  const [starting, setStarting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skillHint, setSkillHint] = useState('');
  const [contextNoteId, setContextNoteId] = useState('');
  const [chunks, setChunks] = useState<LectureChunk[]>([]);
  /** The measured width of this studio — what decides inline drawer vs sheet. */
  const [studioWidth, setStudioWidth] = useState<number | null>(null);
  const studioRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const notesRef = useRef(notesBody);
  const doorRef = useRef<{ noteId: string; doorTitle: string } | null>(null);
  titleRef.current = title;
  notesRef.current = notesBody;

  useEffect(() => {
    const node = studioRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = (width: number) =>
      setStudioWidth((prev) => (prev !== null && Math.abs(prev - width) < 1 ? prev : width));
    measure(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') measure(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const knownTranscript = whisperTranscript || latestLectureTranscript(activeNote?.attachments);
  const storedParts = lectureNoteParts({
    body: activeNote?.body ?? '',
    attachments: activeNote?.attachments ?? [],
  });
  const savedTranscript = preferLectureTranscript(storedParts.transcript, knownTranscript);
  const persistableTranscript = preferLectureTranscript(
    savedTranscript,
    displayLectureTranscript({
      committed: committedTranscript,
      interim: '',
      whisper: knownTranscript,
    })
  );
  const liveTranscript = displayLectureTranscript({
    committed: committedTranscript,
    interim: interimTranscript,
    whisper: persistableTranscript,
  });

  useEffect(() => {
    if (!activeNote) {
      setTitle(decision.action === 'create' ? decision.title : '');
      setNotesBody('');
      return;
    }
    setTitle(activeNote.title || '');
    setNotesBody(storedParts.typed);
  }, [activeNote?.id, activeNote?.title, activeNote?.body, knownTranscript, decision]);

  /**
   * Put the body back together for a save. The typed notes no longer carry the
   * generated section, so every write has to re-attach it — otherwise the first
   * autosave after enhancing would silently delete the enhanced notes.
   */
  const enhancedRef = useRef('');
  enhancedRef.current = storedParts.enhanced;
  const composeBody = useCallback((typed: string, transcript: string) => {
    const base = composeLectureNoteBody(typed, transcript);
    return enhancedRef.current ? upsertSmartNotesSection(base, enhancedRef.current) : base;
  }, []);

  const scheduleSave = useCallback(() => {
    if (!activeNote) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveNote(activeNote.id, {
        title: titleRef.current,
        body: composeBody(notesRef.current, persistableTranscript),
      }).catch(() => undefined);
    }, 700);
  }, [activeNote, composeBody, persistableTranscript, saveNote]);

  const flushNote = useCallback(() => {
    if (!activeNote) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const transcript = preferLectureTranscript(savedTranscript, persistableTranscript);
    if (!notesRef.current.trim() && !transcript.trim()) return;
    void saveNote(activeNote.id, {
      title: titleRef.current,
      body: composeBody(notesRef.current, transcript),
    }).catch(() => undefined);
  }, [activeNote, composeBody, savedTranscript, persistableTranscript, saveNote]);

  const flushNoteRef = useRef(flushNote);
  flushNoteRef.current = flushNote;

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  useEffect(() => {
    setCurrentBodyProvider(() => notesRef.current);
    return () => setCurrentBodyProvider(null);
  }, [setCurrentBodyProvider]);

  useEffect(() => {
    if (!committedTranscript.trim() && !knownTranscript.trim()) return;
    scheduleSave();
  }, [committedTranscript, knownTranscript, scheduleSave]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushNoteRef.current();
    };
    const onPageHide = () => flushNoteRef.current();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      flushNoteRef.current();
    };
  }, []);

  const elapsedMs = getSessionElapsedMs({ startedAt, pausedAt, pausedTotalMs });
  void tick;
  const recording = status === 'recording';
  const busy = status === 'saving' || status === 'uploading' || status === 'transcribing';

  /**
   * The pre-check holds its own short-lived microphone stream so the meter
   * moves before and during a take, and is released once neither is true.
   */
  const preCheck = useLecturePreCheck(status === 'idle' || recording);

  const allNotes = useNotesStore((s) => s.notes);
  const attachableNotes = useMemo(() => {
    if (!studySetId) return [];
    return (allNotes ?? []).filter(
      (row) => row.studySetId === studySetId && row.id !== activeNote?.id
    );
  }, [allNotes, studySetId, activeNote?.id]);
  const contextNote = attachableNotes.find((row) => row.id === contextNoteId) ?? null;

  useEffect(() => {
    if (recording) setEditingNotes(true);
  }, [recording]);

  /** STORE → DRAWER. The store owns the microphone; the drawer follows it. */
  useEffect(() => {
    if (recording && drawer.step !== 'recording') dispatchDrawer({ type: 'recording-started' });
    if (status === 'saving' && drawer.step === 'recording') dispatchDrawer({ type: 'stop' });
    if (status === 'idle' && drawer.step === 'saving') dispatchDrawer({ type: 'saved' });
  }, [recording, status, drawer.step]);

  useEffect(() => {
    if (status !== 'idle' || !activeNote?.id) return;
    hydrateFromNote(activeNote.id, activeNote.attachments);
  }, [status, activeNote?.id, activeNote?.attachments, hydrateFromNote]);

  /** An interrupted take: offer to carry on, or just to finish transcribing. */
  const recovery = useMemo(() => {
    if (status !== 'idle' || !activeNote) return null;
    const resume = resolveLectureResume({
      rows: lectureSegmentRows(activeNote.attachments ?? []),
    });
    return resume.action === 'recover' ? resume : null;
  }, [status, activeNote?.id, activeNote?.attachments]);

  const segmentsForNote = segmentsNoteId === activeNote?.id ? segments : [];

  /* ------------------------------------------------------------ chunks -- */

  /**
   * The captions grow the open chunk; a closed segment replaces the captions
   * for its span. Both rules live in `@lantern/shared/learning/lectureRecorder`
   * so the phone's Transcript tab reads the same list.
   */
  const captions = displayLectureTranscript({
    committed: committedTranscript,
    interim: interimTranscript,
  });
  useEffect(() => {
    if (!recording || !captions.trim()) return;
    setChunks((previous) => growLectureChunks({ chunks: previous, text: captions, atMs: elapsedMs }));
    // `elapsedMs` moves every tick; the chunk grows on new WORDS, not on time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captions, recording]);

  useEffect(() => {
    const done = segmentsForNote.filter((row) => row.status === 'done' && row.transcript);
    if (!done.length) return;
    setChunks((previous) =>
      done.reduce(
        (rows, row) =>
          applyLectureSegmentToChunks({
            chunks: rows,
            seq: row.seq,
            startOffsetMs: row.startOffsetMs,
            durationMs: row.durationMs,
            text: row.transcript,
          }),
        previous
      )
    );
  }, [segmentsForNote]);

  const sealedChunks = drawer.step === 'done' ? sealLectureChunks(chunks) : chunks;

  /* ------------------------------------------------------- the actions -- */

  const ensureNote = async (): Promise<StudyNote | null> => {
    if (activeNote) return activeNote;
    const createdTitle = newLectureNoteTitle();
    const created = await createNote({
      title: createdTitle,
      body: '',
      ...studySetNotePayload({ courseId, studySetId }),
    });
    doorRef.current = { noteId: created.id, doorTitle: createdTitle };
    await onNoteReady(created.id);
    return created;
  };

  const cleanupDoorNote = async () => {
    const door = doorRef.current;
    if (!door) return;
    if (
      !shouldDeleteDoorNoteOnDiscard({
        openedByDoor: true,
        title: titleRef.current,
        body: notesRef.current,
        doorTitle: door.doorTitle,
      })
    ) {
      return;
    }
    try {
      await removeNote(door.noteId);
      doorRef.current = null;
    } catch {
      // A leftover empty shell is worse than a failed delete toast here.
    }
  };

  const beginTake = async (resume?: { sessionId: string; nextSeq: number; recordedMs: number }) => {
    if (starting || recording || busy) return;
    setStarting(true);
    try {
      const target = await ensureNote();
      if (!target) throw new Error('Could not open a lecture note.');
      await startRecording(target.id, titleRef.current || target.title || newLectureNoteTitle(), {
        currentBody: notesRef.current,
        language: languages.spokenLanguage,
        translateTo: languages.transcribeTo,
        deviceId: preCheck.selectedDeviceId,
        ...(resume ? { resume } : {}),
      });
      if (useLectureRecordingStore.getState().status !== 'recording') {
        await cleanupDoorNote();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start recording.', 'error');
      await cleanupDoorNote();
    } finally {
      setStarting(false);
    }
  };

  /** The big black button: ask for consent first, unless it is remembered. */
  const handleStartPressed = () => {
    if (!shouldCreateLectureNote(agreed)) {
      showToast('Confirm you can record before starting.', 'info');
      return;
    }
    const next = lectureDrawerReducer(drawer, { type: 'start-pressed' });
    dispatchDrawer({ type: 'start-pressed' });
    if (next.step === 'recording') void beginTake();
  };

  const handleConsent = (granted: boolean) => {
    if (!granted) {
      dispatchDrawer({ type: 'consent-declined' });
      return;
    }
    dispatchDrawer({ type: 'consent-granted' });
    rememberLectureConsent();
    void beginTake();
  };

  const handleStop = () => {
    dispatchDrawer({ type: 'stop' });
    stopRecording({ currentBody: notesRef.current });
  };

  const handleResume = () => {
    const rows = lectureSegmentRows(activeNote?.attachments ?? []);
    const offer = resolveLectureResume({ rows });
    dispatchDrawer({ type: 'resume' });
    void beginTake(
      offer.action === 'none'
        ? undefined
        : { sessionId: offer.sessionId, nextSeq: offer.nextSeq, recordedMs: offer.recordedMs }
    );
  };

  const handleDiscard = async () => {
    discardRecording();
    dispatchDrawer({ type: 'discard' });
    setChunks([]);
    await cleanupDoorNote();
  };

  const handleNotesChange = (next: string) => {
    const stamped = recording ? applyLectureNoteStamp(notesRef.current, next, elapsedMs) : next;
    setNotesBody(stamped);
    scheduleSave();
  };

  const askAboutLecture = async () => {
    const target = activeNote;
    if (target) {
      await setActiveNoteContext({ id: target.id, title: title || target.title || 'Lecture' });
    }
    openWithMessage(
      buildLectureAsk({
        question: askDraft,
        recentTranscript: liveTranscript,
        noteTitle: title || target?.title,
        elapsedMs: recording ? elapsedMs : undefined,
      }),
      { noteId: target?.id, recentTranscript: liveTranscript.slice(-400) }
    );
    setAskDraft('');
  };

  /* ------------------------------------------------------------ enhance -- */

  /**
   * Reveal the enhanced notes progressively once they land.
   *
   * The tab keeps saying "Generating…" for as long as `revealChars` is running,
   * and the chip above the editor says what is happening. When it finishes —
   * or when the request fails — both go away in the SAME state update, which is
   * what stops the reference's stuck spinner from ever existing here.
   */
  useEffect(() => {
    if (revealChars === null) return;
    const full = storedParts.enhanced;
    if (!full) {
      // The note has not come back from the parent's refetch yet. Wait — but
      // not forever: a reveal that never ends is the stuck spinner in a
      // different coat, so it gives up after `ENHANCE_REVEAL_WAIT_MS` and the
      // tab goes back to its own label with the notes still saved on the note.
      const startedAt = revealStartedAt.current ?? Date.now();
      revealStartedAt.current = startedAt;
      if (Date.now() - startedAt > ENHANCE_REVEAL_WAIT_MS) {
        setRevealChars(null);
        return;
      }
      const wait = setTimeout(() => setRevealWaitTick((value) => value + 1), 200);
      return () => clearTimeout(wait);
    }
    revealStartedAt.current = null;
    if (revealChars >= full.length) {
      const done = setTimeout(() => setRevealChars(null), ENHANCE_REVEAL_STEP_MS);
      return () => clearTimeout(done);
    }
    const step = Math.max(1, Math.ceil(full.length / ENHANCE_REVEAL_STEPS));
    const timer = setTimeout(
      () => setRevealChars((chars) => Math.min(full.length, (chars ?? 0) + step)),
      ENHANCE_REVEAL_STEP_MS
    );
    return () => clearTimeout(timer);
  }, [revealChars, revealWaitTick, storedParts.enhanced]);

  const enhancing = writing || revealChars !== null;
  const writeCost = formatCreditCost(getSmartNotesCreditCost(depth));

  const enhanceNotes = async () => {
    if (!activeNote) {
      showToast('Start a lecture note first.', 'info');
      return;
    }
    const snapshot = { title: titleRef.current, body: notesRef.current };
    const source = liveTranscript
      ? { ...activeNote, ...snapshot, body: `${snapshot.body}\n\n${liveTranscript}` }
      : { ...activeNote, ...snapshot };
    if (!hasEnoughNoteStudyContent(source)) {
      showToast('Add notes or wait for the transcript before enhancing.', 'info');
      return;
    }
    setEnhanceError(null);
    setEnhanceOpen(false);
    setWriting(true);
    setTab('enhanced');
    try {
      // Save the WHOLE lecture, not the typed half: the transcript is the part
      // worth summarizing, and the server re-reads the note.
      const full = {
        title: snapshot.title,
        body: composeBody(snapshot.body, persistableTranscript),
      };
      await saveNote(activeNote.id, full);
      await onSmartNote(full, {
        depth,
        skillLevelHint: skillHint.trim() || undefined,
        contextNoteId: contextNoteId || undefined,
      });
      setRevealChars(0);
    } catch (error) {
      // The tab label is a function of `enhancing`, so clearing it here IS the
      // fix for the reference's "Generating…" that never stopped.
      setRevealChars(null);
      setEnhanceError(
        error instanceof Error ? error.message : lectureDrawerCopy.enhanceFailed
      );
    } finally {
      setWriting(false);
    }
  };

  /* ----------------------------------------------------------- the tabs -- */

  const audioRow = lectureAudioAttachment({
    body: activeNote?.body ?? '',
    attachments: activeNote?.attachments ?? [],
  });
  const tabItems = lectureTabPillLabels({
    recording,
    enhancing,
    hasEnhanced: Boolean(storedParts.enhanced),
  });
  const placement = lectureDrawerPlacement(studioWidth ?? 0);
  const drawerVisible = drawer.open && !drawer.minimised;
  const enhancedShown =
    revealChars === null ? storedParts.enhanced : storedParts.enhanced.slice(0, revealChars);

  const onPickTab = (next: LectureTabPillId) => {
    if (next === 'record') {
      dispatchDrawer({ type: drawerVisible ? 'close' : 'open' });
      return;
    }
    setTab(next);
  };

  const settingsPopover = settingsOpen ? (
    <LectureRecorderSettings
      languages={languages}
      onChangeLanguages={(patch) => setLectureLanguages(patch)}
      devices={preCheck.devices}
      selectedDeviceId={preCheck.selectedDeviceId}
      onSelectDevice={preCheck.selectDevice}
      onClose={() => setSettingsOpen(false)}
    />
  ) : null;

  const drawerNode = (
    <LectureTranscriptDrawer
      drawer={drawer}
      preCheck={preCheck}
      canStart={agreed}
      starting={starting}
      chunks={sealedChunks}
      sealed={drawer.step === 'done'}
      elapsedMs={elapsedMs}
      enhancing={enhancing}
      onEnhance={() => setEnhanceOpen(true)}
      enhanceCost={writeCost}
      onClose={() => dispatchDrawer({ type: 'close' })}
      onOpenSettings={() => setSettingsOpen((was) => !was)}
      onStart={handleStartPressed}
      onConsent={handleConsent}
      onStop={handleStop}
      onMinimise={() => dispatchDrawer({ type: 'minimise' })}
      onResume={handleResume}
      settings={settingsPopover}
      consent={
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-body">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-1"
            />
            <span>I can record this lecture.</span>
          </label>
          <p className="text-caption text-lantern-text-secondary">{LECTURE_CONSENT_LINE}</p>
          <p className="text-caption text-lantern-text-secondary">{lectureStudioPriceLine()}</p>
        </div>
      }
    />
  );

  return (
    <div
      ref={studioRef}
      className="flex-1 min-h-0 min-w-0 flex flex-row gap-4 overflow-hidden"
      data-testid="lecture-studio"
      data-drawer-placement={placement}
    >
      {/* THE EDITOR COLUMN. `relative`, because the tab pill and the minimised
          widget float inside it rather than taking rows of their own. */}
      <div className="relative flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface">
        {/* HEADER — the lecture's own breadcrumb, Turn into, Share. The set and
            the timer are the focus bar's job, one row above this one. */}
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-lantern-border px-3 py-2">
          <span aria-hidden="true">🎙</span>
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              scheduleSave();
            }}
            aria-label="Lecture title"
            className="min-w-0 flex-1 bg-transparent text-title font-semibold text-lantern-text outline-none"
          />
          <Menu>
            <MenuTrigger
              aria-label="Turn this lecture into something else"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text hover:border-lantern-text-tertiary disabled:opacity-50"
              disabled={turning || !activeNote}
            >
              Turn into
              <AppIcon name="chevron-down" size={14} aria-hidden />
            </MenuTrigger>
            <MenuContent align="end" placement="bottom">
              <TurnIntoMenuItems
                existing={activeNote ? turnIntoExisting?.(activeNote.id) : undefined}
                onSelect={onTurnInto}
              />
            </MenuContent>
          </Menu>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            disabled={!activeNote}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text hover:border-lantern-text-tertiary disabled:opacity-50"
          >
            <AppIcon name="share" size={16} aria-hidden />
            Share
          </button>
        </div>

        {enhancing ? (
          <div className="pointer-events-none absolute left-1/2 top-14 z-10 -translate-x-1/2">
            <span className="rounded-full bg-lantern-primary-fill px-3 py-1 text-caption text-white shadow-lantern-md">
              ⟳ {lectureDrawerCopy.enhancing}
            </span>
          </div>
        ) : null}

        {enhanceError ? (
          <div
            role="alert"
            className="shrink-0 flex items-center gap-2 border-b border-lantern-border bg-lantern-surface px-3 py-2"
          >
            <span className="text-body text-lantern-error">
              ✕ {lectureDrawerCopy.enhanceFailed}
            </span>
            <button
              type="button"
              onClick={() => setEnhanceError(null)}
              className="ml-auto min-h-[44px] rounded-full border border-lantern-border px-3 text-body text-lantern-text"
            >
              Close
            </button>
          </div>
        ) : null}

        {recovery ? (
          <div className="shrink-0 border-b border-lantern-border px-3 py-2">
            <p className="text-body text-lantern-text">
              This lecture was interrupted. {recovery.untranscribed} part
              {recovery.untranscribed === 1 ? '' : 's'} recorded but not transcribed — the audio is
              saved.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={handleResume} loading={starting}>
                Carry on recording
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  segmentsForNote
                    .filter((row) => row.status !== 'done')
                    .forEach((row) => retrySegment(row.seq))
                }
              >
                Finish transcribing
              </Button>
            </div>
          </div>
        ) : null}

        {/* THE PANE. One scroller, generous side padding, a content block that
            stops at the width a line of prose is readable at. `pb-24` is the
            floating pill's clearance — it sits over this, not beside it. */}
        <div
          id="lecture-panel"
          role="tabpanel"
          aria-labelledby={`lecture-tab-${tab}`}
          className="flex-1 min-h-0 overflow-y-auto px-6 pb-24 pt-4 md:px-12"
        >
          <div className="mx-auto w-full max-w-[560px]">
            {tab === 'notes' ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-label uppercase text-lantern-text-secondary">My notes</h2>
                  <button
                    type="button"
                    aria-pressed={editingNotes}
                    onClick={() => setEditingNotes((was) => !was)}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text hover:border-lantern-text-tertiary"
                  >
                    {editingNotes ? 'Done' : 'Edit'}
                  </button>
                </div>
                {editingNotes ? (
                  <textarea
                    value={notesBody}
                    onChange={(event) => handleNotesChange(event.target.value)}
                    aria-label="Typed lecture notes"
                    placeholder="Type during class. New paragraphs get a timestamp."
                    className="min-h-[24rem] w-full flex-1 resize-none rounded-xl border border-lantern-border bg-lantern-background p-3 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
                  />
                ) : (
                  <div
                    aria-label="Typed lecture notes"
                    className="min-h-[24rem] w-full flex-1 rounded-xl border border-lantern-border bg-lantern-background p-3"
                  >
                    <NoteReadingView
                      body={notesBody}
                      emptyLine="Type during class. New paragraphs get a timestamp."
                    />
                  </div>
                )}
              </div>
            ) : null}

            {tab === 'enhanced' ? (
              <div className="space-y-3">
                <NoteReadingView
                  body={enhancedShown}
                  emptyLine={
                    enhancing ? 'Writing your notes…' : 'No enhanced notes yet.'
                  }
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEnhanceOpen(true)}
                  disabled={enhancing}
                >
                  ✨ Enhance notes · {writeCost}
                </Button>
              </div>
            ) : null}

            {tab === 'materials' ? (
              <div className="space-y-3">
                <h2 className="text-label uppercase text-lantern-text-secondary">Material</h2>
                {contextNote ? (
                  <div className="rounded-xl border border-lantern-border bg-lantern-background p-3">
                    <p className="text-body text-lantern-text">
                      {contextNote.title || 'Untitled note'}
                    </p>
                    <p className="mt-1 text-caption text-lantern-text-secondary">
                      Enhanced notes will read this together with the transcript.
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => setContextNoteId('')}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-body text-lantern-text-secondary">
                      Attach a material from this set. Enhanced notes will use it together with the
                      transcript.
                    </p>
                    {attachableNotes.length > 0 ? (
                      <Select
                        aria-label="Attach a material"
                        value={contextNoteId}
                        onChange={(event) => setContextNoteId(event.target.value)}
                        className="min-h-[44px] w-full"
                      >
                        <option value="">Attach a material</option>
                        {attachableNotes.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.title || 'Untitled note'}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <p className="text-caption text-lantern-text-tertiary">
                        This set has no other material yet.
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : null}

            {tab === 'audio' ? (
              activeNote && segmentsForNote.length ? (
                <LectureAudioSegments
                  noteId={activeNote.id}
                  segments={segmentsForNote}
                  attachments={activeNote.attachments}
                />
              ) : activeNote && audioRow ? (
                <LectureAudioPlayer noteId={activeNote.id} attachment={audioRow} />
              ) : (
                <p className="text-body text-lantern-text-tertiary">
                  No recording is saved on this lecture yet.
                </p>
              )
            ) : null}

            {/* Ask lives under the pane, not in chrome of its own: it is about
                what was just said, and it reads as the last paragraph. */}
            <div className="mt-6 border-t border-lantern-border pt-3">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <h2 className="text-label uppercase text-lantern-text-secondary">Ask Lantern</h2>
                <p className="text-caption text-lantern-text-secondary">
                  {LECTURE_ASK_KEEP_LISTENING}
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <textarea
                  value={askDraft}
                  onChange={(event) => setAskDraft(event.target.value)}
                  aria-label="Ask about the lecture"
                  placeholder={LECTURE_ASK_JUST_SAID}
                  rows={2}
                  className="min-w-0 flex-1 resize-none rounded-xl border border-lantern-border bg-lantern-background p-3 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
                />
                <Button size="sm" variant="secondary" onClick={() => void askAboutLecture()}>
                  {LECTURE_ASK_JUST_SAID}
                </Button>
              </div>
              {recording ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => void handleDiscard()}
                >
                  Discard this recording
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {/* THE FLOATING TAB PILL, centred in the editor column. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
          <LectureTabPill
            items={tabItems}
            value={drawerVisible && recording ? 'record' : tab}
            onChange={onPickTab}
            panelId="lecture-panel"
          />
        </div>

        {/* THE MINIMISED WIDGET — bottom-right of the editor, over the notes. */}
        {drawer.minimised && recording ? (
          <div className="absolute bottom-20 right-4">
            <LectureMinimisedWidget
              elapsedMs={elapsedMs}
              levelDb={preCheck.levelDb}
              qualityLabel={preCheck.quality.label}
              onStop={handleStop}
              onExpand={() => dispatchDrawer({ type: 'expand' })}
            />
          </div>
        ) : null}
      </div>

      {/* THE DRAWER — a column beside the editor while the room can hold one,
          a sheet over it when it cannot. Never a squeezed editor. */}
      {drawerVisible && placement === 'inline' ? (
        <aside
          className="my-2 w-[236px] shrink-0"
          aria-label={lectureDrawerCopy.title}
          data-testid="lecture-drawer-inline"
        >
          {drawerNode}
        </aside>
      ) : null}

      {drawerVisible && placement === 'sheet' ? (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/40"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dispatchDrawer({ type: 'close' });
          }}
        >
          <aside
            className="h-full w-[280px] max-w-[90vw] p-2"
            aria-label={lectureDrawerCopy.title}
            data-testid="lecture-drawer-sheet"
          >
            {drawerNode}
          </aside>
        </div>
      ) : null}

      <LectureEnhanceModal
        isOpen={enhanceOpen}
        onClose={() => setEnhanceOpen(false)}
        depth={depth}
        onDepthChange={setDepth}
        skillHint={skillHint}
        onSkillHintChange={setSkillHint}
        attachableNotes={attachableNotes}
        contextNoteId={contextNoteId}
        onContextNoteChange={setContextNoteId}
        onSubmit={() => void enhanceNotes()}
        writing={writing}
        cost={writeCost}
      />

      {activeNote && shareOpen ? (
        <NoteCollaboratorsModal
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          noteId={activeNote.id}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  );
};

export default LectureStudio;

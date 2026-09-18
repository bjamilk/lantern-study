import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LECTURE_ASK_JUST_SAID,
  LECTURE_ASK_KEEP_LISTENING,
  LECTURE_CONSENT_LINE,
  NOTES_STUDIO_DEPTHS,
  applyLectureNoteStamp,
  buildLectureAsk,
  composeLectureNoteBody,
  displayLectureTranscript,
  formatLectureClock,
  hasEnoughNoteStudyContent,
  latestLectureTranscript,
  lectureAudioAttachment,
  lectureNoteParts,
  lectureStudioPriceLine,
  lectureTabs,
  lectureTranscriptLines,
  newLectureNoteTitle,
  preferLectureTranscript,
  studySetNotePayload,
  resolveLectureStudioNote,
  resolveLectureTab,
  shouldCreateLectureNote,
  shouldDeleteDoorNoteOnDiscard,
  type LectureAttachmentLike,
  type LectureTabId,
  type TurnIntoTargetId,
} from '@lantern/shared';
import {
  SMART_NOTES_SKILL_HINT_EXAMPLES,
  SMART_NOTES_SKILL_HINT_MAX_CHARS,
  upsertSmartNotesSection,
  type SmartNotesDepth,
  type SmartNotesRequestOptions,
} from '@lantern/shared/utils/smartNotes';
import {
  SMART_NOTES_CREDIT_COST,
  formatCreditCost,
  getSmartNotesCreditCost,
} from '@lantern/shared/utils/aiCredits';
import type { StudyNote } from '../../types';
import { Button, Select } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { Tab, TabList, TabPanel, Tabs } from '../ui/Tabs';
import { TurnIntoMenu } from './TurnIntoMenu';
import { NoteReadingView } from './NoteReadingView';
import { LectureAudioPlayer } from './LectureAudioPlayer';
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
  setLectureLanguages,
} from '../../utils/lectureRecorderPrefs';
import { LectureLevelMeter } from './LectureLevelMeter';
import { LecturePreCheckPanel } from './LecturePreCheckPanel';
import { LectureRecorderSettings } from './LectureRecorderSettings';
import { LectureAudioSegments, LectureTranscriptSegments } from './LectureSegmentList';
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
  const pauseRecording = useLectureRecordingStore((s) => s.pauseRecording);
  const resumeRecording = useLectureRecordingStore((s) => s.resumeRecording);
  const discardRecording = useLectureRecordingStore((s) => s.discard);
  const cancelTranscription = useLectureRecordingStore((s) => s.cancelTranscription);
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

  const [agreed, setAgreed] = useState(status !== 'idle');
  const [consented, setConsented] = useState(status !== 'idle');
  const [title, setTitle] = useState(activeNote?.title || '');
  const [notesBody, setNotesBody] = useState('');
  const [askDraft, setAskDraft] = useState('');
  const [depth, setDepth] = useState<SmartNotesDepth>('standard');
  const [writing, setWriting] = useState(false);
  /**
   * Notes read as a hierarchy by default; Edit brings back the textarea. A
   * lecture that starts recording flips to Edit on its own — typing during
   * class is the whole point of this pane.
   */
  const [editingNotes, setEditingNotes] = useState(false);
  /** null = follow the default rule; a value = the student picked that tab. */
  const [requestedTab, setRequestedTab] = useState<LectureTabId | null>(null);
  const [starting, setStarting] = useState(false);
  /** The ⚙ popover: mic + the two language choices. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** One line about the reader, appended to the enhance prompt as a hint. */
  const [skillHint, setSkillHint] = useState('');
  /** A material from this set to read alongside the transcript. '' = none. */
  const [contextNoteId, setContextNoteId] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const notesRef = useRef(notesBody);
  const doorRef = useRef<{ noteId: string; doorTitle: string } | null>(null);
  titleRef.current = title;
  notesRef.current = notesBody;

  const knownTranscript = whisperTranscript || latestLectureTranscript(activeNote?.attachments);
  /**
   * The stored body, split into the three texts the tabs show. Reading the
   * typed notes through the planner (rather than `splitLectureNoteBody` alone)
   * is what keeps the generated Smart Notes block — which is appended to the
   * END of the body, after the transcript — out of the editable textarea.
   */
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

  /**
   * The pre-check holds its OWN short-lived microphone stream: the take is
   * still one `MediaRecorder` in the store, on a stream of its own. It stays
   * open while recording so the meter beside the clock keeps moving, and is
   * released the moment the recorder is neither armed nor running.
   */
  const preCheckActive = status === 'idle' || recording;
  const preCheck = useLecturePreCheck(preCheckActive);
  const userSettings = useAuthStore((s) => s.currentUser?.settings);
  const languages = useMemo(() => currentLectureLanguages(userSettings), [userSettings]);
  const allNotes = useNotesStore((s) => s.notes);
  /**
   * The materials the "Attach a material" picker may offer: this set's notes,
   * minus the lecture being enhanced. The server checks owner and set again —
   * this list is a convenience, never the authorization.
   */
  const attachableNotes = useMemo(() => {
    if (!studySetId) return [];
    return (allNotes ?? []).filter(
      (row) => row.studySetId === studySetId && row.id !== activeNote?.id
    );
  }, [allNotes, studySetId, activeNote?.id]);

  useEffect(() => {
    if (recording) setEditingNotes(true);
  }, [recording]);

  /**
   * Read the note's own segment rows whenever a lecture is opened and nothing
   * is running. This is the recovery path: the rows were written BEFORE their
   * audio was transcribed, so a tab that died mid-lecture left a trail here
   * that the local blob could never have left.
   */
  useEffect(() => {
    if (status !== 'idle' || !activeNote?.id) return;
    hydrateFromNote(activeNote.id, activeNote.attachments as Array<Record<string, unknown>>);
  }, [status, activeNote?.id, activeNote?.attachments, hydrateFromNote]);

  /** An interrupted take: offer to carry on, or just to finish transcribing. */
  const recovery = useMemo(() => {
    if (status !== 'idle' || !activeNote) return null;
    const decision = resolveLectureResume({
      rows: lectureSegmentRows(
        (activeNote.attachments ?? []) as Parameters<typeof lectureSegmentRows>[0]
      ),
    });
    return decision.action === 'recover' ? decision : null;
  }, [status, activeNote?.id, activeNote?.attachments]);

  const segmentsForNote = segmentsNoteId === activeNote?.id ? segments : [];
  const failedSegments = segmentsForNote.filter((row) => row.status === 'failed');

  const handleResumeTake = async () => {
    if (!recovery || !activeNote) return;
    setConsented(true);
    setStarting(true);
    try {
      await startRecording(activeNote.id, titleRef.current || activeNote.title || '', {
        language: languages.spokenLanguage,
        translateTo: languages.transcribeTo,
        deviceId: preCheck.selectedDeviceId,
        resume: {
          sessionId: recovery.sessionId,
          nextSeq: recovery.nextSeq,
          recordedMs: recovery.recordedMs,
        },
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not carry on.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleFinishTake = () => {
    segmentsForNote
      .filter((row) => row.status !== 'done')
      .forEach((row) => retrySegment(row.seq));
  };
  const busy = status === 'saving' || status === 'uploading' || status === 'transcribing';
  const paused = recording && Boolean(pausedAt);

  const handleNotesChange = (next: string) => {
    const stamped = recording ? applyLectureNoteStamp(notesRef.current, next, elapsedMs) : next;
    setNotesBody(stamped);
    scheduleSave();
  };

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

  const handleStart = async () => {
    if (!shouldCreateLectureNote(agreed)) {
      showToast('Confirm you can record before starting.', 'info');
      return;
    }
    setConsented(true);
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

  const handleDiscard = async () => {
    discardRecording();
    await cleanupDoorNote();
  };

  const askAboutLecture = async () => {
    const target = activeNote;
    if (target) {
      await setActiveNoteContext({ id: target.id, title: title || target.title || 'Lecture' });
    }
    const excerpt = liveTranscript;
    openWithMessage(
      buildLectureAsk({
        question: askDraft,
        recentTranscript: excerpt,
        noteTitle: title || target?.title,
        elapsedMs: recording ? elapsedMs : undefined,
      }),
      {
        noteId: target?.id,
        recentTranscript: excerpt.slice(-400),
      }
    );
    setAskDraft('');
  };

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
    setWriting(true);
    try {
      // Save the WHOLE lecture, not the typed half. `snapshot.body` is only
      // what the student typed, so writing it straight back used to delete the
      // transcript from the note — and the transcript is the part worth
      // summarizing in the first place.
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
      showToast('Enhanced notes saved on this lecture.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not enhance notes.', 'error');
    } finally {
      setWriting(false);
    }
  };

  const writeCost = formatCreditCost(getSmartNotesCreditCost(depth));
  const canEnhance = status === 'idle' || busy;

  const tabSource = {
    body: activeNote?.body ?? '',
    attachments: activeNote?.attachments ?? [],
    liveTranscript,
    sourceType: activeNote?.sourceType,
    youtubeVideoId: activeNote?.youtubeVideoId,
  };
  const tabs = lectureTabs(tabSource);
  const tab = resolveLectureTab(tabSource, requestedTab, { recording });
  const transcriptLines = lectureTranscriptLines(
    preferLectureTranscript(storedParts.transcript, liveTranscript)
  );
  const audioRow = lectureAudioAttachment(tabSource);
  const hasEnhancedTab = tabs.some((row) => row.id === 'enhanced');

  /**
   * The consent gate is a door, not a wall. It used to cover the whole pane
   * whenever nothing was recording, so opening a lecture you took last week —
   * with its notes, its transcript and its audio all saved — asked "Start a
   * lecture?" and showed you none of them. It now only stands in front of a
   * lecture that has nothing to read yet; an existing one opens on its tabs and
   * carries the consent line as a slim bar above them instead.
   */
  const hasSomethingToShow = tabs.length > 1 || storedParts.typed.trim().length > 0;
  const showConsent = !consented && status === 'idle' && !hasSomethingToShow;

  /**
   * One node, two homes: the depth picker lives inside the Enhanced tab once
   * that tab exists, and in the toolbar before it does — a lecture with no
   * generated notes yet still has to be able to make some.
   */
  const enhanceControls = canEnhance ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-label uppercase text-lantern-text-secondary">Enhance</span>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Notes depth">
        {NOTES_STUDIO_DEPTHS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={depth === option.id}
            onClick={() => setDepth(option.id)}
            className={`min-h-[44px] rounded-full border px-3 text-body ${
              depth === option.id
                ? 'border-lantern-primary bg-lantern-primary text-white'
                : 'border-lantern-border bg-lantern-surface text-lantern-text hover:border-lantern-text-tertiary'
            }`}
          >
            {option.label}
            <span className="ml-1 text-caption font-normal opacity-80">
              · {formatCreditCost(SMART_NOTES_CREDIT_COST[option.id])}
            </span>
          </button>
        ))}
      </div>
      <Button size="sm" onClick={() => void enhanceNotes()} loading={writing} disabled={writing || busy}>
        Enhance notes · {writeCost}
      </Button>
      {/*
        Two optional steers, both free. The price line above does not move for
        either of them: a hint is a sentence in the prompt, not a second call.
      */}
      <div className="w-full space-y-2">
        <label htmlFor="lecture-skill-hint" className="block text-caption text-lantern-text-secondary">
          How much do you already know? (optional)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="lecture-skill-hint"
            value={skillHint}
            maxLength={SMART_NOTES_SKILL_HINT_MAX_CHARS}
            onChange={(event) => setSkillHint(event.target.value)}
            placeholder="e.g. I know the basics but not the maths"
            className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-lantern-border bg-lantern-background px-3 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
          />
          {SMART_NOTES_SKILL_HINT_EXAMPLES.map((example) => (
            <button
              key={example.id}
              type="button"
              onClick={() => setSkillHint(example.text)}
              className="min-h-[44px] rounded-full border border-lantern-border bg-lantern-surface px-3 text-body text-lantern-text hover:border-lantern-text-tertiary"
            >
              {example.label}
            </button>
          ))}
        </div>
        {attachableNotes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="lecture-context-note"
              className="text-caption text-lantern-text-secondary"
            >
              Attach a material
            </label>
            <Select
              id="lecture-context-note"
              value={contextNoteId}
              onChange={(event) => setContextNoteId(event.target.value)}
              className="min-h-[44px] min-w-0 flex-1"
            >
              <option value="">None</option>
              {attachableNotes.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title || 'Untitled note'}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface">
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-lantern-border px-3 py-2">
        <span className={`text-label uppercase ${FEATURE_INK_TEXT.recording}`}>Lecture</span>
        <div
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-3 ${FEATURE_TINT_BG.recording}`}
          aria-live="polite"
        >
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            {recording && !paused ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lantern-feature-recording-ink opacity-75" />
            ) : null}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-lantern-feature-recording-ink" />
          </span>
          <span className={`text-heading tabular-nums ${FEATURE_INK_TEXT.recording}`}>
            {recording || busy ? formatLectureClock(elapsedMs) : '0:00'}
          </span>
          <span className="text-caption text-lantern-text-secondary">
            {status === 'saving'
              ? 'Saving your recording…'
              : busy
                ? status === 'uploading'
                  ? 'Uploading…'
                  : 'Transcribing…'
                : paused
                  ? 'Paused'
                  : recording
                    ? 'Recording'
                    : 'Ready'}
          </span>
        </div>
        {showConsent ? null : recording ? (
          <>
            {/* The same analyser as the pre-check, small, beside the clock. */}
            <LectureLevelMeter levelDb={preCheck.levelDb} size="sm" label="Input level" />
            {paused ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => resumeRecording()}
                title="Resume recording"
                aria-label="Resume recording"
              >
                Resume
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => pauseRecording()}
                title="Pause recording"
                aria-label="Pause recording"
              >
                Pause
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              onClick={() => stopRecording({ currentBody: notesRef.current })}
              title="Stop recording"
              aria-label="Stop recording"
            >
              Stop
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleDiscard()}
              title="Discard this recording"
              aria-label="Discard this recording"
            >
              Discard
            </Button>
          </>
        ) : busy ? (
          <Button size="sm" variant="ghost" onClick={() => cancelTranscription()}>
            Cancel
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => void handleStart()}
              loading={starting}
              disabled={starting || !consented}
              title="Start recording"
              aria-label="Start recording"
            >
              {activeNote ? 'Record' : 'Start'}
            </Button>
            <button
              type="button"
              onClick={() => setSettingsOpen((was) => !was)}
              aria-label="Recorder settings"
              aria-expanded={settingsOpen}
              title="Recorder settings"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-lantern-border text-lantern-text hover:border-lantern-text-tertiary"
            >
              <AppIcon name="settings" size={20} />
            </button>
          </>
        )}
      </div>

      {showConsent ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <h2 className="text-heading">Start a lecture?</h2>
          <p className="text-body text-lantern-text-secondary">{LECTURE_CONSENT_LINE}</p>
          <p className="text-caption text-lantern-text-secondary">{lectureStudioPriceLine()}</p>
          {decision.action === 'resume' ? (
            <p className="text-caption text-lantern-text-secondary">
              This continues {activeNote?.title || 'the open lecture note'} — it will not create a second dated note.
            </p>
          ) : (
            <p className="text-caption text-lantern-text-secondary">
              We will create “{decision.title}” only after you start.
            </p>
          )}
          {/*
            The pre-check replaces the bare Start button. The consent tick and
            the cost copy above it are unchanged — they are the two things a
            student must read, and a meter is not a reason to move them.
          */}
          <LecturePreCheckPanel
            preCheck={preCheck}
            canStart={agreed}
            starting={starting}
            onOpenSettings={() => setSettingsOpen((was) => !was)}
            onStart={() => void handleStart()}
            consent={
              <label className="flex items-start gap-2 text-body">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                  className="mt-1"
                />
                <span>I can record this lecture.</span>
              </label>
            }
          />
          {settingsOpen ? (
            <LectureRecorderSettings
              languages={languages}
              onChangeLanguages={(patch) => setLectureLanguages(patch)}
              devices={preCheck.devices}
              selectedDeviceId={preCheck.selectedDeviceId}
              onSelectDevice={preCheck.selectDevice}
              onClose={() => setSettingsOpen(false)}
            />
          ) : null}
        </div>
      ) : (
        <>
          <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-lantern-border px-3 py-2">
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                scheduleSave();
              }}
              aria-label="Lecture title"
              className="min-w-0 flex-1 bg-transparent text-heading font-semibold text-lantern-text outline-none"
            />
            <TurnIntoMenu
              disabled={turning || !activeNote}
              existing={activeNote ? turnIntoExisting?.(activeNote.id) : undefined}
              onSelect={onTurnInto}
            />
          </div>

          {!consented && status === 'idle' ? (
            <div className="shrink-0 flex flex-wrap items-center gap-3 border-b border-lantern-border px-3 py-2">
              <label className="flex items-center gap-2 text-body">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => {
                    setAgreed(event.target.checked);
                    setConsented(event.target.checked);
                  }}
                />
                <span>I can record this lecture.</span>
              </label>
              <span className="text-caption text-lantern-text-secondary">{LECTURE_CONSENT_LINE}</span>
            </div>
          ) : null}

          {settingsOpen && status === 'idle' ? (
            <div className="shrink-0 border-b border-lantern-border p-3">
              <LectureRecorderSettings
                languages={languages}
                onChangeLanguages={(patch) => setLectureLanguages(patch)}
                devices={preCheck.devices}
                selectedDeviceId={preCheck.selectedDeviceId}
                onSelectDevice={preCheck.selectDevice}
                onClose={() => setSettingsOpen(false)}
              />
            </div>
          ) : null}

          {/*
            A lecture this device did not finish. Both doors are open and both
            are honest: the audio is already saved either way, so "Carry on"
            records more into the SAME take (the stamps stay true to the
            lecture) and "Finish" only asks for the words of what is already
            there. Neither re-records anything and neither charges twice.
          */}
          {recovery ? (
            <div className="shrink-0 border-b border-lantern-border px-3 py-2">
              <p className="text-body text-lantern-text">
                This lecture was interrupted. {recovery.untranscribed} part
                {recovery.untranscribed === 1 ? '' : 's'} recorded but not transcribed — the audio is
                saved.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void handleResumeTake()} loading={starting}>
                  Carry on recording
                </Button>
                <Button size="sm" variant="secondary" onClick={handleFinishTake}>
                  Finish transcribing
                </Button>
              </div>
            </div>
          ) : null}

          {!hasEnhancedTab && enhanceControls ? (
            <div className="shrink-0 border-b border-lantern-border px-3 py-2">{enhanceControls}</div>
          ) : null}

          {/*
            The transcript during class. The Transcript TAB is unreachable while
            a take runs — nothing may pull a typing student off My Notes — so the
            growing list lives here, above the tabs, where it can be read without
            leaving the notes.
          */}
          {recording || busy ? (
            <div className="shrink-0 border-b border-lantern-border p-3 max-h-[30%] overflow-y-auto">
              <h2 className="text-label uppercase text-lantern-text-secondary mb-2">
                Live transcript
              </h2>
              {segmentsForNote.length || recording ? (
                <LectureTranscriptSegments
                  segments={segmentsForNote}
                  liveCaptions={displayLectureTranscript({
                    committed: committedTranscript,
                    interim: interimTranscript,
                  })}
                  recording={recording}
                  onRetry={retrySegment}
                />
              ) : (
                <p className="text-body text-lantern-text-tertiary">
                  Saving your recording… the last part is still on its way.
                </p>
              )}
            </div>
          ) : null}

          <Tabs
            value={tab}
            onValueChange={(next) => setRequestedTab(next as LectureTabId)}
            variant="segmented"
            aria-label="Lecture"
            className="flex-1 min-h-0 flex flex-col"
          >
            <TabList className="shrink-0 mx-3 mt-3 overflow-x-auto">
              {tabs.map((row, index) => (
                <Tab
                  key={row.id}
                  value={row.id}
                  index={index}
                  /* A take owns the pane: nothing may pull a typing student off My Notes. */
                  disabled={recording && row.id !== 'notes'}
                >
                  {row.label}
                </Tab>
              ))}
            </TabList>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <TabPanel value="notes" className="flex h-full min-h-0 flex-col p-3">
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
                    className="flex-1 min-h-[10rem] w-full resize-none rounded-xl border border-lantern-border bg-lantern-background p-3 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
                  />
                ) : (
                  <div
                    aria-label="Typed lecture notes"
                    className="flex-1 min-h-[10rem] w-full overflow-y-auto rounded-xl border border-lantern-border bg-lantern-background p-3"
                  >
                    <NoteReadingView
                      body={notesBody}
                      emptyLine="Type during class. New paragraphs get a timestamp."
                    />
                  </div>
                )}
              </TabPanel>

              <TabPanel value="enhanced" className="space-y-3 p-3">
                <NoteReadingView
                  body={storedParts.enhanced}
                  emptyLine="No enhanced notes yet."
                />
                {enhanceControls ? (
                  <div className="border-t border-lantern-border pt-3">{enhanceControls}</div>
                ) : null}
              </TabPanel>

              <TabPanel value="transcript" className="p-3">
                {segmentsForNote.length ? (
                  <LectureTranscriptSegments segments={segmentsForNote} onRetry={retrySegment} />
                ) : transcriptLines.length ? (
                  <ol className="space-y-2">
                    {transcriptLines.map((line, index) => (
                      <li key={`${line.time ?? ''}-${index}`} className="flex gap-3">
                        {/* The gutter time is a caption; the sentence stays body prose. */}
                        <span className="w-12 shrink-0 text-caption tabular-nums text-lantern-text-secondary">
                          {line.time ?? ''}
                        </span>
                        <span className="min-w-0 text-body text-lantern-text">{line.text}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-body text-lantern-text-tertiary">
                    Captions save into this note as you go. The full Whisper transcript lands after
                    you stop.
                  </p>
                )}
              </TabPanel>

              <TabPanel value="materials" className="p-3">
                <p className="text-body text-lantern-text-secondary">
                  Uploaded files and Walk / Read live on this lecture in Library.
                </p>
              </TabPanel>

              <TabPanel value="audio">
                {activeNote && segmentsForNote.length ? (
                  <LectureAudioSegments
                    noteId={activeNote.id}
                    segments={segmentsForNote}
                    attachments={activeNote.attachments}
                  />
                ) : activeNote && audioRow ? (
                  /* A lecture recorded before segments existed: one whole take. */
                  <LectureAudioPlayer noteId={activeNote.id} attachment={audioRow} />
                ) : (
                  <p className="p-3 text-body text-lantern-text-tertiary">
                    No recording is saved on this lecture yet.
                  </p>
                )}
              </TabPanel>
            </div>
          </Tabs>

          <div className="shrink-0 border-t border-lantern-border p-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="text-label uppercase text-lantern-text-secondary">Ask Lantern</h2>
              <p className="text-caption text-lantern-text-secondary">{LECTURE_ASK_KEEP_LISTENING}</p>
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
          </div>
        </>
      )}
    </div>
  );
};

export default LectureStudio;

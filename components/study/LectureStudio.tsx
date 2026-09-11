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
  lectureStudioPriceLine,
  newLectureNoteTitle,
  preferLectureTranscript,
  studySetNotePayload,
  resolveLectureStudioNote,
  shouldCreateLectureNote,
  shouldDeleteDoorNoteOnDiscard,
  splitLectureNoteBody,
  type TurnIntoTargetId,
} from '@lantern/shared';
import type { SmartNotesDepth, SmartNotesRequestOptions } from '@lantern/shared/utils/smartNotes';
import {
  SMART_NOTES_CREDIT_COST,
  formatCreditCost,
  getSmartNotesCreditCost,
} from '@lantern/shared/utils/aiCredits';
import type { StudyNote } from '../../types';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { TurnIntoMenu } from './TurnIntoMenu';
import { useNotesStore } from '../../stores/notesStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useToastStore } from '../../stores/toastStore';
import {
  getSessionElapsedMs,
  useLectureRecordingStore,
} from '../../stores/lectureRecordingStore';

interface LectureStudioProps {
  courseId: string;
  studySetId?: string;
  theme: 'light' | 'dark';
  note: (StudyNote & { attachments?: Array<{ extractedText?: string | null }> }) | null;
  lectures: Array<StudyNote & { attachments?: Array<{ extractedText?: string | null }> }>;
  turning?: boolean;
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
  const [starting, setStarting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const notesRef = useRef(notesBody);
  const doorRef = useRef<{ noteId: string; doorTitle: string } | null>(null);
  titleRef.current = title;
  notesRef.current = notesBody;

  const knownTranscript = whisperTranscript || latestLectureTranscript(activeNote?.attachments);
  const savedTranscript = splitLectureNoteBody(activeNote?.body || '', knownTranscript).transcript;
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
    setNotesBody(splitLectureNoteBody(activeNote.body || '', knownTranscript).typed);
  }, [activeNote?.id, activeNote?.title, activeNote?.body, knownTranscript, decision]);

  const scheduleSave = useCallback(() => {
    if (!activeNote) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveNote(activeNote.id, {
        title: titleRef.current,
        body: composeLectureNoteBody(notesRef.current, persistableTranscript),
      }).catch(() => undefined);
    }, 700);
  }, [activeNote, persistableTranscript, saveNote]);

  const flushNote = useCallback(() => {
    if (!activeNote) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const transcript = preferLectureTranscript(
      splitLectureNoteBody(activeNote.body || '', knownTranscript).transcript,
      persistableTranscript
    );
    if (!notesRef.current.trim() && !transcript.trim()) return;
    void saveNote(activeNote.id, {
      title: titleRef.current,
      body: composeLectureNoteBody(notesRef.current, transcript),
    }).catch(() => undefined);
  }, [activeNote, knownTranscript, persistableTranscript, saveNote]);

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
  const busy = status === 'uploading' || status === 'transcribing';
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
      await saveNote(activeNote.id, snapshot);
      await onSmartNote(snapshot, { depth });
      showToast('Enhanced notes saved on this lecture.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not enhance notes.', 'error');
    } finally {
      setWriting(false);
    }
  };

  const writeCost = formatCreditCost(getSmartNotesCreditCost(depth));
  const showConsent = !consented && status === 'idle';
  const canEnhance = status === 'idle' || busy;

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
            {busy ? (status === 'uploading' ? 'Uploading…' : 'Transcribing…') : paused ? 'Paused' : recording ? 'Recording' : 'Ready'}
          </span>
        </div>
        {showConsent ? null : recording ? (
          <>
            {paused ? (
              <Button size="sm" variant="secondary" onClick={() => resumeRecording()}>
                Resume
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => pauseRecording()}>
                Pause
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => stopRecording({ currentBody: notesRef.current })}>
              Stop
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void handleDiscard()}>
              Discard
            </Button>
          </>
        ) : busy ? (
          <Button size="sm" variant="ghost" onClick={() => cancelTranscription()}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" onClick={() => void handleStart()} loading={starting} disabled={starting || !consented}>
            {activeNote ? 'Record' : 'Start'}
          </Button>
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
          <label className="flex items-start gap-2 text-body">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-1"
            />
            <span>I can record this lecture.</span>
          </label>
          <Button onClick={() => void handleStart()} disabled={!agreed} loading={starting}>
            Start recording
          </Button>
        </div>
      ) : (
        <>
          {canEnhance ? (
            <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-lantern-border px-3 py-2">
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
              <TurnIntoMenu disabled={turning || !activeNote} onSelect={onTurnInto} />
            </div>
          ) : null}

          <div className="shrink-0 border-b border-lantern-border p-3 max-h-[40%] overflow-y-auto">
            <h2 className="text-label uppercase text-lantern-text-secondary mb-2">Live transcript</h2>
            {liveTranscript ? (
              <p className="text-body whitespace-pre-wrap">{liveTranscript}</p>
            ) : (
              <p className="text-body text-lantern-text-tertiary">
                {recording
                  ? 'Listening… captions appear in a few seconds.'
                  : 'Captions save into this note as you go. The full Whisper transcript lands after you stop.'}
              </p>
            )}
          </div>

          <div className="flex-1 min-h-0 grid lg:grid-cols-2">
            <div className="min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-lantern-border p-3">
              <h2 className="text-label uppercase text-lantern-text-secondary mb-2">My notes</h2>
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  scheduleSave();
                }}
                aria-label="Lecture title"
                className="mb-2 w-full bg-transparent text-heading font-semibold text-lantern-text outline-none"
              />
              <textarea
                value={notesBody}
                onChange={(event) => handleNotesChange(event.target.value)}
                aria-label="Typed lecture notes"
                placeholder="Type during class. New paragraphs get a timestamp."
                className="flex-1 min-h-[10rem] w-full resize-none rounded-xl border border-lantern-border bg-lantern-background p-3 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
              />
            </div>

            <div className="min-h-0 flex flex-col p-3">
              <h2 className="text-label uppercase text-lantern-text-secondary mb-2">Ask</h2>
              <p className="text-caption text-lantern-text-secondary mb-2">{LECTURE_ASK_KEEP_LISTENING}</p>
              <textarea
                value={askDraft}
                onChange={(event) => setAskDraft(event.target.value)}
                aria-label="Ask about the lecture"
                placeholder={LECTURE_ASK_JUST_SAID}
                className="min-h-[7rem] w-full resize-none rounded-xl border border-lantern-border bg-lantern-background p-3 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
              />
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => void askAboutLecture()}>
                  {LECTURE_ASK_JUST_SAID}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default LectureStudio;

/**
 * The `LectureStudio` route in the Study stack: record a class, type alongside
 * the live transcript, ask Lantern about what was just said, and afterwards
 * enhance the lecture into Smart Notes at a chosen depth.
 *
 * Main exports: `LectureStudioScreen` (also the default).
 * Touches: lectureRecordingStore (the recorder state machine: idle → recording →
 * uploading → transcribing → naming), notesStore (create/load/save/remove),
 * companionStore (Ask), toastStore; services/notes `summarizeNote` for the
 * enhance pass. Recording hardware and upload live in the store, not here.
 *
 * Gotchas: a lecture IS a note — the body is composed from typed notes plus
 * transcript plus an appended Smart Notes section, so every autosave has to
 * re-attach `enhancedRef` or enhancing is silently overwritten. Enhancing saves
 * the whole body first because `summarizeNote` re-reads the note server-side.
 * Autosave is debounced 700ms and reads refs, not state. `resolveLectureStudioNote`
 * decides resume-vs-create so a second visit on the same day does not make a
 * duplicate dated note; a note created by the door is deleted again on discard
 * when it is still untouched.
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  LECTURE_ASK_JUST_SAID,
  LECTURE_ASK_KEEP_LISTENING,
  LECTURE_CONSENT_LINE,
  NOTES_STUDIO_DEPTHS,
  applyLectureNoteStamp,
  applyLectureSegmentToChunks,
  buildLectureAsk,
  composeLectureNoteBody,
  displayLectureTranscript,
  formatLectureClock,
  growLectureChunks,
  hasEnoughNoteStudyContent,
  initialLectureDrawer,
  isLectureNote,
  lectureDrawerReducer,
  sealLectureChunks,
  type LectureChunk,
  latestLectureTranscript,
  lectureNoteParts,
  lectureStudioPriceLine,
  studioMaterials,
  newLectureNoteTitle,
  resolveLectureStudioNote,
  studySetNotePayload,
  shouldCreateLectureNote,
  shouldDeleteDoorNoteOnDiscard,
  type LectureTabId,
} from '@lantern/shared';
import {
  SMART_NOTES_SKILL_HINT_EXAMPLES,
  SMART_NOTES_SKILL_HINT_MAX_CHARS,
  upsertSmartNotesSection,
  type SmartNotesDepth,
} from '@lantern/shared/utils/smartNotes';
import {
  SMART_NOTES_CREDIT_COST,
  formatCreditCost,
  getSmartNotesCreditCost,
} from '@lantern/shared/utils/aiCredits';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, ScreenHeader, T } from '../../components/ui';
import { NoteBody } from '../../components/NoteBody';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { LecturePreflightCard } from '../../components/lecture/LecturePreflightCard';
import { LectureLanguagePicker } from '../../components/lecture/LectureLanguagePicker';
import { LectureTabs } from '../../components/lecture/LectureTabs';
import { LectureTranscriptSegments } from '../../components/lecture/LectureSegmentList';
import {
  LectureRecordingBar,
  LectureTranscriptPanel,
} from '../../components/lecture/LectureTranscriptPanel';
import { lectureStudioView } from './lectureStudioView';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNotesStore } from '../../stores/notesStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useToastStore } from '../../stores/toastStore';
import {
  getSessionElapsedMs,
  useLectureRecordingStore,
} from '../../stores/lectureRecordingStore';
import { summarizeNote } from '../../services/notes';

type Props = NativeStackScreenProps<StudyStackParamList, 'LectureStudio'>;

export function LectureStudioScreen({ navigation, route }: Props) {
  const { courseId, courseLabel, noteId, studySetId } = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const notes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const loadNote = useNotesStore((s) => s.loadNote);
  const createNote = useNotesStore((s) => s.createNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const removeNote = useNotesStore((s) => s.removeNote);
  const setSelectedNote = useNotesStore((s) => s.setSelectedNote);
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
  const stopForTitle = useLectureRecordingStore((s) => s.stopForTitle);
  const pauseRecording = useLectureRecordingStore((s) => s.pauseRecording);
  const resumeRecording = useLectureRecordingStore((s) => s.resumeRecording);
  const discardRecording = useLectureRecordingStore((s) => s.discard);
  const setCurrentBodyProvider = useLectureRecordingStore((s) => s.setCurrentBodyProvider);
  const segments = useLectureRecordingStore((s) => s.segments);
  const segmentsNoteId = useLectureRecordingStore((s) => s.transcriptNoteId);
  const retrySegment = useLectureRecordingStore((s) => s.retrySegment);
  const hydrateFromNote = useLectureRecordingStore((s) => s.hydrateFromNote);

  const courseNotes = useMemo(
    () => studioMaterials(notes, { studySetId, courseId }),
    [notes, courseId, studySetId]
  );
  const lectures = useMemo(() => courseNotes.filter(isLectureNote), [courseNotes]);
  const decision = useMemo(
    () =>
      resolveLectureStudioNote({
        lectures,
        selectedNoteId: noteId || selectedNote?.id,
        recordingNoteId: lectureNoteId && status !== 'idle' ? lectureNoteId : null,
        todayTitle: newLectureNoteTitle(),
      }),
    [lectures, noteId, selectedNote?.id, lectureNoteId, status]
  );

  const activeId =
    lectureNoteId && status !== 'idle'
      ? lectureNoteId
      : decision.action === 'resume'
        ? decision.noteId
        : selectedNote?.id;
  const activeNote =
    (selectedNote && selectedNote.id === activeId ? selectedNote : null) ||
    lectures.find((row) => row.id === activeId) ||
    courseNotes.find((row) => row.id === activeId) ||
    null;

  /**
   * The same drawer state machine the web runs, in the Transcript tab.
   *
   * The consent answer is remembered on the ACCOUNT (`lecture.recordingConsent`),
   * so a student who has answered the card on the laptop is not asked again on
   * the phone. The consent LINE is still shown beside the pre-flight either way.
   */
  const lectureSettings = useSettingsStore((s) => s.settings?.lecture);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const consentRemembered = lectureSettings?.recordingConsent === true;
  const [drawer, dispatchDrawer] = useReducer(
    lectureDrawerReducer,
    { consentRemembered, open: status !== 'idle' },
    initialLectureDrawer
  );
  const [chunks, setChunks] = useState<LectureChunk[]>([]);

  const [agreed, setAgreed] = useState(status !== 'idle');
  const [consented, setConsented] = useState(status !== 'idle');
  const [title, setTitle] = useState(activeNote?.title || '');
  const [notesBody, setNotesBody] = useState('');
  const [askDraft, setAskDraft] = useState('');
  const [depth, setDepth] = useState<SmartNotesDepth>('standard');
  /** One line about the reader, appended to the enhance prompt as a hint. */
  const [skillHint, setSkillHint] = useState('');
  const [writing, setWriting] = useState(false);
  /**
   * Notes read as a hierarchy by default; Edit brings back the text box. A
   * lecture that starts recording flips to Edit on its own — typing during
   * class is the whole point of this pane.
   */
  const [editingNotes, setEditingNotes] = useState(false);
  /** null = follow the default rule; a value = the student picked that tab. */
  const [requestedTab, setRequestedTab] = useState<LectureTabId | null>(null);
  const [starting, setStarting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const notesRef = useRef(notesBody);
  const liveRef = useRef('');
  const doorRef = useRef<{ noteId: string; doorTitle: string } | null>(null);
  titleRef.current = title;
  notesRef.current = notesBody;

  const knownTranscript = whisperTranscript || latestLectureTranscript(activeNote?.attachments);
  /**
   * The stored body split into the three texts the tabs show. Reading the typed
   * notes through the planner is what keeps the generated Smart Notes block —
   * appended to the END of the body, after the transcript — out of the editable
   * text box, the same rule the web studio follows.
   */
  const storedParts = lectureNoteParts({
    body: activeNote?.body ?? '',
    attachments: activeNote?.attachments ?? [],
  });
  const liveTranscript = displayLectureTranscript({
    committed: committedTranscript,
    interim: interimTranscript,
    whisper: knownTranscript,
  });
  liveRef.current = liveTranscript;
  const enhancedRef = useRef('');
  enhancedRef.current = storedParts.enhanced;

  useEffect(() => {
    if (activeId) void loadNote(activeId);
  }, [activeId, loadNote]);

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
        body: composeBody(notesRef.current, liveRef.current),
      }).catch(() => undefined);
    }, 700);
  }, [activeNote, composeBody, saveNote]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  useEffect(() => {
    setCurrentBodyProvider(() => notesRef.current);
    return () => setCurrentBodyProvider(null);
  }, [setCurrentBodyProvider]);

  const elapsedMs = getSessionElapsedMs({ startedAt, pausedAt, pausedTotalMs });
  void tick;
  const recording = status === 'recording';

  useEffect(() => {
    if (recording) setEditingNotes(true);
  }, [recording]);
  const busy = status === 'uploading' || status === 'transcribing' || status === 'naming';
  const paused = recording && Boolean(pausedAt);

  /**
   * Read the note's own segment rows whenever a lecture is opened and nothing
   * is running. This is the recovery path: the rows were written BEFORE their
   * audio was transcribed, so an app Android reaped mid-lecture left a trail
   * here that the cache file could never have left.
   */
  useEffect(() => {
    if (status !== 'idle' || !activeNote?.id) return;
    hydrateFromNote(activeNote.id, activeNote.attachments);
  }, [status, activeNote?.id, activeNote?.attachments, hydrateFromNote]);

  const segmentsForNote = segmentsNoteId === activeNote?.id ? segments : [];

  /* ------------------------------------------------- the drawer, in a tab -- */

  /** STORE → DRAWER. The store owns the microphone; the drawer follows it. */
  useEffect(() => {
    if (recording && drawer.step !== 'recording') dispatchDrawer({ type: 'recording-started' });
    if (busy && drawer.step === 'recording') dispatchDrawer({ type: 'stop' });
    if (status === 'idle' && drawer.step === 'saving') dispatchDrawer({ type: 'saved' });
  }, [recording, busy, status, drawer.step]);

  useEffect(() => {
    if (consentRemembered && !drawer.consentRemembered) {
      dispatchDrawer({ type: 'consent-granted' });
    }
  }, [consentRemembered, drawer.consentRemembered]);

  const captions = displayLectureTranscript({
    committed: committedTranscript,
    interim: interimTranscript,
  });
  useEffect(() => {
    if (!recording || !captions.trim()) return;
    setChunks((previous) =>
      growLectureChunks({ chunks: previous, text: captions, atMs: elapsedMs })
    );
    // The chunk grows on new WORDS, not on every tick of the clock.
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

  /** The Start button: ask the consent card first, unless it is remembered. */
  const handleStartPressed = () => {
    if (!shouldCreateLectureNote(agreed)) {
      showToast('Confirm you can record before starting.', 'info');
      return;
    }
    const next = lectureDrawerReducer(drawer, { type: 'start-pressed' });
    dispatchDrawer({ type: 'start-pressed' });
    if (next.step === 'recording') void handleStart();
  };

  const handleConsent = (granted: boolean) => {
    if (!granted) {
      dispatchDrawer({ type: 'consent-declined' });
      return;
    }
    dispatchDrawer({ type: 'consent-granted' });
    void updateSettings('lecture', { recordingConsent: true });
    void handleStart();
  };

  const tabSource = {
    body: activeNote?.body ?? '',
    attachments: activeNote?.attachments ?? [],
    liveTranscript,
    sourceType: activeNote?.sourceType,
    youtubeVideoId: activeNote?.youtubeVideoId,
  };

  /**
   * The consent door only stands in front of a lecture with nothing to read;
   * an existing one opens on its tabs with the consent line as a slim bar.
   */
  const view = lectureStudioView({ source: tabSource, consented, status });
  const showConsent = view.showConsent;

  const handleNotesChange = (next: string) => {
    const stamped = recording ? applyLectureNoteStamp(notesRef.current, next, elapsedMs) : next;
    setNotesBody(stamped);
    scheduleSave();
  };

  const handleStart = async () => {
    if (!shouldCreateLectureNote(agreed)) {
      showToast('Confirm you can record before starting.', 'info');
      return;
    }
    if (starting || recording || busy) return;
    setConsented(true);
    setStarting(true);
    try {
      let target = activeNote;
      if (!target) {
        const createdTitle = newLectureNoteTitle();
        target = await createNote({
          title: createdTitle,
          body: '',
          ...studySetNotePayload({ courseId, studySetId }),
        });
        doorRef.current = { noteId: target.id, doorTitle: createdTitle };
        setSelectedNote(target);
        await loadNote(target.id);
      }
      await startRecording(target.id, titleRef.current || target.title || newLectureNoteTitle(), {
        currentBody: notesRef.current,
      });
      if (useLectureRecordingStore.getState().status !== 'recording') {
        await handleDiscard();
      }
    } catch {
      showToast('Could not start recording. Check the microphone and try again.', 'error');
      await handleDiscard();
    } finally {
      setStarting(false);
    }
  };

  const handleDiscard = async () => {
    await discardRecording();
    const door = doorRef.current;
    if (
      door &&
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: true,
        title: titleRef.current,
        body: notesRef.current,
        doorTitle: door.doorTitle,
      })
    ) {
      await removeNote(door.noteId).catch(() => undefined);
      doorRef.current = null;
    }
  };

  const askAboutLecture = async () => {
    if (activeNote) {
      await setActiveNoteContext({ id: activeNote.id, title: title || activeNote.title || 'Lecture' });
    }
    openWithMessage(
      buildLectureAsk({
        question: askDraft,
        recentTranscript: liveTranscript,
        noteTitle: title || activeNote?.title,
        elapsedMs: recording ? elapsedMs : undefined,
      }),
      {
        noteId: activeNote?.id,
        recentTranscript: liveTranscript.slice(-400),
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
      // Save the WHOLE lecture first: summarize reads the note from the server,
      // and writing back only the typed half used to delete the transcript —
      // the part worth summarizing — before the model ever saw it.
      await saveNote(activeNote.id, {
        title: snapshot.title,
        body: composeBody(snapshot.body, liveRef.current),
      });
      const result = await summarizeNote(activeNote.id, {
        depth,
        skillLevelHint: skillHint.trim() || undefined,
      });
      if (result.note) {
        setSelectedNote({
          ...(useNotesStore.getState().selectedNote ?? activeNote),
          ...result.note,
          summary: result.summary,
        });
      }
      showToast('Enhanced notes saved on this lecture.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not enhance notes.', 'error');
    } finally {
      setWriting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader
        title={title || courseLabel || 'Lecture'}
        subtitle={recording ? LECTURE_ASK_KEEP_LISTENING : 'Lecture studio'}
        onBack={() => navigation.goBack()}
        right={
          <Pressable
            onPress={() => void askAboutLecture()}
            accessibilityRole="button"
            accessibilityLabel={LECTURE_ASK_JUST_SAID}
            className="min-h-[44px] justify-center"
          >
            <T.Body>Ask Lantern</T.Body>
          </Pressable>
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center gap-2 mb-3">
          <View className="h-2.5 w-2.5 rounded-full bg-lantern-feature-recording-ink" />
          <T.Heading
            tabular
            className="text-lantern-feature-recording-ink"
          >
            {recording || busy ? formatLectureClock(elapsedMs) : '0:00'}
          </T.Heading>
          <T.Caption tone="secondary">
            {status === 'naming'
              ? 'Name it to transcribe'
              : busy
                ? status === 'uploading'
                  ? 'Uploading…'
                  : 'Transcribing…'
                : paused
                  ? 'Paused'
                  : recording
                    ? 'Recording'
                    : 'Ready'}
          </T.Caption>
        </View>

        {showConsent ? (
          <View className="gap-3">
            <T.Body>{LECTURE_CONSENT_LINE}</T.Body>
            <T.Caption tone="secondary">{lectureStudioPriceLine()}</T.Caption>
            {decision.action === 'resume' ? (
              <T.Caption tone="secondary">
                This continues {activeNote?.title || 'the open lecture'} — not a second dated note.
              </T.Caption>
            ) : (
              <T.Caption tone="secondary">
                We will create “{decision.title}” only after you start.
              </T.Caption>
            )}
            <Pressable
              onPress={() => setAgreed((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              className="min-h-[44px] flex-row items-center gap-2"
            >
              <View
                className={`h-5 w-5 rounded border ${
                  agreed
                    ? 'bg-lantern-feature-recording-ink border-lantern-feature-recording-ink'
                    : 'border-lantern-border bg-lantern-surface'
                }`}
              />
              <T.Body>I can record this lecture.</T.Body>
            </Pressable>
            {/*
              The pre-check, before the take rather than only during it. The
              Level row reads "No signal yet" until the recorder is running —
              expo-av meters a RECORDING, so unlike the browser there is no
              live bar before Start. Every other row (permission, connection,
              cost, length, screen) is a real reading at this moment.
            */}
            <LecturePreflightCard />
            <LectureLanguagePicker />
            {drawer.step === 'consent' ? (
              // The consent card comes AFTER the pre-flight, exactly as it does
              // on the web: the student checks the room can be heard, then
              // answers for the room.
              <LectureTranscriptPanel
                drawer={drawer}
                chunks={[]}
                sealed={false}
                elapsedMs={0}
                onConsent={handleConsent}
                onStop={() => undefined}
                onResume={() => undefined}
                onEnhance={() => undefined}
              />
            ) : (
              <Button
                disabled={!agreed}
                onPress={handleStartPressed}
                accessibilityLabel="Start recording"
              >
                {starting ? 'Starting…' : 'Start recording'}
              </Button>
            )}
          </View>
        ) : (
          <View className="gap-4">
            {recording ? <LecturePreflightCard /> : null}
            {view.showConsentBar ? (
              <View className="gap-1 rounded-xl border border-lantern-border bg-lantern-surface p-3">
                <Pressable
                  onPress={() => {
                    const next = !agreed;
                    setAgreed(next);
                    setConsented(next);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreed }}
                  className="min-h-[44px] flex-row items-center gap-2"
                >
                  <View
                    className={`h-5 w-5 rounded border ${
                      agreed
                        ? 'bg-lantern-feature-recording-ink border-lantern-feature-recording-ink'
                        : 'border-lantern-border bg-lantern-surface'
                    }`}
                  />
                  <T.Body>I can record this lecture.</T.Body>
                </Pressable>
                <T.Caption tone="secondary">{LECTURE_CONSENT_LINE}</T.Caption>
              </View>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              {recording ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => void (paused ? resumeRecording() : pauseRecording())}
                  >
                    {paused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button size="sm" variant="danger" onPress={() => void stopForTitle({ currentBody: notesRef.current })}>
                    Stop
                  </Button>
                  <Button size="sm" variant="ghost" onPress={() => void handleDiscard()}>
                    Discard
                  </Button>
                </>
              ) : busy ? null : (
                <Button
                  size="sm"
                  disabled={starting || !consented}
                  onPress={() => void handleStart()}
                >
                  {activeNote ? 'Resume' : 'Start'}
                </Button>
              )}
            </View>

            <TextInput
              value={title}
              onChangeText={(value) => {
                setTitle(value);
                scheduleSave();
              }}
              accessibilityLabel="Lecture title"
              className="rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-heading text-lantern-text"
            />

            {/*
              The transcript during class. The Transcript TAB is locked while a
              take runs — nothing may pull a typing student off My Notes — so
              the growing list lives here, above the tabs.
            */}
            {/* The minimised widget's phone shape: a compact bar above the tab
                strip, so the clock and Stop stay in reach while typing. */}
            {recording && drawer.minimised ? (
              <LectureRecordingBar
                elapsedMs={elapsedMs}
                onStop={() => {
                  dispatchDrawer({ type: 'stop' });
                  void stopForTitle({ currentBody: notesRef.current });
                }}
                onExpand={() => dispatchDrawer({ type: 'expand' })}
              />
            ) : null}

            {(recording || busy) && !drawer.minimised ? (
              <View>
                <T.Label>Live transcript</T.Label>
                <View className="mt-2 min-h-[120px] rounded-xl border border-lantern-border bg-lantern-surface p-3">
                  <LectureTranscriptSegments
                    segments={segmentsForNote}
                    liveCaptions={liveTranscript}
                    recording={recording}
                    onRetry={(seq) => void retrySegment(seq)}
                  />
                </View>
                <Pressable
                  onPress={() => dispatchDrawer({ type: 'minimise' })}
                  accessibilityRole="button"
                  accessibilityLabel="Minimize transcript"
                  className="min-h-[44px] justify-center"
                >
                  <T.Caption tone="secondary">Minimize transcript</T.Caption>
                </Pressable>
              </View>
            ) : null}

            {/* The lecture surface, shared with the Library door. */}
            <LectureTabs
              noteId={activeNote?.id}
              segments={segmentsForNote}
              onRetrySegment={(seq) => void retrySegment(seq)}
              source={tabSource}
              noteTitle={title || activeNote?.title}
              recording={recording}
              recordingLabel={recording}
              tab={requestedTab}
              onTabChange={setRequestedTab}
              // The drawer's states, in the tab the web calls Record.
              renderTranscript={() => (
                <LectureTranscriptPanel
                  drawer={drawer}
                  chunks={drawer.step === 'done' ? sealLectureChunks(chunks) : chunks}
                  sealed={drawer.step === 'done'}
                  elapsedMs={elapsedMs}
                  enhancing={writing}
                  enhanceCost={formatCreditCost(getSmartNotesCreditCost(depth))}
                  onConsent={handleConsent}
                  onStop={() => {
                    dispatchDrawer({ type: 'stop' });
                    void stopForTitle({ currentBody: notesRef.current });
                  }}
                  onResume={() => {
                    dispatchDrawer({ type: 'resume' });
                    void handleStart();
                  }}
                  onEnhance={() => void enhanceNotes()}
                  precheck={<LecturePreflightCard />}
                />
              )}
              renderNotes={() => (
                <View>
                  <View className="flex-row items-center justify-between">
                    <T.Label>My notes</T.Label>
                    <Pressable
                      onPress={() => setEditingNotes((was) => !was)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: editingNotes }}
                      accessibilityLabel={editingNotes ? 'Done editing notes' : 'Edit notes'}
                      className="min-h-[44px] justify-center px-2"
                    >
                      <T.Caption>{editingNotes ? 'Done' : 'Edit'}</T.Caption>
                    </Pressable>
                  </View>
                  {editingNotes ? (
                    <TextInput
                      value={notesBody}
                      onChangeText={handleNotesChange}
                      accessibilityLabel="Typed lecture notes"
                      placeholder="Type during class. New paragraphs get a timestamp."
                      multiline
                      className="mt-2 min-h-[140px] rounded-xl border border-lantern-border bg-lantern-surface p-3 text-body text-lantern-text"
                    />
                  ) : (
                    <View
                      accessibilityLabel="Typed lecture notes"
                      className="mt-2 min-h-[140px] rounded-xl border border-lantern-border bg-lantern-surface p-3"
                    >
                      <NoteBody
                        body={notesBody}
                        emptyLine="Type during class. New paragraphs get a timestamp."
                      />
                    </View>
                  )}
                </View>
              )}
            />

            <View>
              <T.Label>Ask</T.Label>
              <T.Caption tone="secondary" className="mt-1 mb-2">
                {LECTURE_ASK_KEEP_LISTENING}
              </T.Caption>
              <TextInput
                value={askDraft}
                onChangeText={setAskDraft}
                accessibilityLabel="Ask about the lecture"
                placeholder={LECTURE_ASK_JUST_SAID}
                multiline
                className="min-h-[88px] rounded-xl border border-lantern-border bg-lantern-surface p-3 text-body text-lantern-text"
              />
              <View className="mt-2">
                <Button variant="secondary" onPress={() => void askAboutLecture()}>
                  {LECTURE_ASK_JUST_SAID}
                </Button>
              </View>
            </View>

            {status === 'idle' || status === 'failed' ? (
              <View>
                <T.Label>Enhance</T.Label>
                <View className="flex-row flex-wrap gap-2 mt-2 mb-2">
                  {NOTES_STUDIO_DEPTHS.map((option) => (
                    <Pressable
                      key={option.id}
                      onPress={() => setDepth(option.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: depth === option.id }}
                      className={`min-h-[44px] rounded-full border px-3 justify-center ${
                        depth === option.id
                          ? 'border-lantern-primary bg-lantern-primary'
                          : 'border-lantern-border bg-lantern-surface'
                      }`}
                    >
                      <T.Body style={depth === option.id ? { color: '#ffffff' } : undefined}>
                        {`${option.label} · ${formatCreditCost(SMART_NOTES_CREDIT_COST[option.id])}`}
                      </T.Body>
                    </Pressable>
                  ))}
                </View>
                {/*
                  One optional line about the reader. Free: a hint is a
                  sentence in the prompt, not a second call, so the price above
                  does not move.
                */}
                <T.Caption tone="secondary" className="mt-1">
                  How much do you already know? (optional)
                </T.Caption>
                <TextInput
                  value={skillHint}
                  onChangeText={setSkillHint}
                  maxLength={SMART_NOTES_SKILL_HINT_MAX_CHARS}
                  accessibilityLabel="How much do you already know?"
                  placeholder="e.g. I know the basics but not the maths"
                  className="mt-1 min-h-[44px] rounded-xl border border-lantern-border bg-lantern-surface px-3 text-body text-lantern-text"
                />
                <View className="flex-row flex-wrap gap-2 mt-2 mb-2">
                  {SMART_NOTES_SKILL_HINT_EXAMPLES.map((example) => (
                    <Pressable
                      key={example.id}
                      onPress={() => setSkillHint(example.text)}
                      accessibilityRole="button"
                      accessibilityLabel={`${example.label} level`}
                      className="min-h-[44px] justify-center rounded-full border border-lantern-border bg-lantern-surface px-3"
                    >
                      <T.Body>{example.label}</T.Body>
                    </Pressable>
                  ))}
                </View>
                <Button disabled={writing} onPress={() => void enhanceNotes()}>
                  {writing
                    ? 'Enhancing…'
                    : `Enhance notes · ${formatCreditCost(getSmartNotesCreditCost(depth))}`}
                </Button>
                <T.Caption tone="secondary" className="mt-2">
                  Turn this lecture into cards or a test from the course room after you enhance.
                </T.Caption>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default LectureStudioScreen;

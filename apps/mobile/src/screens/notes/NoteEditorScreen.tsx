/**
 * The `NoteEditor` route: the one screen every note in the library opens into.
 * Reads or edits the note, hosts the imported-document surfaces (PDF, slides,
 * photos with OCR, YouTube), the lecture tabs and recorder, the Learn panel
 * (Smart Notes, flashcards, a test), collaborators, cover and filing.
 *
 * Main exports: `NoteEditorScreen` (also the default).
 * Touches: notesStore (load/save/remove, cover path), companionStore,
 * lectureRecordingStore, jobsStore, studyGoalsStore, authStore, confirmStore;
 * services/notes (fetch, summarize, quiz, OCR, YouTube retry, attachment pages),
 * services/ai, services/jobArtifacts, and the AI-usage subscription. Native:
 * expo-image-picker; recording hardware lives in the lecture store.
 *
 * Gotchas: the note is hydrated into local state ONCE per open
 * (`lastHydratedNoteIdRef`) — re-applying `selectedNote` on every store update
 * would erase in-progress typing, and re-deciding read-vs-edit would throw the
 * student out mid-word. Autosave is debounced 800ms and is deliberately paused
 * for a few seconds around transcription, which writes the body from the store.
 * `titleRef`/`bodyRef` exist because the leave-while-recording listener is
 * registered once per recording and a stale closure would let
 * `shouldDeleteDoorNoteOnDiscard` delete a note the student renamed mid-take.
 * `startRecording: true` from the Record door fires once per arrival, guarded by
 * `startedFromDoorRef` so a re-render or Fast Refresh cannot start a second
 * recording. The contextual row's actions are registered through
 * `useScreenActions` as plain (unmemoised) functions, read through a ref, so
 * they never close over a stale credit count or a swapped note.
 */
import { Screen, useScreenActions } from '../../components/layout';
import { learnTailPadding } from './noteLearnScroll';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { appAlert, confirmAsync } from '../../components/ui/appDialog';



import {
  aggregatePhotoOcrStatus,
  getAttachmentExtractionStatus,
  getExtractionStatusMessage,
  isPhotoNoteSource,
  getNoteStudyContent,
  hasEnoughNoteStudyContent,
  MarkdownRenderer,
  buildSpanQuestion,
  buildFigureQuestion,
  canAskAboutHighlight,
  highlightFromRange,
  isWalkableAttachment,
  isLectureNote,
  composeLectureNoteBody,
  displayLectureTranscript,
  getNoteStudyContentForSmartNotes,
  latestLectureTranscript,
  lectureNoteParts,
  lectureTabs,
  listSmartNoteSources,
  MIN_NOTE_STUDY_CONTENT_CHARS,
  noteHasMaterials,
  toggleSmartNoteFilter,
  preferLectureTranscript,
  splitLectureNoteBody,
  type LectureTabId,
  type SmartNoteSourceId,
} from '@lantern/shared';
import { upsertSmartNotesSection } from '@lantern/shared/utils/smartNotes';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useCompanionStore } from '../../stores/companionStore';
import { confirmSheet } from '../../stores/confirmStore';
import { useNotesStore } from '../../stores/notesStore';
import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { brand, useTheme } from '../../theme';


import {
  copyNote,
  fetchNote,
  summarizeNote,
  generateNoteQuiz,
  addImagesToPhotoNote,
  retryYoutubeTranscript,
  runNoteOcr,
  waitForNoteOcr,
  fetchNoteAttachmentPages,
} from '../../services/notes';

import { useAIHandlers } from '../../hooks/useAIHandlers';
import { aiGenerateFlashcards } from '../../services/ai';
import { trackAIToolUsed } from '../../services/productAnalytics';
import { useJobsStore } from '../../stores/jobsStore';
import { saveGeneratedDeck, saveGeneratedTest } from '../../services/jobArtifacts';
import { JobProgressSheet } from '../../components/jobs';
import { setStudyIntent } from '../../hooks/usePresenceHeartbeat';

import { Button, Card, T } from '../../components/ui';
import {
  CoverBanner,
  CoverFailureLine,
  CoverPicker,
  useCoverPicker,
} from '../../components/ui/CoverPicker';
import { readCoverPath } from '../../components/ui/coverPickerModel';
import { NoteBody } from '../../components/NoteBody';
import { CoursePicker } from '../../components/CoursePicker';
import { TopicPicker } from '../../components/TopicPicker';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { NotePdfViewer } from '../../components/NotePdfViewer';
import { NoteImageGallery } from '../../components/NoteImageGallery';
import { NoteCollaboratorsModal } from '../../components/NoteCollaboratorsModal';
import { NoteLearnPanel, SmartNoteComposeFields } from '../../components/notes/NoteLearnPanel';
import { getLatestAIUsage, subscribeToAIUsage } from '../../services/ai';
import { makeCardsConfirmMessage, noCreditsLeftMessage } from './noteCardsPrompt';
import { topicIdAfterCourseChange } from '../../utils/topicSelection';
import {
  AI_CREDIT_COSTS,
  SMART_NOTES_CREDIT_COST,
  formatCreditCost,
} from '@lantern/shared/utils/aiCredits';
import { useAuthStore } from '../../stores/authStore';
import {
  formatRecordingDuration,
  getElapsedRecordingSeconds,
  MIN_MOBILE_LECTURE_RECORD_MS,
  useLectureRecordingStore,
} from '../../stores/lectureRecordingStore';
import { LecturePreflightCard } from '../../components/lecture/LecturePreflightCard';
import { LectureTabs } from '../../components/lecture/LectureTabs';
import { recordCardBlockedReason } from '../../components/lecture/lectureStatusCopy';
import { shouldDeleteDoorNoteOnDiscard } from '../study/recorderDoor';
import * as ImagePicker from 'expo-image-picker';
import type { NoteAttachment } from '../../services/notes';
import { readCachedScript } from '../../services/narration';
import { AppIcon } from '../../components/ui/AppIcon';

import { toTab } from '../../navigation/nestedTab';

/** Questions asked for from one note; the server may return fewer. Matches the Test builder. */
const NOTE_TEST_QUESTION_CEILING = 10;

type NavigationProp = {

  goBack: () => void;
  canGoBack?: () => boolean;
  navigate: (screen: string, params?: Record<string, unknown>) => void;

};



interface Props {

  navigation: NavigationProp;

  route: { params: { noteId: string; startRecording?: boolean } };

}

export function NoteEditorScreen({ navigation, route }: Props) {

  const noteId = route.params.noteId;
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const { selectedNote, isLoading, isSaving, loadNote, saveNote, removeNote, setSelectedNote, setNoteCoverPath } = useNotesStore();
  const noteCoverPath = readCoverPath(selectedNote);
  const coverTarget = useMemo(() => ({ kind: 'note' as const, id: noteId }), [noteId]);
  const applyCover = useCallback(
    (coverPath: string | null) => setNoteCoverPath(noteId, coverPath),
    [noteId, setNoteCoverPath],
  );
  const coverPicker = useCoverPicker(coverTarget, {
    hasCover: Boolean(noteCoverPath),
    onApplied: applyCover,
  });

  const { isAILoading } = useAIHandlers();
  const startJob = useJobsStore((state) => state.startJob);



  const [title, setTitle] = useState('');

  const [body, setBody] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  const [summary, setSummary] = useState('');

  /**
   * READ or EDIT — and READ is the default for a note that has anything in it.
   *
   * This screen was a bare `TextInput` and nothing else, so opening the
   * "Pancreatitis" note off a set's notes list showed `#`, `##`, `**bold**`,
   * bullets and pipe tables literally, all at the 14 sp body size (build 186's
   * device pass). Lane N gave the studios a reading state —
   * `components/NoteBody.tsx` over the shared block parser
   * (`@lantern/shared/utils/noteBlocks`, which is also what strips the Smart
   * Notes sentinels) — and the one screen every note in the library actually
   * opens into never got it.
   *
   * So: a note with content opens in READ, with `Edit` in the header; `Done`
   * saves and comes back. A brand-new or empty note opens straight in EDIT —
   * there is nothing to read, and making the student press Edit before they
   * can type is the door the recorder and the import paths walk through. A
   * view-only note is always READ; `canEdit` is the gate, not the mode.
   *
   * Everything else on this screen — autosave, the recorder, attachments, the
   * Learn panel — is unchanged and lives outside the swap.
   */
  const [mode, setMode] = useState<'read' | 'edit'>('read');

  const lectureStatus = useLectureRecordingStore((s) => s.status);
  const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
  const lectureStartedAt = useLectureRecordingStore((s) => s.startedAt);
  const lectureTick = useLectureRecordingStore((s) => s.tick);
  const startLectureRecording = useLectureRecordingStore((s) => s.start);
  const stopLectureRecording = useLectureRecordingStore((s) => s.stopForTitle);
  const lectureStoreTitle = useLectureRecordingStore((s) => s.noteTitle);
  const discardLectureRecording = useLectureRecordingStore((s) => s.discard);
  const cancelLectureTranscription = useLectureRecordingStore((s) => s.cancelTranscription);
  const setCurrentBodyProvider = useLectureRecordingStore((s) => s.setCurrentBodyProvider);
  const lectureSegments = useLectureRecordingStore((s) => s.segments);
  const lectureSegmentsNoteId = useLectureRecordingStore((s) => s.transcriptNoteId);
  const retryLectureSegment = useLectureRecordingStore((s) => s.retrySegment);
  const hydrateLectureSegments = useLectureRecordingStore((s) => s.hydrateFromNote);
  const committedTranscript = useLectureRecordingStore((s) => s.committedTranscript);
  const interimTranscript = useLectureRecordingStore((s) => s.interimTranscript);
  const whisperTranscript = useLectureRecordingStore((s) => s.whisperTranscript);
  const isRecording = lectureNoteId === noteId && lectureStatus === 'recording';
  const transcribing =
    lectureNoteId === noteId &&
    (lectureStatus === 'uploading' || lectureStatus === 'transcribing');
  const recordingSeconds = isRecording ? getElapsedRecordingSeconds(lectureStartedAt) : 0;
  // Why the "Record" tile is unavailable, decided in one tested place. It is
  // `null` exactly when a new recording may start here.
  const recordBlockedReason = recordCardBlockedReason({
    status: lectureStatus,
    activeNoteId: lectureNoteId,
    noteId,
  });
  void lectureTick;
  const pauseAutosaveUntilRef = useRef(0);
  const AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS = 4000;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  /**
   * The title field's LIVE value, for the same reason `bodyRef` exists.
   *
   * The "leave while recording" listener is registered once per recording (its
   * effect does not depend on `title`), so a `title` read out of that closure is
   * the one from the render the listener was built in — the door's own title.
   * Reading the state directly there would tell `shouldDeleteDoorNoteOnDiscard`
   * that a note the student RENAMED mid-recording is still the door's untouched
   * shell, and delete it: the exact "keeps a door note the student has renamed"
   * rule, defeated by a stale closure. The ref is always current.
   */
  const titleRef = useRef(title);
  titleRef.current = title;
  /**
   * The note this editor was opened for BY THE RECORD DOOR, and the exact title
   * the door wrote, captured the moment recording auto-starts (see the door
   * effect below). It is what `shouldDeleteDoorNoteOnDiscard` needs to tell an
   * untouched throwaway shell from a note the student has since made theirs.
   * Declared up here so every exit path — the recording bar's Cancel and the
   * "leave while recording" prompt alike — can read it.
   */
  const doorNoteRef = useRef<{ noteId: string; doorTitle: string } | null>(null);

  const [summarizing, setSummarizing] = useState(false);

  const [smartNotesGuidance, setSmartNotesGuidance] = useState('');

  const [smartNotesDepth, setSmartNotesDepth] =
    useState<import('@lantern/shared/utils/smartNotes').SmartNotesDepth>('standard');
  const [smartNoteOpen, setSmartNoteOpen] = useState(false);
  const [requestedTab, setRequestedTab] = useState<LectureTabId | null>(null);
  const [selectedSources, setSelectedSources] = useState<SmartNoteSourceId[]>([]);

  const [aiUsage, setAiUsage] = useState(getLatestAIUsage());

  useEffect(() => subscribeToAIUsage(setAiUsage), []);

  /**
   * Read this note's own segment rows when nothing is recording, so a lecture
   * opened from Library shows the same stamped cards and the same per-segment
   * players as the studio — including a take that was interrupted.
   */
  useEffect(() => {
    if (lectureStatus !== 'idle' || !noteId) return;
    hydrateLectureSegments(noteId, selectedNote?.attachments);
  }, [lectureStatus, noteId, selectedNote?.attachments, hydrateLectureSegments]);

  useEffect(() => {
    setStudyIntent({
      context: 'writing',
      courseId: selectedNote?.courseId || undefined,
      topic: selectedNote?.title || title || undefined,
    });
    return () => setStudyIntent(null);
  }, [noteId, selectedNote?.courseId, selectedNote?.title, title]);

  const remainingCredits = Math.max(0, aiUsage.remaining);
  const shortForSmartNote =
    aiUsage.limit > 0 && remainingCredits < SMART_NOTES_CREDIT_COST[smartNotesDepth];
  const shortForOneCredit = aiUsage.limit > 0 && remainingCredits < 1;


  const [retryingYoutubeTranscript, setRetryingYoutubeTranscript] = useState(false);
  const [youtubeTranscriptExpanded, setYoutubeTranscriptExpanded] = useState(true);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [parentScrollEnabled, setParentScrollEnabled] = useState(true);
  const tabBarClearance = useTabBarClearance(16);
  /**
   * The note's own scroller, and where the "Learn from this note" panel sits
   * inside it. Both exist for the contextual row's Learn item (spec v3 §7.2):
   * the panel is a section of this screen, not a route, so the row asks the
   * screen to bring it into view rather than navigating anywhere.
   */
  const scrollRef = useRef<ScrollView>(null);
  const learnPanelY = useRef(0);
  /**
   * The two measurements `learnTailPadding` needs (noteLearnScroll.ts): how
   * tall the scroller is and how tall the Learn panel is. State rather than
   * refs because the answer is a style — the padding has to be re-rendered
   * when either changes — and each setter is guarded on equality so a layout
   * pass that reports the same number does not loop.
   */
  const [scrollViewportHeight, setScrollViewportHeight] = useState(0);
  const [learnPanelHeight, setLearnPanelHeight] = useState(0);
  const openCompanionWithMessage = useCompanionStore(s => s.openWithMessage);
  const openCompanion = useCompanionStore(s => s.open);
  const setActiveNoteContext = useCompanionStore(s => s.setActiveNoteContext);
  const handleDocumentScrollLock = useCallback((locked: boolean) => {
    setParentScrollEnabled(!locked);
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDocumentNote =
    selectedNote?.sourceType === 'pdf' || selectedNote?.sourceType === 'presentation';
  const isYoutubeNote =
    selectedNote?.sourceType === 'youtube' || Boolean(selectedNote?.youtubeVideoId);
  const isPhotoNote = selectedNote?.sourceType === 'photos';
  /**
   * A lecture is one note with tabs. My notes is the only writable surface;
   * the transcript stays behind the marker / attachment.
   */
  const isLectureSurface = Boolean(selectedNote && isLectureNote(selectedNote));
  const liveTranscript = displayLectureTranscript({
    committed: committedTranscript,
    interim: interimTranscript,
    whisper:
      whisperTranscript ||
      latestLectureTranscript(selectedNote?.attachments) ||
      splitLectureNoteBody(body).transcript,
  });
  const lectureTabSource = {
    body,
    attachments: selectedNote?.attachments ?? [],
    liveTranscript,
    showTranscriptTab: isLectureSurface,
    showEnhancedTab: Boolean(
      smartNoteOpen ||
        isLectureSurface ||
        noteHasMaterials({
          attachments: selectedNote?.attachments ?? [],
          sourceType: selectedNote?.sourceType,
          youtubeVideoId: selectedNote?.youtubeVideoId,
        })
    ),
    sourceType: selectedNote?.sourceType,
    youtubeVideoId: selectedNote?.youtubeVideoId,
  };
  const lectureParts = lectureNoteParts(lectureTabSource);
  const lectureTabList = lectureTabs(lectureTabSource);
  const showNoteTabs = lectureTabList.length > 1;
  const persistableTranscript = lectureNoteParts({
    body,
    attachments: selectedNote?.attachments ?? [],
  }).transcript;
  const handleTypedNotesChange = (typed: string) => {
    let next = isLectureSurface
      ? composeLectureNoteBody(typed, persistableTranscript)
      : typed;
    if (lectureParts.enhanced) next = upsertSmartNotesSection(next, lectureParts.enhanced);
    setBody(next);
  };
  const youtubeAttachment = useMemo(
    () => selectedNote?.attachments?.find((a) => a.type === 'youtube'),
    [selectedNote?.attachments]
  );
  const youtubeTranscriptText = youtubeAttachment?.extractedText?.trim() || '';
  const youtubeTranscriptStatus = useMemo(() => {
    if (youtubeTranscriptText) return 'ready' as const;
    const status = youtubeAttachment?.metadata?.transcriptStatus;
    if (status === 'processing' || status === 'ready' || status === 'failed') return status;
    return youtubeAttachment ? ('missing' as const) : ('missing' as const);
  }, [youtubeAttachment, youtubeTranscriptText]);
  const youtubeTranscriptError =
    typeof youtubeAttachment?.metadata?.transcriptError === 'string'
      ? youtubeAttachment.metadata.transcriptError
      : null;
  const imageAttachments = useMemo(
    () =>
      (selectedNote?.attachments || [])
        .filter((a) => a.type === 'image')
        .sort(
          (a, b) =>
            (typeof a.metadata?.sortOrder === 'number' ? a.metadata.sortOrder : 0) -
            (typeof b.metadata?.sortOrder === 'number' ? b.metadata.sortOrder : 0)
        ),
    [selectedNote?.attachments]
  );
  const showImageGallery = isPhotoNote || imageAttachments.length > 0;
  const [addingPhotos, setAddingPhotos] = useState(false);
  const accessRole = selectedNote?.accessRole || 'owner';
  const canEdit = accessRole === 'owner' || accessRole === 'editor';
  const isOwner = accessRole === 'owner';

  const documentAttachment = useMemo(
    () =>
      selectedNote?.attachments?.find(
        (a) => a.type === 'pdf' || (a.type === 'presentation' && a.metadata?.previewStoragePath)
      ),
    [selectedNote?.attachments]
  );

  useEffect(() => {
    const attachment = selectedNote?.attachments?.find(isWalkableAttachment);
    if (!attachment?.id) return;
    void fetchNoteAttachmentPages(noteId, attachment.id, { images: true }).catch(() => undefined);
  }, [noteId, selectedNote?.attachments]);

  const presentationAttachment = useMemo(
    () => selectedNote?.attachments?.find((a) => a.type === 'presentation'),
    [selectedNote?.attachments]
  );

  const documentSourceAttachment = useMemo(
    () =>
      selectedNote?.attachments?.find((a) => a.type === 'pdf') || presentationAttachment,
    [selectedNote?.attachments, presentationAttachment]
  );

  /**
   * The attachment "Walk me through" opens, or null when this note has none.
   *
   * Only a PDF or a slide deck has pages, and only a deck that has finished
   * converting has a preview to render them from — `documentAttachment` is
   * already that test, so the walk-through door and the PDF viewer agree about
   * what this note is instead of disagreeing on the same screen.
   */
  const walkthroughAttachmentId = documentAttachment?.id ?? null;

  /**
   * How many pages this document has, when anyone has counted them.
   *
   * Read off the attachment's own metadata rather than fetched: the "Read it
   * to me" door only needs it to print the right price band, and asking the
   * pages route for a number would make opening a note wait on a request it
   * has no other use for. Unknown counts as 0, and the door quotes the cheap
   * band against the 40-page cap — never more than the student is charged.
   */
  const documentPageCount = (() => {
    const raw = (documentAttachment?.metadata as { pageCount?: unknown } | undefined)?.pageCount;
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  })();

  /**
   * True when this document has already been read aloud once on this device.
   *
   * Only the device's own copy is consulted, and deliberately: a note opening
   * must not wait on the network to decide what a tile says. A script bought
   * on the web shows as unread here until the reading screen fetches it — the
   * screen then says "already read" and charges nothing, so the worst this can
   * do is under-promise.
   */
  const [narrationReady, setNarrationReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!walkthroughAttachmentId) {
      setNarrationReady(false);
      return;
    }
    void readCachedScript(walkthroughAttachmentId).then((cached) => {
      if (!cancelled) setNarrationReady(Boolean(cached));
    });
    return () => {
      cancelled = true;
    };
  }, [walkthroughAttachmentId]);

  const handleReadAloud = () => {
    if (!walkthroughAttachmentId) return;
    // Same stack, same reasoning as the walk-through: a Study screen pushed
    // onto Study. Nothing is charged by opening it — the reading screen prints
    // the price and asks.
    navigation.navigate('Narration', {
      noteId,
      attachmentId: walkthroughAttachmentId,
    });
  };

  const handleWalkthrough = () => {
    if (!walkthroughAttachmentId) return;
    // A plain push on the SAME stack: the walk-through is a Study screen, so
    // there is no nested navigate here and nothing to forget `initial: false`
    // on. It keeps both bars and carries its own contextual row.
    navigation.navigate('Walkthrough', {
      noteId,
      attachmentId: walkthroughAttachmentId,
    });
  };

  // Photo notes read text from several photographs, so the status is the batch's.
  const extractionStatus = isPhotoNoteSource(selectedNote?.sourceType)
    ? aggregatePhotoOcrStatus(selectedNote?.attachments)
    : getAttachmentExtractionStatus(documentSourceAttachment);
  const extractionMessage = getExtractionStatusMessage(
    extractionStatus,
    selectedNote?.sourceType
  );
  const [runningOcr, setRunningOcr] = useState(false);
  const ocrPollAttemptedRef = useRef<Set<string>>(new Set());

  const studyContent = useMemo(
    () =>
      selectedNote
        ? getNoteStudyContent({
            sourceType: selectedNote.sourceType,
            body,
            summary: selectedNote.summary,
            attachments: selectedNote.attachments,
          })
        : body,
    [selectedNote, body]
  );

  const canGenerateStudyMaterials = useMemo(
    () =>
      selectedNote
        ? hasEnoughNoteStudyContent({
            sourceType: selectedNote.sourceType,
            body,
            summary: selectedNote.summary,
            attachments: selectedNote.attachments,
          })
        : body.trim().length >= 50,
    [selectedNote, body]
  );

  const studyInput = {
    sourceType: selectedNote?.sourceType,
    body,
    summary: selectedNote?.summary,
    attachments: selectedNote?.attachments,
  };
  const availableSources = listSmartNoteSources(studyInput);
  const availableSourceKey = availableSources.map((source) => source.id).join(',');
  const synthesizeSources = availableSources.length > 0 ? selectedSources : undefined;
  const synthesizeReady =
    getNoteStudyContentForSmartNotes(studyInput, synthesizeSources).trim().length >=
    MIN_NOTE_STUDY_CONTENT_CHARS;

  useEffect(() => {
    setRequestedTab(null);
    setSmartNoteOpen(false);
  }, [noteId]);

  useEffect(() => {
    setSelectedSources(
      availableSourceKey ? (availableSourceKey.split(',') as SmartNoteSourceId[]) : []
    );
  }, [noteId, availableSourceKey]);

  const handleImageAttachmentsChange = (attachments: NoteAttachment[]) => {
    if (!selectedNote) return;
    const other = (selectedNote.attachments || []).filter((a) => a.type !== 'image');
    setSelectedNote({ ...selectedNote, attachments: [...other, ...attachments] });
  };

  const handleAddPhotos = () => {
    if (!selectedNote || addingPhotos) return;
    appAlert('Add photos', 'Choose a source', [
      {
        text: 'Photo library',
        onPress: () => {
          void (async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              appAlert('Permission required', 'Photo library access is needed.');
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsMultipleSelection: true,
              quality: 0.85,
              exif: false,
            });
            if (result.canceled || !result.assets.length) return;
            setAddingPhotos(true);
            try {
              const uploadResult = await addImagesToPhotoNote(
                selectedNote.id,
                result.assets.map((asset, index) => ({
                  uri: asset.uri,
                  fileName: asset.fileName || `photo-${index + 1}.jpg`,
                  mimeType: asset.mimeType,
                  size: asset.fileSize ?? 0,
                }))
              );
              const other = (selectedNote.attachments || []).filter((a) => a.type !== 'image');
              const merged = [...other, ...uploadResult.attachments];
              setSelectedNote({ ...selectedNote, attachments: merged });
            } catch (e: unknown) {
              appAlert('Upload failed', e instanceof Error ? e.message : 'Could not add photos');
            } finally {
              setAddingPhotos(false);
            }
          })();
        },
      },
      {
        text: 'Camera',
        onPress: () => {
          void (async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              appAlert('Permission required', 'Camera access is needed.');
              return;
            }
            const result = await ImagePicker.launchCameraAsync({ quality: 0.85, exif: false });
            if (result.canceled || !result.assets[0]) return;
            const asset = result.assets[0];
            setAddingPhotos(true);
            try {
              const uploadResult = await addImagesToPhotoNote(selectedNote.id, [
                {
                  uri: asset.uri,
                  fileName: asset.fileName || 'photo.jpg',
                  mimeType: asset.mimeType,
                  size: asset.fileSize ?? 0,
                },
              ]);
              const other = (selectedNote.attachments || []).filter((a) => a.type !== 'image');
              setSelectedNote({
                ...selectedNote,
                attachments: [...other, ...uploadResult.attachments],
              });
            } catch (e: unknown) {
              appAlert('Upload failed', e instanceof Error ? e.message : 'Could not add photo');
            } finally {
              setAddingPhotos(false);
            }
          })();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };



  useEffect(() => {
    loadNote(noteId);
  }, [noteId, loadNote]);

  // Poll while local OCR is processing after a scanned upload.
  useEffect(() => {
    if (!selectedNote) return;
    if (
      selectedNote.sourceType !== 'pdf' &&
      selectedNote.sourceType !== 'presentation' &&
      !isPhotoNoteSource(selectedNote.sourceType)
    )
      return;
    if (extractionStatus !== 'ocr_processing') return;
    if (ocrPollAttemptedRef.current.has(noteId)) return;
    ocrPollAttemptedRef.current.add(noteId);
    let cancelled = false;
    setRunningOcr(true);
    void waitForNoteOcr(noteId)
      .then((result) => {
        if (cancelled) return;
        const prev = useNotesStore.getState().selectedNote;
        if (!prev || prev.id !== noteId) return;
        setSelectedNote({
          ...prev,
          attachments: result.attachments?.length
            ? [
                ...(prev.attachments || []).filter((a) => a.type !== 'image'),
                ...result.attachments,
              ]
            : prev.attachments?.map((a) =>
                a.id === result.attachment.id ? result.attachment : a
              ) ?? [result.attachment],
        });
        if (result.status === 'failed') {
          appAlert('OCR failed', result.ocrError || 'Local OCR failed.');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        appAlert('OCR failed', err instanceof Error ? err.message : 'OCR timed out');
      })
      .finally(() => {
        if (!cancelled) setRunningOcr(false);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, selectedNote?.sourceType, extractionStatus, setSelectedNote, selectedNote]);

  // Poll while YouTube transcript is processing so Smart Notes unlocks in-session.
  useEffect(() => {
    if (!isYoutubeNote || youtubeTranscriptStatus !== 'processing') return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 40;
    const tick = async () => {
      if (cancelled || attempts >= maxAttempts) return;
      attempts += 1;
      try {
        const refreshed = await fetchNote(noteId);
        if (cancelled) return;
        const prev = useNotesStore.getState().selectedNote;
        if (!prev || prev.id !== noteId) return;
        setSelectedNote({
          ...prev,
          ...refreshed,
          attachments: refreshed.attachments ?? prev.attachments,
        });
        const attachment = refreshed.attachments?.find((a) => a.type === 'youtube');
        const text = attachment?.extractedText?.trim();
        const status = text
          ? 'ready'
          : attachment?.metadata?.transcriptStatus === 'failed'
            ? 'failed'
            : attachment?.metadata?.transcriptStatus === 'ready'
              ? 'ready'
              : 'processing';
        if (status === 'processing') {
          setTimeout(() => void tick(), 2500);
        }
      } catch {
        if (!cancelled) setTimeout(() => void tick(), 4000);
      }
    };
    const timer = setTimeout(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isYoutubeNote, youtubeTranscriptStatus, noteId, setSelectedNote]);

  const lastHydratedNoteIdRef = useRef<string | null>(null);

  useEffect(() => {
    lastHydratedNoteIdRef.current = null;
  }, [noteId]);

  useEffect(() => {
    // Hydrate once per note open. Re-applying selectedNote on every store update
    // (autosave, attachments, transcript reload) erases in-progress typing.
    if (!selectedNote || selectedNote.id !== noteId) return;
    if (lastHydratedNoteIdRef.current === noteId) return;
    lastHydratedNoteIdRef.current = noteId;
    setTitle(selectedNote.title);
    setBody(selectedNote.body);
    setSummary(selectedNote.summary || '');
    // Decided once, at open, from what the note actually holds. Re-deciding on
    // every store update would throw the student out of the editor mid-word.
    setMode(!canEdit || (selectedNote.body ?? '').trim().length > 0 ? 'read' : 'edit');
  }, [selectedNote, noteId, canEdit]);

  useEffect(() => {
    if (!canEdit) {
      setCurrentBodyProvider(null);
      return;
    }
    setCurrentBodyProvider(() => bodyRef.current);
    return () => setCurrentBodyProvider(null);
  }, [canEdit, noteId, setCurrentBodyProvider]);

  const scheduleSave = useCallback(
    (updates: { title?: string; body?: string; summary?: string }) => {
      if (!canEdit) return;
      if (Date.now() < pauseAutosaveUntilRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (Date.now() < pauseAutosaveUntilRef.current) return;
        saveNote(noteId, updates).catch(() => {});
      }, 800);
    },
    [canEdit, noteId, saveNote]
  );

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!transcribing) return;
    cancelPendingSave();
    pauseAutosaveUntilRef.current = Date.now() + AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS;
  }, [transcribing, cancelPendingSave]);

  const prevTranscribingRef = useRef(false);
  useEffect(() => {
    if (prevTranscribingRef.current && !transcribing && lectureStatus === 'idle') {
      pauseAutosaveUntilRef.current = Date.now() + AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS;
      const latest = useNotesStore.getState().selectedNote;
      if (latest?.id === noteId) {
        lastHydratedNoteIdRef.current = null;
        setTitle(latest.title);
        setBody(latest.body || '');
        lastHydratedNoteIdRef.current = noteId;
      }
    }
    prevTranscribingRef.current = transcribing;
  }, [transcribing, lectureStatus, noteId]);

  /**
   * While the title sheet is open the lecture store owns this note's title.
   * Autosave here would write the pre-rename title straight back over it, and
   * the sheet can stay open for as long as it takes to type, which is longer
   * than the 4 s post-transcript pause. So the pause is renewed for as long as
   * the sheet lives.
   */
  useEffect(() => {
    if (lectureNoteId !== noteId || lectureStatus !== 'naming') return;
    cancelPendingSave();
    pauseAutosaveUntilRef.current = Date.now() + 5000;
    const timer = setInterval(() => {
      pauseAutosaveUntilRef.current = Date.now() + 5000;
    }, 2000);
    return () => clearInterval(timer);
  }, [lectureStatus, lectureNoteId, noteId, cancelPendingSave]);

  // Adopt the title the sheet just saved, so the field does not sit on the
  // old one and race the next autosave.
  useEffect(() => {
    if (lectureNoteId !== noteId) return;
    if (lectureStatus !== 'uploading' && lectureStatus !== 'transcribing') return;
    if (!lectureStoreTitle || lectureStoreTitle === title) return;
    setTitle(lectureStoreTitle);
  }, [lectureStoreTitle, lectureStatus, lectureNoteId, noteId, title]);

  // Leave NoteEditor while recording: continue (keep session) or discard.
  useEffect(() => {
    const nav = navigation as NavigationProp & {
      addListener?: (
        event: string,
        cb: (e: { preventDefault: () => void; data: { action: unknown } }) => void
      ) => () => void;
      dispatch?: (action: unknown) => void;
    };
    const unsubscribe = nav.addListener?.('beforeRemove', (e) => {
      if (lectureNoteId !== noteId || lectureStatus !== 'recording') return;
      e.preventDefault();
      appAlert(
        'Lecture recording in progress',
        'Leave this note and keep recording in the background, or discard the recording?',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Continue recording',
            onPress: () => {
              nav.dispatch?.(e.data.action);
            },
          },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              // Leaving mid-recording and discarding is the same commitment as
              // the bar's Cancel: if the note is still the door's untouched
              // shell, it goes with the audio rather than being left behind.
              const door = doorNoteRef.current;
              void discardLectureRecording().then(async () => {
                if (
                  door &&
                  door.noteId === noteId &&
                  shouldDeleteDoorNoteOnDiscard({
                    openedByDoor: true,
                    // The REF, never the closed-over state: this listener was
                    // built when recording started, so `title` here would be
                    // the door's title even after the student renamed the note.
                    title:
                      titleRef.current || useNotesStore.getState().selectedNote?.title,
                    body: bodyRef.current,
                    doorTitle: door.doorTitle,
                  })
                ) {
                  doorNoteRef.current = null;
                  try {
                    await removeNote(noteId);
                  } catch {
                    // A stray empty row, not lost work — let them leave anyway.
                  }
                }
                nav.dispatch?.(e.data.action);
              });
            },
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, lectureNoteId, noteId, lectureStatus, discardLectureRecording]);

  useEffect(() => {
    if (!selectedNote || selectedNote.id !== noteId) return;
    if (title === selectedNote.title && body === selectedNote.body) return;
    scheduleSave({ title, body });
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [title, body, noteId, selectedNote?.id, selectedNote?.title, selectedNote?.body, scheduleSave]);

  const startRecording = () => {
    if (!canEdit) return;
    cancelPendingSave();
    void startLectureRecording(noteId, title || selectedNote?.title || 'Untitled note', {
      currentBody: bodyRef.current,
    });
  };

  /**
   * Discard is where "nothing exists until the student commits" is finished.
   *
   * The door creates the note before a second is recorded, so a Start-then-
   * Discard (the mis-tap-twice case) would otherwise leave the empty
   * "Lecture — 6 Sep" behind — the exact junk the door exists to prevent. When
   * the discarded note is still the door's untouched shell, delete it and step
   * back out. The rule lives in `shouldDeleteDoorNoteOnDiscard`; this is its
   * thin shell.
   */
  const cleanupDiscardedDoorNote = async (): Promise<boolean> => {
    const door = doorNoteRef.current;
    if (!door || door.noteId !== noteId) return false;
    const remove = shouldDeleteDoorNoteOnDiscard({
      openedByDoor: true,
      title: titleRef.current || selectedNote?.title,
      body: bodyRef.current,
      doorTitle: door.doorTitle,
    });
    if (!remove) return false;
    // One shot: whatever happens next, this note is no longer the door's shell.
    doorNoteRef.current = null;
    cancelPendingSave();
    try {
      await removeNote(noteId);
      return true;
    } catch {
      // A note we could not delete is a stray empty row, not lost work; the
      // student can still delete it by hand. Do not trap them on the editor.
      return false;
    }
  };

  const discardRecording = () => {
    void discardLectureRecording().then(() => {
      void cleanupDiscardedDoorNote().then((deleted) => {
        // Only a note we actually deleted sends the student back out; a note
        // they kept (typed into, renamed) or never a door note stays put. The
        // door always pushes the editor onto a stack, so there is somewhere to
        // go back to.
        if (!deleted) return;
        if (navigation.canGoBack?.() ?? true) navigation.goBack();
      });
    });
  };

  const stopRecording = () => {
    cancelPendingSave();
    pauseAutosaveUntilRef.current = Date.now() + AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS;
    void stopLectureRecording({ currentBody: bodyRef.current });
  };

  const cancelTranscription = () => {
    cancelLectureTranscription();
  };

  const handleRecordPress = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  /**
   * The Record door's second half.
   *
   * The door asks, creates the note and hands over `startRecording: true`; the
   * mic then opens by itself, so a note created by that door is never an empty
   * one the student has to notice and delete. Once per arrival, and only once
   * the note is actually loaded and editable — `startedFromDoorRef` makes a
   * re-render, a Fast Refresh or a returning screen unable to start a second
   * recording over a running one.
   */
  const startedFromDoorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!route.params?.startRecording) return;
    if (startedFromDoorRef.current === noteId) return;
    if (!canEdit) return;
    if (!selectedNote || selectedNote.id !== noteId) return;
    if (lectureStatus !== 'idle') return;
    startedFromDoorRef.current = noteId;
    // Remember this is the door's note, and the title the door wrote, so a
    // later discard can tell an untouched shell from a note now made theirs.
    doorNoteRef.current = { noteId, doorTitle: (selectedNote.title ?? '').trim() };
    startRecording();
    // `startRecording` is re-created every render; the ref above is the guard,
    // so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.startRecording, noteId, canEdit, selectedNote, lectureStatus]);



  const handleRetryYoutubeTranscript = async () => {
    if (!canEdit || retryingYoutubeTranscript) return;
    setRetryingYoutubeTranscript(true);
    try {
      const result = await retryYoutubeTranscript(noteId);
      const prev = useNotesStore.getState().selectedNote;
      if (prev?.id === noteId) {
        setSelectedNote({
          ...prev,
          ...result.note,
          attachments:
            prev.attachments?.map((a) =>
              a.id === result.attachment.id ? result.attachment : a
            ) ?? [result.attachment],
        });
      }
      if (result.status === 'failed') {
        appAlert(
          'Transcript unavailable',
          result.transcriptError ||
            'Still could not fetch a transcript for this video.'
        );
      }
    } catch (e: unknown) {
      appAlert('Error', e instanceof Error ? e.message : 'Transcript retry failed');
    } finally {
      setRetryingYoutubeTranscript(false);
    }
  };

  const handleSummarize = async () => {

    if (!synthesizeReady) {

      appAlert(
        'Empty note',
        isYoutubeNote
          ? 'Wait for the video transcript, or add your own notes, before summarizing.'
          : 'Select materials with enough text, or add your own notes.'
      );

      return;

    }

    setSummarizing(true);

    try {

      await saveNote(noteId, { title, body });

      const result = await summarizeNote(noteId, {
        guidance: smartNotesGuidance.trim() || undefined,
        depth: smartNotesDepth,
        sources: synthesizeSources,
      });

      const newSummary = result.summary || result.note?.summary || '';

      setSummary(newSummary);

      if (result.note?.body != null) {
        setBody(result.note.body);
        pauseAutosaveUntilRef.current = Date.now() + AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS;
      }
      setRequestedTab('enhanced');

      if (result.note) {
        const prev = useNotesStore.getState().selectedNote;
        if (prev?.id === noteId) {
          setSelectedNote({ ...prev, ...result.note, summary: newSummary });
        }
      }

    } catch (e: unknown) {

      appAlert('Error', e instanceof Error ? e.message : 'Summarize failed');

    } finally {

      setSummarizing(false);

    }

  };



  const handleChatWithNote = () => {
    const noteTitle = title || selectedNote?.title || 'Untitled Note';
    void setActiveNoteContext({
      id: noteId,
      title: noteTitle,
      scopeId: selectedNote?.studySetId ?? selectedNote?.courseId ?? null,
    });
    openCompanion();
  };

  const highlight = highlightFromRange(body, selection.start, selection.end);
  const askHighlightReady = canAskAboutHighlight(highlight);

  const handleAskHighlight = () => {
    if (!askHighlightReady) return;
    const noteTitle = title || selectedNote?.title || 'Untitled Note';
    void setActiveNoteContext({ id: noteId, title: noteTitle });
    openCompanionWithMessage(buildSpanQuestion({ excerpt: highlight, noteTitle }), {
      selectedSpan: highlight.trim(),
      noteId,
    });
  };

  const handleAskFigure = (attachment: NoteAttachment) => {
    const noteTitle = title || selectedNote?.title || 'Untitled Note';
    void setActiveNoteContext({ id: noteId, title: noteTitle });
    openCompanionWithMessage(
      buildFigureQuestion({
        label: attachment.fileName || 'Photo',
        excerpt: attachment.extractedText || undefined,
      }),
      { noteId }
    );
  };

  /**
   * Wave G: hand the generation to the jobs store instead of awaiting it here.
   *
   * The screen used to hold a spinner through an AI call and a save loop, and
   * a student who backed out lost the sheet AND any way of knowing what
   * happened. Now the work is owned by jobsStore: the progress sheet can be
   * swiped away, the cards still land in a deck, and a local notification
   * deep-links to it.
   */
  const handleGenerateFlashcards = () => {
    if (!canGenerateStudyMaterials) {
      appAlert(
        'Not enough content',
        'Add at least 50 characters of study content. For presentations, wait for slide text extraction or add your own notes.'
      );
      return;
    }
    if (!user?.id) {
      appAlert('Error', 'You must be signed in to generate flashcards.');
      return;
    }

    // Same count as web's deck-from-note path; 5 was below the supported
    // minimum of 10 and got clamped anyway.
    const count = normalizeFlashcardCount();
    const noteTitle = title || selectedNote?.title || 'Untitled Note';
    const content = studyContent.slice(0, 8000);
    const userId = user.id;

    startJob({
      kind: 'flashcards',
      sourceTitle: noteTitle,
      requestedCount: count,
      run: async ({ jobId, onServerJob, onStage }) => {
        // The raw service rather than useAIHandlers: the hook swallows the
        // error and returns [], which would report every failure as "could
        // not generate" and hide the real reason from the sheet.
        const { flashcards } = await aiGenerateFlashcards(content, {
          count,
          style: 'concise',
          // The server's job id, the moment the 202 lands: it is what a push
          // names, and what survives a cold start.
          onJobUpdate: (p) => {
            if (p.jobId) onServerJob(p.jobId);
          },
        });
        trackAIToolUsed('generate_flashcards');
        if (!flashcards.length) {
          throw new Error('Could not generate flashcards from this note.');
        }

        // Persist into a deck the same way web does — generating without saving
        // spends AI credits and leaves the user with nothing to study. The deck
        // is created only now that the cards exist, and is rolled back if they
        // do not land (services/jobArtifacts.ts).
        onStage('Saving to your deck');
        const { ref, saved } = await saveGeneratedDeck({
          jobId,
          userId,
          cards: flashcards,
          deckName: `From: ${noteTitle}`,
          description: `Generated from note: ${noteTitle}`,
          courseId: selectedNote?.courseId,
        });
        // `saved`, never `flashcards.length`: the count the student is shown
        // is of cards that exist.
        return { artifact: ref, resultCount: saved };
      },
    });
  };

  const handleGenerateQuiz = () => {
    if (!canGenerateStudyMaterials) {
      appAlert(
        'Not enough content',
        'Add at least 50 characters of study content. For presentations, wait for slide text extraction or add your own notes.'
      );
      return;
    }

    const noteTitle = title || selectedNote?.title || 'Untitled Note';
    const currentTitle = title;
    const currentBody = body;

    startJob({
      // One name for one thing: what this makes lands under Tests as a test,
      // so the progress sheet and the notification call it that.
      kind: 'test',
      sourceTitle: noteTitle,
      // A ceiling, not a promise: unanswerable questions are dropped before
      // the save, so the sheet says "up to 10" until the save counts one. Ten
      // is the same ceiling the Test builder asks for from the same note —
      // one number for one action, whichever door the student came through.
      requestedCount: NOTE_TEST_QUESTION_CEILING,
      requestedCountIsMax: true,
      run: async ({ jobId, onServerJob, onStage }) => {
        await saveNote(noteId, { title: currentTitle, body: currentBody });

        const { studyGoal } = useStudyGoalsStore.getState();
        const session = await generateNoteQuiz(noteId, studyGoal, NOTE_TEST_QUESTION_CEILING, onServerJob);
        if (!session.questions.length) {
          throw new Error('Could not generate a test from this note.');
        }
        onStage('Saving your test');
        // A quiz made from a note is a test of the student's own: it is saved
        // as one, appears in the Tests list under Available, and its link
        // opens it. It used to be handed to the DAILY quiz store instead and
        // referenced as `quiz/daily` — so it lived only in a dashboard panel
        // that shows one quiz a day, Tests said "No tests available", and
        // Open, the notification and the deep link all landed on Home.
        const { ref, saved } = await saveGeneratedTest({
          jobId,
          title: `Test · ${noteTitle}`,
          sourceNoteId: noteId,
          questions: session.questions,
          courseId: selectedNote?.courseId,
        });
        return { artifact: ref, resultCount: saved };
      },
    });
  };

  /**
   * The contextual row's two in-place actions (spec v3 §7.2, the `NoteEditor`
   * row: Learn · Cards · Test · AI).
   *
   * Learn and Cards have no route to go to — they are things this screen does
   * to the note that is open — so the row asks the screen, through
   * ChromeContext, and only while this screen is the focused one. Test and AI
   * are not here: Test is a plain navigate to the builder carrying this note's
   * id, and AI is the app's own companion door, both of which the registry
   * plans on its own.
   *
   * Plain functions, deliberately not memoised: `useScreenActions` reads them
   * through a ref on every render, so a handler can never close over a stale
   * `shortForOneCredit` or a note that has since been swapped.
   */
  const scrollToLearnPanel = () => {
    // The panel is a direct child of the scroller's content, so its layout y
    // IS the offset that puts its heading at the top of the viewport.
    scrollRef.current?.scrollTo({ y: learnPanelY.current, animated: true });
  };

  const makeCardsFromNote = () => {
    // The same work the "Turn into → Flashcards" tile does, and the same
    // refusals — but the tile prints its cost and its disabled reason before
    // the tap and a row item cannot, so the one refusal the handler does not
    // already make out loud is made here.
    if (shortForOneCredit) {
      scrollToLearnPanel();
      appAlert(
        'No AI uses left today',
        noCreditsLeftMessage(AI_CREDIT_COSTS.generate_flashcards, aiUsage)
      );
      return;
    }
    if (isAILoading) return;
    // A row item is a NAME, not a price: on device, tapping "Cards" spent an
    // AI use instantly, with nothing said before or after — a student who
    // read it as "show me this note's cards" was charged for a generation
    // they never asked for. Every other priced door in this app prints its
    // cost on the control; this one cannot, so it asks. The tile in the Learn
    // panel, which does print its cost, still runs on one press.
    void (async () => {
      const confirmed = await confirmAsync(
        'Make flashcards from this note?',
        makeCardsConfirmMessage(AI_CREDIT_COSTS.generate_flashcards, aiUsage),
        { confirmLabel: 'Make flashcards' }
      );
      if (!confirmed) return;
      handleGenerateFlashcards();
    })();
  };

  useScreenActions('NoteEditor', {
    // The ids are the registry's `ContextualScreenAction` values, not the row
    // item ids: what the screen offers is named by what it DOES.
    noteLearn: scrollToLearnPanel,
    // A note the reader cannot edit has no "Turn into" section at all, so the
    // row's Cards press falls through to nothing rather than to an alert.
    noteFlashcards: canEdit ? makeCardsFromNote : undefined,
  });

  const handleDelete = async () => {

    // Mirror web App.tsx's onDelete: never delete without confirmation, and
    // never orphan an active lecture recording that points at this note.
    const lecture = useLectureRecordingStore.getState();
    if (lecture.noteId === noteId && lecture.status !== 'idle') {
      const ok = await confirmSheet({
        title: 'Recording in progress',
        message:
          'This note has an active lecture recording. Delete the note and discard the recording?',
        confirmLabel: 'Discard & delete',
        danger: true,
      });
      if (!ok) return;
      await lecture.discard();
    } else {
      const ok = await confirmSheet({
        title: 'Delete note',
        message: 'Delete this note? This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
    }

    cancelPendingSave();

    await removeNote(noteId);

    navigation.goBack();

  };

  /** A note nobody may edit can only ever be read; see the `mode` comment. */
  const reading = mode === 'read' || !canEdit;

  /**
   * Done is a commit, not just a mode flip: the autosave timer may still be
   * holding the last keystrokes, so cancel it and write once, now. Leaving the
   * body untouched writes nothing — this must not mint a revision per toggle.
   */
  const handleDoneEditing = () => {
    cancelPendingSave();
    setMode('read');
    if (!canEdit) return;
    if (selectedNote && title === selectedNote.title && body === selectedNote.body) return;
    void saveNote(noteId, { title, body }).catch(() => {});
  };

  const handleCopy = async () => {
    try {
      const copy = await copyNote(noteId);
      navigation.navigate('NoteEditor', { noteId: copy.id });
    } catch (error) {
      appAlert('Could not make a copy', error instanceof Error ? error.message : 'Try again.');
    }
  };



  if (isLoading && !selectedNote) {

    return (

      <Screen bottom="none">

        <View className="flex-1 items-center justify-center">

          <ActivityIndicator size="large" color={brand.text} />

        </View>

      </Screen>

    );

  }



  return (

    <Screen bottom="none" keyboard>

      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface">

        <Pressable hitSlop={10}

          onPress={() => navigation.goBack()}

          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"

          accessibilityLabel="Back to notes"

        >

          <AppIcon name="arrow-back" size={24} color="#475569" />

        </Pressable>

        <TextInput

          value={title}

          onChangeText={setTitle}
          editable={canEdit}

          placeholder="Note title"
          accessibilityLabel="Note title"

          placeholderTextColor="#94a3b8"

          className="flex-1 text-base font-semibold text-lantern-text"

        />

        {isSaving && canEdit ? (

          <Text className="text-xs text-lantern-text-tertiary shrink-0">Saving...</Text>

        ) : null}

        {/* The one control that switches the body between the reading view and
            the editor. It is a header control rather than a floating button so
            it cannot scroll away from a long note. */}
        {canEdit ? (
          <Pressable
            hitSlop={8}
            onPress={() => (reading ? setMode('edit') : handleDoneEditing())}
            className="px-2 py-2 rounded-lg shrink-0 active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
            accessibilityRole="button"
            accessibilityLabel={reading ? 'Edit note' : 'Done editing'}
          >
            <Text className="text-sm font-semibold text-lantern-primary-text">
              {reading ? 'Edit' : 'Done'}
            </Text>
          </Pressable>
        ) : null}

        {isOwner ? (
        <Pressable
          onPress={() =>
            (navigation as unknown as {
              navigate: (screen: string, params?: Record<string, unknown>) => void;
            }).navigate('MarketTab', toTab('StudyProductDrafts', { source: { noteIds: [noteId], title: title || selectedNote?.title } }))
          }
          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
          accessibilityLabel="Turn into a Study Product"
        >
          <AppIcon name="storefront" size={20} color={brand.text} />
        </Pressable>
        ) : null}

        {canEdit ? (
        <Pressable
          onPress={() => coverPicker.open()}
          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
          accessibilityLabel={noteCoverPath ? 'Change cover image' : 'Add cover image'}
        >
          <AppIcon name="image" size={20} color={brand.text} />
        </Pressable>
        ) : null}

        {isOwner ? (
        <Pressable
          onPress={() => setShowCollaborators(true)}
          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
          accessibilityLabel="Manage collaborators"
        >
          <AppIcon name="people" size={20} color={brand.text} />
        </Pressable>
        ) : null}

        {isOwner ? (
        <Pressable

          onPress={handleDelete}

          className="p-2 rounded-lg active:bg-red-50 dark:active:bg-red-900/20"

          accessibilityLabel="Delete note"

        >

          <AppIcon name="trash" size={20} color="#ef4444" />

        </Pressable>
        ) : null}

      </View>



      {/* Banner first, the note's own title sits in the header above it and
          its body below — 16:5 so a cover never costs the reader a screen of
          the note they opened. */}
      <CoverBanner
        coverPath={noteCoverPath}
        pendingUri={coverPicker.pendingUri}
        accessibilityLabel="Note cover image"
      />
      <CoverFailureLine failure={coverPicker.failure} onDismiss={coverPicker.dismissFailure} />

      <CoverPicker controller={coverPicker} title="Note cover" />

      {/* Keyboard handling moved up to <Screen keyboard>: this screen sits
          under the in-flow TopBar, and RN's KeyboardAvoidingView measures its
          own frame PARENT-relative, so a KAV here under-lifted by the whole
          height of the chrome above it. `Screen` measures its window position
          and feeds that back as keyboardVerticalOffset. */}
      <View className="flex-1">

        <ScrollView
          ref={scrollRef}
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="p-4"
          onLayout={event => {
            const height = event.nativeEvent.layout.height;
            setScrollViewportHeight(prev => (prev === height ? prev : height));
          }}
          // Enough tail for the Learn panel's heading to reach the TOP when the
          // contextual row's Learn item scrolls to it — it is the last content
          // in the note, so without this the scroll stopped at the end of the
          // document and left the panel in the bottom half (16-note-learn.png).
          // Never less than the chrome clearance; see noteLearnScroll.ts.
          contentContainerStyle={{
            paddingBottom: learnTailPadding({
              base: tabBarClearance,
              viewportHeight: scrollViewportHeight,
              panelHeight: learnPanelHeight,
            }),
          }}
          scrollEnabled={parentScrollEnabled}
          nestedScrollEnabled
          directionalLockEnabled
        >

          {!isOwner ? (
            <Card className="mb-4 border-lantern-primary/30">
              <Text className="text-sm font-medium text-lantern-text">
                {canEdit
                  ? 'You are editing a shared note.'
                  : 'You have view-only access to this note.'}
              </Text>
              <Button size="sm" className="mt-3 self-start" variant="secondary" onPress={() => void handleCopy()}>
                Make a copy
              </Button>
            </Card>
          ) : null}

          {/* The pre-flight card. It sits above the controls while the mic is
              live on THIS note, so the three things that decide whether the
              transcript is any good — permission, level, connection — are
              readings on screen rather than assumptions. */}
          {isRecording ? <View className="mb-3"><LecturePreflightCard /></View> : null}

          {/* The live recording controls. They appear only once a session on
              THIS note is running: the door into recording is the "Turn into"
              row below, so an idle note no longer shows two ways in. */}
          {canEdit && (isRecording || transcribing) ? <View className="flex-row flex-wrap gap-2 py-2 mb-2">

            <Button

              size="sm"

              variant={isRecording ? 'danger' : 'secondary'}

              onPress={handleRecordPress}

              disabled={
                transcribing ||
                (isRecording && recordingSeconds * 1000 < MIN_MOBILE_LECTURE_RECORD_MS)
              }

            >

              {transcribing
                ? lectureStatus === 'uploading'
                  ? 'Uploading...'
                  : 'Transcribing...'
                : recordingSeconds < 2
                  ? `Wait ${2 - recordingSeconds}s`
                  : 'Stop & name'}

            </Button>

            {isRecording ? (
              <>
                <Button size="sm" variant="ghost" onPress={() => void discardRecording()}>
                  Cancel
                </Button>
                <View className="flex-row items-center gap-2 self-center">
                  <View className="w-2 h-2 rounded-full bg-red-500" />
                  <Text className="text-xs text-red-500">
                    Recording {formatRecordingDuration(recordingSeconds)}
                  </Text>
                </View>
              </>
            ) : null}

            {transcribing ? (
              <Button size="sm" variant="ghost" onPress={cancelTranscription}>
                Cancel
              </Button>
            ) : null}

          </View> : null}

          {/* The Learn panel replaces what used to be TWO learn surfaces on
              this screen: a "Turn into" tile grid here, and a card of small
              buttons at the bottom offering the same four generations again.
              One panel now, at the bottom, which is where the contextual row's
              Learn item has always scrolled — see components/notes/NoteLearnPanel. */}


          {/* Academic archive: file this note under a course (owner/editor only). */}
          {selectedNote && (canEdit || selectedNote.courseId) ? (
            <View className="mb-4">
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-1">Course</Text>
              <CoursePicker
                value={selectedNote.courseId ?? null}
                disabled={!canEdit}
                onChange={course => {
                  const nextCourseId = course?.id ?? null;
                  // A topic belongs to one course, so moving the note drops it.
                  const nextTopicId = topicIdAfterCourseChange(
                    selectedNote.topicId ?? null,
                    selectedNote.courseId ?? null,
                    nextCourseId
                  );
                  setSelectedNote({ ...selectedNote, courseId: nextCourseId, topicId: nextTopicId });
                  saveNote(noteId, { courseId: nextCourseId, topicId: nextTopicId }).catch(() => {});
                }}
                placeholder="File this note under a course (optional)"
                title="Course for this note"
              />
              <View className="mt-2">
                <Text className="text-xs font-semibold text-lantern-text-secondary mb-1">Topic</Text>
                <TopicPicker
                  courseId={selectedNote.courseId ?? null}
                  value={selectedNote.topicId ?? null}
                  disabled={!canEdit}
                  onChange={topic => {
                    const nextTopicId = topic?.id ?? null;
                    setSelectedNote({ ...selectedNote, topicId: nextTopicId });
                    saveNote(noteId, { topicId: nextTopicId }).catch(() => {});
                  }}
                  placeholder="Which part of the syllabus? (optional)"
                  title="Topic for this note"
                />
              </View>
            </View>
          ) : null}

          {showNoteTabs ? (
            <View className="mb-4">
              <LectureTabs
                noteId={noteId}
                source={lectureTabSource}
                noteTitle={title || selectedNote?.title}
                /*
                  The Library door onto the same lecture. A recording made in
                  the studio — or on the laptop — shows here as the same stamped
                  cards and the same per-segment players, because both doors
                  read the note's own rows.
                */
                segments={lectureSegmentsNoteId === noteId ? lectureSegments : []}
                onRetrySegment={(seq) => void retryLectureSegment(seq)}
                recording={false}
                tab={requestedTab}
                onTabChange={setRequestedTab}
                renderNotes={({ typed }) =>
                  reading ? (
                    <Pressable
                      onPress={canEdit ? () => setMode('edit') : undefined}
                      accessibilityRole={canEdit ? 'button' : undefined}
                      accessibilityLabel="Typed lecture notes"
                    >
                      <NoteBody
                        body={typed}
                        emptyLine={
                          canEdit
                            ? isLectureSurface
                              ? 'Type during class. The transcript stays on its own tab.'
                              : 'No notes of your own yet. Tap Edit to add some.'
                            : 'No notes of their own here.'
                        }
                      />
                    </Pressable>
                  ) : (
                    <TextInput
                      value={typed}
                      onChangeText={handleTypedNotesChange}
                      onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
                      editable={canEdit}
                      accessibilityLabel="Typed lecture notes"
                      placeholder={
                        isLectureSurface
                          ? 'Type during class. The transcript stays on its own tab.'
                          : isPhotoNote
                            ? 'Add your own notes alongside these photos...'
                            : isYoutubeNote
                              ? 'Add your own notes alongside this video transcript...'
                              : 'Add your own notes on top of this document...'
                      }
                      placeholderTextColor="#94a3b8"
                      multiline
                      textAlignVertical="top"
                      className="w-full min-h-[160px] p-4 rounded-xl border border-lantern-border bg-lantern-surface text-body leading-relaxed text-lantern-text"
                    />
                  )
                }
                renderEnhanced={({ enhanced }) => (
                  <View className="gap-3">
                    {canEdit ? (
                      <SmartNoteComposeFields
                        sources={availableSources.map((source) => source.id)}
                        selectedSources={selectedSources}
                        onToggleFilter={(id) => {
                          setSelectedSources((current) =>
                            toggleSmartNoteFilter(
                              id,
                              current,
                              availableSources.map((source) => source.id)
                            )
                          );
                        }}
                        guidance={smartNotesGuidance}
                        onGuidanceChange={setSmartNotesGuidance}
                        depth={smartNotesDepth}
                        onDepthChange={setSmartNotesDepth}
                        summarizing={summarizing}
                        shortForSmartNote={shortForSmartNote}
                        writeDisabled={!synthesizeReady}
                        onWrite={() => void handleSummarize()}
                      />
                    ) : null}
                    <T.Label>Enhanced notes</T.Label>
                    <View className="min-h-[140px] rounded-xl border border-lantern-border bg-lantern-surface p-3">
                      <NoteBody body={enhanced} emptyLine="No enhanced notes yet." />
                    </View>
                  </View>
                )}
                renderMaterials={() => (
                  <View className="gap-3">
                    {walkthroughAttachmentId ? (
                      <View className="gap-2">
                        <Button size="sm" variant="secondary" onPress={handleWalkthrough}>
                          Walk me through it
                        </Button>
                        <Button size="sm" variant="secondary" onPress={handleReadAloud}>
                          Read it to me
                        </Button>
                      </View>
                    ) : null}
                    {documentAttachment ? (
                      <NotePdfViewer
                        noteId={noteId}
                        attachment={documentAttachment}
                        onScrollLockChange={handleDocumentScrollLock}
                      />
                    ) : null}
                    {showImageGallery && imageAttachments.length > 0 ? (
                      <ErrorBoundary fallbackTitle="Photos failed to load">
                        <NoteImageGallery
                          noteId={noteId}
                          attachments={imageAttachments}
                          editable={isPhotoNote && canEdit}
                          onAttachmentsChange={handleImageAttachmentsChange}
                          onAddPhotos={isPhotoNote && canEdit ? handleAddPhotos : undefined}
                          onAskAboutFigure={handleAskFigure}
                        />
                      </ErrorBoundary>
                    ) : null}
                    {selectedNote?.youtubeVideoId ? (
                      <Pressable
                        onPress={() =>
                          void Linking.openURL(
                            selectedNote.youtubeUrl ||
                              `https://www.youtube.com/watch?v=${selectedNote.youtubeVideoId}`
                          )
                        }
                        className="rounded-xl border border-lantern-border bg-lantern-background-secondary p-4 flex-row items-center gap-3"
                      >
                        <AppIcon name="logo-youtube" size={28} color="#ef4444" />
                        <View className="flex-1">
                          <Text className="text-sm font-medium text-lantern-text">
                            Linked YouTube video
                          </Text>
                          <Text className="text-xs text-lantern-primary-text mt-1">
                            Tap to open in YouTube
                          </Text>
                        </View>
                      </Pressable>
                    ) : null}
                    {isYoutubeNote ? (
                      <View className="rounded-xl border border-lantern-border bg-lantern-surface p-4">
                        <View className="flex-row items-start justify-between gap-3">
                          <View className="flex-1">
                            <Text className="text-sm font-semibold text-lantern-text">
                              {youtubeTranscriptStatus === 'ready'
                                ? 'Video transcript'
                                : youtubeTranscriptStatus === 'processing' || retryingYoutubeTranscript
                                  ? 'Fetching transcript…'
                                  : 'Transcript unavailable'}
                            </Text>
                            <Text className="text-xs text-lantern-text-secondary mt-1">
                              {youtubeTranscriptStatus === 'ready'
                                ? 'Ready for Smart Notes, flashcards, and chat.'
                                : youtubeTranscriptStatus === 'processing' || retryingYoutubeTranscript
                                  ? 'We’ll use this transcript for Smart Notes and other AI study tools.'
                                  : youtubeTranscriptError ||
                                    'We couldn’t fetch captions for this video. Private videos, disabled captions, and some rate limits can block import.'}
                            </Text>
                          </View>
                          {(youtubeTranscriptStatus === 'failed' ||
                            youtubeTranscriptStatus === 'missing') &&
                          canEdit ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={retryingYoutubeTranscript}
                              onPress={() => void handleRetryYoutubeTranscript()}
                            >
                              Retry
                            </Button>
                          ) : null}
                          {youtubeTranscriptStatus === 'ready' && youtubeTranscriptText ? (
                            <Pressable onPress={() => setYoutubeTranscriptExpanded((v) => !v)}>
                              <Text className="text-xs font-medium text-lantern-primary-text">
                                {youtubeTranscriptExpanded ? 'Hide' : 'Show'}
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                        {(youtubeTranscriptStatus === 'processing' || retryingYoutubeTranscript) && (
                          <View className="flex-row items-center gap-2 mt-3">
                            <ActivityIndicator size="small" color="#0ea5e9" />
                            <Text className="text-xs text-lantern-text-tertiary">
                              Pulling captions from YouTube…
                            </Text>
                          </View>
                        )}
                        {youtubeTranscriptStatus === 'ready' &&
                        youtubeTranscriptExpanded &&
                        youtubeTranscriptText ? (
                          <ScrollView
                            nestedScrollEnabled
                            style={{ maxHeight: 224 }}
                            className="mt-3 rounded-lg border border-lantern-border bg-lantern-background-secondary p-3"
                          >
                            <Text className="text-xs leading-relaxed text-lantern-text-secondary">
                              {youtubeTranscriptText}
                            </Text>
                          </ScrollView>
                        ) : null}
                      </View>
                    ) : null}
                    {extractionMessage &&
                    (selectedNote?.sourceType === 'pdf' ||
                      selectedNote?.sourceType === 'presentation' ||
                      isPhotoNoteSource(selectedNote?.sourceType)) ? (
                      <View className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                        <Text className="text-sm text-lantern-text mb-2">
                          {runningOcr || extractionStatus === 'ocr_processing'
                            ? 'Running local OCR…'
                            : extractionMessage}
                        </Text>
                        {(extractionStatus === 'needs_ocr' ||
                          extractionStatus === 'empty' ||
                          extractionStatus === 'ocr_failed') &&
                        canEdit ? (
                          <Button
                            onPress={() => {
                              if (!selectedNote || runningOcr) return;
                              setRunningOcr(true);
                              void runNoteOcr(selectedNote.id)
                                .then((result) => {
                                  const prev = useNotesStore.getState().selectedNote;
                                  if (!prev || prev.id !== selectedNote.id) return;
                                  setSelectedNote({
                                    ...prev,
                                    attachments: result.attachments?.length
                                      ? [
                                          ...(prev.attachments || []).filter((a) => a.type !== 'image'),
                                          ...result.attachments,
                                        ]
                                      : prev.attachments?.map((a) =>
                                          a.id === result.attachment.id ? result.attachment : a
                                        ) ?? [result.attachment],
                                  });
                                  if (result.status === 'failed') {
                                    appAlert('OCR failed', result.ocrError || 'Local OCR failed.');
                                  }
                                })
                                .catch((err: unknown) => {
                                  appAlert(
                                    'OCR failed',
                                    err instanceof Error ? err.message : 'Failed to run OCR'
                                  );
                                })
                                .finally(() => setRunningOcr(false));
                            }}
                            disabled={runningOcr}
                          >
                            {runningOcr
                              ? 'Running OCR…'
                              : `Run OCR · ${formatCreditCost(AI_CREDIT_COSTS.note_ocr)}`}
                          </Button>
                        ) : null}
                      </View>
                    ) : null}
                    {isDocumentNote && !documentAttachment ? (
                      <Text className="text-sm text-lantern-text-secondary">
                        {selectedNote?.sourceType === 'presentation'
                          ? extractionStatus === 'ok'
                            ? 'Slide preview is unavailable. Extracted text is available for AI tools.'
                            : 'Slide preview is unavailable. Extracted text may be missing — run OCR or add notes.'
                          : 'Document preview is unavailable.'}
                        {presentationAttachment?.fileName ? ` (${presentationAttachment.fileName})` : ''}
                      </Text>
                    ) : null}
                  </View>
                )}
              />
            </View>
          ) : reading ? (
            /* The reading view for a plain note: the shared block renderer the
               studios use, so a heading is a heading and a table is a table.
               Tapping it is the second way into the editor. */
            <Pressable
              onPress={canEdit ? () => setMode('edit') : undefined}
              accessibilityRole={canEdit ? 'button' : undefined}
              accessibilityLabel="Note body"
              className="mb-4"
            >
              <NoteBody
                body={body}
                emptyLine={
                  canEdit
                    ? 'This note is empty. Tap Edit to start writing.'
                    : 'This note is empty.'
                }
              />
            </Pressable>
          ) : (
          <TextInput

            value={body}

            onChangeText={setBody}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            editable={canEdit}
            accessibilityLabel="Note body"

            placeholder="Start typing your notes... Use headings, lists, and structure for better AI study tools."

            placeholderTextColor="#94a3b8"

            multiline

            textAlignVertical="top"

            className="w-full min-h-[280px] p-4 rounded-xl border border-lantern-border bg-lantern-surface text-sm leading-relaxed text-lantern-text mb-4"

          />
          )}

          {askHighlightReady ? (
            <Pressable
              onPress={handleAskHighlight}
              accessibilityRole="button"
              accessibilityLabel="Ask about the highlighted span"
              className="mb-4 min-h-[44px] justify-center"
            >
              <T.Body>Ask about selection</T.Body>
              <T.Caption tone="secondary">Lantern will cite the highlighted span.</T.Caption>
            </Pressable>
          ) : null}



          {summary ? (

            <Card className="mb-4 border-lantern-primary/30 dark:border-lantern-primary/30 bg-lantern-primary-background dark:bg-lantern-primary-background">

              <Text className="text-sm font-semibold text-lantern-primary-dark dark:text-lantern-primary-light mb-2">Smart Notes</Text>

              <MarkdownRenderer
                content={summary}
                enableMath={false}
                style={{ color: colors.text, fontSize: 14, lineHeight: 22 }}
              />

            </Card>

          ) : null}



          {canEdit ? <View
            // Where the row's Learn item scrolls to. A direct child of the
            // scroller's content, so `y` needs no conversion.
            onLayout={event => {
              const { y, height } = event.nativeEvent.layout;
              learnPanelY.current = y;
              setLearnPanelHeight(prev => (prev === height ? prev : height));
            }}
          >
            <NoteLearnPanel
              guidance={smartNotesGuidance}
              onGuidanceChange={setSmartNotesGuidance}
              depth={smartNotesDepth}
              onDepthChange={setSmartNotesDepth}
              canGenerate={canGenerateStudyMaterials}
              shortForOneCredit={shortForOneCredit}
              shortForSmartNote={shortForSmartNote}
              isAILoading={isAILoading}
              summarizing={summarizing}
              recordBlockedReason={recordBlockedReason}
              walkthroughAttachmentId={walkthroughAttachmentId}
              walkthroughPending={extractionStatus === 'ocr_processing'}
              documentPageCount={documentPageCount}
              narrationReady={narrationReady}
              onFlashcards={handleGenerateFlashcards}
              onTest={handleGenerateQuiz}
              onSmartNotes={() => {
                setSmartNoteOpen(true);
                setRequestedTab('enhanced');
              }}
              smartNoteOpen={smartNoteOpen && !showNoteTabs}
              sources={availableSources.map((source) => source.id)}
              selectedSources={selectedSources}
              onToggleFilter={(id) => {
                setSelectedSources((current) =>
                  toggleSmartNoteFilter(
                    id,
                    current,
                    availableSources.map((source) => source.id)
                  )
                );
              }}
              onWriteSmartNotes={() => void handleSummarize()}
              writeDisabled={!synthesizeReady}
              hideDocumentActions={Boolean(walkthroughAttachmentId && showNoteTabs)}
              onRecord={handleRecordPress}
              onChat={handleChatWithNote}
              onWalkthrough={handleWalkthrough}
              onReadAloud={handleReadAloud}
            />
          </View> : null}

        </ScrollView>

      </View>

      <NoteCollaboratorsModal
        visible={showCollaborators}
        noteId={noteId}
        noteTitle={selectedNote?.title}
        currentUserId={user?.id}
        onClose={() => setShowCollaborators(false)}
      />

      {/* Wave G: reports whichever generation this screen started, and can be
          swiped away without stopping it. */}
      <JobProgressSheet />

    </Screen>

  );

}



export default NoteEditorScreen;


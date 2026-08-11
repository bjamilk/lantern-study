import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import {
  FlashcardType,
  getAttachmentExtractionStatus,
  getExtractionStatusMessage,
  getNoteStudyContent,
  hasEnoughNoteStudyContent,
  MarkdownRenderer,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from '@lantern/shared';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useCompanionStore } from '../../stores/companionStore';
import { useNotesStore } from '../../stores/notesStore';
import { useTheme } from '../../theme';


import {
  copyNote,
  fetchNote,
  summarizeNote,
  generateNoteQuiz,
  addImagesToPhotoNote,
  retryYoutubeTranscript,
  runNoteOcr,
  waitForNoteOcr,
} from '../../services/notes';

import { useAIHandlers } from '../../hooks/useAIHandlers';

import { Button, Card } from '../../components/ui';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { NotePdfViewer } from '../../components/NotePdfViewer';
import { NoteImageGallery } from '../../components/NoteImageGallery';
import { NoteCollaboratorsModal } from '../../components/NoteCollaboratorsModal';
import AIUsageBadge from '../../components/AIUsageBadge';
import { getLatestAIUsage, subscribeToAIUsage } from '../../services/ai';
import { SMART_NOTES_CREDIT_COST } from '@lantern/shared/utils/aiCredits';
import { SMART_NOTES_GUIDANCE_MAX_CHARS } from '@lantern/shared/utils/smartNotes';
import { useAuthStore } from '../../stores/authStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import {
  formatRecordingDuration,
  getElapsedRecordingSeconds,
  MIN_MOBILE_LECTURE_RECORD_MS,
  useLectureRecordingStore,
} from '../../stores/lectureRecordingStore';
import * as ImagePicker from 'expo-image-picker';
import type { NoteAttachment } from '../../services/notes';

type NavigationProp = {

  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;

};



interface Props {

  navigation: NavigationProp;

  route: { params: { noteId: string } };

}



export function NoteEditorScreen({ navigation, route }: Props) {

  const noteId = route.params.noteId;
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const { selectedNote, isLoading, isSaving, loadNote, saveNote, removeNote, setSelectedNote } = useNotesStore();

  const { handleAIGenerateFlashcards, isAILoading } = useAIHandlers();



  const [title, setTitle] = useState('');

  const [body, setBody] = useState('');

  const [summary, setSummary] = useState('');

  const lectureStatus = useLectureRecordingStore((s) => s.status);
  const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
  const lectureStartedAt = useLectureRecordingStore((s) => s.startedAt);
  const lectureTick = useLectureRecordingStore((s) => s.tick);
  const startLectureRecording = useLectureRecordingStore((s) => s.start);
  const stopLectureRecording = useLectureRecordingStore((s) => s.stopAndTranscribe);
  const discardLectureRecording = useLectureRecordingStore((s) => s.discard);
  const cancelLectureTranscription = useLectureRecordingStore((s) => s.cancelTranscription);
  const setCurrentBodyProvider = useLectureRecordingStore((s) => s.setCurrentBodyProvider);
  const isRecording = lectureNoteId === noteId && lectureStatus === 'recording';
  const transcribing =
    lectureNoteId === noteId &&
    (lectureStatus === 'uploading' || lectureStatus === 'transcribing');
  const recordingSeconds = isRecording ? getElapsedRecordingSeconds(lectureStartedAt) : 0;
  void lectureTick;
  const pauseAutosaveUntilRef = useRef(0);
  const AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS = 4000;
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const [summarizing, setSummarizing] = useState(false);

  const [smartNotesGuidance, setSmartNotesGuidance] = useState('');

  const [smartNotesDepth, setSmartNotesDepth] =
    useState<import('@lantern/shared/utils/smartNotes').SmartNotesDepth>('standard');

  const [aiUsage, setAiUsage] = useState(getLatestAIUsage());

  useEffect(() => subscribeToAIUsage(setAiUsage), []);

  const remainingCredits = Math.max(0, aiUsage.remaining);
  const shortForSmartNote =
    aiUsage.limit > 0 && remainingCredits < SMART_NOTES_CREDIT_COST[smartNotesDepth];
  const shortForOneCredit = aiUsage.limit > 0 && remainingCredits < 1;

  const [generatingQuiz, setGeneratingQuiz] = useState(false);

  const [generatingCards, setGeneratingCards] = useState(false);
  const [retryingYoutubeTranscript, setRetryingYoutubeTranscript] = useState(false);
  const [youtubeTranscriptExpanded, setYoutubeTranscriptExpanded] = useState(true);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [parentScrollEnabled, setParentScrollEnabled] = useState(true);
  const tabBarClearance = useTabBarClearance(16);
  const openCompanionWithMessage = useCompanionStore(s => s.openWithMessage);
  const handleDocumentScrollLock = useCallback((locked: boolean) => {
    setParentScrollEnabled(!locked);
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDocumentNote =
    selectedNote?.sourceType === 'pdf' || selectedNote?.sourceType === 'presentation';
  const isYoutubeNote =
    selectedNote?.sourceType === 'youtube' || Boolean(selectedNote?.youtubeVideoId);
  const isPhotoNote = selectedNote?.sourceType === 'photos';
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

  const presentationAttachment = useMemo(
    () => selectedNote?.attachments?.find((a) => a.type === 'presentation'),
    [selectedNote?.attachments]
  );

  const documentSourceAttachment = useMemo(
    () =>
      selectedNote?.attachments?.find((a) => a.type === 'pdf') || presentationAttachment,
    [selectedNote?.attachments, presentationAttachment]
  );

  const extractionStatus = getAttachmentExtractionStatus(documentSourceAttachment);
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

  const handleImageAttachmentsChange = (attachments: NoteAttachment[]) => {
    if (!selectedNote) return;
    const other = (selectedNote.attachments || []).filter((a) => a.type !== 'image');
    setSelectedNote({ ...selectedNote, attachments: [...other, ...attachments] });
  };

  const handleAddPhotos = () => {
    if (!selectedNote || addingPhotos) return;
    Alert.alert('Add photos', 'Choose a source', [
      {
        text: 'Photo library',
        onPress: () => {
          void (async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission required', 'Photo library access is needed.');
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
              Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not add photos');
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
              Alert.alert('Permission required', 'Camera access is needed.');
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
              Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not add photo');
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
    if (selectedNote.sourceType !== 'pdf' && selectedNote.sourceType !== 'presentation') return;
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
          attachments:
            prev.attachments?.map((a) =>
              a.id === result.attachment.id ? result.attachment : a
            ) ?? [result.attachment],
        });
        if (result.status === 'failed') {
          Alert.alert('OCR failed', result.ocrError || 'Local OCR failed.');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        Alert.alert('OCR failed', err instanceof Error ? err.message : 'OCR timed out');
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
  }, [selectedNote, noteId]);

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
      Alert.alert(
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
              void discardLectureRecording().then(() => {
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

  const discardRecording = () => {
    void discardLectureRecording();
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
        Alert.alert(
          'Transcript unavailable',
          result.transcriptError ||
            'Still could not fetch a transcript for this video.'
        );
      }
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Transcript retry failed');
    } finally {
      setRetryingYoutubeTranscript(false);
    }
  };

  const handleSummarize = async () => {

    if (!studyContent.trim()) {

      Alert.alert(
        'Empty note',
        isYoutubeNote
          ? 'Wait for the video transcript, or add your own notes, before summarizing.'
          : 'Add some content before summarizing.'
      );

      return;

    }

    setSummarizing(true);

    try {

      await saveNote(noteId, { title, body });

      const result = await summarizeNote(noteId, {
        guidance: smartNotesGuidance.trim() || undefined,
        depth: smartNotesDepth,
      });

      const newSummary = result.summary || result.note?.summary || '';

      setSummary(newSummary);

      if (result.note?.body != null) {
        setBody(result.note.body);
        pauseAutosaveUntilRef.current = Date.now() + AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS;
      }

      if (result.note) {
        const prev = useNotesStore.getState().selectedNote;
        if (prev?.id === noteId) {
          setSelectedNote({ ...prev, ...result.note, summary: newSummary });
        }
      }

    } catch (e: unknown) {

      Alert.alert('Error', e instanceof Error ? e.message : 'Summarize failed');

    } finally {

      setSummarizing(false);

    }

  };



  const handleChatWithNote = () => {
    // Same prompt web builds in hooks/useNoteHandlers.ts so the companion gets
    // the note's content either way, rather than being opened empty.
    const noteTitle = title || selectedNote?.title || 'Untitled Note';
    openCompanionWithMessage(
      studyContent.trim().length >= MIN_NOTE_STUDY_CONTENT_CHARS
        ? `Help me study my note "${noteTitle}". Ask me questions and explain key concepts from this material:\n\n${studyContent.slice(0, 4000)}`
        : `I want to study my note "${noteTitle}". Ask me questions about it or help me understand key concepts based on this material.`
    );
  };

  const handleGenerateFlashcards = async () => {
    if (!canGenerateStudyMaterials) {
      Alert.alert(
        'Not enough content',
        'Add at least 50 characters of study content. For presentations, wait for slide text extraction or add your own notes.'
      );
      return;
    }
    if (!user?.id) {
      Alert.alert('Error', 'You must be signed in to generate flashcards.');
      return;
    }
    setGeneratingCards(true);
    try {
      // Same count as web's deck-from-note path; 5 was below the supported
      // minimum of 10 and got clamped anyway.
      const cards = await handleAIGenerateFlashcards(studyContent.slice(0, 8000), {
        count: normalizeFlashcardCount(),
        style: 'concise',
      });
      if (!cards.length) {
        throw new Error('Could not generate flashcards from this note.');
      }

      // Persist into a deck the same way web does — generating without saving
      // spends AI credits and leaves the user with nothing to study.
      const noteTitle = title || selectedNote?.title || 'Untitled Note';
      const { createDeck, createFlashcard } = useFlashcardStore.getState();
      const deck = await createDeck(
        `From: ${noteTitle}`.slice(0, 80),
        `Generated from note: ${noteTitle}`,
        user.id
      );
      for (const card of cards) {
        await createFlashcard({
          deckId: deck.id,
          type: FlashcardType.BASIC,
          front: card.front,
          back: card.back,
          userId: user.id,
        });
      }

      Alert.alert('Generated', `Created ${cards.length} flashcards in "${deck.name}".`, [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Open deck',
          onPress: () =>
            navigation.navigate('DeckDetail', { deckId: deck.id, deckName: deck.name }),
        },
      ]);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Flashcard generation failed');
    } finally {
      setGeneratingCards(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!canGenerateStudyMaterials) {
      Alert.alert(
        'Not enough content',
        'Add at least 50 characters of study content. For presentations, wait for slide text extraction or add your own notes.'
      );
      return;
    }

    setGeneratingQuiz(true);

    try {

      await saveNote(noteId, { title, body });

      await generateNoteQuiz(noteId, 'retention', 5);

      Alert.alert('Quiz ready', 'A quiz was generated from this note.');

    } catch (e: unknown) {

      Alert.alert('Error', e instanceof Error ? e.message : 'Quiz generation failed');

    } finally {

      setGeneratingQuiz(false);

    }

  };



  const handleDelete = async () => {

    await removeNote(noteId);

    navigation.goBack();

  };

  const handleCopy = async () => {
    try {
      const copy = await copyNote(noteId);
      navigation.navigate('NoteEditor', { noteId: copy.id });
    } catch (error) {
      Alert.alert('Could not make a copy', error instanceof Error ? error.message : 'Try again.');
    }
  };



  if (isLoading && !selectedNote) {

    return (

      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center">

        <ActivityIndicator size="large" color="#6366f1" />

      </SafeAreaView>

    );

  }



  return (

    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>

      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface">

        <Pressable

          onPress={() => navigation.goBack()}

          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"

          accessibilityLabel="Back to notes"

        >

          <Ionicons name="arrow-back" size={22} color="#475569" />

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

        {isOwner ? (
        <Pressable
          onPress={() => setShowCollaborators(true)}
          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
          accessibilityLabel="Manage collaborators"
        >
          <Ionicons name="people-outline" size={20} color="#6366f1" />
        </Pressable>
        ) : null}

        {isOwner ? (
        <Pressable

          onPress={handleDelete}

          className="p-2 rounded-lg active:bg-red-50 dark:active:bg-red-900/20"

          accessibilityLabel="Delete note"

        >

          <Ionicons name="trash-outline" size={20} color="#ef4444" />

        </Pressable>
        ) : null}

      </View>



      <KeyboardAvoidingView

        className="flex-1"

        behavior={Platform.OS === 'ios' ? 'padding' : undefined}

      >

        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="p-4"
          contentContainerStyle={{ paddingBottom: tabBarClearance }}
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

          {canEdit ? <View className="flex-row flex-wrap gap-2 py-2 mb-2">

            <Button

              size="sm"

              variant={isRecording ? 'danger' : 'secondary'}

              onPress={handleRecordPress}

              disabled={
                transcribing ||
                (isRecording && recordingSeconds * 1000 < MIN_MOBILE_LECTURE_RECORD_MS) ||
                (lectureStatus !== 'idle' && lectureNoteId !== noteId)
              }

            >

              {transcribing
                ? lectureStatus === 'uploading'
                  ? 'Uploading...'
                  : 'Transcribing...'
                : isRecording
                  ? recordingSeconds < 2
                    ? `Wait ${2 - recordingSeconds}s`
                    : 'Stop & transcribe'
                  : 'Record lecture'}

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



          {documentAttachment ? (
            <View className="mb-4">
              <NotePdfViewer
                noteId={noteId}
                attachment={documentAttachment}
                onScrollLockChange={handleDocumentScrollLock}
              />
            </View>
          ) : null}

          {showImageGallery && imageAttachments.length > 0 ? (
            <ErrorBoundary fallbackTitle="Photos failed to load">
              <NoteImageGallery
                noteId={noteId}
                attachments={imageAttachments}
                editable={isPhotoNote && canEdit}
                onAttachmentsChange={handleImageAttachmentsChange}
                onAddPhotos={isPhotoNote && canEdit ? handleAddPhotos : undefined}
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
              className="mb-4 rounded-xl border border-lantern-border bg-lantern-background-secondary p-4 flex-row items-center gap-3"
            >
              <Ionicons name="logo-youtube" size={28} color="#ef4444" />
              <View className="flex-1">
                <Text className="text-sm font-medium text-lantern-text">
                  Linked YouTube video
                </Text>
                <Text className="text-xs text-lantern-primary mt-1">
                  Tap to open in YouTube
                </Text>
              </View>
            </Pressable>
          ) : null}

          {isYoutubeNote ? (
            <View className="mb-4 rounded-xl border border-lantern-border bg-lantern-surface p-4">
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
                    <Text className="text-xs font-medium text-lantern-primary">
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
          (selectedNote?.sourceType === 'pdf' || selectedNote?.sourceType === 'presentation') ? (
            <View className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
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
                          attachments:
                            prev.attachments?.map((a) =>
                              a.id === result.attachment.id ? result.attachment : a
                            ) ?? [result.attachment],
                        });
                        if (result.status === 'failed') {
                          Alert.alert('OCR failed', result.ocrError || 'Local OCR failed.');
                        }
                      })
                      .catch((err: unknown) => {
                        Alert.alert(
                          'OCR failed',
                          err instanceof Error ? err.message : 'Failed to run OCR'
                        );
                      })
                      .finally(() => setRunningOcr(false));
                  }}
                  disabled={runningOcr}
                >
                  {runningOcr ? 'Running OCR…' : 'Run OCR (local)'}
                </Button>
              ) : null}
            </View>
          ) : null}

          {isDocumentNote && !documentAttachment ? (
            <Text className="text-sm text-lantern-text-secondary mb-4">
              {selectedNote?.sourceType === 'presentation'
                ? extractionStatus === 'ok'
                  ? 'Slide preview is unavailable. Extracted text is available for AI tools.'
                  : 'Slide preview is unavailable. Extracted text may be missing — run OCR or add notes.'
                : 'Document preview is unavailable.'}
              {presentationAttachment?.fileName ? ` (${presentationAttachment.fileName})` : ''}
            </Text>
          ) : null}

          {isDocumentNote || isPhotoNote || isYoutubeNote ? (
            <>
              <Text className="text-sm font-semibold text-lantern-text mb-2">
                Your notes
              </Text>
              <TextInput
                value={body}
                onChangeText={setBody}
                editable={canEdit}
                accessibilityLabel="Note body"
                placeholder={
                  isPhotoNote
                    ? 'Add your own notes alongside these photos...'
                    : isYoutubeNote
                      ? 'Add your own notes alongside this video transcript...'
                      : 'Add your own notes on top of this document...'
                }
                placeholderTextColor="#94a3b8"
                multiline
                textAlignVertical="top"
                className="w-full min-h-[160px] p-4 rounded-xl border border-lantern-border bg-lantern-surface text-sm leading-relaxed text-lantern-text mb-4"
              />
            </>
          ) : (
          <TextInput

            value={body}

            onChangeText={setBody}
            editable={canEdit}
            accessibilityLabel="Note body"

            placeholder="Start typing your notes... Use headings, lists, and structure for better AI study tools."

            placeholderTextColor="#94a3b8"

            multiline

            textAlignVertical="top"

            className="w-full min-h-[280px] p-4 rounded-xl border border-lantern-border bg-lantern-surface text-sm leading-relaxed text-lantern-text mb-4"

          />
          )}



          {summary ? (

            <Card className="mb-4 border-lantern-primary/30 dark:border-lantern-primary/30 bg-lantern-primary-background/50 dark:bg-lantern-primary-background/20">

              <Text className="text-sm font-semibold text-lantern-primary-dark dark:text-lantern-primary-light mb-2">Smart Notes</Text>

              <MarkdownRenderer
                content={summary}
                enableMath={false}
                style={{ color: colors.text, fontSize: 14, lineHeight: 22 }}
              />

            </Card>

          ) : null}



          {canEdit ? <Card className="border-lantern-border">

            <Text className="text-sm font-semibold text-lantern-text mb-1">

              Learn from this note

            </Text>

            <Text className="text-sm text-lantern-text-secondary mb-3">

              AI tools to turn this note into study materials.

            </Text>

            <TextInput
              className="w-full px-3 py-2 mb-2 rounded-lg text-sm border border-lantern-border bg-lantern-background text-lantern-text"
              placeholder='Optional guidance — e.g. "focus on clinical applications"'
              placeholderTextColor={colors.textTertiary}
              value={smartNotesGuidance}
              onChangeText={setSmartNotesGuidance}
              maxLength={SMART_NOTES_GUIDANCE_MAX_CHARS}
            />

            <View className="flex-row gap-1 mb-3">
              {(
                [
                  ['concise', 'Concise'],
                  ['standard', 'Standard'],
                  ['deep', 'Deep dive'],
                ] as Array<[typeof smartNotesDepth, string]>
              ).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  onPress={() => setSmartNotesDepth(value)}
                  className={`flex-1 px-2 py-1.5 rounded-lg border items-center ${
                    smartNotesDepth === value
                      ? 'bg-lantern-primary border-lantern-primary'
                      : 'bg-lantern-background border-lantern-border'
                  }`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      smartNotesDepth === value ? 'text-white' : 'text-lantern-text-secondary'
                    }`}
                  >
                    {label} · {SMART_NOTES_CREDIT_COST[value]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="flex-row flex-wrap gap-2">

              <Button
                size="sm"
                variant="secondary"
                loading={summarizing}
                disabled={shortForSmartNote}
                onPress={() => void handleSummarize()}
              >

                Smart Note

              </Button>

              <Button size="sm" variant="secondary" onPress={handleChatWithNote}>
                Chat
              </Button>

              <Button
                size="sm"
                variant="secondary"
                loading={generatingCards}
                disabled={isAILoading || !canGenerateStudyMaterials || shortForOneCredit}
                onPress={() => void handleGenerateFlashcards()}
              >
                Flashcards
              </Button>

              <Button
                size="sm"
                variant="secondary"
                loading={generatingQuiz}
                disabled={!canGenerateStudyMaterials || shortForOneCredit}
                onPress={() => void handleGenerateQuiz()}
              >

                Quiz

              </Button>

            </View>

            <View className="mt-3">
              <AIUsageBadge variant="inline" cost={SMART_NOTES_CREDIT_COST[smartNotesDepth]} />
            </View>

          </Card> : null}

        </ScrollView>

      </KeyboardAvoidingView>

      <NoteCollaboratorsModal
        visible={showCollaborators}
        noteId={noteId}
        noteTitle={selectedNote?.title}
        currentUserId={user?.id}
        onClose={() => setShowCollaborators(false)}
      />

    </SafeAreaView>

  );

}



export default NoteEditorScreen;


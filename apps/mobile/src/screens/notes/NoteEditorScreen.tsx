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
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import { getNoteStudyContent, hasEnoughNoteStudyContent } from '@lantern/shared';
import { useNotesStore } from '../../stores/notesStore';

import { copyNote, summarizeNote, generateNoteQuiz, addImagesToPhotoNote } from '../../services/notes';

import { useAIHandlers } from '../../hooks/useAIHandlers';

import { Button, Card } from '../../components/ui';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { NotePdfViewer } from '../../components/NotePdfViewer';
import { NoteImageGallery } from '../../components/NoteImageGallery';
import { NoteCollaboratorsModal } from '../../components/NoteCollaboratorsModal';
import { useAuthStore } from '../../stores/authStore';
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

  const [generatingQuiz, setGeneratingQuiz] = useState(false);

  const [generatingCards, setGeneratingCards] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [parentScrollEnabled, setParentScrollEnabled] = useState(true);
  const handleDocumentScrollLock = useCallback((locked: boolean) => {
    setParentScrollEnabled(!locked);
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDocumentNote =
    selectedNote?.sourceType === 'pdf' || selectedNote?.sourceType === 'presentation';
  const isPhotoNote = selectedNote?.sourceType === 'photos';
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
            const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
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



  const handleSummarize = async () => {

    if (!studyContent.trim()) {

      Alert.alert('Empty note', 'Add some content before summarizing.');

      return;

    }

    setSummarizing(true);

    try {

      await saveNote(noteId, { title, body });

      const result = await summarizeNote(noteId);

      const newSummary = result.summary || '';

      setSummary(newSummary);

      if (result.note?.summary) setSummary(result.note.summary);

      await saveNote(noteId, { summary: newSummary });

    } catch (e: unknown) {

      Alert.alert('Error', e instanceof Error ? e.message : 'Summarize failed');

    } finally {

      setSummarizing(false);

    }

  };



  const handleGenerateFlashcards = async () => {
    if (!canGenerateStudyMaterials) {
      Alert.alert(
        'Not enough content',
        'Add at least 50 characters of study content. For presentations, wait for slide text extraction or add your own notes.'
      );
      return;
    }
    setGeneratingCards(true);
    try {
      const cards = await handleAIGenerateFlashcards(studyContent.slice(0, 8000), { count: 5, style: 'concise' });
      Alert.alert('Generated', `${cards.length} flashcard ideas created. Add them to a deck from Flashcards.`);
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
          contentContainerClassName="p-4 pb-10"
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

          {isDocumentNote && !documentAttachment ? (
            <Text className="text-sm text-lantern-text-secondary mb-4">
              {selectedNote?.sourceType === 'presentation'
                ? 'Slide preview is unavailable, but AI can still use extracted text from your deck.'
                : 'Document preview is unavailable.'}
              {presentationAttachment?.fileName ? ` (${presentationAttachment.fileName})` : ''}
            </Text>
          ) : null}

          {isDocumentNote || isPhotoNote ? (
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

              <Text className="text-sm font-semibold text-lantern-primary-dark dark:text-lantern-primary-light mb-2">Summary</Text>

              <Text className="text-sm text-lantern-text leading-relaxed">{summary}</Text>

            </Card>

          ) : null}



          {canEdit ? <Card className="border-lantern-border">

            <Text className="text-sm font-semibold text-lantern-text mb-1">

              Summary & quiz

            </Text>

            <Text className="text-sm text-lantern-text-secondary mb-3">

              AI tools to turn this note into study materials.

            </Text>

            <View className="flex-row flex-wrap gap-2">

              <Button size="sm" variant="secondary" loading={summarizing} onPress={() => void handleSummarize()}>

                Smart Note

              </Button>

              <Button
                size="sm"
                variant="secondary"
                loading={generatingCards}
                disabled={isAILoading || !canGenerateStudyMaterials}
                onPress={() => void handleGenerateFlashcards()}
              >
                Flashcards
              </Button>

              <Button
                size="sm"
                variant="secondary"
                loading={generatingQuiz}
                disabled={!canGenerateStudyMaterials}
                onPress={() => void handleGenerateQuiz()}
              >

                Quiz

              </Button>

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


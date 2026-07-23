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

import * as FileSystem from 'expo-file-system/legacy';

import { getNoteStudyContent, hasEnoughNoteStudyContent } from '@lantern/shared';
import { useNotesStore } from '../../stores/notesStore';

import { transcribeAudioForNote, summarizeNote, generateNoteQuiz, addImagesToPhotoNote } from '../../services/notes';

import { useAIHandlers } from '../../hooks/useAIHandlers';

import { Button, Card } from '../../components/ui';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { NotePdfViewer } from '../../components/NotePdfViewer';
import { NoteImageGallery } from '../../components/NoteImageGallery';
import { NoteCollaboratorsModal } from '../../components/NoteCollaboratorsModal';
import { useAuthStore } from '../../stores/authStore';
import * as ImagePicker from 'expo-image-picker';
import type { NoteAttachment } from '../../services/notes';

type NavigationProp = {

  goBack: () => void;

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

  const [recording, setRecording] = useState<{
    stopAndUnloadAsync: () => Promise<void>;
    getURI: () => string | null;
  } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const [transcribing, setTranscribing] = useState(false);
  const [transcribeStage, setTranscribeStage] = useState<'idle' | 'uploading' | 'transcribing'>('idle');
  const discardRecordingRef = useRef(false);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartedAtRef = useRef(0);
  const pauseAutosaveUntilRef = useRef(0);
  const MIN_RECORD_MS = 1500;
  const AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS = 4000;

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
    if (!isRecording) {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      return;
    }

    setRecordingSeconds(0);
    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [isRecording]);

  const formatRecordingDuration = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const scheduleSave = useCallback(
    (updates: { title?: string; body?: string; summary?: string }) => {
      if (Date.now() < pauseAutosaveUntilRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (Date.now() < pauseAutosaveUntilRef.current) return;
        saveNote(noteId, updates).catch(() => {});
      }, 800);
    },
    [noteId, saveNote]
  );

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!selectedNote || selectedNote.id !== noteId) return;
    if (title === selectedNote.title && body === selectedNote.body) return;
    scheduleSave({ title, body });
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [title, body, noteId, selectedNote?.id, selectedNote?.title, selectedNote?.body, scheduleSave]);



  const startRecording = async () => {
    try {
      discardRecordingRef.current = false;
      const { Audio } = await import('expo-av');
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Microphone access is required to record lectures.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
      });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingStartedAtRef.current = Date.now();
      setRecording(rec as { stopAndUnloadAsync: () => Promise<void>; getURI: () => string | null });
      setIsRecording(true);
    } catch {
      Alert.alert('Error', 'Could not start recording. Check microphone permission and try again.');
    }
  };



  const discardRecording = async () => {
    if (!recording) return;
    discardRecordingRef.current = true;
    setIsRecording(false);
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // ignore unload errors when discarding
    }
    setRecording(null);
  };



  const stopRecording = async () => {
    if (!recording) return;

    const elapsed = Date.now() - recordingStartedAtRef.current;
    if (!discardRecordingRef.current && elapsed < MIN_RECORD_MS) {
      Alert.alert('Keep recording', 'Keep recording for at least 2 seconds so we can capture audio.');
      return;
    }

    setIsRecording(false);
    if (discardRecordingRef.current) {
      discardRecordingRef.current = false;
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // ignore
      }
      setRecording(null);
      return;
    }

    setTranscribing(true);
    let stage: 'uploading' | 'transcribing' = 'uploading';
    setTranscribeStage(stage);
    const abortController = new AbortController();
    transcribeAbortRef.current = abortController;
    cancelPendingSave();
    pauseAutosaveUntilRef.current = Date.now() + AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (!uri) throw new Error('No recording file');

      const info = await FileSystem.getInfoAsync(uri);
      const byteLength = info.exists && 'size' in info ? Number(info.size) || 0 : 0;
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
      });
      if (!base64 || base64.length < 64 || (byteLength > 0 && byteLength < 256)) {
        throw new Error(
          `Recording was empty. Hold a bit longer, then stop again. (${Math.round(elapsed / 1000)}s, ${byteLength || base64.length}B)`
        );
      }

      const lowerUri = uri.toLowerCase();
      const mimeType = lowerUri.endsWith('.webm')
        ? 'audio/webm'
        : lowerUri.endsWith('.wav')
          ? 'audio/wav'
          : lowerUri.endsWith('.ogg')
            ? 'audio/ogg'
            : 'audio/mp4';
      const ext = lowerUri.endsWith('.webm')
        ? 'webm'
        : lowerUri.endsWith('.wav')
          ? 'wav'
          : lowerUri.endsWith('.ogg')
            ? 'ogg'
            : 'm4a';

      stage = 'transcribing';
      setTranscribeStage(stage);
      const result = await transcribeAudioForNote(base64, {
        mimeType,
        noteId,
        fileName: `lecture-${Date.now()}.${ext}`,
        signal: abortController.signal,
        currentBody: body,
        durationMs: elapsed,
        clientByteLength: byteLength || undefined,
        localFileUri: uri,
        useStoragePath: true,
      });

      if (result.transcript) {
        setBody((prev) =>
          prev.includes(result.transcript)
            ? prev
            : [prev, result.transcript].filter(Boolean).join('\n\n')
        );
        pauseAutosaveUntilRef.current = Date.now() + AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS;
      }
      if (result.persistWarning) {
        Alert.alert('Transcript ready', result.persistWarning);
      } else if (result.transcript) {
        Alert.alert('Transcript ready', 'Your lecture was transcribed into this note.');
      }
      // Refresh attachments/metadata without re-hydrating the draft (see lastHydratedNoteIdRef).
      await loadNote(noteId);
    } catch (e: unknown) {
      // User tapped cancel — AbortController was cleared in cancelTranscription.
      if (!transcribeAbortRef.current && e instanceof Error && e.name === 'AbortError') return;
      const message =
        e instanceof Error && e.name === 'AbortError'
          ? 'Transcription timed out. Try a shorter recording.'
          : e instanceof Error
            ? e.message
            : 'Could not transcribe audio';
      const stageHint =
        stage === 'uploading'
          ? ' (failed while uploading)'
          : ' (failed while transcribing)';
      Alert.alert('Transcription failed', `${message}${stageHint}`);
    } finally {
      transcribeAbortRef.current = null;
      setTranscribing(false);
      setTranscribeStage('idle');
    }
  };



  const cancelTranscription = () => {
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    setTranscribing(false);
    setTranscribeStage('idle');
  };



  const handleRecordPress = () => {
    if (isRecording) void stopRecording();
    else void startRecording();
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

          placeholder="Note title"

          placeholderTextColor="#94a3b8"

          className="flex-1 text-base font-semibold text-lantern-text"

        />

        {isSaving ? (

          <Text className="text-xs text-lantern-text-tertiary shrink-0">Saving...</Text>

        ) : null}

        <Pressable
          onPress={() => setShowCollaborators(true)}
          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
          accessibilityLabel="Manage collaborators"
        >
          <Ionicons name="people-outline" size={20} color="#6366f1" />
        </Pressable>

        <Pressable

          onPress={handleDelete}

          className="p-2 rounded-lg active:bg-red-50 dark:active:bg-red-900/20"

          accessibilityLabel="Delete note"

        >

          <Ionicons name="trash-outline" size={20} color="#ef4444" />

        </Pressable>

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

          <View className="flex-row flex-wrap gap-2 py-2 mb-2">

            <Button

              size="sm"

              variant={isRecording ? 'danger' : 'secondary'}

              onPress={handleRecordPress}

              disabled={
                transcribing || (isRecording && recordingSeconds < 2)
              }

            >

              {transcribing
                ? transcribeStage === 'uploading'
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

          </View>



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
                editable={isPhotoNote}
                onAttachmentsChange={handleImageAttachmentsChange}
                onAddPhotos={isPhotoNote ? handleAddPhotos : undefined}
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



          <Card className="border-lantern-border">

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

          </Card>

        </ScrollView>

      </KeyboardAvoidingView>

      <NoteCollaboratorsModal
        visible={showCollaborators}
        noteId={noteId}
        currentUserId={user?.id}
        onClose={() => setShowCollaborators(false)}
      />

    </SafeAreaView>

  );

}



export default NoteEditorScreen;


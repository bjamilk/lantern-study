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

import { transcribeAudioForNote, summarizeNote, generateNoteQuiz } from '../../services/notes';

import { useAIHandlers } from '../../hooks/useAIHandlers';

import { Button, Card } from '../../components/ui';
import { NotePdfViewer } from '../../components/NotePdfViewer';
import { NoteCollaboratorsModal } from '../../components/NoteCollaboratorsModal';
import { useAuthStore } from '../../stores/authStore';

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
  const { selectedNote, isLoading, isSaving, loadNote, saveNote, removeNote } = useNotesStore();

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
  const discardRecordingRef = useRef(false);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [summarizing, setSummarizing] = useState(false);

  const [generatingQuiz, setGeneratingQuiz] = useState(false);

  const [generatingCards, setGeneratingCards] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDocumentNote =
    selectedNote?.sourceType === 'pdf' || selectedNote?.sourceType === 'presentation';

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



  useEffect(() => {

    loadNote(noteId);

  }, [noteId, loadNote]);



  useEffect(() => {

    if (selectedNote?.id === noteId) {

      setTitle(selectedNote.title);

      setBody(selectedNote.body);

      setSummary(selectedNote.summary || '');

    }

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

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(() => {

        saveNote(noteId, updates).catch(() => {});

      }, 800);

    },

    [noteId, saveNote]

  );



  useEffect(() => {

    if (!selectedNote || selectedNote.id !== noteId) return;

    if (title === selectedNote.title && body === selectedNote.body) return;

    scheduleSave({ title, body });

    return () => {

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    };

  }, [title, body, noteId, selectedNote, scheduleSave]);



  const startRecording = async () => {
    try {
      discardRecordingRef.current = false;
      const { Audio } = await import('expo-av');
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Microphone access is required to record lectures.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec as { stopAndUnloadAsync: () => Promise<void>; getURI: () => string | null });
      setIsRecording(true);
    } catch {
      Alert.alert('Error', 'Could not start recording.');
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
    const abortController = new AbortController();
    transcribeAbortRef.current = abortController;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (!uri) throw new Error('No recording file');

      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });

      await transcribeAudioForNote(base64, {
        mimeType: 'audio/m4a',
        noteId,
        fileName: `lecture-${Date.now()}.m4a`,
        signal: abortController.signal,
      });

      await loadNote(noteId);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      Alert.alert('Transcription failed', e instanceof Error ? e.message : 'Could not transcribe audio');
    } finally {
      transcribeAbortRef.current = null;
      setTranscribing(false);
    }
  };



  const cancelTranscription = () => {
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    setTranscribing(false);
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

        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerClassName="p-4 pb-10">

          <View className="flex-row flex-wrap gap-2 py-2 mb-2">

            <Button

              size="sm"

              variant={isRecording ? 'danger' : 'secondary'}

              onPress={handleRecordPress}

              disabled={transcribing}

            >

              {transcribing ? 'Transcribing...' : isRecording ? 'Stop & transcribe' : 'Record lecture'}

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
              <NotePdfViewer noteId={noteId} attachment={documentAttachment} />
            </View>
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

          {isDocumentNote ? (
            <>
              <Text className="text-sm font-semibold text-lantern-text mb-2">
                Your notes
              </Text>
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Add your own notes on top of this document..."
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


import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  appendEssayAttempt,
  composeEssayNoteBody,
  currentEssayAttempt,
  essayAttemptLabel,
  essayDraftTooThin,
  essayFromMaterial,
  essaySourceNotes,
  essayStudioPriceLine,
  getNoteStudyContent,
  isEssayGraderMissing,
  isEssayNote,
  materialsForCourse,
  newEssayNoteTitle,
  studySetNotePayload,
  parseEssayNoteBody,
  selectEssayAttempt,
  startEssaySession,
  type EssaySession,
} from '@lantern/shared';
import { AI_FEATURE_CREDIT_COST, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, ScreenHeader, T } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { useNotesStore } from '../../stores/notesStore';
import { useToastStore } from '../../stores/toastStore';
import { aiGradeEssay } from '../../services/ai';

type Props = NativeStackScreenProps<StudyStackParamList, 'EssayStudio'>;

export function EssayStudioScreen({ navigation, route }: Props) {
  const { courseId, courseLabel, noteId, studySetId } = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const notes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const createNote = useNotesStore((s) => s.createNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const loadNote = useNotesStore((s) => s.loadNote);
  const showToast = useToastStore((s) => s.showToast);

  const courseNotes = useMemo(() => materialsForCourse(notes, courseId), [notes, courseId]);
  const essays = useMemo(() => courseNotes.filter(isEssayNote), [courseNotes]);
  const sources = useMemo(() => essaySourceNotes(courseNotes), [courseNotes]);

  const [session, setSession] = useState<EssaySession | null>(null);
  const [essayNoteId, setEssayNoteId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState(noteId || sources[0]?.id || '');
  const [grading, setGrading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const essayNoteIdRef = useRef<string | null>(null);
  essayNoteIdRef.current = essayNoteId;

  useEffect(() => {
    const open =
      selectedNote && selectedNote.id === noteId
        ? selectedNote
        : essays.find((row) => row.id === noteId);
    if (!open || !isEssayNote(open)) return;
    const parsed = parseEssayNoteBody(open.body);
    if (!parsed) return;
    setSession(parsed);
    setEssayNoteId(open.id);
  }, [essays, noteId, selectedNote]);

  useEffect(() => {
    if (sourceId && sources.some((note) => note.id === sourceId)) return;
    setSourceId(sources[0]?.id || '');
  }, [sourceId, sources]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const persist = useCallback(
    (next: EssaySession, id: string | null) => {
      if (!id) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveNote(id, { body: composeEssayNoteBody(next) }).catch(() => undefined);
      }, 600);
    },
    [saveNote]
  );

  const updateSession = (recipe: (current: EssaySession) => EssaySession) => {
    setSession((current) => {
      const base = current ?? startEssaySession({});
      const next = recipe(base);
      persist(next, essayNoteIdRef.current);
      return next;
    });
  };

  const loadFromFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['text/plain', 'text/markdown'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    if ((asset.mimeType ?? '').startsWith('image/')) {
      showToast('Import the photo as a note in this course, then load it here.', 'info');
      setImportOpen(true);
      return;
    }
    try {
      const text = await FileSystem.readAsStringAsync(asset.uri);
      updateSession((current) => ({
        ...current,
        sourceTitle: (asset.name || 'Draft').replace(/\.[^.]+$/, '') || 'Draft',
        draft: text,
      }));
    } catch {
      showToast('Could not read that file. Paste the draft instead.', 'error');
    }
  };

  const grade = async () => {
    const current = session ?? startEssaySession({});
    if (essayDraftTooThin(current.draft)) {
      showToast('Paste at least a short paragraph first.', 'info');
      return;
    }
    setGrading(true);
    try {
      const source = sources.find((note) => note.id === sourceId);
      const sourceNotes = source ? getNoteStudyContent(source) : '';
      let review: { overall: number; scores: EssaySession['attempts'][number]['scores']; feedback: string };
      try {
        const generated = await aiGradeEssay(current.draft, {
          rubricText: current.rubricText || undefined,
          prompt: current.prompt || undefined,
          sourceNotes: sourceNotes || undefined,
          sourceTitle: current.sourceTitle,
        });
        review = {
          overall: generated.overall,
          scores: generated.scores,
          feedback: generated.feedback,
        };
      } catch (error) {
        if (!isEssayGraderMissing(error)) throw error;
        const local = essayFromMaterial({
          draft: current.draft,
          rubricText: current.rubricText,
          prompt: current.prompt,
          sourceTitle: current.sourceTitle,
        });
        review = { overall: local.overall, scores: local.scores, feedback: local.feedback };
      }
      const next = appendEssayAttempt(current, review);
      let id = essayNoteId;
      if (!id) {
        const created = await createNote({
          title: newEssayNoteTitle(current.sourceTitle),
          body: composeEssayNoteBody(next),
          ...studySetNotePayload({ courseId, studySetId }),
        });
        id = created.id;
        setEssayNoteId(created.id);
        await loadNote(created.id);
      } else {
        persist(next, id);
      }
      setSession(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not grade the draft.', 'error');
    } finally {
      setGrading(false);
    }
  };

  const open = session ?? startEssaySession({});
  const attempt = currentEssayAttempt(open);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader title={courseLabel || 'Essay'} onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarClearance, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <T.Heading>Essay</T.Heading>
        <T.Body tone="secondary">{essayStudioPriceLine()}</T.Body>
        {essays.length > 0 ? (
          <View className="gap-2">
            <T.Label tone="secondary">HISTORY</T.Label>
            {essays.map((note) => (
              <Pressable
                key={note.id}
                onPress={() => {
                  void loadNote(note.id);
                  const parsed = parseEssayNoteBody(note.body);
                  if (parsed) {
                    setSession(parsed);
                    setEssayNoteId(note.id);
                  }
                }}
                className="min-h-[44px] rounded-xl border border-lantern-border px-3 py-2"
              >
                <T.Body>{note.title || 'Essay'}</T.Body>
              </Pressable>
            ))}
          </View>
        ) : null}
        <T.Caption tone="secondary">Assignment prompt (optional)</T.Caption>
        <TextInput
          value={open.prompt}
          onChangeText={(text) => updateSession((current) => ({ ...current, prompt: text }))}
          multiline
          className="min-h-[64px] rounded-xl border border-lantern-border px-3 py-2 text-body text-lantern-text"
          placeholderTextColor="#5b6a7f"
        />
        <T.Caption tone="secondary">Draft</T.Caption>
        <TextInput
          value={open.draft}
          onChangeText={(text) => updateSession((current) => ({ ...current, draft: text }))}
          multiline
          placeholder="Paste the assignment here, or load a note."
          className="min-h-[160px] rounded-xl border border-lantern-border px-3 py-2 text-body text-lantern-text"
          placeholderTextColor="#5b6a7f"
        />
        <View className="flex-row flex-wrap gap-2">
          <Button variant="secondary" onPress={() => void loadFromFile()}>
            Upload a text file
          </Button>
          <Button variant="secondary" onPress={() => setImportOpen(true)}>
            Import a photo
          </Button>
        </View>
        {sources.length === 0 ? (
          <T.Caption tone="secondary">
            Import a photo as a note to load camera text. Paste still works without one.
          </T.Caption>
        ) : (
          <View className="gap-2">
            <T.Label tone="secondary">LOAD FROM A NOTE</T.Label>
            {sources.map((note) => (
              <Pressable
                key={note.id}
                onPress={() => setSourceId(note.id)}
                className={`min-h-[44px] rounded-xl border px-3 py-2 ${
                  sourceId === note.id
                    ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint'
                    : 'border-lantern-border'
                }`}
              >
                <T.Body>{note.title || 'Untitled note'}</T.Body>
              </Pressable>
            ))}
            <Button
              variant="secondary"
              onPress={() => {
                const note = sources.find((row) => row.id === sourceId);
                if (!note) return;
                updateSession((current) => ({
                  ...current,
                  sourceNoteId: note.id,
                  sourceTitle: note.title || 'Untitled note',
                  draft: getNoteStudyContent(note),
                }));
              }}
            >
              Load from note
            </Button>
          </View>
        )}
        <T.Caption tone="secondary">Rubric (optional, one criterion per line)</T.Caption>
        <TextInput
          value={open.rubricText}
          onChangeText={(text) => updateSession((current) => ({ ...current, rubricText: text }))}
          multiline
          placeholder={'- Definition\n- Treatment\n- Signs'}
          className="min-h-[96px] rounded-xl border border-lantern-border px-3 py-2 text-body text-lantern-text"
          placeholderTextColor="#5b6a7f"
        />
        <Button disabled={grading} onPress={() => void grade()}>
          {grading
            ? 'Grading…'
            : attempt
              ? `Regrade · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`
              : `Grade · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
        </Button>
        {attempt ? (
          <View className="gap-2 rounded-xl border border-lantern-border p-3">
            <T.Label tone="secondary">PRACTICE SCORE</T.Label>
            <T.Title>{attempt.overall} / 100</T.Title>
            <T.Caption tone="secondary">Practice feedback, not an official grade.</T.Caption>
            {attempt.scores.map((row) => (
              <View key={row.criterionId}>
                <T.Body>
                  {row.label} · {row.score}/{row.max}
                </T.Body>
                {row.comment ? <T.Caption tone="secondary">{row.comment}</T.Caption> : null}
              </View>
            ))}
            <T.Body>{attempt.feedback}</T.Body>
            {open.attempts.length > 1 ? (
              <View className="flex-row flex-wrap gap-2">
                {open.attempts.map((row, index) => (
                  <Pressable
                    key={row.id}
                    onPress={() => updateSession((current) => selectEssayAttempt(current, index))}
                    className={`min-h-[44px] rounded-full border px-3 py-2 ${
                      index === open.currentIndex
                        ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint'
                        : 'border-lantern-border'
                    }`}
                  >
                    <T.Caption>{essayAttemptLabel(row, index)}</T.Caption>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Button
              variant="secondary"
              onPress={() => updateSession((current) => ({ ...current, draft: '' }))}
            >
              New draft
            </Button>
          </View>
        ) : null}
      </ScrollView>
      <ImportAndStudyModal
        visible={importOpen}
        courseId={courseId}
        onClose={() => setImportOpen(false)}
        onOpenNote={(id) => {
          setImportOpen(false);
          void loadNote(id).then(() => {
            const imported = useNotesStore.getState().selectedNote;
            if (!imported || imported.id !== id) return;
            setSourceId(imported.id);
            updateSession((current) => ({
              ...current,
              sourceNoteId: imported.id,
              sourceTitle: imported.title || 'Untitled note',
              draft: getNoteStudyContent(imported),
            }));
          });
        }}
      />
    </SafeAreaView>
  );
}

export default EssayStudioScreen;

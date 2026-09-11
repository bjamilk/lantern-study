import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  NOTES_STUDIO_DEPTHS,
  TURN_INTO_TARGETS,
  hasEnoughNoteStudyContent,
  isWalkableAttachment,
  materialsForCourse,
  materialsForStudySet,
  type TurnIntoTargetId,
} from '@lantern/shared';
import {
  AI_CREDIT_COSTS,
  SMART_NOTES_CREDIT_COST,
  formatCreditCost,
  getSmartNotesCreditCost,
} from '@lantern/shared/utils/aiCredits';
import type { SmartNotesDepth } from '@lantern/shared/utils/smartNotes';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, ScreenHeader, T } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useNotesStore } from '../../stores/notesStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { useJobsStore } from '../../stores/jobsStore';
import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { summarizeNote, generateNoteQuiz } from '../../services/notes';
import { aiGenerateFlashcards } from '../../services/ai';
import { saveGeneratedDeck, saveGeneratedTest } from '../../services/jobArtifacts';
import type { StudyNote } from '../../services/notes';

type Props = NativeStackScreenProps<StudyStackParamList, 'NotesStudio'>;

export function NotesStudioScreen({ navigation, route }: Props) {
  const { courseId, courseLabel, noteId, studySetId } = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const notes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const loadNote = useNotesStore((s) => s.loadNote);
  const setSelectedNote = useNotesStore((s) => s.setSelectedNote);
  const openCompanion = useCompanionStore((s) => s.open);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  const showToast = useToastStore((s) => s.showToast);
  const userId = useAuthStore((s) => s.user?.id);
  const startJob = useJobsStore((s) => s.startJob);

  const courseNotes = useMemo(
    () =>
      studySetId
        ? materialsForStudySet(notes, studySetId)
        : courseId
          ? materialsForCourse(notes, courseId)
          : notes,
    [notes, courseId, studySetId]
  );
  const note =
    (selectedNote && selectedNote.id === noteId ? selectedNote : null) ||
    courseNotes.find((row) => row.id === noteId) ||
    null;
  const walkable = note?.attachments?.find(isWalkableAttachment);

  const [depth, setDepth] = useState<SmartNotesDepth>('standard');
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (noteId) void loadNote(noteId);
  }, [loadNote, noteId]);

  useEffect(() => {
    if (!note) return;
    void setActiveNoteContext({ id: note.id, title: note.title || 'Untitled note' });
  }, [note, setActiveNoteContext]);

  const enhance = async () => {
    if (!note) return;
    if (!hasEnoughNoteStudyContent(note)) {
      showToast('Add more study content to this note first.', 'info');
      return;
    }
    setWriting(true);
    try {
      const result = await summarizeNote(note.id, { depth });
      if (result.note) {
        setSelectedNote({
          ...(useNotesStore.getState().selectedNote ?? note),
          ...result.note,
          summary: result.summary,
        });
      }
      showToast('Enhanced notes saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not enhance notes.', 'error');
    } finally {
      setWriting(false);
    }
  };

  const turnInto = useCallback(
    (target: TurnIntoTargetId, current: StudyNote) => {
      if (!hasEnoughNoteStudyContent(current)) {
        showToast('Add more study content to this note first.', 'info');
        return;
      }
      if (!userId) {
        showToast('Sign in to generate study materials.', 'error');
        return;
      }
      const noteTitle = current.title || 'Untitled Note';
      const content = (current.body || current.summary || '').slice(0, 8000);
      if (target === 'cards') {
        const count = normalizeFlashcardCount();
        startJob({
          kind: 'flashcards',
          sourceTitle: noteTitle,
          requestedCount: count,
          run: async ({ jobId, onServerJob, onStage }) => {
            const { flashcards } = await aiGenerateFlashcards(content, {
              count,
              style: 'concise',
              onJobUpdate: (p) => {
                if (p.jobId) onServerJob(p.jobId);
              },
            });
            if (!flashcards.length) {
              throw new Error('Could not generate flashcards from this note.');
            }
            onStage('Saving to your deck');
            const { ref, saved } = await saveGeneratedDeck({
              jobId,
              userId,
              cards: flashcards,
              deckName: `From: ${noteTitle}`,
              description: `Generated from note: ${noteTitle}`,
              courseId,
              studySetId,
            });
            return { artifact: ref, resultCount: saved };
          },
        });
        showToast('Building flashcards for this course…', 'info');
        return;
      }
      startJob({
        kind: 'test',
        sourceTitle: noteTitle,
        requestedCount: 10,
        requestedCountIsMax: true,
        run: async ({ jobId, onServerJob, onStage }) => {
          const { studyGoal } = useStudyGoalsStore.getState();
          const session = await generateNoteQuiz(current.id, studyGoal, 10, onServerJob);
          if (!session.questions.length) {
            throw new Error('Could not generate a test from this note.');
          }
          onStage('Saving your test');
          const { ref, saved } = await saveGeneratedTest({
            jobId,
            title: `Test · ${noteTitle}`,
            sourceNoteId: current.id,
            questions: session.questions,
            courseId,
          });
          return { artifact: ref, resultCount: saved };
        },
      });
      showToast('Building a practice test for this course…', 'info');
    },
    [courseId, studySetId, showToast, startJob, userId]
  );

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader
        title={note?.title || courseLabel || 'Notes'}
        subtitle="Notes studio"
        onBack={() => navigation.goBack()}
        right={
          <Pressable onPress={() => openCompanion()} accessibilityRole="button" accessibilityLabel="Ask">
            <T.Caption>Ask</T.Caption>
          </Pressable>
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarClearance, gap: 12 }}
      >
        {!note ? (
          <T.Body tone="secondary">{studySetId ? 'Open a note in this set first.' : 'Open a note in this course first.'}</T.Body>
        ) : (
          <>
            <T.Body>{note.body || 'This note is empty. Edit it to add study content.'}</T.Body>
            <View className="flex-row flex-wrap gap-2">
              <Button
                variant="secondary"
                onPress={() => navigation.navigate('NoteEditor', { noteId: note.id })}
              >
                Edit
              </Button>
              {walkable?.id ? (
                <Button
                  variant="secondary"
                  onPress={() =>
                    navigation.navigate('Walkthrough', {
                      noteId: note.id,
                      attachmentId: walkable.id,
                    })
                  }
                >
                  Walk through
                </Button>
              ) : null}
              <Button variant="secondary" onPress={() => openCompanion()}>
                Ask
              </Button>
            </View>
            <T.Label tone="secondary">ENHANCE</T.Label>
            <View className="flex-row flex-wrap gap-2">
              {NOTES_STUDIO_DEPTHS.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setDepth(option.id)}
                  className={`min-h-[44px] rounded-full border px-3 py-2 ${
                    depth === option.id
                      ? 'border-lantern-feature-notes-ink bg-lantern-feature-notes-tint'
                      : 'border-lantern-border'
                  }`}
                >
                  <T.Caption>
                    {option.label} · {formatCreditCost(SMART_NOTES_CREDIT_COST[option.id])}
                  </T.Caption>
                </Pressable>
              ))}
            </View>
            <Button disabled={writing} onPress={() => void enhance()}>
              {writing
                ? 'Enhancing…'
                : `Enhance notes · ${formatCreditCost(getSmartNotesCreditCost(depth))}`}
            </Button>
            <T.Label tone="secondary">TURN INTO</T.Label>
            <View className="flex-row flex-wrap gap-2">
              {TURN_INTO_TARGETS.map((target) => (
                <Button
                  key={target.id}
                  size="sm"
                  variant="secondary"
                  onPress={() => turnInto(target.id, note)}
                >
                  {`${target.label} · ${formatCreditCost(
                    target.id === 'cards'
                      ? AI_CREDIT_COSTS.generate_flashcards
                      : AI_CREDIT_COSTS.generate_questions
                  )}`}
                </Button>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default NotesStudioScreen;
